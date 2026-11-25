const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const SESSION_COOKIE = "lab_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12 hours

/**
 * Verify a Google Identity Services ID token and decide the caller's role.
 * Throws with a user-facing message on any rejection.
 */
async function verifyGoogleLogin(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error("Could not read your Google account email.");
  }
  if (!payload.email_verified) {
    throw new Error("Your Google email is not verified.");
  }

  const email = payload.email.toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const studentDomain = (process.env.STUDENT_EMAIL_DOMAIN || "").toLowerCase();

  let role;
  if (email === adminEmail) {
    role = "admin";
  } else if (studentDomain && email.endsWith("@" + studentDomain)) {
    role = "student";
  } else {
    throw new Error(
      `Only "@${studentDomain}" student accounts (or the admin account) may sign in here.`
    );
  }

  return {
    email,
    name: payload.name || email,
    picture: payload.picture || null,
    role,
  };
}

function issueSession(res, user) {
  const token = jwt.sign(user, process.env.SESSION_SECRET, { expiresIn: "12h" });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.BASE_URL?.startsWith("https"),
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function clearSession(res) {
  res.clearCookie(SESSION_COOKIE);
}

function readSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: "Not signed in." });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: "Not signed in." });
  if (user.role !== "admin") {
    return res.status(403).json({ error: "Admin access only." });
  }
  req.user = user;
  next();
}

module.exports = {
  verifyGoogleLogin,
  issueSession,
  clearSession,
  readSession,
  requireAuth,
  requireAdmin,
};
