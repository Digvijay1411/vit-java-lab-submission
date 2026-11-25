// Shared helpers used by both student.js and admin.js

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no JSON body
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

function formatDeadline(iso) {
  if (!iso) return "No deadline set";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

async function loadConfig() {
  return api("/api/config");
}

async function getCurrentUser() {
  try {
    return await api("/api/me");
  } catch {
    return null;
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  window.location.href = "/";
}
