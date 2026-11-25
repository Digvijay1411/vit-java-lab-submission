require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const crypto = require("crypto");

const store = require("./store");
const {
  verifyGoogleLogin,
  issueSession,
  clearSession,
  readSession,
  requireAuth,
  requireAdmin,
} = require("./auth");
const drive = require("./driveClient");

const REQUIRED_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SESSION_SECRET",
  "STUDENT_EMAIL_DOMAIN",
  "ADMIN_EMAIL",
  "BASE_URL",
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.warn(
      `[config] ${key} is not set — copy .env.example to .env and fill it in.`
    );
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// ---------- Config exposed to the frontend ----------
app.get("/api/config", (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    studentDomain: process.env.STUDENT_EMAIL_DOMAIN || "",
  });
});

// ---------- Auth ----------
app.post("/api/auth/google", async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "Missing idToken." });
  try {
    const user = await verifyGoogleLogin(idToken);
    issueSession(res, user);
    res.json({ email: user.email, name: user.name, role: user.role });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: "Not signed in." });
  res.json({ email: user.email, name: user.name, role: user.role });
});

// ---------- Experiments (read) ----------
app.get("/api/experiments", requireAuth, async (req, res) => {
  const experiments = await store.readJSON("experiments.json", []);
  const submissions = await store.readJSON("submissions.json", []);

  const mine =
    req.user.role === "admin"
      ? null
      : submissions.filter((s) => s.studentEmail === req.user.email);

  const now = Date.now();
  const result = experiments.map((exp) => {
    const deadlineMs = exp.deadline ? new Date(exp.deadline).getTime() : null;
    const isOpen = deadlineMs === null ? true : now < deadlineMs;
    const base = {
      id: exp.id,
      title: exp.title,
      description: exp.description || "",
      deadline: exp.deadline,
      isOpen,
    };
    if (mine) {
      const sub = mine.find((s) => s.experimentId === exp.id);
      base.mySubmission = sub
        ? { fileName: sub.fileName, submittedAt: sub.submittedAt }
        : null;
    }
    return base;
  });

  res.json(result);
});

// ---------- Admin: set deadline (and optionally title/description) ----------
app.post("/api/admin/experiments/:id/deadline", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { deadline } = req.body || {};
  if (deadline && isNaN(new Date(deadline).getTime())) {
    return res.status(400).json({ error: "Invalid date/time." });
  }
  const updated = await store.update("experiments.json", [], (list) => {
    return list.map((exp) =>
      exp.id === id ? { ...exp, deadline: deadline || null } : exp
    );
  });
  res.json(updated.find((e) => e.id === id));
});

app.post("/api/admin/experiments/:id/details", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { title, description } = req.body || {};
  const updated = await store.update("experiments.json", [], (list) => {
    return list.map((exp) =>
      exp.id === id
        ? {
            ...exp,
            title: title?.trim() ? title.trim() : exp.title,
            description: description ?? exp.description,
          }
        : exp
    );
  });
  res.json(updated.find((e) => e.id === id));
});

// ---------- Admin: Drive connection ----------
app.get("/api/admin/drive/status", requireAdmin, async (req, res) => {
  res.json({ connected: await drive.isConnected() });
});

app.get("/auth/drive/connect", requireAdmin, (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("drive_oauth_state", state, { httpOnly: true, maxAge: 5 * 60 * 1000 });
  res.redirect(drive.getAuthUrl(state));
});

app.get("/auth/drive/callback", requireAdmin, async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies?.drive_oauth_state;
  if (!code || !state || state !== expectedState) {
    return res.status(400).send("Invalid OAuth callback (state mismatch). Try connecting again.");
  }
  try {
    await drive.saveTokensFromCode(code);
    res.redirect("/admin.html?drive=connected");
  } catch (err) {
    res.status(500).send("Failed to connect Google Drive: " + err.message);
  }
});

// ---------- Admin: view all submissions ----------
app.get("/api/admin/submissions", requireAdmin, async (req, res) => {
  const submissions = await store.readJSON("submissions.json", []);
  res.json(submissions);
});

// ---------- Student: submit a lab record ----------
app.post(
  "/api/experiments/:id/submit",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    if (req.user.role !== "student") {
      return res.status(403).json({ error: "Only students can submit lab records." });
    }
    const id = Number(req.params.id);
    const experiments = await store.readJSON("experiments.json", []);
    const exp = experiments.find((e) => e.id === id);
    if (!exp) return res.status(404).json({ error: "Experiment not found." });

    const deadlineMs = exp.deadline ? new Date(exp.deadline).getTime() : null;
    if (deadlineMs !== null && Date.now() >= deadlineMs) {
      return res.status(403).json({
        error: `The deadline for "${exp.title}" has passed. Submission is closed.`,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const submissions = await store.readJSON("submissions.json", []);
    const existing = submissions.find(
      (s) => s.experimentId === id && s.studentEmail === req.user.email
    );

    const safeName = req.file.originalname.replace(/[^\w.\-() ]/g, "_");
    const driveFileName = `${req.user.email}__${exp.title}__${safeName}`;

    let uploadResult;
    try {
      uploadResult = await drive.uploadSubmission({
        experimentTitle: exp.title,
        fileName: driveFileName,
        mimeType: req.file.mimetype || "application/octet-stream",
        buffer: req.file.buffer,
        existingFileId: existing?.driveFileId,
      });
    } catch (err) {
      return res.status(502).json({
        error: "Could not save your file to Google Drive: " + err.message,
      });
    }

    const record = {
      id: existing?.id || crypto.randomUUID(),
      experimentId: id,
      experimentTitle: exp.title,
      studentEmail: req.user.email,
      studentName: req.user.name,
      fileName: req.file.originalname,
      driveFileId: uploadResult.fileId,
      driveFileLink: uploadResult.webViewLink,
      submittedAt: new Date().toISOString(),
    };

    await store.update("submissions.json", [], (list) => {
      const others = list.filter(
        (s) => !(s.experimentId === id && s.studentEmail === req.user.email)
      );
      return [...others, record];
    });

    res.json({ ok: true, submittedAt: record.submittedAt });
  }
);

// Friendly error for files over the size limit
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ error: `File is too large. Max ${process.env.MAX_UPLOAD_MB || 25} MB.` });
  }
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`Java Lab Record Submission running on ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
});
