/**
 * Chris Legend of Shadows — Secure Media Upload Worker
 *
 * Routes:
 *   OPTIONS  *                    → CORS preflight
 *   POST /upload/music            → Founder: upload audio file to R2
 *   POST /upload/gallery          → Founder: upload image file to R2
 *   DELETE /media/:key            → Founder: delete a file from R2
 *   GET  /health                  → public health check
 *
 * Security model:
 *   Every mutating request must carry a valid Firebase ID token in the
 *   Authorization header (Bearer <idToken>).  The Worker verifies the
 *   token via Google's public-key endpoint and confirms the email matches
 *   the Founder account.  No R2 credentials ever leave the Worker.
 *
 * Environment bindings (set via wrangler secret / wrangler.toml):
 *   env.MEDIA_BUCKET        R2 bucket binding
 *   env.FOUNDER_EMAIL       christijerina46@gmail.com
 *   env.FIREBASE_PROJECT_ID bue12-f6a1f
 *   env.MEDIA_PUBLIC_BASE   public base URL, e.g. https://pub-xxx.r2.dev
 */

/* ─── ALLOWED TYPES ──────────────────────────────────────────────────── */
const ALLOWED_AUDIO = new Set(["audio/mpeg","audio/mp3","audio/wav","audio/ogg","audio/aac","audio/x-m4a","audio/mp4"]);
const ALLOWED_IMAGE = new Set(["image/jpeg","image/jpg","image/png","image/gif","image/webp","image/avif"]);
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;   // 80 MB
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;   // 25 MB

/* ─── CORS HEADERS ───────────────────────────────────────────────────── */
const CORS = {
  "Access-Control-Allow-Origin": "https://chrislegendofshadows.com",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Name, X-File-Type, X-File-Size",
  "Access-Control-Max-Age": "86400",
};

function cors(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}

function json(obj, status = 200) {
  return cors(JSON.stringify(obj), status);
}

function err(msg, status = 400) {
  return cors(JSON.stringify({ error: msg }), status);
}

/* ─── FIREBASE ID TOKEN VERIFICATION ────────────────────────────────── */
/**
 * Verifies a Firebase ID token by fetching Google's public keys and
 * validating the JWT signature, expiry, audience, and issuer.
 * Returns the decoded payload or throws on failure.
 */
async function verifyFirebaseToken(idToken, projectId) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");

  const header  = JSON.parse(atob(parts[0].replace(/-/g,"+").replace(/_/g,"/")));
  const payload = JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")));

  // Basic claim checks
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now)        throw new Error("Token expired");
  if (payload.iat > now + 300)  throw new Error("Token issued in the future");
  if (payload.aud !== projectId) throw new Error("Wrong audience");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Wrong issuer");

  // Fetch Google's public keys
  const keysRes = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
    { cf: { cacheTtl: 3600 } }
  );
  if (!keysRes.ok) throw new Error("Could not fetch public keys");
  const keys = await keysRes.json();

  const pemCert = keys[header.kid];
  if (!pemCert) throw new Error("Unknown key ID");

  // Import the certificate and verify signature
  const certBody = pemCert
    .replace("-----BEGIN CERTIFICATE-----", "")
    .replace("-----END CERTIFICATE-----", "")
    .replace(/\s/g, "");
  const certDer = Uint8Array.from(atob(certBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    certDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sigBytes   = Uint8Array.from(
    atob(parts[2].replace(/-/g,"+").replace(/_/g,"/")),
    c => c.charCodeAt(0)
  );

  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sigBytes, signedPart);
  if (!valid) throw new Error("Invalid signature");

  return payload;
}

/* ─── AUTH MIDDLEWARE ────────────────────────────────────────────────── */
async function requireFounder(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: err("Missing Authorization header", 401) };
  }
  const idToken = authHeader.slice(7).trim();

  let payload;
  try {
    payload = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (e) {
    return { error: err("Invalid or expired token: " + e.message, 401) };
  }

  if (!payload.email || payload.email.toLowerCase() !== env.FOUNDER_EMAIL.toLowerCase()) {
    return { error: err("Unauthorized — Founder only", 403) };
  }

  return { payload };
}

