const API = "http://localhost:5000";

const registerForm = document.getElementById("registerForm");
const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const loginBtn = document.getElementById("loginBtn");
const leaderboardBtn = document.getElementById("leaderboardBtn");
const messageEl = document.getElementById("message");

function showMessage(text, type = "error") {
  messageEl.textContent = text;
  messageEl.className = "message";
  if (type === "success") {
    messageEl.classList.add("success");
  }
}

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = usernameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const confirmPassword = confirmPasswordInput.value.trim();

  if (!username || !email || !password || !confirmPassword) {
    showMessage("Барлық өрісті толтыр");
    return;
  }

  if (password.length < 6) {
    showMessage("Құпия сөз кемінде 6 таңба болу керек");
    return;
  }

  if (password !== confirmPassword) {
    showMessage("Құпия сөздер сәйкес емес");
    return;
  }

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showMessage(data.message || "Тіркелу қатесі");
      return;
    }

    showMessage("Тіркелу сәтті аяқталды", "success");

    setTimeout(() => {
      window.location.href = "../login/index.html";
    }, 900);
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    showMessage("Сервермен байланыс жоқ");
  }
});

loginBtn.addEventListener("click", () => {
  window.location.href = "../login/index.html";
});

leaderboardBtn.addEventListener("click", () => {
  window.location.href = "../leaderboard/index.html";
});