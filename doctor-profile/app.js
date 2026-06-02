const API = "http://localhost:5000";
const token = localStorage.getItem("token");
const roleValue = localStorage.getItem("role");
const usernameValue = localStorage.getItem("username") || "";

if (!token) {
  window.location.href = "http://localhost:5500/login/";
}

if (roleValue !== "doctor" && roleValue !== "admin") {
  window.location.href = "http://localhost:5500/game/";
}

const doctorFullNameText = document.getElementById("doctorFullNameText");
const doctorRoleText = document.getElementById("doctorRoleText");
const doctorEmailMini = document.getElementById("doctorEmailMini");

const heroAvatar = document.getElementById("heroAvatar");
const sidebarAvatar = document.getElementById("sidebarAvatar");
const sidebarName = document.getElementById("sidebarName");
const sidebarSubtitle = document.getElementById("sidebarSubtitle");

const statPatients = document.getElementById("statPatients");
const statSessions = document.getElementById("statSessions");
const statBestScore = document.getElementById("statBestScore");
const statRole = document.getElementById("statRole");

const infoUsername = document.getElementById("infoUsername");
const infoRole = document.getElementById("infoRole");
const infoFullName = document.getElementById("infoFullName");
const infoEmail = document.getElementById("infoEmail");
const infoPhone = document.getElementById("infoPhone");
const infoSpecialty = document.getElementById("infoSpecialty");
const infoWorkplace = document.getElementById("infoWorkplace");
const infoBio = document.getElementById("infoBio");

const openPersonalModalBtn = document.getElementById("openPersonalModalBtn");
const closePersonalModalBtn = document.getElementById("closePersonalModalBtn");
const cancelPersonalModalBtn = document.getElementById("cancelPersonalModalBtn");
const savePersonalBtn = document.getElementById("savePersonalBtn");
const personalModal = document.getElementById("personalModal");

const fullNameInput = document.getElementById("fullName");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const specialtyInput = document.getElementById("specialty");
const workplaceInput = document.getElementById("workplace");
const bioInput = document.getElementById("bio");
const newPasswordInput = document.getElementById("newPassword");

const avatarInput = document.getElementById("avatarInput");

const backToDoctorBtn = document.getElementById("backToDoctorBtn");
const goDoctorDashboardBtn = document.getElementById("goDoctorDashboardBtn");
const goGameBtn = document.getElementById("goGameBtn");
const logoutBtn = document.getElementById("logoutBtn");

let currentAvatar = "";

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (res.status === 401) {
    localStorage.clear();
    window.location.href = "http://localhost:5500/login/";
    throw new Error("Сессия аяқталды");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Қате");
  return data;
}

function setAvatar(name, imageData) {
  const first = (name || usernameValue || "D").trim().charAt(0).toUpperCase() || "D";

  if (imageData) {
    heroAvatar.style.backgroundImage = `url(${imageData})`;
    sidebarAvatar.style.backgroundImage = `url(${imageData})`;

    heroAvatar.style.backgroundSize = "cover";
    heroAvatar.style.backgroundPosition = "center";
    sidebarAvatar.style.backgroundSize = "cover";
    sidebarAvatar.style.backgroundPosition = "center";

    heroAvatar.textContent = "";
    sidebarAvatar.textContent = "";
  } else {
    heroAvatar.style.backgroundImage = "";
    sidebarAvatar.style.backgroundImage = "";

    heroAvatar.textContent = first;
    sidebarAvatar.textContent = first;
  }
}

function fillInfo(user) {
  const fullName = user.fullName || user.username || "Doctor";
  const email = user.email || "-";
  const phone = user.phone || "-";
  const specialty = user.specialty || "-";
  const workplace = user.workplace || "-";
  const bio = user.bio || "-";

  doctorFullNameText.textContent = fullName;
  doctorRoleText.textContent = `${user.role || "doctor"} account settings`;
  doctorEmailMini.textContent = email;

  if (sidebarName) sidebarName.textContent = fullName;
  if (sidebarSubtitle) sidebarSubtitle.textContent = user.specialty || "Doctor profile";

  infoUsername.textContent = user.username || "-";
  infoRole.textContent = user.role || "doctor";
  infoFullName.textContent = fullName;
  infoEmail.textContent = email;
  infoPhone.textContent = phone;
  infoSpecialty.textContent = specialty;
  infoWorkplace.textContent = workplace;
  infoBio.textContent = bio;

  statRole.textContent = user.role || "doctor";

  fullNameInput.value = user.fullName || "";
  emailInput.value = user.email || "";
  phoneInput.value = user.phone || "";
  specialtyInput.value = user.specialty || "";
  workplaceInput.value = user.workplace || "";
  bioInput.value = user.bio || "";

  currentAvatar = user.avatar || "";
  setAvatar(fullName, currentAvatar);

  localStorage.setItem("fullName", user.fullName || "");
  localStorage.setItem("email", user.email || "");
  localStorage.setItem("avatar", user.avatar || "");
}

