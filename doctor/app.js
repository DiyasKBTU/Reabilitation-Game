const API = "http://localhost:5000";
const token = localStorage.getItem("token");
const role = localStorage.getItem("role");

if (!token) {
  window.location.href = "http://localhost:5500/login/";
}

if (role !== "doctor" && role !== "admin") {
  alert("Тек doctor немесе admin кіре алады");
  window.location.href = "http://localhost:5500/game/";
}
const doctorTopProfileBtn = document.getElementById("doctorTopProfileBtn");
const doctorTopAvatar = document.getElementById("doctorTopAvatar");
const doctorTopName = document.getElementById("doctorTopName");
const doctorTopRole = document.getElementById("doctorTopRole");
const doctorPatientCount = document.getElementById("doctorPatientCount");
const doctorSessionCount = document.getElementById("doctorSessionCount");
const doctorBestScore = document.getElementById("doctorBestScore");
const selectedPatientName = document.getElementById("selectedPatientName");

const patientName = document.getElementById("patientName");
const patientAge = document.getElementById("patientAge");
const patientDiagnosis = document.getElementById("patientDiagnosis");
const patientNotes = document.getElementById("patientNotes");
const addPatientBtn = document.getElementById("addPatientBtn");

const patientSummary = document.getElementById("patientSummary");
const exportPdfBtn = document.getElementById("exportPdfBtn");

const doctorPatientsTable = document.getElementById("doctorPatientsTable");
const doctorPatientsOnlyTable = document.getElementById("doctorPatientsOnlyTable");
const doctorSessionsTable = document.getElementById("doctorSessionsTable");

const searchInput = document.getElementById("searchInput");

const openPatientModalBtn = document.getElementById("openPatientModalBtn");
const closePatientModalBtn = document.getElementById("closePatientModalBtn");
const cancelPatientModalBtn = document.getElementById("cancelPatientModalBtn");
const patientModal = document.getElementById("patientModal");

const patientDetailsModal = document.getElementById("patientDetailsModal");
const closePatientDetailsModalBtn = document.getElementById("closePatientDetailsModalBtn");
const detailsPatientTitle = document.getElementById("detailsPatientTitle");
const detailsSessionCount = document.getElementById("detailsSessionCount");
const detailsBestScore = document.getElementById("detailsBestScore");
const detailsLastScore = document.getElementById("detailsLastScore");
const detailsTrend = document.getElementById("detailsTrend");
const detailsPatientInfo = document.getElementById("detailsPatientInfo");
const detailsTrendInfo = document.getElementById("detailsTrendInfo");
const patientDetailsChartCanvas = document.getElementById("patientDetailsChart");

const sessionListModal = document.getElementById("sessionListModal");
const closeSessionListModalBtn = document.getElementById("closeSessionListModalBtn");
const sessionListTitle = document.getElementById("sessionListTitle");
const sessionListContent = document.getElementById("sessionListContent");

const chartRangeButtons = document.querySelectorAll(".chart-range-btn");
const gameFilterButtons = document.querySelectorAll(".game-filter-btn");

// ✅ NEW: doctor sidebar profile
const goDoctorProfileBtn = document.getElementById("goDoctorProfileBtn");
const doctorSidebarAvatar = document.getElementById("doctorSidebarAvatar");
const doctorSidebarName = document.getElementById("doctorSidebarName");
const doctorSidebarSubtitle = document.getElementById("doctorSidebarSubtitle");

const views = {
  overview: document.getElementById("overviewView"),
  patients: document.getElementById("patientsView"),
  sessions: document.getElementById("sessionsView")
};

let allPatients = [];
let allSessions = [];
let selectedPatientId = localStorage.getItem("selectedPatientId") || null;
let currentDetailPatient = null;
let currentDetailSessions = [];
let currentChartRange = "session";
let currentDetailGame = "all";
let patientDetailsChart = null;

function openPatientModal() {
  patientModal.classList.remove("hidden");
}

function closePatientModal() {
  patientModal.classList.add("hidden");
}

function openPatientDetailsModal() {
  patientDetailsModal.classList.remove("hidden");
}

function closePatientDetailsModal() {
  patientDetailsModal.classList.add("hidden");
}

function openSessionListModal() {
  sessionListModal.classList.remove("hidden");
}

function closeSessionListModal() {
  sessionListModal.classList.add("hidden");
}

function switchView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active-view"));
  views[name].classList.add("active-view");

  document.querySelectorAll(".menu-item[data-view]").forEach((btn) => {
    btn.classList.remove("active");
  });

  const activeBtn = document.querySelector(`.menu-item[data-view="${name}"]`);
  if (activeBtn) activeBtn.classList.add("active");
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

  if (res.status === 401) {
    localStorage.clear();
    window.location.href = "http://localhost:5500/login/";
    throw new Error("Сессия аяқталды, қайта кір");
  }

  if (!res.ok) throw new Error(data.message || "Қате");
  return data;
}

