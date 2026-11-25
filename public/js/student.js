(async function main() {
  const config = await loadConfig();
  document.getElementById("domain-note").textContent = config.studentDomain
    ? `Only @${config.studentDomain} accounts can sign in as a student.`
    : "";

  const user = await getCurrentUser();
  if (user) {
    showDashboard(user);
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
    if (user.role === "admin") {
      window.location.href = "/admin.html";
      return;
    }
    showDashboard(user);
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function showDashboard(user) {
  if (user.role === "admin") {
    window.location.href = "/admin.html";
    return;
  }
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");

  const userBox = document.getElementById("user-box");
  userBox.classList.remove("hidden");
  document.getElementById("user-name").textContent = `${user.name} (${user.email})`;
  document.getElementById("user-pic").classList.add("hidden");

  await renderExperiments();
}

async function renderExperiments() {
  const grid = document.getElementById("experiments-grid");
  grid.innerHTML = "Loading...";
  let experiments;
  try {
    experiments = await api("/api/experiments");
  } catch (err) {
    grid.innerHTML = `<p class="status-msg error">${err.message}</p>`;
    return;
  }

  grid.innerHTML = "";
  for (const exp of experiments) {
    grid.appendChild(renderCard(exp));
  }
}

function renderCard(exp) {
  const card = document.createElement("div");
  card.className = "card";

  const submitted = !!exp.mySubmission;
  const badgeClass = !exp.isOpen ? "closed" : submitted ? "submitted" : "open";
  const badgeText = !exp.isOpen ? "Closed" : submitted ? "Submitted" : "Open";

  card.innerHTML = `
    <h3>${escapeHtml(exp.title)}</h3>
    <span class="badge ${badgeClass}">${badgeText}</span>
    <div class="deadline-text">Deadline: ${formatDeadline(exp.deadline)}</div>
    ${
      submitted
        ? `<div class="small-muted">Last submitted: ${escapeHtml(
            exp.mySubmission.fileName
          )} — ${new Date(exp.mySubmission.submittedAt).toLocaleString("en-IN")}</div>`
        : ""
    }
    <div class="file-row">
      <input type="file" id="file-${exp.id}" ${!exp.isOpen ? "disabled" : ""} />
      <button class="btn btn-primary btn-small" id="submit-${exp.id}" ${
    !exp.isOpen ? "disabled" : ""
  }>${submitted ? "Resubmit" : "Submit"}</button>
    </div>
    <div class="status-msg" id="status-${exp.id}"></div>
  `;

  const btn = card.querySelector(`#submit-${exp.id}`);
  btn.addEventListener("click", () => submitExperiment(exp.id));

  return card;
}

async function submitExperiment(id) {
  const fileInput = document.getElementById(`file-${id}`);
  const statusEl = document.getElementById(`status-${id}`);
  const btn = document.getElementById(`submit-${id}`);
  statusEl.className = "status-msg";
  statusEl.textContent = "";

  if (!fileInput.files.length) {
    statusEl.className = "status-msg error";
    statusEl.textContent = "Choose a file first.";
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  btn.disabled = true;
  statusEl.textContent = "Uploading...";
  try {
    await api(`/api/experiments/${id}/submit`, { method: "POST", body: formData });
    statusEl.className = "status-msg success";
    statusEl.textContent = "Submitted successfully.";
    await renderExperiments();
  } catch (err) {
    statusEl.className = "status-msg error";
    statusEl.textContent = err.message;
    btn.disabled = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
