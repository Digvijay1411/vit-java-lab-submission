# Java Lab Record Submission — VIT Vellore

A small web app for weekly Java lab-record submissions:

- **Students** sign in with their `@vitstudent.ac.in` Google account and upload a file
  for each of 10 experiments, before a per-experiment deadline.
- **Only the admin** (`shinde.digvijay@vit.ac.in` by default) can set/change deadlines.
  Students cannot edit them, and the server enforces the deadline itself (not the
  browser), so a student can't submit late by messing with their device clock.
- Every submitted file is uploaded straight into the **admin's own Google Drive**,
  inside a folder called **"Java"** (one subfolder per experiment).

No database server is needed — it stores its small amount of state (deadlines,
submission log) as JSON files on disk.

---

## 1. What you need to do in Google Cloud Console (one-time)

This app needs its own Google OAuth credentials. You (the admin) create these once.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a
   new project (e.g. "VIT Java Lab Submission").
2. **Enable the Google Drive API**: APIs & Services → Library → search "Google Drive
   API" → Enable.
3. **Configure the OAuth consent screen**: APIs & Services → OAuth consent screen.
   - User type: "External" is fine (or "Internal" if VIT's Workspace lets you restrict
     to vit.ac.in — either works for this app).
   - Add your own admin email as a **test user** if the app stays in "Testing" mode
     (this is fine — only you ever do the Drive OAuth consent, students never see
     this screen, they use plain Google Sign-In).
   - Scopes: you don't need to add anything manually here; the app requests
     `drive.file` at connect time.
4. **Create credentials**: APIs & Services → Credentials → Create Credentials →
   OAuth client ID → Application type **Web application**.
   - **Authorized JavaScript origins**: add the URL you'll deploy to, e.g.
     `https://your-app.onrender.com` (and `http://localhost:3000` while testing
     locally).
   - **Authorized redirect URIs**: add `https://your-app.onrender.com/auth/drive/callback`
     (and `http://localhost:3000/auth/drive/callback` for local testing).
   - Save. Copy the **Client ID** and **Client Secret**.

That's the only manual setup required on Google's side.

---

## 2. Configure the app

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | What to put |
|---|---|
| `BASE_URL` | The exact public URL you'll deploy to (no trailing slash) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From step 1 above |
| `STUDENT_EMAIL_DOMAIN` | `vitstudent.ac.in` (already set) |
| `ADMIN_EMAIL` | `shinde.digvijay@vit.ac.in` (already set) |
| `DRIVE_FOLDER_NAME` | `Java` (already set) |
| `SESSION_SECRET` | Any long random string — e.g. run `openssl rand -hex 32` |
| `MAX_UPLOAD_MB` | Max file size per upload (default 25) |

---

## 3. Run it

```bash
npm install
npm start
```

Visit `http://localhost:3000`.

- Go to `/admin.html` and sign in with `shinde.digvijay@vit.ac.in`.
- Click **"Connect Google Drive"** — this is a one-time consent screen where you
  (the admin) grant the app permission to create/update files in your own Drive.
  After this, the app can create the "Java" folder and upload into it automatically.
- Set a deadline for each of the 10 experiments.
- Students go to `/` and sign in with their `@vitstudent.ac.in` account to upload.

---

## 4. Deploying so students can actually reach it

Pick any Node.js host — Render, Railway, Fly.io, a VIT server, etc. The important
parts:

1. Deploy the whole project (it's a normal Node/Express app — `npm install` then
   `npm start`).
2. Set the same environment variables from `.env` in the host's dashboard
   (**do not** commit your real `.env` file — `.gitignore` already excludes it).
3. Set `BASE_URL` to the real deployed URL, and make sure that URL is added to the
   OAuth client's **Authorized JavaScript origins** and **Authorized redirect URIs**
   in Google Cloud Console (step 1.4 above) — update it if you change hosts.
4. After deploying, sign in once as admin and click "Connect Google Drive" again on
   the new URL (the connection is tied to where the app is running, it's a one-time
   step).

### Persistent storage note
This app stores its data in the `data/` folder (`experiments.json`, `submissions.json`,
`config.json`, `drive-token.json`). Most hosts (Render, Railway, etc.) give the
filesystem a **persistent disk** option for your app — make sure `data/` lives on a
disk that survives restarts/redeploys, or the deadlines and Drive connection would
need to be re-entered after every deploy. (Render: add a "Disk" mounted at the
project's `data` folder. Railway: use a Volume the same way.)

---

## How it works, in brief

- **Login**: Google Identity Services (the "Sign in with Google" button) runs in the
  browser and returns a signed ID token. The server verifies that token with Google,
  reads the verified email, and only accepts it if the email ends in
  `@vitstudent.ac.in` or exactly matches `ADMIN_EMAIL`. Anything else is rejected —
  this check happens on the server, so it can't be bypassed from the browser.
- **Deadlines**: stored in `data/experiments.json`. Only `/api/admin/.../deadline`
  (which requires the admin role) can change them. The submit endpoint independently
  re-checks the deadline against the server's own clock before accepting a file —
  a student has no path to extend or bypass it.
- **Drive upload**: uses a `drive.file` OAuth scope on the admin's account (connected
  once via "Connect Google Drive"). The refresh token is stored in
  `data/drive-token.json` and silently renewed by the googleapis library — nothing
  needs re-authorizing day to day. Files land in `Java/<Experiment Name>/`, named
  `studentemail__ExperimentName__originalfilename`.
- Resubmitting before the deadline overwrites the student's previous file in Drive
  (so Drive doesn't fill up with duplicate attempts) and updates the submission log.

## Customizing

- **Experiment titles/descriptions**: editable by admin via
  `POST /api/admin/experiments/:id/details` (no UI button yet, but you can also just
  edit `data/experiments.json` directly while the server is stopped).
- **Allowed file types**: currently any file type is accepted up to `MAX_UPLOAD_MB`.
  To restrict to e.g. `.java`/`.zip`/`.pdf`, add a `fileFilter` to the `multer(...)`
  call in `src/server.js`.
