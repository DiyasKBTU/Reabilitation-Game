window.addEventListener("DOMContentLoaded", () => {
  const API = "http://localhost:5000";
  const token = localStorage.getItem("token");
  const username = localStorage.getItem("username");
  const role = localStorage.getItem("role") || "patient";

  if (!token) {
    window.location.href = "../login/index.html";
    return;
  }

  let selectedPatientId = localStorage.getItem("selectedPatientId") || null;
  let gameStartTime = 0;
  let currentLevel = 1;

  const welcomeText = document.getElementById("welcomeText");
  if (welcomeText) {
    welcomeText.textContent = `${username}, шариктерді ұста. Бомбадан сақтан.`;
  }

  const logoutBtn = document.getElementById("logoutBtn");
  const leaderboardBtn = document.getElementById("leaderboardBtn");
  const profileBtn = document.getElementById("profileBtn");
  const game2Btn = document.getElementById("game2Btn");
  const menuGame2Btn = document.getElementById("menuGame2Btn");

  logoutBtn.addEventListener("click", () => {
    localStorage.clear();
    window.location.href = "../login/index.html";
  });
  leaderboardBtn.addEventListener("click", () => { window.location.href = "../leaderboard/index.html"; });
  profileBtn.addEventListener("click", () => { window.location.href = "../profile/index.html"; });
  function openSecondGame() { window.location.href = "../game2/index.html"; }
  if (game2Btn) game2Btn.addEventListener("click", openSecondGame);
  if (menuGame2Btn) menuGame2Btn.addEventListener("click", openSecondGame);

  // ─── BLE ────────────────────────────────────────────────────────────────────
  const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
  const DATA_UUID    = "abcd1234-ab12-ab12-ab12-abcdef123456";
  const CALIB_UUID   = "abcd1235-ab12-ab12-ab12-abcdef123456";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const menuScreen    = document.getElementById("menuScreen");
  const settingsPanel = document.getElementById("settingsPanel");

  const startBtn         = document.getElementById("startBtn");
  const menuBtn          = document.getElementById("menuBtn");
  const settingsBtn      = document.getElementById("settingsBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const connectBtn       = document.getElementById("connectBtn");
  const disconnectBtn    = document.getElementById("disconnectBtn");
  const calibBtn         = document.getElementById("calibBtn");
  const zeroBtn          = document.getElementById("zeroBtn");

  const bleStateEl  = document.getElementById("bleState");
  const yawValEl    = document.getElementById("yawVal");
  const pitchValEl  = document.getElementById("pitchVal");
  const rollValEl   = document.getElementById("rollVal");

  const bg = new Image();
  bg.src = "bg.jpg";

  let bleDevice = null;
  let calibChar = null;
  let sessionSaved = false;

  const ble = {
    connected: false,
    yaw: 0, pitch: 0, roll: 0,
    smoothYaw: 0, smoothPitch: 0, smoothRoll: 0
  };

  // ─── GAME STATE ─────────────────────────────────────────────────────────────
  let gameStarted = false;
  let score = 0;
  let lives = 3;
  let gameOver = false;

  // Комбо
  let combo = 0;
  let maxCombo = 0;
  let comboTimer = 0;

  // Зональные шары
  let zoneHits = 0;

  // Золотой шар (streak challenge)
  let goldenBall = null;
  let goldenTimer = 0;
  const GOLDEN_INTERVAL = 1800; // ~30 сек при 60fps

  // IMU time-series запись
  let imuTimeSeries = [];
  let imuRecordTimer = 0;
  const IMU_SAMPLE_INTERVAL = 12; // каждые ~12 кадров ≈ 200ms при 60fps

  const catcher = { x: 0, y: 0, w: 180, h: 30, speed: 9 };
  const balls = [];
  const bombs = [];
  const particles = [];
  const popups = [];
  const keys = {};

  const ballPalettes = [
    ["#ffe27a", "#ffb703"],
    ["#8ff7ff", "#3bbcff"],
    ["#ff9be8", "#f72585"],
    ["#b9ff88", "#22c55e"],
    ["#dcc2ff", "#8b5cf6"],
    ["#ffb48f", "#fb5607"]
  ];

  // ─── BLE ─────────────────────────────────────────────────────────────────────
  function setBleStatus(text) { bleStateEl.textContent = text; }

  function normalizeAngle(v) {
    while (v > 180) v -= 360;
    while (v < -180) v += 360;
    return v;
  }

  function handleIMUData(event) {
    const raw = new TextDecoder().decode(event.target.value);
    const parts = raw.split(",").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return;

    ble.yaw   = normalizeAngle(parts[0]);
    ble.pitch = parts[1];
    ble.roll  = parts[2];

    ble.smoothYaw   = ble.smoothYaw   * 0.78 + ble.yaw   * 0.22;
    ble.smoothPitch = ble.smoothPitch * 0.78 + ble.pitch * 0.22;
    ble.smoothRoll  = ble.smoothRoll  * 0.78 + ble.roll  * 0.22;

    yawValEl.textContent   = ble.smoothYaw.toFixed(1);
    pitchValEl.textContent = ble.smoothPitch.toFixed(1);
    rollValEl.textContent  = ble.smoothRoll.toFixed(1);
  }

  async function connectBLE() {
    try {
      setBleStatus("Қосылуда...");
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ name: "ESP32-C3-IMU" }],
        optionalServices: [SERVICE_UUID]
      });
      bleDevice.addEventListener("gattserverdisconnected", () => {
        ble.connected = false;
        setBleStatus("Қосылмаған");
      });
      const server   = await bleDevice.gatt.connect();
      const service  = await server.getPrimaryService(SERVICE_UUID);
      const dataChar = await service.getCharacteristic(DATA_UUID);
      calibChar = await service.getCharacteristic(CALIB_UUID);
      await dataChar.startNotifications();
      dataChar.addEventListener("characteristicvaluechanged", handleIMUData);
      ble.connected = true;
      setBleStatus("Қосылды ✓");
    } catch (e) {
      console.error(e);
      setBleStatus("Қате");
    }
  }

  async function disconnectBLE() {
    try {
      if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
      ble.connected = false;
      setBleStatus("Қосылмаған");
    } catch (e) { console.error(e); }
  }

  async function sendCommand(command) {
    if (!calibChar) { setBleStatus("Алдымен BLE қос"); return; }
    try {
      await calibChar.writeValue(new TextEncoder().encode(command));
      setBleStatus(command + " жіберілді");
    } catch (e) { console.error(e); }
  }

  // ─── PATIENTS ────────────────────────────────────────────────────────────────
  async function loadPatients() {
    if (role !== "doctor" && role !== "admin") return;
    try {
      const res = await fetch(`${API}/api/patient`, {
        headers: { Authorization: "Bearer " + token }
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && !selectedPatientId) {
        selectedPatientId = data[0]._id;
        localStorage.setItem("selectedPatientId", selectedPatientId);
      }
    } catch (e) { console.error("PATIENT LOAD ERROR", e); }
  }

  // ─── SESSION SAVE ─────────────────────────────────────────────────────────────
  async function saveSession() {
    if (sessionSaved) return;
    sessionSaved = true;

    if (role !== "doctor" && role !== "admin") {
      console.log("Patient role: session not saved");
      return;
    }
    if (!selectedPatientId) {
      console.warn("Пациент таңдалмаған");
      return;
    }

    const durationSec = Math.floor((Date.now() - gameStartTime) / 1000);

    try {
      const res = await fetch(`${API}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          patientId: selectedPatientId,
          yaw:   ble.smoothYaw,
          pitch: ble.smoothPitch,
          roll:  ble.smoothRoll,
          score,
          durationSec,
          level: currentLevel,
          maxCombo,
          zoneHits,
          gameType: "game1",
          gameName: "Space Catcher",
          imuTimeSeries  // сервер вычислит реальный ROM из него
        })
      });
      const data = await res.json();
      console.log("SESSION SAVED:", data);
    } catch (e) {
      console.error("SESSION SAVE ERROR", e);
    }
  }

  // ─── CANVAS ──────────────────────────────────────────────────────────────────
  function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    catcher.y = canvas.height - 82;
    if (catcher.x === 0) catcher.x = canvas.width / 2 - catcher.w / 2;
  }

  // ─── FACTORY ─────────────────────────────────────────────────────────────────
  function createBall(startY = -50) {
    const palette = ballPalettes[Math.floor(Math.random() * ballPalettes.length)];
    // 25% шанс — зональный шар (требует движения к определённой стороне)
    const isZonal = Math.random() < 0.25;
    const zoneSide = Math.random() < 0.5 ? "left" : "right";
    let x;
    if (isZonal) {
      x = zoneSide === "left"
        ? Math.random() * (canvas.width * 0.28) + 30
        : canvas.width * 0.72 + Math.random() * (canvas.width * 0.25);
    } else {
      x = Math.random() * (canvas.width - 90) + 45;
    }
    return {
      x: Math.max(30, Math.min(canvas.width - 30, x)),
      y: startY,
      r: 22 + Math.random() * 6,
      speed: 2.1 + Math.random() * 2.3,
      sway: Math.random() * Math.PI * 2,
      c1: palette[0],
      c2: palette[1],
      isZonal,
      zoneSide
    };
  }

  function createBomb(startY = -50) {
    return {
      x: Math.random() * (canvas.width - 90) + 45,
      y: startY,
      r: 20,
      speed: 2.8 + Math.random() * 2.1,
      rot: Math.random() * Math.PI * 2,
      pulse: Math.random() * Math.PI * 2
    };
  }

  function createGoldenBall() {
    const side = Math.random() < 0.5 ? "left" : "right";
    const x = side === "left"
      ? 30 + Math.random() * 60
      : canvas.width - 90 + Math.random() * 60;
    return { x, y: -60, r: 28, speed: 1.8, sway: Math.random() * Math.PI * 2, pulse: 0 };
  }

  function resetGame() {
    score = 0;
    lives = 3;
    gameOver = false;
    sessionSaved = false;
    currentLevel = 1;
    combo = 0;
    maxCombo = 0;
    comboTimer = 0;
    zoneHits = 0;
    goldenBall = null;
    goldenTimer = 0;
    imuTimeSeries = [];
    imuRecordTimer = 0;

    balls.length = 0;
    bombs.length = 0;
    particles.length = 0;
    popups.length = 0;

    catcher.x = canvas.width / 2 - catcher.w / 2;
    catcher.y = canvas.height - 82;

    for (let i = 0; i < 8; i++)  balls.push(createBall(-Math.random() * canvas.height));
    for (let i = 0; i < 4; i++)  bombs.push(createBomb(-Math.random() * canvas.height - 220));
  }

  // ─── PARTICLES & POPUPS ──────────────────────────────────────────────────────
  function spawnParticles(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        life: 26 + Math.random() * 18,
        color
      });
    }
  }

  function spawnPopup(x, y, text, color) {
    popups.push({ x, y, text, color, life: 40 });
  }

  // ─── COMBO ───────────────────────────────────────────────────────────────────
  function getComboMultiplier() {
    if (combo >= 15) return 3;
    if (combo >= 7)  return 2;
    return 1;
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────────
  function updateIMURecord() {
    if (!gameStarted || gameOver) return;
    imuRecordTimer++;
    if (imuRecordTimer >= IMU_SAMPLE_INTERVAL) {
      imuRecordTimer = 0;
      imuTimeSeries.push({
        t: Date.now() - gameStartTime,
        r: parseFloat(ble.smoothRoll.toFixed(2)),
        p: parseFloat(ble.smoothPitch.toFixed(2)),
        y: parseFloat(ble.smoothYaw.toFixed(2))
      });
    }
  }

  function updateParticles() {
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.life -= 1;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
  }

  function updatePopups() {
    for (const p of popups) { p.y -= 1.1; p.life -= 1; }
    for (let i = popups.length - 1; i >= 0; i--) {
      if (popups[i].life <= 0) popups.splice(i, 1);
    }
  }

  function updateCatcher() {
    if (ble.connected) {
      catcher.x += ble.smoothRoll * 0.65;
    } else {
      if (keys["arrowleft"] || keys["a"]) catcher.x -= catcher.speed;
      if (keys["arrowright"] || keys["d"]) catcher.x += catcher.speed;
    }
    if (catcher.x < 0) catcher.x = 0;
    if (catcher.x + catcher.w > canvas.width) catcher.x = canvas.width - catcher.w;
  }

  function updateBalls() {
    const speedMult = 1 + (currentLevel - 1) * 0.12;

    for (const ball of balls) {
      ball.y += ball.speed * speedMult;
      ball.sway += 0.05;
      ball.x += Math.sin(ball.sway) * 0.7;

      const caught = ball.y + ball.r >= catcher.y
        && ball.x >= catcher.x
        && ball.x <= catcher.x + catcher.w;

      if (caught) {
        combo++;
        comboTimer = 180;
        if (combo > maxCombo) maxCombo = combo;

        const mult = getComboMultiplier();
        const pts = mult;
        score += pts;
        currentLevel = Math.floor(score / 10) + 1;

        let popText = `+${pts}`;
        if (mult > 1) popText += ` ×${mult}`;
        if (ball.isZonal) {
          zoneHits++;
          popText += " 🎯";
          spawnParticles(ball.x, ball.y, "#ffd700", 16);
        } else {
          spawnParticles(ball.x, ball.y, ball.c1, 12);
        }
        spawnPopup(ball.x, ball.y - 10, popText, ball.isZonal ? "#ffd700" : ball.c1);
        Object.assign(ball, createBall(-Math.random() * 220 - 40));
        return;
      }

      if (ball.y - ball.r > canvas.height) {
        combo = 0;
        comboTimer = 0;
        Object.assign(ball, createBall(-Math.random() * 220 - 40));
      }
    }

    if (comboTimer > 0) {
      comboTimer--;
      if (comboTimer === 0) combo = 0;
    }
  }

  function updateBombs() {
    const speedMult = 1 + (currentLevel - 1) * 0.1;

    for (const bomb of bombs) {
      bomb.y += bomb.speed * speedMult;
      bomb.rot += 0.07;
      bomb.pulse += 0.08;

      const hit = bomb.y + bomb.r >= catcher.y
        && bomb.x >= catcher.x
        && bomb.x <= catcher.x + catcher.w;

      if (hit) {
        lives--;
        combo = 0;
        comboTimer = 0;
        spawnParticles(bomb.x, bomb.y, "#ff9f1c", 16);
        spawnPopup(bomb.x, bomb.y - 10, "-1 ❤️", "#ff9f1c");
        Object.assign(bomb, createBomb(-Math.random() * 320 - 120));
        if (lives <= 0) {
          gameOver = true;
          saveSession();
        }
      }
      if (bomb.y - bomb.r > canvas.height) {
        Object.assign(bomb, createBomb(-Math.random() * 320 - 120));
      }
    }
  }

  function updateGoldenBall() {
    goldenTimer++;
    if (goldenTimer >= GOLDEN_INTERVAL && !goldenBall) {
      goldenBall = createGoldenBall();
      goldenTimer = 0;
    }
    if (!goldenBall) return;

    goldenBall.y += goldenBall.speed;
    goldenBall.sway += 0.03;
    goldenBall.x += Math.sin(goldenBall.sway) * 0.4;
    goldenBall.pulse += 0.1;

    const caught = goldenBall.y + goldenBall.r >= catcher.y
      && goldenBall.x >= catcher.x
      && goldenBall.x <= catcher.x + catcher.w;

    if (caught) {
      const pts = 5 * getComboMultiplier();
      score += pts;
      combo += 3;
      if (combo > maxCombo) maxCombo = combo;
      comboTimer = 180;
      spawnParticles(goldenBall.x, goldenBall.y, "#ffd700", 30);
      spawnPopup(goldenBall.x, goldenBall.y - 20, `⭐ +${pts}`, "#ffd700");
      goldenBall = null;
      return;
    }
    if (goldenBall.y - goldenBall.r > canvas.height) {
      goldenBall = null;
    }
  }

  function update() {
    updateParticles();
    updatePopups();
    updateIMURecord();

    if (!gameStarted || gameOver) return;

    updateCatcher();
    updateBalls();
    updateBombs();
    updateGoldenBall();
  }

  // ─── DRAW ─────────────────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r, fill = true, stroke = false) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill)   ctx.fill();
    if (stroke) ctx.stroke();
  }

  function drawBackground() {
    if (bg.complete && bg.naturalWidth > 0) {
      ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, "#050816");
      g.addColorStop(1, "#140326");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawCatcher() {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(catcher.x + catcher.w / 2, catcher.y + catcher.h + 12, catcher.w * 0.42, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createLinearGradient(catcher.x, catcher.y, catcher.x, catcher.y + catcher.h);
    grad.addColorStop(0, "#5eead4");
    grad.addColorStop(0.55, "#38bdf8");
    grad.addColorStop(1, "#4f46e5");

    ctx.fillStyle = grad;
    roundRect(ctx, catcher.x, catcher.y, catcher.w, catcher.h, 14, true, false);

    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 2;
    roundRect(ctx, catcher.x, catcher.y, catcher.w, catcher.h, 14, false, true);

    // Комбо гло на платформе
    if (combo >= 7) {
      const glowColor = combo >= 15 ? "#ffd700" : "#fb923c";
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 18 + combo;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 2.5;
      roundRect(ctx, catcher.x, catcher.y, catcher.w, catcher.h, 14, false, true);
      ctx.shadowBlur = 0;
    }
  }

  function drawBall(ball) {
    if (ball.isZonal) {
      ctx.save();
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.fillText(ball.zoneSide === "left" ? "←" : "→", ball.x, ball.y - ball.r - 6);
      ctx.restore();
    }

    const grad = ctx.createRadialGradient(
      ball.x - ball.r * 0.3, ball.y - ball.r * 0.35, ball.r * 0.18,
      ball.x, ball.y, ball.r
    );
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.16, ball.c1);
    grad.addColorStop(1, ball.c2);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBalls() {
    for (const ball of balls) drawBall(ball);
  }

  function drawBombs() {
    for (const bomb of bombs) {
      ctx.save();
      ctx.translate(bomb.x, bomb.y);
      ctx.rotate(bomb.rot);

      const pulse = 1 + Math.sin(bomb.pulse) * 0.08;
      const glow  = 10 + (Math.sin(bomb.pulse * 1.6) + 1) * 8;

      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12;
        const sx = Math.cos(angle) * (bomb.r - 2);
        const sy = Math.sin(angle) * (bomb.r - 2);
        const ex = Math.cos(angle) * (bomb.r + 10) * pulse;
        const ey = Math.sin(angle) * (bomb.r + 10) * pulse;

        const spikeGrad = ctx.createLinearGradient(sx, sy, ex, ey);
        spikeGrad.addColorStop(0, "#ffd166");
        spikeGrad.addColorStop(1, "#ff4d00");

        ctx.strokeStyle = spikeGrad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.stroke();
      }

      ctx.shadowColor = "#ff7b00";
      ctx.shadowBlur = glow;

      const core = ctx.createRadialGradient(-5, -5, 2, 0, 0, bomb.r);
      core.addColorStop(0, "#6b7280");
      core.addColorStop(0.4, "#1f2937");
      core.addColorStop(1, "#090d18");

      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, bomb.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  function drawGoldenBall() {
    if (!goldenBall) return;
    const gb = goldenBall;
    const glow = 14 + Math.sin(gb.pulse) * 8;

    ctx.save();
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = glow;

    ctx.strokeStyle = `rgba(255,215,0,${0.5 + Math.sin(gb.pulse) * 0.3})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(gb.x, gb.y, gb.r + 8 + Math.sin(gb.pulse) * 4, 0, Math.PI * 2);
    ctx.stroke();

    const grad = ctx.createRadialGradient(
      gb.x - gb.r * 0.3, gb.y - gb.r * 0.35, gb.r * 0.2,
      gb.x, gb.y, gb.r
    );
    grad.addColorStop(0, "#fffbe6");
    grad.addColorStop(0.3, "#ffd700");
    grad.addColorStop(1, "#b45309");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(gb.x, gb.y, gb.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.fillText("⭐", gb.x, gb.y + 6);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / 40);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawPopups() {
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, p.life / 40);
      ctx.fillStyle = p.color;
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "center";
      ctx.fillText(p.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
  }

  // ROM Gauge — визуальный индикатор амплитуды движений
  function drawROMGauge() {
    const gx = canvas.width - 230;
    const gy = 100;
    const gw = 200;
    const gh = 36;

    // Фон
    ctx.fillStyle = "rgba(8,12,24,0.72)";
    roundRect(ctx, gx - 10, gy - 28, gw + 20, gh + 68, 12, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    roundRect(ctx, gx - 10, gy - 28, gw + 20, gh + 68, 12, false, true);

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.fillText("ROM МЕТР", gx + gw / 2, gy - 10);

    // Трек (диапазон ±45°)
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, gx, gy, gw, gh, 8, true, false);

    const maxRange = 45;
    const center = gx + gw / 2;
    const rollClamped = Math.max(-maxRange, Math.min(maxRange, ble.smoothRoll));
    const rollX = center + (rollClamped / maxRange) * (gw / 2);

    const absRoll = Math.abs(rollClamped);
    const gaugeColor = absRoll > 25 ? "#22c55e" : absRoll > 10 ? "#f59e0b" : "#ef4444";

    // Заполнение
    ctx.fillStyle = gaugeColor;
    ctx.globalAlpha = 0.35;
    if (rollClamped >= 0) {
      ctx.fillRect(center, gy + 4, Math.max(0, rollX - center), gh - 8);
    } else {
      ctx.fillRect(rollX, gy + 4, Math.max(0, center - rollX), gh - 8);
    }
    ctx.globalAlpha = 1;

    // Центр
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center, gy + 4);
    ctx.lineTo(center, gy + gh - 4);
    ctx.stroke();

    // Курсор
    ctx.fillStyle = gaugeColor;
    ctx.shadowColor = gaugeColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(rollX, gy + gh / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Метки углов
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px Arial";
    ctx.textAlign = "left";   ctx.fillText("-45°", gx,           gy + gh + 14);
    ctx.textAlign = "center"; ctx.fillText("0°",   center,       gy + gh + 14);
    ctx.textAlign = "right";  ctx.fillText("+45°", gx + gw,      gy + gh + 14);

    // Текущее значение
    ctx.fillStyle = gaugeColor;
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${ble.smoothRoll.toFixed(1)}°`, gx + gw / 2, gy + gh + 30);

    // Качество движения
    const quality = absRoll > 25 ? "Отлично" : absRoll > 10 ? "Хорошо" : "Двигайся шире!";
    ctx.fillStyle = gaugeColor;
    ctx.font = "bold 11px Arial";
    ctx.fillText(quality, gx + gw / 2, gy + gh + 46);

    ctx.textAlign = "left";
  }

  function drawHud() {
    if (!gameStarted) return;

    // Основной HUD
    ctx.fillStyle = "rgba(8,12,24,0.72)";
    roundRect(ctx, 20, 100, 260, 150, 18, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, 20, 100, 260, 150, 18, false, true);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px Arial";
    ctx.fillText(`Score: ${score}`, 36, 138);
    ctx.font = "bold 22px Arial";
    ctx.fillText(`Level: ${currentLevel}`, 36, 170);

    // Жизни
    let livesStr = "";
    for (let i = 0; i < 3; i++) livesStr += i < lives ? "❤️" : "🖤";
    ctx.fillText(livesStr, 36, 200);

    // Комбо
    if (combo >= 2) {
      const mult = getComboMultiplier();
      const comboColor = mult >= 3 ? "#ffd700" : mult >= 2 ? "#fb923c" : "#a3e635";
      ctx.fillStyle = comboColor;
      ctx.font = `bold ${22 + mult * 2}px Arial`;
      ctx.fillText(`COMBO ×${combo}`, 36, 236);
    }

    // ROM Gauge в правом верхнем углу
    drawROMGauge();
  }

  function drawHint() {
    if (!gameStarted || gameOver) return;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 17px Arial";
    ctx.fillText("A/D немесе ESP32 Roll арқылы басқар", 26, canvas.height - 30);
  }

  function drawGameOver() {
    if (!gameOver) return;

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 58px Arial";
    ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 70);

    ctx.font = "bold 30px Arial";
    ctx.fillText(`Ұпай: ${score}`, canvas.width / 2, canvas.height / 2 - 14);
    ctx.fillText(`Макс комбо: ×${maxCombo}`, canvas.width / 2, canvas.height / 2 + 34);
    ctx.fillText(`Зона хиттер: ${zoneHits} 🎯`, canvas.width / 2, canvas.height / 2 + 78);
    ctx.fillText("Қайта бастау үшін R бас", canvas.width / 2, canvas.height / 2 + 128);
    ctx.textAlign = "left";
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────────
  function render() {
    update();
    drawBackground();

    if (gameStarted) {
      drawCatcher();
      drawBalls();
      drawBombs();
      drawGoldenBall();
      drawParticles();
      drawPopups();
      drawHud();
      drawHint();
      drawGameOver();
    }

    requestAnimationFrame(render);
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────────
  resizeCanvas();
  resetGame();
  loadPatients();

  window.addEventListener("resize", resizeCanvas);

  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (gameOver && e.key.toLowerCase() === "r") {
      resetGame();
      gameStartTime = Date.now();
      gameStarted = true;
      menuScreen.classList.add("hidden");
    }
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  startBtn.addEventListener("click", () => {
    resetGame();
    gameStartTime = Date.now();
    menuScreen.classList.add("hidden");
    gameStarted = true;
  });

  menuBtn.addEventListener("click", () => {
    menuScreen.classList.remove("hidden");
    gameStarted = false;
  });

  settingsBtn.addEventListener("click", () => { settingsPanel.classList.toggle("hidden"); });
  closeSettingsBtn.addEventListener("click", () => { settingsPanel.classList.add("hidden"); });

  connectBtn.addEventListener("click", connectBLE);
  disconnectBtn.addEventListener("click", disconnectBLE);
  calibBtn.addEventListener("click", () => sendCommand("CALIB"));
  zeroBtn.addEventListener("click", () => sendCommand("RESET_YAW"));

  render();
});