function getPatientNameById(patientId) {
  const patient = allPatients.find((p) => String(p._id) === String(patientId));
  return patient ? patient.fullName : "Белгісіз пациент";
}

function getSessionGameType(session) {
  if (session.gameType || session.game || session.gameId) return session.gameType || session.game || session.gameId;
  if (String(session.rawSnapshot || "").startsWith("GAME2|")) return "game2";
  if (Number(session.level) === 2 && String(session.rawSnapshot || "").startsWith("GAME2|")) return "game2";
  return "game1";
}

function getSessionGameName(session) {
  const type = getSessionGameType(session);
  if (session.gameName) return session.gameName;
  if (type === "game2") return "2-ойын ESP Car";
  return "1-ойын SPACE CATCHER";
}

function filterSessionsByGame(sessions, gameType) {
  if (gameType === "all") return sessions;
  return sessions.filter((s) => getSessionGameType(s) === gameType);
}

function calculateTrend(sessions) {
  if (!sessions || sessions.length < 2) {
    return { text: "Мәлімет аз", className: "trend-flat", diff: 0 };
  }

  const sorted = sessions.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const prev = Number(sorted[sorted.length - 2].score || 0);
  const last = Number(sorted[sorted.length - 1].score || 0);
  const diff = last - prev;

  if (diff > 0) return { text: `↑ +${diff}`, className: "trend-up", diff };
  if (diff < 0) return { text: `↓ ${diff}`, className: "trend-down", diff };
  return { text: "→ 0", className: "trend-flat", diff: 0 };
}