async function loadProfile() {
  try {
    const data = await apiFetch(`${API}/api/auth/me`);
    fillInfo(data);
  } catch (error) {
    console.error("LOAD PROFILE ERROR:", error);
    if (!error.message.includes("Сессия")) {
      alert(error.message || "Профиль жүктеу қатесі");
    }
  }
}

async function saveProfile(showMessage = true) {
  try {
    const body = {
      fullName: fullNameInput.value.trim(),
      email: emailInput.value.trim(),
      phone: phoneInput.value.trim(),
      specialty: specialtyInput.value.trim(),
      workplace: workplaceInput.value.trim(),
      bio: bioInput.value.trim(),
      avatar: currentAvatar || ""
    };

    const newPassword = newPasswordInput.value.trim();
    if (newPassword) {
      body.password = newPassword;
    }

    const data = await apiFetch(`${API}/api/auth/update-profile`, {
      method: "PUT",
      body: JSON.stringify(body)
    });

    fillInfo(data.user);
    newPasswordInput.value = "";
    if (showMessage) {
      closeModal(personalModal);
      alert("Профиль сақталды");
    }
  } catch (error) {
    console.error("SAVE PROFILE ERROR:", error);
    alert(error.message || "Сервер қатесі");
  }
}

function openModal(modal) {
  modal.classList.remove("hidden");
}

function closeModal(modal) {
  modal.classList.add("hidden");
}

async function loadStats() {
  try {
    const patients = await apiFetch(`${API}/api/patient`);

    const patientCount = Array.isArray(patients) ? patients.length : 0;
    statPatients.textContent = patientCount;

    let allSessions = [];
    if (Array.isArray(patients)) {
      for (const patient of patients) {
        try {
          const sessions = await apiFetch(`${API}/api/session/${patient._id}`);
          if (Array.isArray(sessions)) {
            allSessions = allSessions.concat(sessions);
          }
        } catch (e) {
          console.error(e);
        }
      }
    }

    statSessions.textContent = allSessions.length;
    statBestScore.textContent = allSessions.length
      ? Math.max(...allSessions.map((s) => Number(s.score || 0)))
      : 0;
  } catch (error) {
    console.error("LOAD STATS ERROR:", error);
    statPatients.textContent = "0";
    statSessions.textContent = "0";
    statBestScore.textContent = "0";
  }
}

avatarInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    currentAvatar = reader.result;
    const previewName = fullNameInput.value.trim() || doctorFullNameText.textContent || "D";
    setAvatar(previewName, currentAvatar);

    await saveProfile(false);
  };
  reader.readAsDataURL(file);
});

openPersonalModalBtn.addEventListener("click", () => openModal(personalModal));
closePersonalModalBtn.addEventListener("click", () => closeModal(personalModal));
cancelPersonalModalBtn.addEventListener("click", () => closeModal(personalModal));
savePersonalBtn.addEventListener("click", () => saveProfile(true));

personalModal.addEventListener("click", (e) => {
  if (e.target === personalModal) closeModal(personalModal);
});

backToDoctorBtn.addEventListener("click", () => {
  window.location.href = "http://localhost:5500/doctor/";
});

goDoctorDashboardBtn.addEventListener("click", () => {
  window.location.href = "http://localhost:5500/doctor/";
});

goGameBtn.addEventListener("click", () => {
  window.location.href = "http://localhost:5500/game/";
});

logoutBtn.addEventListener("click", () => {
  localStorage.clear();
  window.location.href = "http://localhost:5500/login/";
});

loadProfile();
loadStats();