const API = "http://localhost:5000";
const list = document.getElementById("list");
const toLogin = document.getElementById("toLogin");
const toGame = document.getElementById("toGame");

async function loadLeaderboard() {
  try {
    const res = await fetch(`${API}/api/score/leaderboard`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      list.innerHTML = `<div class="item"><div class="name">Әзірге score жоқ</div></div>`;
      return;
    }

    list.innerHTML = data
      .map(
        (item, index) => `
          <div class="item">
            <div class="rank">#${index + 1}</div>
            <div class="name">${item.username}</div>
            <div class="score">${item.score}</div>
          </div>
        `
      )
      .join("");
  } catch (e) {
    list.innerHTML = `<div class="item"><div class="name">Leaderboard жүктелмеді</div></div>`;
  }
}

toLogin.addEventListener("click", () => {
  window.location.href = "../login/index.html";
});

toGame.addEventListener("click", () => {
  window.location.href = "../game/index.html";
});

loadLeaderboard();