function groupSessionsByPatient(sessions) {
  const grouped = {};

  sessions.forEach((session) => {
    const gameType = getSessionGameType(session);
    const key = `${session.patientId}__${gameType}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(session);
  });

  return Object.entries(grouped).map(([key, patientSessions]) => {
    const [patientId] = key.split("__");
    const sorted = patientSessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const bestScore = Math.max(...sorted.map((s) => Number(s.score || 0)));
    const lastScore = Number(sorted[0]?.score || 0);

    return {
      patientId,
      patientName: getPatientNameById(patientId),
      gameType: getSessionGameType(sorted[0] || {}),
      gameName: getSessionGameName(sorted[0] || {}),
      sessions: sorted,
      sessionCount: sorted.length,
      bestScore,
      lastScore
    };
  });
}


function renderStats() {
  doctorPatientCount.textContent = allPatients.length;
  doctorSessionCount.textContent = allSessions.length;

  const best = allSessions.length
    ? Math.max(...allSessions.map((s) => Number(s.score || 0)))
    : 0;

  doctorBestScore.textContent = best;

  const selected = allPatients.find((p) => p._id === selectedPatientId);
  selectedPatientName.textContent = selected ? selected.fullName : "-";
}

function renderPatientSummary() {
  const selected = allPatients.find((p) => p._id === selectedPatientId);

  if (!selected) {
    patientSummary.innerHTML = "";
    return;
  }

  const relatedSessions = allSessions
    .filter((s) => String(s.patientId) === String(selected._id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const lastSession = relatedSessions.length
    ? new Date(relatedSessions[0].createdAt).toLocaleString()
    : "-";

  patientSummary.innerHTML = `
    <div class="summary-box">
      <strong>Пациент</strong>
      <span>${selected.fullName || "-"}</span>
    </div>
    <div class="summary-box">
      <strong>Жасы</strong>
      <span>${selected.age ?? "-"}</span>
    </div>
    <div class="summary-box">
      <strong>Диагноз</strong>
      <span>${selected.diagnosis || "-"}</span>
    </div>
    <div class="summary-box">
      <strong>Соңғы сессия</strong>
      <span>${lastSession}</span>
    </div>
  `;
}

function patientCard(patient) {
  const patientSessions = allSessions
    .filter((s) => String(s.patientId) === String(patient._id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const sessionCount = patientSessions.length;
  const bestScore = sessionCount
    ? Math.max(...patientSessions.map((s) => Number(s.score || 0)))
    : 0;

  const lastSession = patientSessions[0] || null;
  const lastScore = lastSession ? Number(lastSession.score || 0) : 0;
  const trend = calculateTrend(patientSessions);
  const isSelected = patient._id === selectedPatientId;
  const lastGameName = lastSession ? getSessionGameName(lastSession) : "Ойын жоқ";

  const minAngle = lastSession ? Number(lastSession.minAngle || 0).toFixed(1) : "-";
  const maxAngle = lastSession ? Number(lastSession.maxAngle || 0).toFixed(1) : "-";
  const rangeOfMotion = lastSession ? Number(lastSession.rangeOfMotion || 0).toFixed(1) : "-";
  const strengthIndex = lastSession ? Number(lastSession.strengthIndex || 0).toFixed(1) : "-";
  const enduranceSec = lastSession ? Number(lastSession.enduranceSec || 0) : 0;
  const movementCount = lastSession ? Number(lastSession.movementCount || 0) : 0;

  return `
    <div class="patient-analytics-card">
      <div class="patient-card-top">
        <div class="patient-card-title">
          <h4>${patient.fullName || "-"}${getInsightsBadge(patient)}</h4>
          <p>${patient.diagnosis || "Диагноз көрсетілмеген"}</p>
        </div>
        <div class="patient-chip">${isSelected ? "Таңдалған пациент" : "Пациент"} · ${lastGameName}</div>
      </div>

      <div class="patient-card-stats">
        <div class="patient-mini-box">
          <span>Жасы</span>
          <strong>${patient.age ?? "-"}</strong>
        </div>
        <div class="patient-mini-box">
          <span>Үздік score</span>
          <strong>${bestScore}</strong>
        </div>
        <div class="patient-mini-box">
          <span>Қозғалыс ауқымы</span>
          <strong>${rangeOfMotion}°</strong>
        </div>
        <div class="patient-mini-box">
          <span>Min / Max</span>
          <strong>${minAngle}° / ${maxAngle}°</strong>
        </div>
        <div class="patient-mini-box">
          <span>Күш индексі</span>
          <strong>${strengthIndex}</strong>
        </div>
        <div class="patient-mini-box">
          <span>Қозғалыс саны</span>
          <strong>${movementCount}</strong>
        </div>
      </div>

      <div class="patient-trend">
        <div>
          <small>Соңғы score / төзімділік</small>
          <div><strong>${lastScore} / ${enduranceSec} сек</strong></div>
        </div>
        <div class="${trend.className}">
          ${trend.diff > 0 ? "Жоғарылап жатыр" : trend.diff < 0 ? "Төмендеп жатыр" : "Тұрақты"}
        </div>
      </div>

      <div class="patient-card-actions">
        <button class="primary-btn" onclick="openPatientAnalytics('${patient._id}')">Аналитика ашу</button>
        <button class="secondary-btn" onclick="openPatientSessions('${patient._id}')">Прогресс списогы</button>
        <button class="secondary-btn" onclick="selectPatient('${patient._id}', '${String(patient.fullName || "").replace(/'/g, "\\'")}')">
          ${isSelected ? "Таңдалған" : "Таңдау"}
        </button>
      </div>
    </div>
  `;
}

function renderPatients(list) {
  if (!list.length) {
    const empty = `<div class="row-card">Пациент жоқ</div>`;
    doctorPatientsTable.innerHTML = empty;
    doctorPatientsOnlyTable.innerHTML = empty;
    return;
  }

  const html = list.map(patientCard).join("");
  doctorPatientsTable.innerHTML = html;
  doctorPatientsOnlyTable.innerHTML = html;
}

function renderSessions(list) {
  if (!list.length) {
    doctorSessionsTable.innerHTML = `<div class="row-card">Session жоқ</div>`;
    return;
  }

  const grouped = groupSessionsByPatient(list);

  doctorSessionsTable.innerHTML = grouped.map((group) => `
    <div class="patient-analytics-card">
      <div class="patient-card-top">
        <div class="patient-card-title">
          <h4>${group.patientName}</h4>
          <p>Сол пациенттің ${group.gameName} сессиялары</p>
        </div>
        <div class="patient-chip">${group.gameName} · ${group.sessionCount} сессия</div>
      </div>

      <div class="patient-card-stats">
        <div class="patient-mini-box">
          <span>Пациент / Ойын</span>
          <strong>${group.patientName} / ${group.gameName}</strong>
        </div>
        <div class="patient-mini-box">
          <span>Үздік score</span>
          <strong>${group.bestScore}</strong>
        </div>
        <div class="patient-mini-box">
          <span>Соңғы score</span>
          <strong>${group.lastScore}</strong>
        </div>
        <div class="patient-mini-box">
          <span>Сессия саны</span>
          <strong>${group.sessionCount}</strong>
        </div>
        <div class="patient-mini-box">
          <span>Соңғы өзгеріс</span>
          <strong>${calculateTrend(group.sessions).text}</strong>
        </div>
        <div class="patient-mini-box">
          <span>Күйі</span>
          <strong>${calculateTrend(group.sessions).diff > 0 ? "Өсім" : calculateTrend(group.sessions).diff < 0 ? "Төмендеу" : "Тұрақты"}</strong>
        </div>
      </div>

      <div class="patient-card-actions">
        <button class="primary-btn" onclick="openPatientSessions('${group.patientId}', '${group.gameType}')">Прогресс списогы</button>
        <button class="secondary-btn" onclick="openPatientAnalytics('${group.patientId}', '${group.gameType}')">Аналитика</button>
      </div>
    </div>
  `).join("");
}

function renderPatientSessionList(patient, sessions) {
  if (!sessions.length) {
    sessionListContent.innerHTML = `<div class="row-card">Сессия жоқ</div>`;
    return;
  }

  sessionListTitle.textContent = `${patient.fullName} - прогресс списогы`;

  sessionListContent.innerHTML = sessions.map((session, index) => `
    <div class="session-list-card">
      <div class="session-badge-row">
        <span class="session-badge badge-blue">Сессия #${sessions.length - index}</span>
        <span class="game-name-pill">${getSessionGameName(session)}</span>
        <span class="session-badge badge-green">Score: ${session.score}</span>
        <span class="session-badge badge-purple">ROM: ${Number(session.rangeOfMotion || 0).toFixed(1)}°</span>
        <span class="session-badge badge-orange">Күш: ${Number(session.strengthIndex || 0).toFixed(1)}</span>
      </div>

      <div class="session-row">
        <div class="block compact-block">
          <strong>Пациент / Ойын</strong>
          ${patient.fullName} / ${getSessionGameName(session)}
        </div>
        <div class="block compact-block">
          <strong>Score</strong>
          ${session.score}
        </div>
        <div class="block compact-block">
          <strong>Yaw</strong>
          ${Number(session.yaw || 0).toFixed(1)}°
        </div>
        <div class="block compact-block">
          <strong>Pitch</strong>
          ${Number(session.pitch || 0).toFixed(1)}°
        </div>
      </div>

      <div class="session-row">
        <div class="block compact-block">
          <strong>Roll</strong>
          ${Number(session.roll || 0).toFixed(1)}°
        </div>
        <div class="block compact-block">
          <strong>Min бұрыш</strong>
          ${Number(session.minAngle || 0).toFixed(1)}°
        </div>
        <div class="block compact-block">
          <strong>Max бұрыш</strong>
          ${Number(session.maxAngle || 0).toFixed(1)}°
        </div>
        <div class="block compact-block">
          <strong>Қозғалыс ауқымы</strong>
          ${Number(session.rangeOfMotion || 0).toFixed(1)}°
        </div>
      </div>

      <div class="session-row">
        <div class="block compact-block">
          <strong>Күш индексі</strong>
          ${Number(session.strengthIndex || 0).toFixed(1)}
        </div>
        <div class="block compact-block">
          <strong>Төзімділік</strong>
          ${Number(session.enduranceSec || 0)} сек
        </div>
        <div class="block compact-block">
          <strong>Қозғалыс саны</strong>
          ${Number(session.movementCount || 0)}
        </div>
        <div class="block compact-block">
          <strong>Ұзақтығы</strong>
          ${Number(session.durationSec || 0)} сек
        </div>
      </div>

      <div class="session-meta">
        <div class="session-list-title-mini">Уақыты</div>
        <div class="session-time">${new Date(session.createdAt).toLocaleString()}</div>
      </div>
    </div>
  `).join("");
}

function groupSessionsByDay(sessions) {
  const map = new Map();

  sessions.forEach((s) => {
    const d = new Date(s.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });

  return Array.from(map.entries()).map(([key, arr]) => {
    const avgScore = arr.reduce((sum, x) => sum + Number(x.score || 0), 0) / arr.length;
    return { label: key, value: avgScore };
  });
}

function groupSessionsByMonth(sessions) {
  const map = new Map();

  sessions.forEach((s) => {
    const d = new Date(s.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });

  return Array.from(map.entries()).map(([key, arr]) => {
    const avgScore = arr.reduce((sum, x) => sum + Number(x.score || 0), 0) / arr.length;
    return { label: key, value: avgScore };
  });
}

function buildChartData(sessions, range) {
  if (range === "day") {
    const grouped = groupSessionsByDay(sessions);
    return {
      labels: grouped.map((x) => x.label),
      values: grouped.map((x) => Number(x.value.toFixed(2)))
    };
  }

  if (range === "month") {
    const grouped = groupSessionsByMonth(sessions);
    return {
      labels: grouped.map((x) => x.label),
      values: grouped.map((x) => Number(x.value.toFixed(2)))
    };
  }

  const sorted = sessions.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return {
    labels: sorted.map((_, i) => `#${i + 1}`),
    values: sorted.map((s) => Number(s.score || 0))
  };
}

