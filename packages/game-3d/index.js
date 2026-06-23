/**
 * packages/game-3d — City Driver Game Engine (Three.js)
 *
 * Чистый 3D-движок вождения. Никакого document.getElementById, window.location,
 * localStorage, fetch. Всё взаимодействие с внешним миром — через параметры
 * конструктора (canvas, callbacks). HUD рисуется снаружи (React/HTML) по данным
 * из `state` и колбэка onState — движок занимается только 3D-сценой и логикой.
 *
 * Управляющая ось — roll кисти (наклон влево/вправо = руль). gameType "game2".
 *
 * @example
 * import { Game3DEngine } from '@game3d/index.js';
 * const engine = new Game3DEngine(canvas, {
 *   alpha: 0.2,
 *   onGameOver: (data) => console.log(data),
 *   onScore:    (score) => {},
 *   onState:    (state) => {},   // вызывается при изменении score/lives/level/combo
 * });
 * engine.start();
 * engine.updateInput(bleReading.smooth.roll, pitch, yaw);
 * engine.destroy();
 */
import * as THREE from 'three';

// ─── Константы сцены ──────────────────────────────────────────────────────────
const ROAD_W      = 9;        // ширина дороги (世界-единицы)
const ROAD_HALF   = ROAD_W / 2;
const ROAD_LEN    = 220;      // длина полотна
const CAR_Z       = 4;        // фиксированная позиция игрока по Z (ближе к камере)
const CAR_MAX_X   = ROAD_HALF - 1.2;  // предел смещения машины
const SPAWN_Z     = -170;     // откуда появляются объекты
const RECYCLE_Z   = 14;       // где объекты уходят за камеру и переиспользуются
const ROLL_RANGE  = 45;       // °: |roll|=45 → полный поворот руля
const BASE_SPEED  = 46;       // ед/с на 1 уровне
const COLLIDE_X   = 1.5;
const COLLIDE_Z   = 1.7;

const BUILDING_COLORS = [0x334155, 0x3f3d56, 0x4b3f5e, 0x2d4356, 0x44405e, 0x3a3f4b];
const OBSTACLE_COLORS = [0xef4444, 0xf59e0b, 0x10b981, 0x8b5cf6, 0xec4899];

// Испытания: тип меняется по таймеру, сложность растёт — это и есть «не просто катание»
const CHALLENGES = ['traffic', 'slalom', 'gates'];
const CHALLENGE_LABELS = {
  traffic: 'Поток встречных машин — уворачивайся',
  slalom:  'Слалом — лови монеты у краёв (полный размах)',
  gates:   'Ворота — притормози (наклон назад) и пройди в проём',
};
const CHALLENGE_MS = 14000;   // длительность одного испытания

// Частота записи IMU-ряда для ML. 25 Гц (Nyquist 12.5 Гц) покрывает полосу тремора 3–12 Гц;
// на прежних 5 Гц спектральные признаки tremorPower/tremorFreqHz структурно зануляются.
// Совпадает с fs_hz синтетики обучения (25 Гц).
const IMU_RECORD_MS = 40;

// Газ/тормоз наклоном кисти вперёд-назад (ось pitch) — вторая ось для ML
const PITCH_RANGE = 35;       // °: полный наклон вперёд/назад
const SPEED_MIN   = 0.45;     // множитель скорости при полном торможении
const SPEED_MAX   = 1.6;      // множитель при полном газе

