# Founder Access Setup — One-Time Firebase Configuration

## Required before Founder login works

### 1. Enable Email/Password Authentication

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **bue12-f6a1f**
3. Left sidebar → **Authentication** → **Sign-in method** tab
4. Click **Email/Password** → Enable it → Save

### 2. Create the Founder Account

1. In Firebase Console → **Authentication** → **Users** tab
2. Click **Add user**
3. Email: `christijerina46@gmail.com`
4. Password: (set a strong password only the Founder knows)
5. Click **Add user**

### 3. Apply Database Security Rules

1. In Firebase Console → **Realtime Database** → **Rules** tab
2. Replace the existing rules with the contents of `docs/firebase-database-rules.json`
3. Click **Publish**

The rules enforce:
- **Public read** — anyone can read comments
- **Authenticated write** — any signed-in user (including anonymous) can post a comment
- **Own comment delete** — users can delete their own comments (matched by UID)
- **Founder delete** — the email-authenticated Founder can delete any comment

---

## How the Founder Login works

1. Founder visits `founder-login.html` (linked via the subtle `☽` in the music player footer)
2. Enters email and password → Firebase verifies credentials
3. On success → redirected to `music-library-admin.html`
4. Firebase Auth persists the session in the browser — the Founder stays logged in

## How the Guard works

`music-library-admin.html` fires a Firebase `onAuthStateChanged` check immediately on load.

- **Not signed in** → redirect to `founder-login.html`
- **Signed in as wrong email** → redirect to `founder-login.html`
- **Signed in as `christijerina46@gmail.com`** → page revealed

The page is covered by a full-screen black overlay until auth resolves.
Redirects use `window.location.replace()` so the admin page is not in browser history.
