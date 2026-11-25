(async function main() {
  const config = await loadConfig();
  const user = await getCurrentUser();

  if (user && user.role === "admin") {
    showDashboard(user);
  } else if (user) {
    // Logged in but not an admin — send them to the student view.
    window.location.href = "/";
  } else {
    initGoogleSignIn(config.googleClientId);
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
})();

function initGoogleSignIn(clientId) {
  if (!clientId) {
    document.getElementById("login-error").textContent =
      "Server is not configured yet (missing Google Client ID).";
    return;
  }
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleCredentialResponse,
  });
  window.google.accounts.id.renderButton(
    document.getElementById("g_id_signin_container"),
    { theme: "outline", size: "large", text: "signin_with", shape: "pill" }
  );
}

async function handleCredentialResponse(response) {
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  try {
    const user = await api("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken: response.credential }),
    });
    if (user.role !== "admin") {
      window.location.href = "/";
      return;
    }
    showDashboard(user);
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function showDashboard(user) {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");

  const userBox = document.getElementById("user-box");
  userBox.classList.remove("hidden");
  document.getElementById("user-name").textContent = `${user.name} (${user.email})`;

  await Promise.all([renderDriveStatus(), renderExperiments(), renderSubmissions()]);
}

async function renderDriveStatus() {
  const statusEl = document.getElementById("drive-status");
  const btn = document.getElementById("connect-drive-btn");
  try {
    const { connected } = await api("/api/admin/drive/status");
    if (connected) {
      statusEl.textContent = "✅ Connected";
      btn.textContent = "Reconnect Google Drive";
    } else {
      statusEl.textContent = "⚠️ Not connected yet — submissions cannot be saved until you connect.";
      btn.textContent = "Connect Google Drive";
    }
  } catch (err) {
    statusEl.textContent = "Could not check status.";
  }
}

async function renderExperiments() {
  const container = document.getElementById("experiments-admin-list");
  container.innerHTML = "Loading...";
  let experiments;
  try {
    experiments = await api("/api/experiments");
  } catch (err) {
    container.innerHTML = `<p class="status-msg error">${err.message}</p>`;
    return;
  }

  container.innerHTML = "";
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr><th>Experiment</th><th>Current deadline</th><th>Set new deadline</th><th></th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  for (const exp of experiments) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(exp.title)}</td>
      <td>${formatDeadline(exp.deadline)}</td>
      <td>
        <div class="deadline-form">
          <input type="datetime-local" id="deadline-${exp.id}" value="${toDatetimeLocalValue(
      exp.deadline
    )}" />
          <button class="btn btn-primary btn-small" id="save-${exp.id}">Save</button>
        </div>
      </td>
      <td><span class="status-msg" id="status-${exp.id}"></span></td>
    `;
    tbody.appendChild(tr);
  }

  container.appendChild(table);

  for (const exp of experiments) {
    document
      .getElementById(`save-${exp.id}`)
      .addEventListener("click", () => saveDeadline(exp.id));
  }
}

async function saveDeadline(id) {
  const input = document.getElementById(`deadline-${id}`);
  const statusEl = document.getElementById(`status-${id}`);
  statusEl.className = "status-msg";
  statusEl.textContent = "Saving...";

  const localValue = input.value; // "YYYY-MM-DDTHH:mm" in the browser's local time
  const iso = localValue ? new Date(localValue).toISOString() : null;

  try {
    await api(`/api/admin/experiments/${id}/deadline`, {
      method: "POST",
      body: JSON.stringify({ deadline: iso }),
    });
    statusEl.className = "status-msg success";
    statusEl.textContent = "Saved.";
    await renderExperiments();
  } catch (err) {
    statusEl.className = "status-msg error";
    statusEl.textContent = err.message;
  }
}

async function renderSubmissions() {
  const container = document.getElementById("submissions-table");
  container.innerHTML = "Loading...";
  let submissions;
  try {
    submissions = await api("/api/admin/submissions");
  } catch (err) {
    container.innerHTML = `<p class="status-msg error">${err.message}</p>`;
    return;
  }

  if (submissions.length === 0) {
    container.innerHTML = `<p class="small-muted">No submissions yet.</p>`;
    return;
  }

  submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr><th>Student</th><th>Experiment</th><th>File</th><th>Submitted at</th><th>Drive link</th></tr>
    </thead>
    <tbody>
      ${submissions
        .map(
          (s) => `
        <tr>
          <td>${escapeHtml(s.studentName)}<br/><span class="small-muted">${escapeHtml(
            s.studentEmail
          )}</span></td>
          <td>${escapeHtml(s.experimentTitle)}</td>
          <td>${escapeHtml(s.fileName)}</td>
          <td>${new Date(s.submittedAt).toLocaleString("en-IN")}</td>
          <td>${
            s.driveFileLink
              ? `<a href="${s.driveFileLink}" target="_blank" rel="noopener">Open</a>`
              : "—"
          }</td>
        </tr>`
        )
        .join("")}
    </tbody>
  `;
  container.innerHTML = "";
  container.appendChild(table);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