function renderPatientDetailsChart() {
  if (!currentDetailPatient) return;

  const data = buildChartData(currentDetailSessions, currentChartRange);

  if (patientDetailsChart) {
    patientDetailsChart.destroy();
  }

  patientDetailsChart = new Chart(patientDetailsChartCanvas, {
    type: "line",
    data: {
      labels: data.labels,
      datasets: [
        {
          label:
            currentChartRange === "session"
              ? "Session score"
              : currentChartRange === "day"
              ? "Daily average"
              : "Monthly average",
          data: data.values,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.12)",
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top"
        }
      }
    }
  });
}

function renderPatientDetailsInfo() {
  if (!currentDetailPatient) return;

  const sessions = currentDetailSessions.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const bestScore = sessions.length ? Math.max(...sessions.map((s) => Number(s.score || 0))) : 0;
  const lastScore = sessions.length ? Number(sessions[sessions.length - 1].score || 0) : 0;
  const trend = calculateTrend(sessions);

  const selectedGameLabel = currentDetailGame === "all" ? "Барлық ойын" : (currentDetailGame === "game2" ? "2-ойын ESP Car" : "1-ойын SPACE CATCHER");
  detailsPatientTitle.textContent = `${currentDetailPatient.fullName || "Patient analytics"} / ${selectedGameLabel}`;
  detailsSessionCount.textContent = sessions.length;
  detailsBestScore.textContent = bestScore;
  detailsLastScore.textContent = lastScore;
  detailsTrend.textContent = trend.text;
  detailsTrend.className = trend.className;

  const lastSession = sessions[sessions.length - 1] || null;

  detailsPatientInfo.innerHTML = `
    <p><strong>Аты:</strong> ${currentDetailPatient.fullName || "-"}</p>
    <p><strong>Ойын:</strong> ${selectedGameLabel}</p>
    <p><strong>Жасы:</strong> ${currentDetailPatient.age ?? "-"}</p>
    <p><strong>Диагноз:</strong> ${currentDetailPatient.diagnosis || "-"}</p>
    <p><strong>Ескерту:</strong> ${currentDetailPatient.notes || "-"}</p>
    <p><strong>Соңғы ROM:</strong> ${lastSession ? Number(lastSession.rangeOfMotion || 0).toFixed(1) : 0}°</p>
    <p><strong>Соңғы күш индексі:</strong> ${lastSession ? Number(lastSession.strengthIndex || 0).toFixed(1) : 0}</p>
  `;

  let trendText = "Мәлімет аз";
  if (trend.diff > 0) trendText = "Нәтиже жоғарылап жатыр";
  if (trend.diff < 0) trendText = "Нәтиже төмендеп жатыр";
  if (trend.diff === 0 && sessions.length >= 2) trendText = "Нәтиже тұрақты";

  detailsTrendInfo.innerHTML = `
    <p><strong>Тренд:</strong> ${trendText}</p>
    <p><strong>Соңғы өзгеріс:</strong> ${trend.text}</p>
    <p><strong>Ойын:</strong> ${selectedGameLabel}</p>
    <p><strong>Режим:</strong> ${
      currentChartRange === "session"
        ? "Сессия бойынша"
        : currentChartRange === "day"
        ? "Күн бойынша"
        : "Ай бойынша"
    }</p>
  `;
}

