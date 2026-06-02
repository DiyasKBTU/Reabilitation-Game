const API = "http://localhost:5000";
const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "../login/index.html";
}

const usernameEl = document.getElementById("username");
const emailEl = document.getElementById("email");
const roleEl = document.getElementById("role");
const bestScoreEl = document.getElementById("bestScore");
const totalGamesEl = document.getElementById("totalGames");

const toGame = document.getElementById("toGame");
const toLeaderboard = document.getElementById("toLeaderboard");
const logoutBtn = document.getElementById("logoutBtn");

async function loadProfile() {
  try {
    const res = await fetch(`${API}/api/profile`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.message || "Profile жүктелмеді");
      return;
    }

    usernameEl.textContent = data.user.username;
    emailEl.textContent = data.user.email;
    roleEl.textContent = data.user.role;
    bestScoreEl.textContent = data.stats.bestScore;
    totalGamesEl.textContent = data.stats.sessionCount;
  } catch (error) {
    console.error(error);
    alert("Сервермен байланыс жоқ");
  }
}

toGame.addEventListener("click", () => {
  window.location.href = "../game/index.html";
});

toLeaderboard.addEventListener("click", () => {
  window.location.href = "../leaderboard/index.html";
});

logoutBtn.addEventListener("click", () => {
  localStorage.clear();
  window.location.href = "../login/index.html";
});

loadProfile();