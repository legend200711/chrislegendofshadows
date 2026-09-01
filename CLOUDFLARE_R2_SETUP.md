# Cloudflare R2 Media Integration — Deployment Guide

## What Was Built

```
┌─────────────────────────────────────────────────┐
│               CHRIS LEGEND OF SHADOWS            │
│                                                   │
│  Public Website ──────── reads ──────────────>   │
│    music-player.html      Firebase /music         │
│    gallery.html           Firebase /gallery       │
│    gallery.html           Firebase /comments      │
│                                                   │
│  Founder Control ──────────────────────────────> │
│    music-library-admin.html                       │
│      │                                            │
│      ├─ POST file + Firebase ID token             │
│      │     ↓                                      │
│      │  Cloudflare Worker (chris-legend-media)    │
│      │  • Verifies Firebase ID token              │
│      │  • Confirms Founder email                  │
│      │  • Writes file to R2                       │
│      │  • Returns public R2 URL                   │
│      │     ↓                                      │
│      └─ Saves metadata to Firebase /music         │
│                          Firebase /gallery        │
└─────────────────────────────────────────────────┘
```

---

## Step 1 — Create the R2 Bucket

```bash
cd upload-worker
npm install

# Create the bucket
npx wrangler r2 bucket create chris-legend-media
```

---

## Step 2 — Enable Public Access on the Bucket

1. Go to **Cloudflare Dashboard → R2 → chris-legend-media → Settings**
2. Under **Public Access**, enable the **r2.dev** subdomain
3. Copy the public URL — it looks like:
   `https://pub-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.dev`

---

## Step 3 — Set Worker Secrets

```bash
cd upload-worker

# The exact Founder email
npx wrangler secret put FOUNDER_EMAIL
# Enter: christijerina46@gmail.com

# Firebase Project ID
npx wrangler secret put FIREBASE_PROJECT_ID
# Enter: bue12-f6a1f

# The public R2 base URL from Step 2
npx wrangler secret put MEDIA_PUBLIC_BASE
# Enter: https://pub-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.dev
```

---

## Step 4 — Deploy the Worker

```bash
cd upload-worker
npx wrangler deploy
```

The worker will be available at:
`https://chris-legend-media.YOUR-SUBDOMAIN.workers.dev`

---

## Step 5 — Update the Website with the Worker URL

Open `music-library-admin.html` and find this line:

```javascript
const WORKER_URL = "https://chris-legend-media.christijerina.workers.dev";
```

Replace it with your actual deployed Worker URL from Step 4.

---

## Step 6 — Update Firebase Security Rules

In the Firebase Console:

1. Go to **Realtime Database → Rules**
2. Replace the rules with the contents of `firebase-rules.json`
3. Click **Publish**

---

## Step 7 — Configure CORS on the R2 Bucket

1. Go to **Cloudflare Dashboard → R2 → chris-legend-media → Settings → CORS Policy**
2. Add this CORS rule:

```json
[
  {
    "AllowedOrigins": ["https://chrislegendofshadows.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

> Note: The Worker handles uploads (POST), so only GET/HEAD needs to be in R2 CORS.
> The Worker itself sets CORS headers for upload responses.

---

## Step 8 — Test the System

### Security Tests

1. **Logged out**: Try accessing `/upload/music` directly → should get 401
2. **Normal user**: Try with a non-Founder Firebase token → should get 403
3. **Founder**: Login at founder-login.html, go to Media Control → should work

### Functionality Tests

1. Founder uploads audio files → appears in Legendary Player
2. Founder uploads images → appears in Gallery
3. Public user visits Gallery → sees all R2 images
4. Public user visits Player → hears all R2 music
5. Upload progress panel shows per-file status
6. Duplicate file shows confirm dialog
7. Failed upload shows Retry button
8. Remove track from Firebase → disappears from Player

---

## Architecture Notes

### What's in Firebase vs R2

| Content | Location |
|---------|----------|
| Audio files (.mp3, .wav, etc.) | **R2** |
| Gallery images (.jpg, .png, etc.) | **R2** |
| Track metadata (title, URL, duration, etc.) | **Firebase /music** |
| Gallery image metadata (title, URL, etc.) | **Firebase /gallery** |
| Comments | **Firebase /comments** |
| Authentication | **Firebase Auth** |

### Security Model

```
Browser (Founder) ──── Firebase ID Token ──→ Worker
                                              │
                                              ├─ verifyFirebaseToken()
                                              │   • checks signature via Google public keys
                                              │   • validates expiry, audience, issuer
                                              │
                                              ├─ checks email === FOUNDER_EMAIL
                                              │
                                              └─ uploads to R2 ── returns public URL
```

R2 credentials **never leave the Worker**. The browser never sees them.

### Existing Media

Existing static images (`samiam.png`, `tam.png`) continue to appear in the gallery.
Existing localStorage tracks continue to work for the same browser session.
No existing data was deleted or migrated.

---

## File Summary

| File | Purpose |
|------|---------|
| `upload-worker/wrangler.toml` | Worker config + R2 binding |
| `upload-worker/src/index.js` | Secure upload Worker |
| `upload-worker/package.json` | Worker npm manifest |
| `firebase-rules.json` | Firebase Realtime DB security rules |
| `music-library-admin.html` | Founder Media Control (R2 + Firebase) |
| `music-player.html` | Legendary Player (now Firebase-backed) |
| `gallery.html` | Gallery (static + Firebase R2 images) |