// ─── INSIGHTS ─────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical:     { icon: "🔴", label: "Критично",  color: "#ef4444", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.35)" },
  warning:      { icon: "🟡", label: "Внимание",  color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.35)" },
  good:         { icon: "🟢", label: "Хорошо",    color: "#22c55e", bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.35)"  },
  no_data:      { icon: "⚪", label: "Нет данных", color: "#6b7280", bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.3)" }
};

const TREND_ICONS = { up: "↑", down: "↓", stable: "→" };
const TREND_COLORS = { up: "#22c55e", down: "#ef4444", stable: "#6b7280" };

function renderInsightAlerts(alerts) {
  if (!alerts.length) {
    return `<div style="color:#22c55e;font-size:14px;padding:10px 0">
      ✅ Все показатели в норме — пациент выполняет упражнения хорошо
    </div>`;
  }

  return alerts.map(alert => {
    const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.warning;
    return `
      <div style="
        background:${cfg.bg};
        border:1px solid ${cfg.border};
        border-radius:10px;
        padding:10px 14px;
        margin-bottom:8px;
        display:flex;
        align-items:flex-start;
        gap:10px;
      ">
        <span style="font-size:18px;flex-shrink:0">${cfg.icon}</span>
        <div>
          <div style="font-size:11px;color:${cfg.color};font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">${alert.metric}</div>
          <div style="font-size:13px;color:#e2e8f0;line-height:1.45">${alert.text}</div>
        </div>
      </div>
    `;
  }).join("");
}

