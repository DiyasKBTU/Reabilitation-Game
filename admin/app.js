const API = "http://localhost:5000";
const token = localStorage.getItem("token");
const role = localStorage.getItem("role");

if (!token) {
  window.location.href = "../login/index.html";
}

if (role !== "admin") {
  alert("Тек admin кіре алады");
  window.location.href = "../game/index.html";
}

const contentUsers = document.getElementById("usersTable");
const contentPatients = document.getElementById("patientsTable");
const contentSessions = document.getElementById("sessionsTable");
const contentAccess = document.getElementById("accessTable");
const recentUsers = document.getElementById("recentUsers");

const totalUsers = document.getElementById("totalUsers");
const totalDoctors = document.getElementById("totalDoctors");
const totalPatients = document.getElementById("totalPatients");
const totalSessions = document.getElementById("totalSessions");

const searchInput = document.getElementById("searchInput");

const views = {
  overview: document.getElementById("overviewView"),
  users: document.getElementById("usersView"),
  patients: document.getElementById("patientsView"),
  sessions: document.getElementById("sessionsView"),
  access: document.getElementById("accessView")
};

let allUsers = [];
let allPatients = [];
let allSessions = [];

function switchView(name) {
  Object.values(views).forEach(v => v.classList.remove("active-view"));
  views[name].classList.add("active-view");

  document.querySelectorAll(".menu-item").forEach(btn => btn.classList.remove("active"));
  const activeBtn = document.querySelector(`.menu-item[data-view="${name}"]`);
  if (activeBtn) activeBtn.classList.add("active");
}

function statusBadge(value, onText = "Берілген", offText = "Жоқ") {
  return value
    ? `<span class="status status-on">${onText}</span>`
    : `<span class="status status-off">${offText}</span>`;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    }
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Қате");
  return data;
}

function renderOverview() {
  totalUsers.textContent = allUsers.length;
  totalDoctors.textContent = allUsers.filter(u => u.role === "doctor").length;
  totalPatients.textContent = allPatients.length;
  totalSessions.textContent = allSessions.length;

  const latestUsers = allUsers.slice(0, 5);

  if (!latestUsers.length) {
    recentUsers.innerHTML = `<div class="row-card">User жоқ</div>`;
    return;
  }

  recentUsers.innerHTML = latestUsers.map(user => `
    <div class="row-card">
      <div class="row-main">
        <div class="block"><strong>Username</strong>${user.username}</div>
        <div class="block"><strong>Email</strong>${user.email}</div>
        <div class="block"><strong>Role</strong>${user.role}</div>
        <div class="block"><strong>Platform</strong>${statusBadge(user.platformAccess)}</div>
        <div class="block"><strong>Database</strong>${statusBadge(user.databaseAccess)}</div>
        <div class="block"><strong>Blocked</strong>${statusBadge(!user.blocked, "Жоқ", "Иә")}</div>
      </div>
    </div>
  `).join("");
}

function renderUsers(users) {
  if (!users.length) {
    contentUsers.innerHTML = `<div class="row-card">User жоқ</div>`;
    return;
  }

  contentUsers.innerHTML = users.map(user => `
    <div class="row-card">
      <div class="row-main">
        <div class="block"><strong>Username</strong>${user.username}</div>
        <div class="block"><strong>Email</strong>${user.email}</div>
        <div class="block"><strong>Role</strong>${user.role}</div>
        <div class="block"><strong>Platform</strong>${statusBadge(user.platformAccess)}</div>
        <div class="block"><strong>Database</strong>${statusBadge(user.databaseAccess)}</div>
        <div class="block"><strong>Blocked</strong>${statusBadge(!user.blocked, "Жоқ", "Иә")}</div>
      </div>
    </div>
  `).join("");
}

function renderAccess(users) {
  const filtered = users.filter(user => user.role !== "admin");

  if (!filtered.length) {
    contentAccess.innerHTML = `<div class="row-card">Қолданушы жоқ</div>`;
    return;
  }

  contentAccess.innerHTML = filtered.map(user => `
    <div class="row-card">
      <div class="row-main">
        <div class="block"><strong>Username</strong>${user.username}</div>
        <div class="block"><strong>Email</strong>${user.email}</div>
        <div class="block"><strong>Role</strong>${user.role}</div>
        <div class="block"><strong>Platform</strong>${statusBadge(user.platformAccess)}</div>
        <div class="block"><strong>Database</strong>${statusBadge(user.databaseAccess)}</div>
        <div class="block"><strong>Blocked</strong>${statusBadge(!user.blocked, "Жоқ", "Иә")}</div>
      </div>

      <div class="row-actions">
        <button class="action-btn green" onclick="togglePlatform('${user._id}', ${!user.platformAccess})">
          ${user.platformAccess ? "Платф. алу" : "Платф. беру"}
        </button>

        <button class="action-btn blue" onclick="toggleDatabase('${user._id}', ${!user.databaseAccess})">
          ${user.databaseAccess ? "База алу" : "База беру"}
        </button>

        <button class="action-btn ${user.blocked ? "green" : "red"}" onclick="toggleBlock('${user._id}', ${!user.blocked})">
          ${user.blocked ? "Unblock" : "Block"}
        </button>

        <button class="action-btn purple" onclick="changeRole('${user._id}', '${user.role === "doctor" ? "patient" : "doctor"}')">
          ${user.role === "doctor" ? "Patient қыл" : "Doctor қыл"}
        </button>
      </div>
    </div>
  `).join("");
}