/* ─── SAFE FILENAME / KEY ────────────────────────────────────────────── */
function safeKey(prefix, originalName) {
  // Sanitize: keep only alphanumeric, dot, dash, underscore
  const clean = originalName.replace(/[^a-zA-Z0-9._\-]/g, "_").slice(0, 200);
  const ts    = Date.now();
  return `${prefix}/${ts}_${clean}`;
}

/* ─── UPLOAD HANDLER ─────────────────────────────────────────────────── */
async function handleUpload(request, env, mediaType) {
  // Auth check
  const { error, payload } = await requireFounder(request, env);
  if (error) return error;

  // Read metadata from headers (avoids parsing multipart on large files)
  const fileName    = decodeURIComponent(request.headers.get("X-File-Name")  || "upload");
  const contentType = request.headers.get("X-File-Type") || request.headers.get("Content-Type") || "application/octet-stream";
  const fileSize    = parseInt(request.headers.get("X-File-Size") || "0", 10);

  // Validate content type
  const isAudio = mediaType === "music";
  const allowed = isAudio ? ALLOWED_AUDIO : ALLOWED_IMAGE;
  const maxSize = isAudio ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;

  // Normalize content-type for comparison
  const baseType = contentType.split(";")[0].trim().toLowerCase();
  if (!allowed.has(baseType)) {
    return err(`File type not allowed: ${baseType}`, 415);
  }

  if (fileSize > maxSize) {
    return err(`File too large. Maximum is ${Math.round(maxSize / 1024 / 1024)} MB`, 413);
  }

  // Reject dangerous filenames
  if (/\.(exe|bat|cmd|sh|php|py|rb|js|html|htm|svg)$/i.test(fileName)) {
    return err("File type not permitted", 415);
  }

  const prefix = isAudio ? "music" : "gallery";
  const key    = safeKey(prefix, fileName);

  // Upload to R2
  try {
    const uploaded = await env.MEDIA_BUCKET.put(key, request.body, {
      httpMetadata: {
        contentType: contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        originalName: fileName,
        uploadedBy:   payload.email,
        uploadedAt:   new Date().toISOString(),
        mediaType,
      },
    });

    const publicUrl = `${env.MEDIA_PUBLIC_BASE.replace(/\/$/, "")}/${key}`;

    return json({
      ok:        true,
      key:       uploaded.key,
      url:       publicUrl,
      size:      uploaded.size,
      mediaType,
    });
  } catch (e) {
    console.error("R2 put failed:", e);
    return err("Upload failed: " + e.message, 500);
  }
}

/* ─── DELETE HANDLER ─────────────────────────────────────────────────── */
async function handleDelete(request, env, key) {
  const { error } = await requireFounder(request, env);
  if (error) return error;

  if (!key || key.includes("..")) return err("Invalid key", 400);

  try {
    await env.MEDIA_BUCKET.delete(key);
    return json({ ok: true, deleted: key });
  } catch (e) {
    return err("Delete failed: " + e.message, 500);
  }
}

/* ─── CHECK DUPLICATE ────────────────────────────────────────────────── */
async function handleCheckDuplicate(request, env) {
  const { error } = await requireFounder(request, env);
  if (error) return error;

  const { prefix, fileName } = await request.json().catch(() => ({}));
  if (!prefix || !fileName) return err("prefix and fileName required", 400);

  const listed = await env.MEDIA_BUCKET.list({ prefix: `${prefix}/`, include: ["customMetadata"] });
  const match  = listed.objects.find(o =>
    (o.customMetadata?.originalName || "").toLowerCase() === fileName.toLowerCase()
  );

  return json({ exists: !!match, key: match?.key || null });
}

/* ─── MAIN FETCH ─────────────────────────────────────────────────────── */
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health check
    if (method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "chris-legend-media-worker" });
    }

    // Upload endpoints
    if (method === "POST" && url.pathname === "/upload/music") {
      return handleUpload(request, env, "music");
    }
    if (method === "POST" && url.pathname === "/upload/gallery") {
      return handleUpload(request, env, "gallery");
    }

    // Duplicate check
    if (method === "POST" && url.pathname === "/check-duplicate") {
      return handleCheckDuplicate(request, env);
    }

    // Delete
    if (method === "DELETE" && url.pathname.startsWith("/media/")) {
      const key = decodeURIComponent(url.pathname.slice("/media/".length));
      return handleDelete(request, env, key);
    }

    return err("Not found", 404);
  },
};
