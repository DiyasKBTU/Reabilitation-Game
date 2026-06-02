const API = "http://localhost:5000";

const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const registerBtn = document.getElementById("registerBtn");
const leaderboardBtn = document.getElementById("leaderboardBtn");
const messageEl = document.getElementById("message");

function showMessage(text, type = "error") {
  messageEl.textContent = text;
  messageEl.className = "message";
  if (type === "success") {
    messageEl.classList.add("success");
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    showMessage("Барлық өрісті толтыр");
    return;
  }

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showMessage(data.message || "Қате логин немесе пароль");
      return;
    }

    console.log("LOGIN RESPONSE:", data);

    localStorage.clear();
   localStorage.setItem("token", data.token);
localStorage.setItem("username", data.user.username);
localStorage.setItem("role", data.user.role || "user");
localStorage.setItem("userId", data.user._id || "");
localStorage.setItem("fullName", data.user.fullName || "");
localStorage.setItem("email", data.user.email || "");
localStorage.setItem("avatar", data.user.avatar || "");

    showMessage("Сәтті кірдің", "success");

    setTimeout(() => {
      if (data.user.role === "admin") {
        window.location.assign("http://localhost:5500/admin/");
      } else if (data.user.role === "doctor") {
        window.location.assign("http://localhost:5500/doctor/");
      } else {
        window.location.assign("http://localhost:5500/game/");
      }
    }, 700);
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    showMessage("Сервермен байланыс жоқ");
  }
});

registerBtn.addEventListener("click", () => {
  window.location.href = "http://localhost:5500/register/";
});

leaderboardBtn.addEventListener("click", () => {
  window.location.href = "http://localhost:5500/leaderboard/";
});