export class Game3DEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number}   [opts.alpha=0.2]    — коэффициент сглаживания IMU (EMA)
   * @param {Function} [opts.onGameOver]   — { score, maxCombo, zoneHits, imuTimeSeries, durationSec, level, gameType, gameName }
   * @param {Function} [opts.onScore]      — вызывается при изменении очков
   * @param {Function} [opts.onState]      — вызывается при изменении дискретных значений HUD
   */
  constructor(canvas, opts = {}) {
    this._canvas = canvas;
    this._alpha  = opts.alpha ?? 0.2;
    this.onGameOver = opts.onGameOver ?? null;
    this.onScore    = opts.onScore    ?? null;
    this.onState    = opts.onState    ?? null;

    // Вход (BLE / клавиатура)
    this._roll = 0; this._pitch = 0; this._yaw = 0;
    this._smoothRoll = 0; this._smoothPitch = 0; this._smoothYaw = 0;
    // Канал ЗАПИСИ для ML: калиброванный НЕсглаженный угол (управление — по _smooth*).
    this._recRoll = 0; this._recPitch = 0; this._recYaw = 0;

    // Состояние игры
    this._gameStarted = false;
    this._gameOver    = false;
    this._gameStartTime = 0;
    this._sessionSaved  = false;
    this._rafId = null;

    // Данные сессии
    this._score = 0; this._lives = 3; this._combo = 0; this._maxCombo = 0;
    this._comboTimer = 0; this._currentLevel = 1; this._zoneHits = 0;
    this._imuTimeSeries = []; this._imuAccumMs = 0;

    // Delta-time
    this._lastFrameTime = 0;
    this._dtMs = 1000 / 60;
    this._dtFactor = 1;

    // Спавн-таймеры (мс реального времени)
    this._obstacleTimer = 0;
    this._coinTimer = 0;

    this._keys = {};
    this._carX = 0;        // текущая позиция машины по X
    this._goldenActive = false;
    this._shield = false;       // щит активен → гасит одно столкновение
    this._powerupTimer = 0;     // таймер спавна бонуса-щита

    // Испытания (стадии): тип меняется по таймеру, сложность растёт
    this._challengeIdx = 0; this._challengeTimer = 0; this._difficulty = 1;
    this._slalomSide = 1;

    // Газ/тормоз осью pitch
    this._bleInput = false;  // true после первого updateInput → вход от устройства/BLE-клавиатуры
    this._kbPitch = 0;       // виртуальный pitch для клавиатурного fallback
    this._throttle = 1;      // множитель скорости от наклона вперёд/назад

    // Привязки
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp   = (e) => { this._keys[e.key.toLowerCase()] = false; };
    this._onResize  = this._resize.bind(this);
    this._renderLoop = this._renderLoop.bind(this);

    this._initThree();
    this._buildScene();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
    window.addEventListener('resize',  this._onResize);

    this._resize();
    this._rafId = requestAnimationFrame(this._renderLoop);
  }

  // ─── Публичный API ──────────────────────────────────────────────────────────

  /**
   * @param {number} rollDeg   сглаженный угол (управление)
   * @param {number} [pitchDeg]
   * @param {number} [yawDeg]
   * @param {{roll:number,pitch:number,yaw:number}} [rec] калиброванный НЕсглаженный угол для
   *        записи в ML-ряд (BLE-поле `calib`). Если не передан — пишем сглаженный (демо/keyboard).
   */
  updateInput(rollDeg, pitchDeg = 0, yawDeg = 0, rec = null) {
    this._bleInput = true;
    this._roll  = this._normalizeAngle(rollDeg);
    this._pitch = pitchDeg;
    this._yaw   = this._normalizeAngle(yawDeg);
    const a = 1 - this._alpha;
    this._smoothRoll  = this._smoothRoll  * a + this._roll  * this._alpha;
    this._smoothPitch = this._smoothPitch * a + this._pitch * this._alpha;
    this._smoothYaw   = this._smoothYaw   * a + this._yaw   * this._alpha;

    // Запись — несглаженный калиброванный угол (сохраняет тремор для ML).
    this._recRoll  = rec ? this._normalizeAngle(rec.roll)  : this._smoothRoll;
    this._recPitch = rec ? rec.pitch                       : this._smoothPitch;
    this._recYaw   = rec ? this._normalizeAngle(rec.yaw)   : this._smoothYaw;
  }

  start() {
    this._resetGame();
    this._gameStartTime = Date.now();
    this._lastFrameTime = 0;
    this._gameStarted = true;
    this._gameOver = false;
    this._sessionSaved = false;
    this._emitState();
  }

  returnToMenu() { this._gameStarted = false; }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
    window.removeEventListener('resize',  this._onResize);
    // Освобождаем GPU-ресурсы
    this._scene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose?.());
      }
    });
    this._bakedTextures?.forEach((t) => t.dispose?.());  // dispose материала НЕ освобождает его карты
    this._renderer?.dispose?.();
    this._renderer?.forceContextLoss?.();  // dispose НЕ освобождает сам WebGL-контекст → утечка при перемонтировании
    this._renderer = null;
    this._scene = null;
  }

  get state() {
    return {
      score: this._score,
      lives: this._lives,
      combo: this._combo,
      level: this._currentLevel,
      roll:  this._smoothRoll,
      pitch: this._smoothPitch,
      throttle: this._throttle,
      zoneHits: this._zoneHits,
      shield: this._shield,
      challenge:      CHALLENGES[this._challengeIdx % CHALLENGES.length],
      challengeLabel: CHALLENGE_LABELS[CHALLENGES[this._challengeIdx % CHALLENGES.length]],
      gameOver: this._gameOver,
      started:  this._gameStarted,
    };
  }

  // ─── Three.js init ────────────────────────────────────────────────────────────

  _initThree() {
    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas, antialias: true, alpha: false,
      powerPreference: 'high-performance',  // ноутбуки с двумя GPU → дискретная карта
    });
    // Потолок плотности пикселей. На HiDPI рендер во весь экран с ratio=2 — главный
    // источник лагов (fill-rate). 1.5 почти неотличимо визуально, но кратно легче.
    this._maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this._pixelRatio = this._maxPixelRatio;
    this._renderer.setPixelRatio(this._pixelRatio);
    this._fpsAccum = 0; this._fpsFrames = 0;   // для адаптивного разрешения

    this._scene = new THREE.Scene();
    this._bakedTextures = [];            // процедурные текстуры → освобождаем в destroy()
    this._scene.background = this._makeSkyTexture();   // градиентное ночное небо вместо заливки
    const fogColor = new THREE.Color(0x1a1d3a);
    this._scene.fog = new THREE.Fog(fogColor, 45, 175);

    this._camera = new THREE.PerspectiveCamera(72, 1, 0.1, 400);
    this._camera.position.set(0, 5, 9);
    this._camera.lookAt(0, 1.2, -12);

    // Освещение: ночной город — приглушённый ambient, чтобы светящиеся окна и фары читались.
    this._scene.add(new THREE.AmbientLight(0x6675a0, 0.6));
    const dir = new THREE.DirectionalLight(0xbcd0ff, 0.8);  // холодный «лунный» свет
    dir.position.set(-8, 18, 6);
    this._scene.add(dir);
    const hemi = new THREE.HemisphereLight(0x556699, 0x0a0e1c, 0.45);
    this._scene.add(hemi);
  }

  _buildScene() {
    const scene = this._scene;

    // ── Земля ────────────────────────────────────────────────────────────────
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, ROAD_LEN + 80),
      new THREE.MeshLambertMaterial({ color: 0x0c1322 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -ROAD_LEN / 2 + 20);
    scene.add(ground);

    // ── Дорога (асфальт-текстура) ─────────────────────────────────────────────
    const asphalt = this._makeAsphaltTexture();
    asphalt.repeat.set(2, (ROAD_LEN + 80) / 9);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, ROAD_LEN + 80),
      new THREE.MeshStandardMaterial({ map: asphalt, color: 0x2a3346, roughness: 0.96, metalness: 0.0 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -ROAD_LEN / 2 + 20);
    scene.add(road);

    // Сплошные боковые линии
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    for (const sx of [-ROAD_HALF + 0.15, ROAD_HALF - 0.15]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.18, ROAD_LEN + 80), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(sx, 0.01, -ROAD_LEN / 2 + 20);
      scene.add(line);
    }

    // ── Пул штрихов разметки ───────────────────────────────────────────────────
    this._dashes = [];
    const dashGeo = new THREE.PlaneGeometry(0.22, 3.4);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xcbd5e1 });
    const DASH_GAP = 9;
    const dashCount = Math.ceil((ROAD_LEN + 40) / DASH_GAP);
    for (let i = 0; i < dashCount; i++) {
      const d = new THREE.Mesh(dashGeo, dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(0, 0.012, SPAWN_Z + i * DASH_GAP);
      d.userData.gap = DASH_GAP * dashCount;
      this._dashes.push(d);
      scene.add(d);
    }

    // ── Звёзды + город по бокам (фасады со светящимися окнами) ─────────────────
    this._buildStars();
    this._buildings = [];
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    const facades = [this._makeFacadeTexture(0), this._makeFacadeTexture(1), this._makeFacadeTexture(2)];
    for (let i = 0; i < 18; i++) {
      const tex = facades[i % facades.length];
      const mat = new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.85,
        color: 0x2a3350, roughness: 0.85, metalness: 0.0,
      });
      const b = new THREE.Mesh(bGeo, mat);
      this._buildings.push(b);
      scene.add(b);
      this._placeBuilding(b, SPAWN_Z + Math.random() * ROAD_LEN, i % 2 === 0 ? -1 : 1);
    }

    // ── Машина игрока ──────────────────────────────────────────────────────────
    this._car = this._buildCar(0x38bdf8);
    this._car.position.set(0, 0, CAR_Z);
    scene.add(this._car);

    // Фейковая тень под машиной
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.02, 0.4);
    this._car.add(shadow);

    // ── Пул препятствий (встречные машины) ──────────────────────────────────
    this._obstacles = [];
    for (let i = 0; i < 10; i++) {   // 10, чтобы «стена» ворот собиралась из нескольких машин
      const o = this._buildCar(OBSTACLE_COLORS[i % OBSTACLE_COLORS.length], true);
      o.visible = false;
      o.userData.active = false;
      this._obstacles.push(o);
      scene.add(o);
    }

    // ── Пул монет ────────────────────────────────────────────────────────────
    this._coins = [];
    const coinGeo = new THREE.TorusGeometry(0.55, 0.2, 10, 20);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffd700, emissive: 0xb8860b, emissiveIntensity: 0.5,
        metalness: 0.6, roughness: 0.3,
      });
      const c = new THREE.Mesh(coinGeo, mat);
      c.rotation.x = Math.PI / 2;
      c.visible = false;
      c.userData.active = false;
      c.userData.zonal = false;
      this._coins.push(c);
      scene.add(c);
    }

    // ── Power-up «щит»: редкий бонус, гасит одно столкновение ──────────────────
    this._powerup = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.6, 1),
      new THREE.MeshStandardMaterial({
        color: 0x34d399, emissive: 0x059669, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.35,
      })
    );
    this._powerup.visible = false;
    this._powerup.userData.active = false;
    scene.add(this._powerup);

    // Аура щита вокруг машины (видна, пока щит активен)
    this._shieldAura = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0x34d399, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false,
      })
    );
    this._shieldAura.position.y = 0.6;
    this._shieldAura.visible = false;
    this._car.add(this._shieldAura);
  }

  // ─── Процедурные текстуры (пекутся один раз; без внешних файлов → demo.html работает) ──────

  /** Оффскрин-canvas для запекания текстуры (не трогает DOM хоста). */
  _canvas2d(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Вертикальный градиент ночного неба (фон сцены). */
  _makeSkyTexture() {
    const c = this._canvas2d(16, 256);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0,   '#05071a');
    g.addColorStop(0.5, '#121634');
    g.addColorStop(0.8, '#2a2150');
    g.addColorStop(1,   '#4a3a6e');   // лёгкое зарево у горизонта
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Асфальт: тёмная база + зернистый шум (вместо плоской заливки дороги). */
  _makeAsphaltTexture() {
    const S = 256;
    const c = this._canvas2d(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#222a39'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.11)';
      ctx.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Фасад здания: тёмная стена + сетка окон, часть светится (служит и map, и emissiveMap). */
  _makeFacadeTexture(variant = 0) {
    const W = 128, H = 256;
    const c = this._canvas2d(W, H);
    const ctx = c.getContext('2d');
    const wall = ['#20283c', '#241f33', '#1d2740'][variant % 3];
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
    const lit  = ['#ffd98a', '#bfe3ff', '#ffcf6b'][variant % 3];   // тёплый/холодный свет окон
    const cols = 4, rows = 9, mx = 10, my = 8;
    const cw = (W - mx * (cols + 1)) / cols;
    const ch = (H - my * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = mx + col * (cw + mx);
        const y = my + r * (ch + my);
        const on = Math.random() < 0.55;
        ctx.fillStyle = on ? lit : '#0c1120';
        ctx.fillRect(x, y, cw, ch);
        if (on) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x, y, cw, ch * 0.4); }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 2);
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Звёздное небо (точки, без тумана → не гаснут вдали). */
  _buildStars() {
    const N = 280;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (Math.random() * 2 - 1) * 140;
      pos[i * 3 + 1] = 22 + Math.random() * 100;
      pos[i * 3 + 2] = SPAWN_Z + Math.random() * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.7, sizeAttenuation: true,
      transparent: true, opacity: 0.85, fog: false,
    });
    this._scene.add(new THREE.Points(geo, mat));
  }

  /** Собирает простую машинку (group из коробок + колёса). */
  _buildCar(color, oncoming = false) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.6, 3.2),
      new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.45 })
    );
    body.position.y = 0.55;
    g.add(body);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.55, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x0b1020, metalness: 0.3, roughness: 0.35,
        emissive: 0x223046, emissiveIntensity: 0.35 })   // лёгкое свечение «салона»
    );
    roof.position.set(0, 1.05, -0.1);
    g.add(roof);
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.2, roughness: 0.8 });
    for (const [wx, wz] of [[-0.85, 1], [0.85, 1], [-0.85, -1], [0.85, -1]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.38, wz);
      g.add(w);
    }
    // Фары/фонари. Встречные едут на игрока (+Z) → фары светят к камере; игрок едет в сцену (−Z).
    const frontZ = oncoming ? 1.55 : -1.55;
    const lampGeo = new THREE.BoxGeometry(0.32, 0.2, 0.12);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d5, emissive: 0xfff2cc, emissiveIntensity: 1.4 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff2222, emissiveIntensity: 1.1 });
    for (const sx of [-0.55, 0.55]) {
      const head = new THREE.Mesh(lampGeo, headMat); head.position.set(sx, 0.5, frontZ);   g.add(head);
      const tail = new THREE.Mesh(lampGeo, tailMat); tail.position.set(sx, 0.55, -frontZ);  g.add(tail);
    }
    return g;
  }

  _placeBuilding(b, z, side) {
    const h = 6 + Math.random() * 26;
    const depth = 4 + Math.random() * 6;
    const w = 3 + Math.random() * 4;
    b.scale.set(w, h, depth);
    const offset = ROAD_HALF + 2 + Math.random() * 10;
    b.position.set(side * offset, h / 2, z);
    b.userData.side = side;
  }

  // ─── Вспомогательные ──────────────────────────────────────────────────────────

  _normalizeAngle(v) {
    while (v > 180)  v -= 360;
    while (v < -180) v += 360;
    return v;
  }

  _handleKeyDown(e) {
    this._keys[e.key.toLowerCase()] = true;
    if (this._gameOver && e.key.toLowerCase() === 'r') this.start();
  }

  _resize() {
    const w = this._canvas.clientWidth  || window.innerWidth;
    const h = this._canvas.clientHeight || window.innerHeight;
    this._lastW = w; this._lastH = h;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / Math.max(1, h);
    this._camera.updateProjectionMatrix();
  }

  /** Авто-ресайз: canvas в React получает размер после монтирования,
   *  а контейнер может меняться (сайдбар) без события window resize. */
  _checkResize() {
    const w = this._canvas.clientWidth;
    const h = this._canvas.clientHeight;
    if (w && h && (w !== this._lastW || h !== this._lastH)) this._resize();
  }

  _emitState() { this.onState?.(this.state); }

  // ─── Reset ──────────────────────────────────────────────────────────────────

  _resetGame() {
    this._score = 0; this._lives = 3; this._gameOver = false; this._sessionSaved = false;
    this._currentLevel = 1; this._combo = 0; this._maxCombo = 0; this._comboTimer = 0;
    this._zoneHits = 0; this._imuTimeSeries = []; this._imuAccumMs = 0;
    this._recRoll = 0; this._recPitch = 0; this._recYaw = 0;
    this._obstacleTimer = 0; this._coinTimer = 0; this._carX = 0;
    this._challengeIdx = 0; this._challengeTimer = 0; this._difficulty = 1; this._slalomSide = 1;
    this._kbPitch = 0; this._throttle = 1;
    this._shield = false; this._powerupTimer = 0;
    this._car.position.x = 0; this._car.rotation.z = 0;
    for (const o of this._obstacles) { o.visible = false; o.userData.active = false; }
    for (const c of this._coins)     { c.visible = false; c.userData.active = false; }
    if (this._powerup)    { this._powerup.visible = false; this._powerup.userData.active = false; }
    if (this._shieldAura)   this._shieldAura.visible = false;
  }

  // ─── Спавн ────────────────────────────────────────────────────────────────────

  _spawnObstacle() {
    const o = this._obstacles.find((x) => !x.userData.active);
    if (!o) return;
    o.userData.active = true;
    o.visible = true;
    o.position.set((Math.random() * 2 - 1) * CAR_MAX_X, 0, SPAWN_Z);
  }

  _spawnCoin() {
    const c = this._coins.find((x) => !x.userData.active);
    if (!c) return;
    c.userData.active = true;
    c.visible = true;
    // 30% монет — «зональные»: у самого края, требуют полного поворота (ROM)
    const zonal = Math.random() < 0.30;
    c.userData.zonal = zonal;
    let x;
    if (zonal) {
      const side = Math.random() < 0.5 ? -1 : 1;
      x = side * (CAR_MAX_X - 0.2);
    } else {
      x = (Math.random() * 2 - 1) * (CAR_MAX_X - 0.5);
    }
    c.position.set(x, 0.7, SPAWN_Z - Math.random() * 20);
    c.material.color.setHex(zonal ? 0x22d3ee : 0xffd700);
    c.material.emissive.setHex(zonal ? 0x0e7490 : 0xb8860b);
  }

  /** Слалом: монеты по очереди у левого/правого края — полный размах руля (ROM). */
  _spawnSlalomCoin() {
    const c = this._coins.find((x) => !x.userData.active);
    if (!c) return;
    this._slalomSide = -this._slalomSide;
    c.userData.active = true; c.visible = true; c.userData.zonal = true;
    c.position.set(this._slalomSide * (CAR_MAX_X - 0.2), 0.7, SPAWN_Z);
    c.material.color.setHex(0x22d3ee);
    c.material.emissive.setHex(0x0e7490);
  }

  /** Ворота: стена встречных машин с узким проёмом + монета-приманка в проёме. */
  _spawnGate() {
    const gapHalf = 1.7;
    const gapCenter = (Math.random() * 2 - 1) * (CAR_MAX_X - gapHalf);
    for (let x = -ROAD_HALF + 1; x <= ROAD_HALF - 1; x += 1.7) {
      if (Math.abs(x - gapCenter) < gapHalf) continue;
      const o = this._obstacles.find((y) => !y.userData.active);
      if (!o) break;
      o.userData.active = true; o.visible = true;
      o.position.set(x, 0, SPAWN_Z);
    }
    const c = this._coins.find((x) => !x.userData.active);
    if (c) {
      c.userData.active = true; c.visible = true; c.userData.zonal = false;
      c.position.set(gapCenter, 0.7, SPAWN_Z - 3);
      c.material.color.setHex(0xffd700); c.material.emissive.setHex(0xb8860b);
    }
  }

  /** Выбор спавна под текущее испытание. */
  _spawnForChallenge(ch) {
    if (ch === 'slalom') {
      if (this._coinTimer >= Math.max(520, 760 - this._challengeIdx * 20)) {
        this._coinTimer = 0; this._spawnSlalomCoin();
      }
    } else if (ch === 'gates') {
      if (this._obstacleTimer >= Math.max(1600, 2400 - this._challengeIdx * 60)) {
        this._obstacleTimer = 0; this._spawnGate();
      }
      if (this._coinTimer >= 1100) { this._coinTimer = 0; this._spawnCoin(); }
    } else { // traffic
      const every = Math.max(520, 1200 - this._currentLevel * 60 - this._challengeIdx * 30);
      if (this._obstacleTimer >= every) { this._obstacleTimer = 0; this._spawnObstacle(); }
      if (this._coinTimer >= 900) { this._coinTimer = 0; this._spawnCoin(); }
    }
  }

  // ─── Update ────────────────────────────────────────────────────────────────────

  _getComboMultiplier() {
    if (this._combo >= 15) return 3;
    if (this._combo >= 7)  return 2;
    return 1;
  }

  _updateIMURecord() {
    if (!this._gameStarted || this._gameOver) return;
    this._imuAccumMs += this._dtMs;
    if (this._imuAccumMs >= IMU_RECORD_MS) { // 25 Гц — покрывает полосу тремора
      this._imuAccumMs = 0;
      this._imuTimeSeries.push({
        t: Date.now() - this._gameStartTime,
        r: parseFloat(this._recRoll.toFixed(2)),
        p: parseFloat(this._recPitch.toFixed(2)),
        y: parseFloat(this._recYaw.toFixed(2)),
      });
    }
  }

  _updateCar() {
    const f = this._dtFactor;
    const bleActive = this._bleInput;
    if (bleActive) {
      const norm = Math.max(-1, Math.min(1, this._smoothRoll / ROLL_RANGE));
      this._carX = norm * CAR_MAX_X;
    } else {
      // Клавиатура: двигаем и синтезируем виртуальный roll (для IMU/ROM)
      const step = 0.16 * f * CAR_MAX_X;
      if (this._keys['arrowleft']  || this._keys['a']) this._carX -= step;
      if (this._keys['arrowright'] || this._keys['d']) this._carX += step;
      this._carX = Math.max(-CAR_MAX_X, Math.min(CAR_MAX_X, this._carX));
      this._smoothRoll = (this._carX / CAR_MAX_X) * ROLL_RANGE;
      this._recRoll = this._smoothRoll;  // без устройства тремора нет — пишем синтез-угол
    }
    this._carX = Math.max(-CAR_MAX_X, Math.min(CAR_MAX_X, this._carX));
    // Плавно подводим машину к целевой позиции
    this._car.position.x += (this._carX - this._car.position.x) * Math.min(1, 0.25 * f);
    // Крен кузова при повороте
    const lean = -(this._car.position.x / CAR_MAX_X) * 0.18;
    this._car.rotation.z += (lean - this._car.rotation.z) * Math.min(1, 0.2 * f);
  }

  /** Газ/тормоз осью pitch: вперёд = быстрее, назад = тормоз, центр = крейсер.
   *  Без устройства — клавиши W/↑ (газ) и S/↓ (тормоз), синтез pitch для IMU/ML. */
  _updateThrottle() {
    if (!this._bleInput) {
      const step = 1.7 * this._dtFactor;
      const up   = this._keys['arrowup']   || this._keys['w'];
      const down = this._keys['arrowdown'] || this._keys['s'];
      if (up)   this._kbPitch += step;
      if (down) this._kbPitch -= step;
      if (!up && !down) this._kbPitch *= 0.9;   // плавный возврат к нейтрали
      this._kbPitch = Math.max(-PITCH_RANGE - 3, Math.min(PITCH_RANGE + 3, this._kbPitch));
      this._pitch = this._kbPitch;
      this._smoothPitch = this._smoothPitch * (1 - this._alpha) + this._pitch * this._alpha;
      this._recPitch = this._smoothPitch;  // без устройства тремора нет — пишем синтез-угол
    }
    const np = Math.max(-1, Math.min(1, this._smoothPitch / PITCH_RANGE));
    this._throttle = np >= 0 ? 1 + np * (SPEED_MAX - 1) : 1 + np * (1 - SPEED_MIN);
  }

  _moveWorld(dz) {
    // Штрихи разметки
    for (const d of this._dashes) {
      d.position.z += dz;
      if (d.position.z > RECYCLE_Z) d.position.z -= d.userData.gap;
    }
    // Здания
    for (const b of this._buildings) {
      b.position.z += dz;
      if (b.position.z > RECYCLE_Z + 6) this._placeBuilding(b, SPAWN_Z, b.userData.side);
    }
  }

  _updateObstacles(dz) {
    const carX = this._car.position.x;
    for (const o of this._obstacles) {
      if (!o.userData.active) continue;
      o.position.z += dz;
      if (o.position.z > RECYCLE_Z) {
        o.userData.active = false; o.visible = false;
        continue;
      }
      // Столкновение
      if (Math.abs(o.position.x - carX) < COLLIDE_X &&
          o.position.z > CAR_Z - COLLIDE_Z && o.position.z < CAR_Z + COLLIDE_Z) {
        o.userData.active = false; o.visible = false;
        if (this._shield) {        // щит погасил удар — жизнь сохранена
          this._shield = false;
          this._emitState();
          continue;
        }
        this._lives--;
        this._combo = 0; this._comboTimer = 0;
        this._emitState();
        if (this._lives <= 0) this._triggerGameOver();
      }
    }
  }

  _updateCoins(dz) {
    const carX = this._car.position.x;
    for (const c of this._coins) {
      if (!c.userData.active) continue;
      c.position.z += dz;
      c.rotation.z += 0.12 * this._dtFactor;
      if (c.position.z > RECYCLE_Z) {
        c.userData.active = false; c.visible = false;
        this._combo = 0; this._comboTimer = 0;
        this._emitState();
        continue;
      }
      if (Math.abs(c.position.x - carX) < COLLIDE_X + 0.2 &&
          c.position.z > CAR_Z - COLLIDE_Z && c.position.z < CAR_Z + COLLIDE_Z) {
        c.userData.active = false; c.visible = false;
        this._combo++;
        this._comboTimer = 2200;
        if (this._combo > this._maxCombo) this._maxCombo = this._combo;
        const pts = (c.userData.zonal ? 3 : 1) * this._getComboMultiplier();
        this._score += pts;
        this._currentLevel = Math.floor(this._score / 12) + 1;
        if (c.userData.zonal) this._zoneHits++;
        this.onScore?.(this._score);
        this._emitState();
      }
    }
  }

  /** Бонус-щит: редкий спавн, подбор включает щит; аура на машине пульсирует, пока щит активен. */
  _updatePowerup(dz) {
    if (this._shieldAura) {
      this._shieldAura.visible = this._shield;
      if (this._shield) this._shieldAura.scale.setScalar(1 + Math.sin(Date.now() * 0.006) * 0.06);
    }
    const p = this._powerup;
    if (!p) return;
    if (!p.userData.active) {
      // спавним, только если щита ещё нет и бонус не на сцене
      if (!this._shield) {
        this._powerupTimer += this._dtMs;
        if (this._powerupTimer >= 9000) {
          this._powerupTimer = 0;
          p.userData.active = true; p.visible = true;
          p.position.set((Math.random() * 2 - 1) * CAR_MAX_X, 0.8, SPAWN_Z);
        }
      }
      return;
    }
    p.position.z += dz;
    p.rotation.y += 0.05 * this._dtFactor;
    p.rotation.x += 0.03 * this._dtFactor;
    if (p.position.z > RECYCLE_Z) { p.userData.active = false; p.visible = false; return; }
    if (Math.abs(p.position.x - this._car.position.x) < COLLIDE_X + 0.3 &&
        p.position.z > CAR_Z - COLLIDE_Z && p.position.z < CAR_Z + COLLIDE_Z) {
      p.userData.active = false; p.visible = false;
      this._shield = true;
      this._emitState();
    }
  }

  _update() {
    this._updateIMURecord();
    if (!this._gameStarted || this._gameOver) return;

    this._updateThrottle();
    const dtSec = this._dtMs / 1000;
    const speed = BASE_SPEED * (1 + (this._currentLevel - 1) * 0.08) * this._difficulty * this._throttle;
    const dz = speed * dtSec;

    this._updateCar();
    this._moveWorld(dz);
    this._updateObstacles(dz);
    this._updateCoins(dz);
    this._updatePowerup(dz);

    // ── Испытания: каждые CHALLENGE_MS меняем тип и поднимаем сложность ──────────
    this._challengeTimer += this._dtMs;
    if (this._challengeTimer >= CHALLENGE_MS) {
      this._challengeTimer = 0;
      this._challengeIdx++;
      this._difficulty = 1 + Math.min(this._challengeIdx, 8) * 0.09;
      this._emitState();   // HUD покажет баннер нового испытания
    }
    const challenge = CHALLENGES[this._challengeIdx % CHALLENGES.length];

    // Спавн по реальному времени — зависит от текущего испытания
    this._obstacleTimer += this._dtMs;
    this._coinTimer += this._dtMs;
    this._spawnForChallenge(challenge);

    // Combo timeout
    if (this._comboTimer > 0) {
      this._comboTimer -= this._dtMs;
      if (this._comboTimer <= 0) { this._comboTimer = 0; if (this._combo) { this._combo = 0; this._emitState(); } }
    }
  }

  _triggerGameOver() {
    this._gameOver = true;
    this._emitState();
    if (this._sessionSaved) return;
    this._sessionSaved = true;
    const durationSec = Math.floor((Date.now() - this._gameStartTime) / 1000);
    this.onGameOver?.({
      score: this._score,
      maxCombo: this._maxCombo,
      zoneHits: this._zoneHits,
      imuTimeSeries: this._imuTimeSeries,
      durationSec,
      level: this._currentLevel,
      challengesCleared: this._challengeIdx,
      gameType: 'game2',
      gameName: 'City Driver',
    });
  }

  // Адаптивное разрешение: FPS проседает → снижаем плотность пикселей; стабильно →
  // повышаем обратно к потолку. Самонастройка под железо игрока (главный фикс лагов).
  _adaptResolution(dtMs) {
    this._fpsAccum += dtMs; this._fpsFrames++;
    if (this._fpsAccum < 1000) return;
    const fps = (this._fpsFrames * 1000) / this._fpsAccum;
    this._fpsAccum = 0; this._fpsFrames = 0;
    let ratio = this._pixelRatio;
    if (fps < 50 && ratio > 1.0) ratio = Math.max(1.0, ratio - 0.25);
    else if (fps > 58 && ratio < this._maxPixelRatio) ratio = Math.min(this._maxPixelRatio, ratio + 0.25);
    if (ratio !== this._pixelRatio) {
      this._pixelRatio = ratio;
      this._renderer.setPixelRatio(ratio);
      this._resize();
    }
  }

  // ─── Render loop ──────────────────────────────────────────────────────────────

  _renderLoop(ts) {
    if (!this._rafId) return;
    const now = typeof ts === 'number' ? ts : performance.now();
    if (!this._lastFrameTime) this._lastFrameTime = now;
    let dtMs = now - this._lastFrameTime;
    this._lastFrameTime = now;
    if (!isFinite(dtMs) || dtMs <= 0) dtMs = 1000 / 60;
    dtMs = Math.min(dtMs, 1000 / 20); // защита от скачка после смены вкладки
    this._dtMs = dtMs;
    this._dtFactor = dtMs / (1000 / 60);
    this._adaptResolution(dtMs);

    this._checkResize();
    this._update();
    this._renderer.render(this._scene, this._camera);

    this._rafId = requestAnimationFrame(this._renderLoop);
  }
}
