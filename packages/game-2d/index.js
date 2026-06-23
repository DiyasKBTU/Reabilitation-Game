/**
 * packages/game-2d — Space Catcher Game Engine
 *
 * Чистый игровой движок. Никакого document.getElementById, window.location,
 * localStorage, fetch. Всё взаимодействие с внешним миром — через параметры
 * конструктора (canvas, callbacks).
 *
 * @example
 * const engine = new Game2DEngine(canvasElement, {
 *   alpha: 0.22,
 *   bgSrc: "bg.jpg",
 *   onGameOver: (data) => console.log(data),
 * });
 * engine.start();
 * engine.updateInput(bleReading.smooth.roll);
 * // при демонтаже компонента:
 * engine.destroy();
 */

// Частота записи IMU-ряда для ML. 25 Гц (Nyquist 12.5 Гц) покрывает клиническую полосу
// тремора 3–12 Гц; на прежних 5 Гц (Nyquist 2.5 Гц) спектральные признаки tremorPower/
// tremorFreqHz структурно зануляются (features._spectral_tremor). Совпадает с fs_hz синтетики
// обучения (25 Гц) → запись приходит в то же распределение, на котором обучена модель.
const IMU_RECORD_MS = 40;

export class Game2DEngine {
  // ─── Конструктор ──────────────────────────────────────────────────────────

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number}   [opts.alpha=0.22]     — коэффициент сглаживания IMU (EMA)
   * @param {string}   [opts.bgSrc=null]     — путь к фоновому изображению
   * @param {Function} [opts.onGameOver]     — вызывается с { score, maxCombo, zoneHits, imuTimeSeries, durationSec }
   * @param {Function} [opts.onScore]        — вызывается при изменении очков
   */
  constructor(canvas, opts = {}) {
    this._canvas  = canvas;
    this._ctx     = canvas.getContext("2d");
    this._alpha   = opts.alpha ?? 0.22;
    this.onGameOver = opts.onGameOver ?? null;
    this.onScore    = opts.onScore    ?? null;

    // Фоновое изображение
    this._bg = new Image();
    if (opts.bgSrc) this._bg.src = opts.bgSrc;

    // Входной сигнал (от BLE или keyboard)
    this._roll  = 0;
    this._pitch = 0;
    this._yaw   = 0;
    this._smoothRoll  = 0;
    this._smoothPitch = 0;
    this._smoothYaw   = 0;
    // Канал ЗАПИСИ для ML: калиброванный, но НЕсглаженный угол (управление — по _smooth*,
    // запись — по _rec*). Сглаживание стёрло бы тремор до попадания в imu_time_series.
    this._recRoll  = 0;
    this._recPitch = 0;
    this._recYaw   = 0;
    this._bleInput    = false;  // true = есть внешний вход (BLE/калибр. клавиатура); иначе своя клавиатура

    // Игровые состояния
    this._gameStarted   = false;
    this._gameOver      = false;
    this._gameStartTime = 0;
    this._sessionSaved  = false;
    this._rafId         = null;

    // Игровые данные
    this._score        = 0;
    this._lives        = 3;
    this._combo        = 0;
    this._maxCombo     = 0;
    this._comboTimer   = 0;
    this._currentLevel = 1;
    this._zoneHits     = 0;
    this._imuTimeSeries = [];
    this._imuAccumMs   = 0;   // аккумулятор времени для записи IMU (по реальному времени, не по кадрам)

    // ── Тайминг для delta-time (независимость от частоты кадров) ──────────────
    // Вся физика масштабируется на _dtFactor = dt / (1000/60), чтобы на 120/144 Гц
    // игра не ускорялась в 2–2.4×, а на слабом железе не замедлялась. Это важно
    // и для честности IMU-данных (плотность сэмплов перестаёт зависеть от FPS).
    this._lastFrameTime = 0;
    this._dtFactor      = 1;
    this._dtMs          = 1000 / 60;

    // Логические (CSS-пиксельные) размеры сцены. Backing store масштабируется
    // на devicePixelRatio в _resizeCanvas, поэтому на HiDPI нет размытия.
    this._w = 0;
    this._h = 0;

    // Объекты сцены
    this._catcher = { x: 0, y: 0, w: 180, h: 30, speed: 9 };
    this._balls   = [];
    this._bombs   = [];
    this._particles = [];
    this._popups    = [];
    this._goldenBall  = null;
    this._goldenTimer = 0;

    // Параллакс-звёздный фон (глубина) и бонус-сердце (восстановление жизни)
    this._stars      = [];
    this._heart      = null;
    this._heartTimer = 0;

    this._keys = {};

    // Привязки для removeEventListener
    this._onKeyDown   = this._handleKeyDown.bind(this);
    this._onKeyUp     = (e) => { this._keys[e.key.toLowerCase()] = false; };
    this._onResize    = this._resizeCanvas.bind(this);

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup",   this._onKeyUp);
    window.addEventListener("resize",  this._onResize);

    this._resizeCanvas();
    this._render = this._render.bind(this);
    this._rafId = requestAnimationFrame(this._render);
  }

  // ─── Публичный API ────────────────────────────────────────────────────────

  /**
   * Обновить входные данные от BLE / клавиатуры / воспроизведения файла.
   * Вызывается снаружи (BLE-стор, useEffect) — движок не знает об источнике.
   * @param {number} rollDeg
   * @param {number} [pitchDeg=0]
   * @param {number} [yawDeg=0]
   */
  /**
   * @param {number} rollDeg   сглаженный угол (управление)
   * @param {number} [pitchDeg]
   * @param {number} [yawDeg]
   * @param {{roll:number,pitch:number,yaw:number}} [rec] калиброванный НЕсглаженный угол для
   *        записи в ML-ряд (BLE-поле `calib`). Если не передан — пишем сглаженный (демо/keyboard).
   */
  updateInput(rollDeg, pitchDeg = 0, yawDeg = 0, rec = null) {
    this._bleInput = true;  // пришёл внешний вход → управление от него, не от своей клавиатуры
    this._roll  = this._normalizeAngle(rollDeg);
    this._pitch = pitchDeg;
    this._yaw   = this._normalizeAngle(yawDeg);

    const a = 1 - this._alpha;
    this._smoothRoll  = this._smoothRoll  * a + this._roll  * this._alpha;
    this._smoothPitch = this._smoothPitch * a + this._pitch * this._alpha;
    this._smoothYaw   = this._smoothYaw   * a + this._yaw   * this._alpha;

    // Запись — несглаженный калиброванный угол (сохраняет тремор для ML). Fallback на
    // управляющий сигнал, если устройство не прислало calib (старый вызов/демо).
    this._recRoll  = rec ? this._normalizeAngle(rec.roll)  : this._smoothRoll;
    this._recPitch = rec ? rec.pitch                       : this._smoothPitch;
    this._recYaw   = rec ? this._normalizeAngle(rec.yaw)   : this._smoothYaw;
  }

  /** Запустить игру (с меню → игра) */
  start() {
    this._resetGame();
    this._gameStartTime = Date.now();
    this._lastFrameTime = 0;  // сбросить, чтобы первый dt после паузы не был огромным
    this._gameStarted = true;
    this._gameOver    = false;
    this._sessionSaved = false;
  }

  /** Вернуться в меню без Game Over */
  returnToMenu() {
    this._gameStarted = false;
  }

  /** Освободить ресурсы (при демонтаже компонента) */
  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup",   this._onKeyUp);
    window.removeEventListener("resize",  this._onResize);
  }

  /** Текущий статус: score, lives, combo, gameOver, gameStarted */
  get state() {
    return {
      score:   this._score,
      lives:   this._lives,
      combo:   this._combo,
      level:   this._currentLevel,
      gameOver: this._gameOver,
      started:  this._gameStarted,
    };
  }

  // ─── Вспомогательные ──────────────────────────────────────────────────────

  _normalizeAngle(v) {
    while (v > 180)  v -= 360;
    while (v < -180) v += 360;
    return v;
  }

  _resizeCanvas() {
    // Логические размеры — в CSS-пикселях; вся игровая геометрия работает в них.
    const cssW = this._canvas.offsetWidth  || window.innerWidth;
    const cssH = this._canvas.offsetHeight || window.innerHeight;
    this._w = cssW;
    this._h = cssH;

    // Backing store масштабируем на devicePixelRatio → чёткая картинка на HiDPI/Retina.
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width  = Math.round(cssW * dpr);
    this._canvas.height = Math.round(cssH * dpr);
    // Рисуем в логических координатах: масштаб контекста = dpr.
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._catcher.y = this._h - 82;
    if (this._catcher.x === 0) {
      this._catcher.x = this._w / 2 - this._catcher.w / 2;
    }
    this._initStars();
  }

  /** Параллакс-звёзды: плотность пропорциональна площади; дальние тусклее и медленнее. */
  _initStars() {
    const count = Math.max(40, Math.round((this._w * this._h) / 9000));
    this._stars = [];
    for (let i = 0; i < count; i++) {
      this._stars.push({
        x: Math.random() * this._w,
        y: Math.random() * this._h,
        r: Math.random() * 1.4 + 0.3,
        sp: 0.05 + Math.random() * 0.35,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  _handleKeyDown(e) {
    this._keys[e.key.toLowerCase()] = true;
    // R — рестарт после Game Over
    if (this._gameOver && e.key.toLowerCase() === "r") {
      this.start();
    }
  }

  // ─── Factory ──────────────────────────────────────────────────────────────

  static _BALL_PALETTES = [
    ["#ffe27a", "#ffb703"],
    ["#8ff7ff", "#3bbcff"],
    ["#ff9be8", "#f72585"],
    ["#b9ff88", "#22c55e"],
    ["#dcc2ff", "#8b5cf6"],
    ["#ffb48f", "#fb5607"]
  ];

  _createBall(startY = -50) {
    const palette = Game2DEngine._BALL_PALETTES[
      Math.floor(Math.random() * Game2DEngine._BALL_PALETTES.length)
    ];
    const isZonal  = Math.random() < 0.25;
    const zoneSide = Math.random() < 0.5 ? "left" : "right";
    let x;
    if (isZonal) {
      x = zoneSide === "left"
        ? Math.random() * (this._w * 0.28) + 30
        : this._w * 0.72 + Math.random() * (this._w * 0.25);
    } else {
      x = Math.random() * (this._w - 90) + 45;
    }
    return {
      x: Math.max(30, Math.min(this._w - 30, x)),
      y: startY,
      r: 22 + Math.random() * 6,
      speed: 2.1 + Math.random() * 2.3,
      sway: Math.random() * Math.PI * 2,
      c1: palette[0], c2: palette[1],
      isZonal, zoneSide
    };
  }

  _createBomb(startY = -50) {
    return {
      x: Math.random() * (this._w - 90) + 45,
      y: startY,
      r: 20,
      speed: 2.8 + Math.random() * 2.1,
      rot: Math.random() * Math.PI * 2,
      pulse: Math.random() * Math.PI * 2
    };
  }

  _createGoldenBall() {
    const side = Math.random() < 0.5 ? "left" : "right";
    const x = side === "left"
      ? 30 + Math.random() * 60
      : this._w - 90 + Math.random() * 60;
    return { x, y: -60, r: 28, speed: 1.8, sway: Math.random() * Math.PI * 2, pulse: 0 };
  }

  // ─── Reset ────────────────────────────────────────────────────────────────

  _resetGame() {
    this._score        = 0;
    this._lives        = 3;
    this._gameOver     = false;
    this._sessionSaved = false;
    this._currentLevel = 1;
    this._combo        = 0;
    this._maxCombo     = 0;
    this._comboTimer   = 0;
    this._zoneHits     = 0;
    this._goldenBall   = null;
    this._goldenTimer  = 0;
    this._heart        = null;
    this._heartTimer   = 0;
    this._imuTimeSeries  = [];
    this._imuAccumMs     = 0;
    this._recRoll = 0; this._recPitch = 0; this._recYaw = 0;

    this._balls.length     = 0;
    this._bombs.length     = 0;
    this._particles.length = 0;
    this._popups.length    = 0;

    this._catcher.x = this._w  / 2 - this._catcher.w / 2;
    this._catcher.y = this._h - 82;

    for (let i = 0; i < 8; i++) this._balls.push(this._createBall(-Math.random() * this._h));
    for (let i = 0; i < 4; i++) this._bombs.push(this._createBomb(-Math.random() * this._h - 220));
  }

  // ─── Particles & Popups ───────────────────────────────────────────────────

  _spawnParticles(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      this._particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        life: 26 + Math.random() * 18,
        color
      });
    }
  }

  _spawnPopup(x, y, text, color) {
    this._popups.push({ x, y, text, color, life: 40 });
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  _getComboMultiplier() {
    if (this._combo >= 15) return 3;
    if (this._combo >= 7)  return 2;
    return 1;
  }

  _updateIMURecord() {
    if (!this._gameStarted || this._gameOver) return;
    // Запись по реальному времени (а не по числу кадров) → плотность IMU-сэмплов
    // не зависит от частоты обновления экрана.
    this._imuAccumMs += this._dtMs;
    if (this._imuAccumMs >= IMU_RECORD_MS) { // 25 Гц — покрывает полосу тремора
      this._imuAccumMs = 0;
      this._imuTimeSeries.push({
        t: Date.now() - this._gameStartTime,
        r: parseFloat(this._recRoll.toFixed(2)),
        p: parseFloat(this._recPitch.toFixed(2)),
        y: parseFloat(this._recYaw.toFixed(2))
      });
    }
  }

  _updateParticles() {
    const f = this._dtFactor;
    for (const p of this._particles) {
      p.x += p.vx * f; p.y += p.vy * f; p.vy += 0.04 * f; p.life -= f;
    }
    for (let i = this._particles.length - 1; i >= 0; i--) {
      if (this._particles[i].life <= 0) this._particles.splice(i, 1);
    }
  }

  _updatePopups() {
    const f = this._dtFactor;
    for (const p of this._popups) { p.y -= 1.1 * f; p.life -= f; }
    for (let i = this._popups.length - 1; i >= 0; i--) {
      if (this._popups[i].life <= 0) this._popups.splice(i, 1);
    }
  }

  _updateCatcher() {
    const f = this._dtFactor;
    // Гейт управления — по флагу _bleInput, а НЕ по величине _smoothRoll: иначе
    // синтезированный для записи roll (ниже) переключал бы управление на «BLE».
    if (this._bleInput) {
      this._catcher.x += this._smoothRoll * 0.65 * f;
      if (this._catcher.x < 0) this._catcher.x = 0;
      if (this._catcher.x + this._catcher.w > this._w) this._catcher.x = this._w - this._catcher.w;
    } else {
      if (this._keys["arrowleft"] || this._keys["a"]) this._catcher.x -= this._catcher.speed * f;
      if (this._keys["arrowright"] || this._keys["d"]) this._catcher.x += this._catcher.speed * f;
      if (this._catcher.x < 0) this._catcher.x = 0;
      if (this._catcher.x + this._catcher.w > this._w) this._catcher.x = this._w - this._catcher.w;
      // Синтез виртуального roll из позиции платформы — чтобы IMU-запись и ROM-метр были
      // осмысленными БЕЗ устройства (иначе imuTimeSeries ≈ 0 → features.valid=false,
      // что и подтвердилось на реальных Firebase-данных: game1 ROM=0).
      const center = this._catcher.x + this._catcher.w / 2;
      const norm = Math.max(-1, Math.min(1, (center - this._w / 2) / (this._w / 2)));
      this._smoothRoll = norm * 45;
      this._recRoll = this._smoothRoll;  // без устройства тремора нет — пишем синтез-угол
    }
  }

  _updateBalls() {
    const f = this._dtFactor;
    const speedMult = 1 + (this._currentLevel - 1) * 0.12;
    for (const ball of this._balls) {
      ball.y += ball.speed * speedMult * f;
      ball.sway += 0.05 * f;
      ball.x += Math.sin(ball.sway) * 0.7 * f;

      const caught = ball.y + ball.r >= this._catcher.y
        && ball.x >= this._catcher.x
        && ball.x <= this._catcher.x + this._catcher.w;

      if (caught) {
        this._combo++;
        this._comboTimer = 180;
        if (this._combo > this._maxCombo) this._maxCombo = this._combo;

        const mult = this._getComboMultiplier();
        const pts  = mult;
        this._score += pts;
        this._currentLevel = Math.floor(this._score / 10) + 1;
        this.onScore?.(this._score);

        let popText = `+${pts}`;
        if (mult > 1) popText += ` ×${mult}`;
        if (ball.isZonal) {
          this._zoneHits++;
          popText += " 🎯";
          this._spawnParticles(ball.x, ball.y, "#ffd700", 16);
        } else {
          this._spawnParticles(ball.x, ball.y, ball.c1, 12);
        }
        this._spawnPopup(ball.x, ball.y - 10, popText, ball.isZonal ? "#ffd700" : ball.c1);
        Object.assign(ball, this._createBall(-Math.random() * 220 - 40));
        // continue (не return!): иначе остальные мячи в этом кадре замирают,
        // а comboTimer ниже не декрементируется.
        continue;
      }
      if (ball.y - ball.r > this._h) {
        this._combo = 0;
        this._comboTimer = 0;
        Object.assign(ball, this._createBall(-Math.random() * 220 - 40));
      }
    }
    if (this._comboTimer > 0) {
      this._comboTimer -= f;
      if (this._comboTimer <= 0) { this._comboTimer = 0; this._combo = 0; }
    }
  }

  _updateBombs() {
    const f = this._dtFactor;
    const speedMult = 1 + (this._currentLevel - 1) * 0.1;
    for (const bomb of this._bombs) {
      bomb.y += bomb.speed * speedMult * f;
      bomb.rot   += 0.07 * f;
      bomb.pulse += 0.08 * f;

      const hit = bomb.y + bomb.r >= this._catcher.y
        && bomb.x >= this._catcher.x
        && bomb.x <= this._catcher.x + this._catcher.w;

      if (hit) {
        this._lives--;
        this._combo      = 0;
        this._comboTimer = 0;
        this._spawnParticles(bomb.x, bomb.y, "#ff9f1c", 16);
        this._spawnPopup(bomb.x, bomb.y - 10, "-1", "#ff9f1c");
        Object.assign(bomb, this._createBomb(-Math.random() * 320 - 120));
        if (this._lives <= 0) this._triggerGameOver();
      }
      if (bomb.y - bomb.r > this._h) {
        Object.assign(bomb, this._createBomb(-Math.random() * 320 - 120));
      }
    }
  }

  _updateGoldenBall() {
    const f = this._dtFactor;
    const GOLDEN_INTERVAL = 1800;
    this._goldenTimer += f;
    if (this._goldenTimer >= GOLDEN_INTERVAL && !this._goldenBall) {
      this._goldenBall = this._createGoldenBall();
      this._goldenTimer = 0;
    }
    if (!this._goldenBall) return;

    const gb = this._goldenBall;
    gb.y += gb.speed * f;
    gb.sway += 0.03 * f;
    gb.x += Math.sin(gb.sway) * 0.4 * f;
    gb.pulse += 0.1 * f;

    const caught = gb.y + gb.r >= this._catcher.y
      && gb.x >= this._catcher.x
      && gb.x <= this._catcher.x + this._catcher.w;

    if (caught) {
      const pts = 5 * this._getComboMultiplier();
      this._score += pts;
      this._combo += 3;
      if (this._combo > this._maxCombo) this._maxCombo = this._combo;
      this._comboTimer = 180;
      this._spawnParticles(gb.x, gb.y, "#ffd700", 30);
      this._spawnPopup(gb.x, gb.y - 20, `⭐ +${pts}`, "#ffd700");
      this._goldenBall = null;
      this.onScore?.(this._score);
      return;
    }
    if (gb.y - gb.r > this._h) this._goldenBall = null;
  }

  /** Бонус-сердце: изредка падает, ловится платформой → +1 жизнь (макс 3). */
  _updateHeart() {
    const f = this._dtFactor;
    const HEART_INTERVAL = 2600;
    this._heartTimer += f;
    if (this._heartTimer >= HEART_INTERVAL && !this._heart && this._lives < 3) {
      this._heartTimer = 0;
      this._heart = { x: 60 + Math.random() * (this._w - 120), y: -40, r: 16, speed: 2.2, pulse: 0 };
    }
    if (!this._heart) return;
    const h = this._heart;
    h.y += h.speed * f;
    h.pulse += 0.1 * f;
    const caught = h.y + h.r >= this._catcher.y
      && h.x >= this._catcher.x && h.x <= this._catcher.x + this._catcher.w;
    if (caught) {
      this._lives = Math.min(3, this._lives + 1);
      this._spawnParticles(h.x, h.y, "#ff6b9d", 18);
      this._spawnPopup(h.x, h.y - 12, "+1 жизнь", "#ff6b9d");
      this._heart = null;
      return;
    }
    if (h.y - h.r > this._h) this._heart = null;
  }

  _triggerGameOver() {
    this._gameOver = true;
    if (this._sessionSaved) return;
    this._sessionSaved = true;
    const durationSec = Math.floor((Date.now() - this._gameStartTime) / 1000);
    this.onGameOver?.({
      score:          this._score,
      maxCombo:       this._maxCombo,
      zoneHits:       this._zoneHits,
      imuTimeSeries:  this._imuTimeSeries,
      durationSec,
      level:          this._currentLevel,
      gameType:       "game1",
      gameName:       "Space Catcher"
    });
  }

  _update() {
    this._updateParticles();
    this._updatePopups();
    this._updateIMURecord();
    if (!this._gameStarted || this._gameOver) return;
    this._updateCatcher();
    this._updateBalls();
    this._updateBombs();
    this._updateGoldenBall();
    this._updateHeart();
  }

  // ─── Draw ─────────────────────────────────────────────────────────────────

  _roundRect(ctx, x, y, w, h, r, fill = true, stroke = false) {
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

  _drawBackground() {
    const ctx = this._ctx;
    if (this._bg.complete && this._bg.naturalWidth > 0) {
      ctx.drawImage(this._bg, 0, 0, this._w, this._h);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, this._h);
    g.addColorStop(0,   "#050816");
    g.addColorStop(0.6, "#0b0a2a");
    g.addColorStop(1,   "#1a0530");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this._w, this._h);

    // Туманность — мягкие цветные пятна для глубины
    for (const [bx, by, br, col] of [
      [this._w * 0.2, this._h * 0.3, this._w * 0.35, "rgba(59,130,246,0.10)"],
      [this._w * 0.8, this._h * 0.55, this._w * 0.4, "rgba(168,85,247,0.10)"],
    ]) {
      const ng = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      ng.addColorStop(0, col);
      ng.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ng;
      ctx.fillRect(0, 0, this._w, this._h);
    }

    // Звёзды: лёгкий параллакс-дрейф вниз + мерцание
    if (!this._stars.length) this._initStars();
    const f = this._dtFactor;
    ctx.fillStyle = "#cfe3ff";
    for (const s of this._stars) {
      s.y += s.sp * f;
      if (s.y > this._h) { s.y = 0; s.x = Math.random() * this._w; }
      s.tw += 0.05 * f;
      ctx.globalAlpha = 0.5 + Math.sin(s.tw) * 0.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawCatcher() {
    const ctx = this._ctx;
    const { x, y, w, h } = this._catcher;

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h + 12, w * 0.42, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0,    "#5eead4");
    grad.addColorStop(0.55, "#38bdf8");
    grad.addColorStop(1,    "#4f46e5");
    ctx.fillStyle = grad;
    this._roundRect(ctx, x, y, w, h, 14, true, false);

    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 2;
    this._roundRect(ctx, x, y, w, h, 14, false, true);

    if (this._combo >= 7) {
      const glowColor = this._combo >= 15 ? "#ffd700" : "#fb923c";
      ctx.shadowColor = glowColor;
      ctx.shadowBlur  = 18 + this._combo;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth   = 2.5;
      this._roundRect(ctx, x, y, w, h, 14, false, true);
      ctx.shadowBlur = 0;
    }
  }

  _drawBall(ball) {
    const ctx = this._ctx;
    if (ball.isZonal) {
      ctx.save();
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth   = 3;
      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur  = 10;
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
    grad.addColorStop(0,    "#ffffff");
    grad.addColorStop(0.16, ball.c1);
    grad.addColorStop(1,    ball.c2);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawBombs() {
    const ctx = this._ctx;
    for (const bomb of this._bombs) {
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
        const sg = ctx.createLinearGradient(sx, sy, ex, ey);
        sg.addColorStop(0, "#ffd166");
        sg.addColorStop(1, "#ff4d00");
        ctx.strokeStyle = sg;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      ctx.shadowColor = "#ff7b00";
      ctx.shadowBlur  = glow;
      const core = ctx.createRadialGradient(-5, -5, 2, 0, 0, bomb.r);
      core.addColorStop(0,   "#6b7280");
      core.addColorStop(0.4, "#1f2937");
      core.addColorStop(1,   "#090d18");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, bomb.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  _drawGoldenBall() {
    if (!this._goldenBall) return;
    const ctx = this._ctx;
    const gb  = this._goldenBall;
    const glow = 14 + Math.sin(gb.pulse) * 8;

    ctx.save();
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur  = glow;
    ctx.strokeStyle = `rgba(255,215,0,${0.5 + Math.sin(gb.pulse) * 0.3})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(gb.x, gb.y, gb.r + 8 + Math.sin(gb.pulse) * 4, 0, Math.PI * 2);
    ctx.stroke();
    const grad = ctx.createRadialGradient(
      gb.x - gb.r * 0.3, gb.y - gb.r * 0.35, gb.r * 0.2,
      gb.x, gb.y, gb.r
    );
    grad.addColorStop(0,   "#fffbe6");
    grad.addColorStop(0.3, "#ffd700");
    grad.addColorStop(1,   "#b45309");
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

  /** Векторное сердце (вместо эмодзи): для HUD-жизней и бонуса-сердца. */
  _drawHeartShape(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x,        y,            x - s, y,            x - s, y + s * 0.3);
    ctx.bezierCurveTo(x - s,    y + s * 0.62, x,     y + s * 0.9,  x,     y + s * 1.1);
    ctx.bezierCurveTo(x,        y + s * 0.9,  x + s, y + s * 0.62, x + s, y + s * 0.3);
    ctx.bezierCurveTo(x + s,    y,            x,     y,            x,     y + s * 0.3);
    ctx.closePath();
    ctx.fill();
  }

  _drawHeart() {
    if (!this._heart) return;
    const ctx = this._ctx;
    const h = this._heart;
    const s = h.r * (1 + Math.sin(h.pulse) * 0.08);
    ctx.save();
    ctx.shadowColor = "#ff4d8d";
    ctx.shadowBlur  = 14 + Math.sin(h.pulse) * 6;
    const grad = ctx.createLinearGradient(h.x, h.y - s, h.x, h.y + s);
    grad.addColorStop(0, "#ff9ec4");
    grad.addColorStop(1, "#e11d6f");
    ctx.fillStyle = grad;
    this._drawHeartShape(ctx, h.x, h.y, s);
    ctx.restore();
  }

  _drawParticles() {
    const ctx = this._ctx;
    for (const p of this._particles) {
      ctx.globalAlpha = Math.max(0, p.life / 40);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  _drawPopups() {
    const ctx = this._ctx;
    for (const p of this._popups) {
      ctx.globalAlpha = Math.max(0, p.life / 40);
      ctx.fillStyle = p.color;
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "center";
      ctx.fillText(p.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
  }

  _drawROMGauge() {
    const ctx = this._ctx;
    const gx = this._w - 230;
    const gy = 100;
    const gw = 200;
    const gh = 36;

    ctx.fillStyle = "rgba(8,12,24,0.72)";
    this._roundRect(ctx, gx - 10, gy - 28, gw + 20, gh + 68, 12, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    this._roundRect(ctx, gx - 10, gy - 28, gw + 20, gh + 68, 12, false, true);

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.fillText("ROM МЕТР", gx + gw / 2, gy - 10);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    this._roundRect(ctx, gx, gy, gw, gh, 8, true, false);

    const maxRange = 45;
    const center   = gx + gw / 2;
    const rollClamped = Math.max(-maxRange, Math.min(maxRange, this._smoothRoll));
    const rollX = center + (rollClamped / maxRange) * (gw / 2);

    const absRoll = Math.abs(rollClamped);
    const gaugeColor = absRoll > 25 ? "#22c55e" : absRoll > 10 ? "#f59e0b" : "#ef4444";

    ctx.fillStyle = gaugeColor;
    ctx.globalAlpha = 0.35;
    if (rollClamped >= 0) {
      ctx.fillRect(center, gy + 4, Math.max(0, rollX - center), gh - 8);
    } else {
      ctx.fillRect(rollX, gy + 4, Math.max(0, center - rollX), gh - 8);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center, gy + 4); ctx.lineTo(center, gy + gh - 4);
    ctx.stroke();

    ctx.fillStyle = gaugeColor;
    ctx.shadowColor = gaugeColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(rollX, gy + gh / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px Arial";
    ctx.textAlign = "left";  ctx.fillText("-45°", gx,        gy + gh + 14);
    ctx.textAlign = "center"; ctx.fillText("0°",  center,    gy + gh + 14);
    ctx.textAlign = "right";  ctx.fillText("+45°", gx + gw,  gy + gh + 14);

    ctx.fillStyle = gaugeColor;
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${this._smoothRoll.toFixed(1)}°`, gx + gw / 2, gy + gh + 30);

    const quality = absRoll > 25 ? "Отлично" : absRoll > 10 ? "Хорошо" : "Двигайся шире!";
    ctx.fillStyle = gaugeColor;
    ctx.font = "bold 11px Arial";
    ctx.fillText(quality, gx + gw / 2, gy + gh + 46);
    ctx.textAlign = "left";
  }

  _drawHud() {
    if (!this._gameStarted) return;
    const ctx = this._ctx;
    ctx.fillStyle = "rgba(8,12,24,0.72)";
    this._roundRect(ctx, 20, 100, 260, 150, 18, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, 20, 100, 260, 150, 18, false, true);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px Arial";
    ctx.fillText(`Score: ${this._score}`, 36, 138);
    ctx.font = "bold 22px Arial";
    ctx.fillText(`Level: ${this._currentLevel}`, 36, 170);

    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < this._lives ? "#ff4d8d" : "rgba(255,255,255,0.18)";
      this._drawHeartShape(ctx, 44 + i * 30, 186, 9);
    }
    ctx.fillStyle = "#fff";

    if (this._combo >= 2) {
      const mult = this._getComboMultiplier();
      const comboColor = mult >= 3 ? "#ffd700" : mult >= 2 ? "#fb923c" : "#a3e635";
      ctx.fillStyle = comboColor;
      ctx.font = `bold ${22 + mult * 2}px Arial`;
      ctx.fillText(`COMBO ×${this._combo}`, 36, 236);
    }

    this._drawROMGauge();
  }

  _drawHint() {
    if (!this._gameStarted || this._gameOver) return;
    const ctx = this._ctx;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 17px Arial";
    ctx.fillText("Управление: A/D или наклон кисти (ESP32 Roll)", 26, this._h - 30);
  }

  _drawGameOver() {
    if (!this._gameOver) return;
    const ctx = this._ctx;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, this._w, this._h);
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 58px Arial";
    ctx.fillText("GAME OVER", this._w / 2, this._h / 2 - 70);
    ctx.font = "bold 30px Arial";
    ctx.fillText(`Очки: ${this._score}`, this._w / 2, this._h / 2 - 14);
    ctx.fillText(`Макс комбо: ×${this._maxCombo}`, this._w / 2, this._h / 2 + 34);
    ctx.fillText(`Зональные: ${this._zoneHits} 🎯`, this._w / 2, this._h / 2 + 78);
    ctx.fillText("Нажми R чтобы начать заново", this._w / 2, this._h / 2 + 128);
    ctx.textAlign = "left";
  }

  // ─── Render loop ──────────────────────────────────────────────────────────

  _render(ts) {
    if (!this._rafId) return; // destroyed

    // ── Delta-time ──────────────────────────────────────────────────────────
    const now = typeof ts === "number" ? ts : performance.now();
    if (!this._lastFrameTime) this._lastFrameTime = now;
    let dtMs = now - this._lastFrameTime;
    this._lastFrameTime = now;
    if (!isFinite(dtMs) || dtMs <= 0) dtMs = 1000 / 60;
    // Ограничиваем скачок (после переключения вкладки) — не больше ~3 кадров.
    dtMs = Math.min(dtMs, 1000 / 20);
    this._dtMs = dtMs;
    this._dtFactor = dtMs / (1000 / 60);

    this._update();
    this._drawBackground();

    if (this._gameStarted) {
      this._drawCatcher();
      for (const ball of this._balls) this._drawBall(ball);
      this._drawBombs();
      this._drawGoldenBall();
      this._drawHeart();
      this._drawParticles();
      this._drawPopups();
      this._drawHud();
      this._drawHint();
      this._drawGameOver();
    }

    this._rafId = requestAnimationFrame(this._render);
  }
}