function renderInsightTrends(trends, summary) {
  const rows = [
    { key: "rom",           label: "ROM",            unit: "°",  format: v => v.toFixed(1) },
    { key: "strength",      label: "Сила",           unit: "",   format: v => v.toFixed(2) },
    { key: "endurance",     label: "Выносливость",   unit: "с",  format: v => Math.round(v) },
    { key: "movementCount", label: "Движений",       unit: "",   format: v => Math.round(v) },
    { key: "score",         label: "Score",          unit: "",   format: v => Math.round(v) }
  ];

  return rows.map(row => {
    const t = trends[row.key];
    if (!t) return "";
    const icon = TREND_ICONS[t.direction] || "→";
    const color = TREND_COLORS[t.direction] || "#6b7280";
    return `
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:8px 12px;
        background:rgba(255,255,255,0.04);
        border-radius:8px;
        margin-bottom:6px;
      ">
        <span style="color:#94a3b8;font-size:13px;min-width:100px">${row.label}</span>
        <span style="color:#e2e8f0;font-size:13px;font-weight:600">
          Ср: ${row.format(t.avg)}${row.unit} &nbsp;|&nbsp; Посл: ${row.format(t.last)}${row.unit}
        </span>
        <span style="color:${color};font-weight:700;font-size:16px;min-width:30px;text-align:right">${icon}</span>
      </div>
    `;
  }).join("");
}

function injectInsightsPanel(data) {
  // Удаляем старую панель если есть
  const old = document.getElementById("insightsPanel");
  if (old) old.remove();

  if (!data || data.overallStatus === "no_data") {
    const noData = document.createElement("div");
    noData.id = "insightsPanel";
    noData.innerHTML = `
      <div style="color:#6b7280;font-size:14px;padding:12px 0">
        ⚪ Сессий пока нет — инсайты появятся после первой игры
      </div>
    `;
    const target = document.getElementById("detailsPatientInfo");
    if (target && target.parentNode) target.parentNode.insertBefore(noData, target);
    return;
  }

  const overallCfg = SEVERITY_CONFIG[data.overallStatus] || SEVERITY_CONFIG.good;

  const panel = document.createElement("div");
  panel.id = "insightsPanel";
  panel.style.cssText = `
    margin-bottom: 18px;
    border: 1px solid rgba(139,92,246,0.3);
    border-radius: 14px;
    padding: 16px;
    background: rgba(139,92,246,0.05);
  `;

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:14px;font-weight:700;color:#c084fc">🧠 AI Инсайты</div>
      <div style="
        font-size:11px;font-weight:700;
        padding:3px 10px;border-radius:20px;
        background:${overallCfg.bg};
        border:1px solid ${overallCfg.border};
        color:${overallCfg.color};
      ">${overallCfg.icon} ${overallCfg.label}</div>
    </div>

    <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">
      Анализ ${data.summary.sessionCount} сессий
    </div>

    ${renderInsightAlerts(data.alerts)}

    <div style="font-size:11px;color:#94a3b8;margin:14px 0 8px;text-transform:uppercase;letter-spacing:0.5px">
      Тренды по метрикам
    </div>
    ${renderInsightTrends(data.trends, data.summary)}
  `;

  // Вставляем в начало детальной панели
  const modalBody = document.querySelector(".patient-details-body") ||
                    document.getElementById("detailsPatientInfo")?.parentNode;
  if (modalBody) {
    modalBody.insertBefore(panel, modalBody.firstChild);
  }
}

async function loadPatientInsights(patientId) {
  try {
    const data = await fetchJSON(`${API}/api/insights/${patientId}`);
    injectInsightsPanel(data);
  } catch (e) {
    console.error("INSIGHTS ERROR:", e);
  }
}

// Добавляем бейджик статуса на карточку пациента
async function loadInsightsBadges() {
  for (const patient of allPatients) {
    try {
      const data = await fetchJSON(`${API}/api/insights/${patient._id}`);
      patient._insights = data;
    } catch (e) {
      patient._insights = null;
    }
  }
}

function getInsightsBadge(patient) {
  const ins = patient._insights;
  if (!ins || ins.overallStatus === "no_data") return "";
  const cfg = SEVERITY_CONFIG[ins.overallStatus] || SEVERITY_CONFIG.good;
  return `<span style="
    font-size:10px;font-weight:700;
    padding:2px 8px;border-radius:10px;
    background:${cfg.bg};border:1px solid ${cfg.border};
    color:${cfg.color};margin-left:8px;
  ">${cfg.icon} ${cfg.label}</span>`;
}

