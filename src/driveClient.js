// Manages the ONE Google Drive OAuth connection — the admin's account
// (ADMIN_EMAIL) — that all student submissions get uploaded into.
const fs = require("fs/promises");
const path = require("path");
const { google } = require("googleapis");

const TOKEN_FILE = path.join(__dirname, "..", "data", "drive-token.json");
const CONFIG_FILE = path.join(__dirname, "..", "data", "config.json");
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BASE_URL}/auth/drive/callback`
  );
}

function getAuthUrl(state) {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensures a refresh_token is returned every time
    scope: [DRIVE_SCOPE],
    state,
  });
}

async function saveTokensFromCode(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove this app's access at " +
        "https://myaccount.google.com/permissions and try connecting again."
    );
  }
  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf8");
}

async function loadTokens() {
  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function isConnected() {
  return (await loadTokens()) !== null;
}

async function getAuthorizedClient() {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error(
      "The admin has not connected Google Drive yet. Log in as admin and click " +
        '"Connect Google Drive" first.'
    );
  }
  const client = oauthClient();
  client.setCredentials(tokens);
  client.on("tokens", async (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    await fs.writeFile(TOKEN_FILE, JSON.stringify(merged, null, 2), "utf8");
  });
  return client;
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

// Finds (or creates) the top-level folder named DRIVE_FOLDER_NAME in the
// admin's Drive, and a subfolder per experiment inside it. IDs are cached
// in config.json so we don't re-search Drive on every upload.
async function ensureFolders(drive, experimentTitle) {
  const config = await readConfig();
  const folderName = process.env.DRIVE_FOLDER_NAME || "Java";

  let rootId = config.rootFolderId;
  if (!rootId) {
    rootId = await findOrCreateFolder(drive, folderName, null);
    config.rootFolderId = rootId;
    await writeConfig(config);
  }

  config.experimentFolders = config.experimentFolders || {};
  let expId = config.experimentFolders[experimentTitle];
  if (!expId) {
    expId = await findOrCreateFolder(drive, experimentTitle, rootId);
    config.experimentFolders[experimentTitle] = expId;
    await writeConfig(config);
  }

  return { rootId, experimentFolderId: expId };
}

async function findOrCreateFolder(drive, name, parentId) {
  const parentClause = parentId
    ? `and '${parentId}' in parents`
    : "and 'root' in parents";
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escapeForQuery(
    name
  )}' and trashed=false ${parentClause}`;

  const list = await drive.files.list({
    q,
    fields: "files(id, name)",
    spaces: "drive",
  });
  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  return created.data.id;
}

function escapeForQuery(name) {
  return name.replace(/'/g, "\\'");
}

/**
 * Upload (or, if driveFileId is given, overwrite) a file into the folder for
 * the given experiment. Returns { fileId, webViewLink }.
 */
async function uploadSubmission({
  experimentTitle,
  fileName,
  mimeType,
  buffer,
  existingFileId,
}) {
  const auth = await getAuthorizedClient();
  const drive = google.drive({ version: "v3", auth });
  const { experimentFolderId } = await ensureFolders(drive, experimentTitle);

  const media = { mimeType, body: bufferToStream(buffer) };

  if (existingFileId) {
    try {
      const updated = await drive.files.update({
        fileId: existingFileId,
        media,
        requestBody: { name: fileName },
        fields: "id, webViewLink",
      });
      return { fileId: updated.data.id, webViewLink: updated.data.webViewLink };
    } catch (err) {
      // Previous file may have been deleted/moved by hand — fall through to create a new one.
    }
  }

  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [experimentFolderId] },
    media,
    fields: "id, webViewLink",
  });
  return { fileId: created.data.id, webViewLink: created.data.webViewLink };
}

const { Readable } = require("stream");
function bufferToStream(buffer) {
  return Readable.from(buffer);
}

module.exports = {
  getAuthUrl,
  saveTokensFromCode,
  isConnected,
  uploadSubmission,
};
