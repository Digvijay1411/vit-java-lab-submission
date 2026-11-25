// Tiny JSON-file "database" with a per-file write queue so concurrent
// requests never interleave writes and corrupt a file.
const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const queues = new Map();

function enqueue(file, task) {
  const prev = queues.get(file) || Promise.resolve();
  const next = prev.then(task, task);
  queues.set(
    file,
    next.catch(() => {})
  );
  return next;
}

async function readJSON(file, fallback) {
  const full = path.join(DATA_DIR, file);
  try {
    const raw = await fs.readFile(full, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJSON(file, data) {
  const full = path.join(DATA_DIR, file);
  const tmp = full + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, full);
}

// Read-modify-write a JSON file atomically relative to other calls on the
// same file. `mutator` receives the current value and returns the new one.
function update(file, fallback, mutator) {
  return enqueue(file, async () => {
    const current = await readJSON(file, fallback);
    const next = await mutator(current);
    await writeJSON(file, next);
    return next;
  });
}

module.exports = { readJSON, writeJSON, update };