function renderPatients(patients) {
  if (!patients.length) {
    contentPatients.innerHTML = `<div class="row-card">Пациент жоқ</div>`;
    return;
  }

  contentPatients.innerHTML = patients.map(patient => `
    <div class="row-card">
      <div class="row-main">
        <div class="block"><strong>Аты</strong>${patient.fullName || "-"}</div>
        <div class="block"><strong>Жасы</strong>${patient.age ?? "-"}</div>
        <div class="block"><strong>Диагноз</strong>${patient.diagnosis || "-"}</div>
        <div class="block"><strong>Ескертпе</strong>${patient.notes || "-"}</div>
        <div class="block"><strong>Doctor ID</strong>${patient.doctorId || "-"}</div>
        <div class="block"><strong>ID</strong>${patient._id}</div>
      </div>
    </div>
  `).join("");
}

function renderSessions(sessions) {
  if (!sessions.length) {
    contentSessions.innerHTML = `<div class="row-card">Session жоқ</div>`;
    return;
  }

  contentSessions.innerHTML = sessions.map(session => `
    <div class="row-card">
      <div class="row-main">
        <div class="block"><strong>Patient ID</strong>${session.patientId}</div>
        <div class="block"><strong>Score</strong>${session.score}</div>
        <div class="block"><strong>Yaw</strong>${Number(session.yaw || 0).toFixed(1)}</div>
        <div class="block"><strong>Pitch</strong>${Number(session.pitch || 0).toFixed(1)}</div>
        <div class="block"><strong>Roll</strong>${Number(session.roll || 0).toFixed(1)}</div>
        <div class="block"><strong>Уақыты</strong>${new Date(session.createdAt).toLocaleString()}</div>
      </div>
    </div>
  `).join("");
}

async function loadAll() {
  try {
    allUsers = await fetchJSON(`${API}/api/admin/users`);
    allPatients = await fetchJSON(`${API}/api/admin/patients`);
    allSessions = await fetchJSON(`${API}/api/admin/sessions`);

    renderOverview();
    renderUsers(allUsers);
    renderPatients(allPatients);
    renderSessions(allSessions);
    renderAccess(allUsers);
  } catch (error) {
    alert(error.message);
  }
}

window.togglePlatform = async function (id, value) {
  try {
    const res = await fetchJSON(`${API}/api/admin/platform-access/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ value })
    });
    alert(res.message);
    await loadAll();
  } catch (error) {
    alert(error.message);
  }
};

window.toggleDatabase = async function (id, value) {
  try {
    const res = await fetchJSON(`${API}/api/admin/database-access/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ value })
    });
    alert(res.message);
    await loadAll();
  } catch (error) {
    alert(error.message);
  }
};

window.toggleBlock = async function (id, value) {
  try {
    const res = await fetchJSON(`${API}/api/admin/block/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ value })
    });
    alert(res.message);
    await loadAll();
  } catch (error) {
    alert(error.message);
  }
};

window.changeRole = async function (id, role) {
  try {
    const res = await fetchJSON(`${API}/api/admin/role/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ role })
    });
    alert(res.message);
    await loadAll();
  } catch (error) {
    alert(error.message);
  }
};

document.querySelectorAll(".menu-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("qaUsers").addEventListener("click", () => switchView("users"));
document.getElementById("qaPatients").addEventListener("click", () => switchView("patients"));
document.getElementById("qaSessions").addEventListener("click", () => switchView("sessions"));
document.getElementById("qaAccess").addEventListener("click", () => switchView("access"));

document.getElementById("goGameBtn").addEventListener("click", () => {
  window.location.href = "../game/index.html";
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.clear();
  window.location.href = "../login/index.html";
});

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();

  const filteredUsers = allUsers.filter(user =>
    (user.username || "").toLowerCase().includes(q) ||
    (user.email || "").toLowerCase().includes(q)
  );

  renderUsers(filteredUsers);
  renderAccess(filteredUsers);
});

loadAll();