async function loadPatients() {
  allPatients = await fetchJSON(`${API}/api/patient`);
}

async function loadAllSessions() {
  let sessions = [];
  for (const patient of allPatients) {
    try {
      const patientSessions = await fetchJSON(`${API}/api/session/${patient._id}`);
      sessions = sessions.concat(patientSessions);
    } catch (e) {
      console.error("SESSION LOAD ERROR:", e);
    }
  }
  allSessions = sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function loadAll() {
  try {
    await loadPatients();

    if (!selectedPatientId && allPatients.length > 0) {
      selectedPatientId = allPatients[0]._id;
      localStorage.setItem("selectedPatientId", selectedPatientId);
    }

    await loadAllSessions();

    // Загружаем инсайты для всех пациентов (для бейджей на карточках)
    await loadInsightsBadges();

    renderPatients(allPatients);
    renderSessions(allSessions);
    renderStats();
    renderPatientSummary();
  } catch (error) {
    alert(error.message || "Сервер қатесі");
  }
}

// ✅ NEW: doctor profile in sidebar
async function loadDoctorSidebarProfile() {
  try {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Doctor profile жүктелмеді");
    }

    const fullName = data.fullName || data.username || "Doctor Panel";
    const specialty = data.specialty || "Rehab Monitoring";
    const avatar = data.avatar || "";
    const roleText = data.role || "doctor";
    const firstLetter = fullName.trim().charAt(0).toUpperCase() || "D";

    // LEFT SIDEBAR
    if (doctorSidebarName) doctorSidebarName.textContent = fullName;
    if (doctorSidebarSubtitle) doctorSidebarSubtitle.textContent = specialty;

    if (doctorSidebarAvatar) {
      if (avatar) {
        doctorSidebarAvatar.style.backgroundImage = `url(${avatar})`;
        doctorSidebarAvatar.textContent = "";
      } else {
        doctorSidebarAvatar.style.backgroundImage = "";
        doctorSidebarAvatar.textContent = firstLetter;
      }
    }

    // TOP RIGHT CHIP
    if (doctorTopName) doctorTopName.textContent = fullName;
    if (doctorTopRole) doctorTopRole.textContent = roleText;

    if (doctorTopAvatar) {
      if (avatar) {
        doctorTopAvatar.style.backgroundImage = `url(${avatar})`;
        doctorTopAvatar.textContent = "";
      } else {
        doctorTopAvatar.style.backgroundImage = "";
        doctorTopAvatar.textContent = firstLetter;
      }
    }
  } catch (error) {
    console.error("DOCTOR PROFILE LOAD ERROR:", error);
  }
}

window.selectPatient = async function (id, name) {
  selectedPatientId = id;
  localStorage.setItem("selectedPatientId", id);
  localStorage.setItem("selectedPatientName", name || "");
  selectedPatientName.textContent = name || "-";
  renderPatients(allPatients);
  renderPatientSummary();
  renderStats();
};

window.openPatientAnalytics = async function (patientId, gameType = "all") {
  currentDetailPatient = allPatients.find((p) => p._id === patientId);
  if (!currentDetailPatient) return;

  currentDetailGame = gameType || "all";
  currentDetailSessions = filterSessionsByGame(
    allSessions.filter((s) => String(s.patientId) === String(patientId)),
    currentDetailGame
  ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  currentChartRange = "session";
  chartRangeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.range === "session");
  });
  gameFilterButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.game === currentDetailGame);
  });

  renderPatientDetailsInfo();
  renderPatientDetailsChart();
  openPatientDetailsModal();
  // Загружаем инсайты асинхронно — появятся поверх модала
  loadPatientInsights(patientId);
};

window.openPatientSessions = async function (patientId, gameType = "all") {
  const patient = allPatients.find((p) => String(p._id) === String(patientId));
  if (!patient) return;

  const sessions = filterSessionsByGame(
    allSessions.filter((s) => String(s.patientId) === String(patientId)),
    gameType || "all"
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  renderPatientSessionList(patient, sessions);
  openSessionListModal();
};

addPatientBtn.addEventListener("click", async () => {
  try {
    const fullName = patientName.value.trim();
    const age = patientAge.value.trim();
    const diagnosis = patientDiagnosis.value.trim();
    const notes = patientNotes.value.trim();

    if (!fullName) {
      alert("Пациент атын енгіз");
      return;
    }

    await fetchJSON(`${API}/api/patient`, {
      method: "POST",
      body: JSON.stringify({
        fullName,
        age,
        diagnosis,
        notes
      })
    });

    patientName.value = "";
    patientAge.value = "";
    patientDiagnosis.value = "";
    patientNotes.value = "";

    closePatientModal();
    await loadAll();
    alert("Пациент қосылды");
  } catch (error) {
    alert(error.message || "Сервер қатесі");
  }
});

chartRangeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentChartRange = btn.dataset.range;
    chartRangeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderPatientDetailsInfo();
    renderPatientDetailsChart();
  });
});

gameFilterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!currentDetailPatient) return;
    currentDetailGame = btn.dataset.game || "all";
    gameFilterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentDetailSessions = filterSessionsByGame(
      allSessions.filter((s) => String(s.patientId) === String(currentDetailPatient._id)),
      currentDetailGame
    ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    renderPatientDetailsInfo();
    renderPatientDetailsChart();
  });
});

if (exportPdfBtn) {
  exportPdfBtn.addEventListener("click", () => {
    if (!currentDetailPatient) {
      alert("Алдымен пациент таңда");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let y = 20;

    doc.setFontSize(18);
    doc.text("Patient Analytics Report", 14, y);
    y += 12;

    doc.setFontSize(12);
    doc.text(`Name: ${currentDetailPatient.fullName || "-"}`, 14, y); y += 8;
    doc.text(`Age: ${currentDetailPatient.age ?? "-"}`, 14, y); y += 8;
    doc.text(`Diagnosis: ${currentDetailPatient.diagnosis || "-"}`, 14, y); y += 8;
    doc.text(`Notes: ${currentDetailPatient.notes || "-"}`, 14, y); y += 12;

    const bestScore = currentDetailSessions.length
      ? Math.max(...currentDetailSessions.map((s) => Number(s.score || 0)))
      : 0;

    doc.text(`Total sessions: ${currentDetailSessions.length}`, 14, y); y += 8;
    doc.text(`Best score: ${bestScore}`, 14, y); y += 12;

    doc.text("Session list:", 14, y); y += 10;

    currentDetailSessions.slice(0, 12).forEach((session, index) => {
      const line =
        `${index + 1}. Score: ${session.score}, ` +
        `ROM: ${Number(session.rangeOfMotion || 0).toFixed(1)}°, ` +
        `Min: ${Number(session.minAngle || 0).toFixed(1)}°, ` +
        `Max: ${Number(session.maxAngle || 0).toFixed(1)}°, ` +
        `Strength: ${Number(session.strengthIndex || 0).toFixed(1)}, ` +
        `Moves: ${Number(session.movementCount || 0)}, ` +
        `Endurance: ${Number(session.enduranceSec || 0)}s`;
      doc.text(line, 14, y);
      y += 8;
    });

    doc.save(`${currentDetailPatient.fullName || "patient"}-analytics.pdf`);
  });
}

openPatientModalBtn.addEventListener("click", openPatientModal);
closePatientModalBtn.addEventListener("click", closePatientModal);
cancelPatientModalBtn.addEventListener("click", closePatientModal);
closePatientDetailsModalBtn.addEventListener("click", closePatientDetailsModal);
closeSessionListModalBtn.addEventListener("click", closeSessionListModal);

patientModal.addEventListener("click", (e) => {
  if (e.target === patientModal) closePatientModal();
});

patientDetailsModal.addEventListener("click", (e) => {
  if (e.target === patientDetailsModal) closePatientDetailsModal();
});

sessionListModal.addEventListener("click", (e) => {
  if (e.target === sessionListModal) closeSessionListModal();
});

document.querySelectorAll(".menu-item[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("goGameBtn").addEventListener("click", () => {
  window.location.href = "http://localhost:5500/game/";
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.clear();
  window.location.href = "http://localhost:5500/login/";
});
if (goDoctorProfileBtn) {
  goDoctorProfileBtn.addEventListener("click", () => {
    window.location.href = "http://localhost:5500/doctor-profile/";
  });
}

if (doctorTopProfileBtn) {
  doctorTopProfileBtn.addEventListener("click", () => {
    window.location.href = "http://localhost:5500/doctor-profile/";
  });
}

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();

  const filtered = allPatients.filter((patient) =>
    (patient.fullName || "").toLowerCase().includes(q) ||
    (patient.diagnosis || "").toLowerCase().includes(q)
  );

  renderPatients(filtered);
  doctorPatientsOnlyTable.innerHTML = doctorPatientsTable.innerHTML;
});

loadAll();
loadDoctorSidebarProfile();