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

// Дневной город: сочные цвета фасадов (PBR-стекло, ловит небо из environment-карты).
const BUILDING_COLORS = [0xff6b6b, 0x4ecdc4, 0xffd93d, 0x9b8cff, 0xff9ff3, 0x54a0ff, 0xff9f43, 0x1dd1a1];
const OBSTACLE_COLORS = [0xef4444, 0xfb923c, 0x22c55e, 0xa855f7, 0xec4899, 0x06b6d4];

// Испытания: тип меняется по таймеру, сложность растёт — это и есть «не просто катание»
const CHALLENGES = ['traffic', 'slalom', 'gates', 'checkpoint', 'boost'];
const CHALLENGE_LABELS = {
  traffic:    'Поток встречных машин — уворачивайся',
  slalom:     'Слалом — лови монеты у краёв (полный размах)',
  gates:      'Ворота — притормози (наклон назад) и пройди в проём',
  checkpoint: 'Лежачие полицейские — тормози наклоном НАЗАД',
  boost:      'Буст-зоны — газуй наклоном ВПЕРЁД по стрелкам',
};
const CHALLENGE_MS = 14000;   // длительность одного испытания

// Визуальные темы окружения — меняются по стадиям ради разнообразия сцены.
const SCENE_THEMES = ['city', 'rain', 'sunset'];

// Пороги для механик оси газ/тормоз (pitch). throttle: 0.45 (полный тормоз) .. 1.6 (полный газ).
const BRAKE_OK_THROTTLE  = 0.8;   // «лежачий полицейский» безопасен, если приторможен (≤)
const BOOST_OK_THROTTLE  = 1.2;   // буст-пад засчитан, если газует (≥)

// Частота записи IMU-ряда для ML. 25 Гц (Nyquist 12.5 Гц) покрывает полосу тремора 3–12 Гц;
// на прежних 5 Гц спектральные признаки tremorPower/tremorFreqHz структурно зануляются.
// Совпадает с fs_hz синтетики обучения (25 Гц).
const IMU_RECORD_MS = 40;

// Газ/тормоз наклоном кисти вперёд-назад (ось pitch) — вторая ось для ML
const PITCH_RANGE = 35;       // °: полный наклон вперёд/назад
const SPEED_MIN   = 0.45;     // множитель скорости при полном торможении
const SPEED_MAX   = 1.6;      // множитель при полном газе
const MIN_RANGE   = 8;        // °: нижний предел персонального диапазона (дрожь не «дёргает» руль)

// Метрики «реакции на препятствия» — когнитивно-моторный навык для врача (НЕ в модель аномалий).
const REACT_LINE    = -28;             // z: дистанция, где встречная угроза становится «реагируй сейчас»
const HAZARD_MARGIN = COLLIDE_X + 0.6; // |x препятствия − x машины| ≤ этого на REACT_LINE = курс столкновения
const REACT_MOVE    = 1.0;             // на сколько увести машину, чтобы счесть «среагировал»

export class Game3DEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number}   [opts.alpha=0.2]    — коэффициент сглаживания IMU (EMA)
   * @param {object}   [opts.range]        — персональный диапазон управления { rollPos, rollNeg, pitchPos, pitchNeg } в °
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
    // Реакция на препятствия: сколько угроз на курсе, сколько не объехал, суммарное время реакции.
    this._hazardCount = 0; this._hazardHit = 0; this._reactionSum = 0; this._reactionN = 0;

    // Delta-time
    this._lastFrameTime = 0;
    this._dtMs = 1000 / 60;
    this._dtFactor = 1;

    // Спавн-таймеры (мс реального времени)
    this._obstacleTimer = 0;
    this._coinTimer = 0;

    this._keys = {};
    this._carX = 0;        // текущая позиция машины по X
    this._carBounceV = 0;  // вертикальная скорость отскока кузова (удар о «лежачего полицейского»)
    this._goldenActive = false;
    this._shield = false;       // щит активен → гасит одно столкновение
    this._magnet = false;       // магнит активен → притягивает монеты (помогает при малом ROM)
    this._magnetTimer = 0;      // обратный отсчёт действия магнита (мс)
    this._powerupTimer = 0;     // таймер спавна бонуса (щит/магнит)
    this._sceneTheme = 'city';  // текущая визуальная тема окружения

    // Испытания (стадии): тип меняется по таймеру, сложность растёт
    this._challengeIdx = 0; this._challengeTimer = 0; this._difficulty = 1;
    this._slalomSide = 1;

    // Газ/тормоз осью pitch
    this._bleInput = false;  // true после первого updateInput → вход от устройства/BLE-клавиатуры
    this._kbPitch = 0;       // виртуальный pitch для клавиатурного fallback
    this._throttle = 1;      // множитель скорости от наклона вперёд/назад

    // Персональный диапазон управления (градусы, по каждому направлению отдельно). Ребёнок с
    // малым/асимметричным размахом (тяжёлый ДЦП) доводит машину до края на СВОЁМ максимуме, а не
    // на жёстких 45°. По умолчанию — глобальные ROLL_RANGE/PITCH_RANGE; задаётся opts.range/setRange.
    this._rollPos = ROLL_RANGE; this._rollNeg = ROLL_RANGE;
    this._pitchPos = PITCH_RANGE; this._pitchNeg = PITCH_RANGE;
    this._steerNorm = 0;     // нормализованное положение руля (−1..1) для HUD
    if (opts.range) this.setRange(opts.range);

    // Привязки
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp   = (e) => { this._keys[e.key.toLowerCase()] = false; };
    this._onResize  = this._resize.bind(this);
    this._renderLoop = this._renderLoop.bind(this);

    this._initThree();
    this._buildScene();
    this._bakeEnvironment();   // отражения неба/города в краске машин, стекле, монетах

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

  /**
   * Персональный диапазон управления по направлениям (в градусах, магнитуды). Любое поле опционально.
   * rollPos — макс. наклон ВПРАВО, rollNeg — ВЛЕВО; pitchPos — газ, pitchNeg — тормоз. Каждое
   * направление масштабируется своим максимумом → полный размах достижим даже при малом/асимметричном
   * диапазоне (тяжёлый ДЦП). Малые значения клампятся снизу (MIN_RANGE), чтобы дрожь не «дёргала» руль.
   */
  setRange({ rollPos, rollNeg, pitchPos, pitchNeg } = {}) {
    const ok = (v) => typeof v === 'number' && isFinite(v) && v > 0;
    if (ok(rollPos))  this._rollPos  = Math.max(MIN_RANGE, rollPos);
    if (ok(rollNeg))  this._rollNeg  = Math.max(MIN_RANGE, rollNeg);
    if (ok(pitchPos)) this._pitchPos = Math.max(MIN_RANGE, pitchPos);
    if (ok(pitchNeg)) this._pitchNeg = Math.max(MIN_RANGE, pitchNeg);
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
    this._envRT?.dispose?.();            // environment-карта (PMREM render target)
    if (this._scene) this._scene.environment = null;
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
      steerNorm: this._steerNorm,   // −1..1 по персональному диапазону (для HUD-бара руля)
      zoneHits: this._zoneHits,
      shield: this._shield,
      magnet: this._magnet,
      theme:  this._sceneTheme,
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
    // Плёночная тональная коррекция + sRGB — «фотографичные» света/тени вместо плоской заливки.
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.12;
    this._maxAniso = this._renderer.capabilities.getMaxAnisotropy();  // резкость текстур под углом
    this._fpsAccum = 0; this._fpsFrames = 0;   // для адаптивного разрешения

    this._scene = new THREE.Scene();
    this._bakedTextures = [];            // процедурные текстуры → освобождаем в destroy()
    this._daySky = this._makeSkyTexture();              // дневное небо с солнцем
    this._sunsetSky = this._makeSunsetSky();            // закатное небо (тема 'sunset')
    this._scene.background = this._daySky;
    // Туман светлый и ОТОДВИНУТ: объекты спавнятся в ~179 ед. от камеры; при far=175 они
    // были полностью «в тумане» (главная причина «ничего не видно»). 90→320 — далеко видно.
    const fogColor = new THREE.Color(0xdaf0ff);
    this._scene.fog = new THREE.Fog(fogColor, 90, 320);

    this._camera = new THREE.PerspectiveCamera(72, 1, 0.1, 500);
    this._camera.position.set(0, 5, 9);
    this._camera.lookAt(0, 1.2, -12);

    // Освещение: яркий солнечный день — насыщенный ambient + сильное направленное «солнце»,
    // чтобы toon-материалы давали чистые плоские цвета и всё хорошо читалось.
    this._ambLight = new THREE.AmbientLight(0xffffff, 0.85);
    this._scene.add(this._ambLight);
    this._dirLight = new THREE.DirectionalLight(0xfff4d6, 1.15);  // тёплое солнце
    this._dirLight.position.set(-10, 22, 8);
    this._scene.add(this._dirLight);
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8fd35a, 0.6);  // небо ↑ / трава ↓
    this._scene.add(hemi);
  }

  _buildScene() {
    const scene = this._scene;

    // ── Земля (трава) ──────────────────────────────────────────────────────────
    const grass = this._makeGrassTexture();
    grass.repeat.set(14, (ROAD_LEN + 80) / 8);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(260, ROAD_LEN + 80),
      new THREE.MeshLambertMaterial({ map: grass, color: 0x9be25a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -ROAD_LEN / 2 + 20);
    scene.add(ground);

    // ── Дорога (асфальт-текстура) ─────────────────────────────────────────────
    const asphalt = this._makeAsphaltTexture();
    asphalt.repeat.set(2, (ROAD_LEN + 80) / 9);
    const asphaltN = this._makeAsphaltNormal();
    asphaltN.repeat.copy(asphalt.repeat);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, ROAD_LEN + 80),
      new THREE.MeshStandardMaterial({
        map: asphalt, normalMap: asphaltN, normalScale: new THREE.Vector2(0.45, 0.45),
        color: 0x8893a4, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.45,
      })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -ROAD_LEN / 2 + 20);
    scene.add(road);
    this._roadMat = road.material;   // тема «дождь» делает асфальт мокро-блестящим

    // Светлые бордюры по краям
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const sx of [-ROAD_HALF + 0.15, ROAD_HALF - 0.15]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.22, ROAD_LEN + 80), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(sx, 0.01, -ROAD_LEN / 2 + 20);
      scene.add(line);
    }

    // ── Пул штрихов разметки (жёлтая осевая — читается на светлом асфальте) ─────
    this._dashes = [];
    const dashGeo = new THREE.PlaneGeometry(0.26, 3.4);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
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

    // ── Облака + toon-город + деревья по обочине ────────────────────────────────
    this._buildClouds();
    this._buildings = [];
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    const facades = [this._makeFacadeTexture(0), this._makeFacadeTexture(1), this._makeFacadeTexture(2)];
    for (let i = 0; i < 18; i++) {
      const tex = facades[i % facades.length];
      const mat = new THREE.MeshStandardMaterial({
        map: tex, color: BUILDING_COLORS[i % BUILDING_COLORS.length],
        roughness: 0.34, metalness: 0.12, envMapIntensity: 0.9,   // стеклянные башни ловят небо
      });
      const b = new THREE.Mesh(bGeo, mat);
      this._buildings.push(b);
      scene.add(b);
      this._placeBuilding(b, SPAWN_Z + Math.random() * ROAD_LEN, i % 2 === 0 ? -1 : 1);
    }

    // Низкополигональные деревья между дорогой и зданиями (объём + «текстуры» сцены)
    this._trees = [];
    for (let i = 0; i < 12; i++) {
      const t = this._buildTree();
      this._trees.push(t);
      scene.add(t);
      this._placeTree(t, SPAWN_Z + Math.random() * ROAD_LEN, i % 2 === 0 ? -1 : 1);
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
        color: 0xffd700, emissive: 0x7a5a00, emissiveIntensity: 0.25,
        metalness: 1.0, roughness: 0.22, envMapIntensity: 1.3,   // полированное золото
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

    this._buildSpeedBumps();
    this._buildBoostPads();
    this._buildParticles();
    this._buildRain();
  }

  /** Пул «лежачих полицейских»: жёлто-чёрная полоса во всю дорогу — притормози (наклон назад). */
  _buildSpeedBumps() {
    this._bumps = [];
    const stripe = this._makeStripeTexture();
    const geo = new THREE.BoxGeometry(ROAD_W - 0.4, 0.35, 1.1);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: stripe, roughness: 0.7, metalness: 0.0,
      }));
      m.visible = false; m.userData.active = false;
      this._bumps.push(m);
      this._scene.add(m);
    }
  }

  /** Пул буст-падов: зелёные шевроны на дороге — газуй (наклон вперёд) для бонуса. */
  _buildBoostPads() {
    this._boosts = [];
    const geo = new THREE.PlaneGeometry(2.4, 3.2);
    const tex = this._makeChevronTexture();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false; m.userData.active = false;
      this._boosts.push(m);
      this._scene.add(m);
    }
  }

  /** Пул частиц для «сочных» вспышек при сборе монет/бонусов (переиспользуются). */
  _buildParticles() {
    this._particles = [];
    const geo = new THREE.PlaneGeometry(0.22, 0.22);
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, depthWrite: false, fog: false,
      }));
      m.visible = false;
      m.userData = { active: false, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 };
      this._particles.push(m);
      this._scene.add(m);
    }
  }

  /** Дождь: облако точек, падает и заворачивается. Видим только в теме 'rain'. */
  _buildRain() {
    const N = 320;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (Math.random() * 2 - 1) * 30;
      pos[i * 3 + 1] = Math.random() * 40;
      pos[i * 3 + 2] = CAR_Z - 10 + (Math.random() * 2 - 1) * 60;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._rain = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xbcd6ff, size: 0.5, transparent: true, opacity: 0.6, fog: false,
    }));
    this._rain.visible = false;
    this._scene.add(this._rain);
  }

  // ─── Процедурные текстуры (пекутся один раз; без внешних файлов → demo.html работает) ──────

  /** Оффскрин-canvas для запекания текстуры (не трогает DOM хоста). */
  _canvas2d(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Пекёт prefiltered environment-карту из самой сцены (PMREM): реальные отражения неба и
   *  города в краске машин, стекле и монетах. Один раз при старте — не нагружает кадр. */
  _bakeEnvironment() {
    try {
      const pmrem = new THREE.PMREMGenerator(this._renderer);
      const envRT = pmrem.fromScene(this._scene, 0.04);
      this._scene.environment = envRT.texture;   // MeshStandardMaterial берёт её автоматически
      this._envRT = envRT;
      pmrem.dispose();
    } catch (e) {
      // env-карта опциональна: материалы остаются видимыми и без неё
    }
  }

  /** Нормал-мапа: мелкое случайное возмущение → асфальт «дышит» рельефом под солнцем. */
  _makeAsphaltNormal() {
    const S = 256;
    const c = this._canvas2d(S, S);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const k = i * 4;
      img.data[k]     = 128 + (Math.random() * 2 - 1) * 24;   // nx
      img.data[k + 1] = 128 + (Math.random() * 2 - 1) * 24;   // ny
      img.data[k + 2] = 255;                                  // nz
      img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);   // нормал-мапа — линейная (НЕ sRGB)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (this._maxAniso) tex.anisotropy = this._maxAniso;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Скруглённый «параллелепипед» через ExtrudeGeometry с фаской — гладкий силуэт вместо
   *  острого бокса. Футпринт w(X)×d(Z), высота h по Y. */
  _roundedBox(w, h, d, r) {
    const hw = w / 2, hd = d / 2;
    const s = new THREE.Shape();
    s.moveTo(-hw + r, -hd);
    s.lineTo(hw - r, -hd);
    s.quadraticCurveTo(hw, -hd, hw, -hd + r);
    s.lineTo(hw, hd - r);
    s.quadraticCurveTo(hw, hd, hw - r, hd);
    s.lineTo(-hw + r, hd);
    s.quadraticCurveTo(-hw, hd, -hw, hd - r);
    s.lineTo(-hw, -hd + r);
    s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    const bt = Math.min(r * 0.6, h * 0.45);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(0.02, h - bt * 2), bevelEnabled: true,
      bevelThickness: bt, bevelSize: r * 0.5, bevelSegments: 2, steps: 1, curveSegments: 6,
    });
    geo.rotateX(-Math.PI / 2);   // экструзия по +Z → высота по +Y
    geo.computeBoundingBox();
    const ctr = new THREE.Vector3();
    geo.boundingBox.getCenter(ctr);
    geo.translate(-ctr.x, -ctr.y, -ctr.z);   // центрируем в начале координат
    return geo;
  }

  /** Дневное небо с мягким солнцем (фон сцены). */
  _makeSkyTexture() {
    const S = 256;
    const c = this._canvas2d(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0,    '#2e93f7');   // насыщенная синева в зените
    g.addColorStop(0.55, '#7dc6ff');
    g.addColorStop(0.85, '#cdebff');
    g.addColorStop(1,    '#f2fbff');   // светлая дымка у горизонта
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    // Солнечное гало в верхней правой части
    const sun = ctx.createRadialGradient(S * 0.72, S * 0.26, 4, S * 0.72, S * 0.26, 70);
    sun.addColorStop(0, 'rgba(255,255,255,0.95)');
    sun.addColorStop(0.4, 'rgba(255,247,214,0.55)');
    sun.addColorStop(1, 'rgba(255,247,214,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Закатное небо: фиолетово-розово-оранжевый градиент + низкое солнце у горизонта. */
  _makeSunsetSky() {
    const S = 256;
    const c = this._canvas2d(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0,    '#3b2a6e');   // фиолетовый зенит
    g.addColorStop(0.45, '#c2497a');   // розовый
    g.addColorStop(0.75, '#ff8c5a');   // оранжевый
    g.addColorStop(1,    '#ffd9a0');   // светлый у горизонта
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    const sun = ctx.createRadialGradient(S * 0.5, S * 0.82, 6, S * 0.5, S * 0.82, 95);
    sun.addColorStop(0, 'rgba(255,244,210,0.95)');
    sun.addColorStop(0.5, 'rgba(255,185,120,0.5)');
    sun.addColorStop(1, 'rgba(255,185,120,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Асфальт: светло-серая база + зернистый шум. */
  _makeAsphaltTexture() {
    const S = 512;
    const c = this._canvas2d(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5d6878'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
      ctx.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (this._maxAniso) tex.anisotropy = this._maxAniso;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Трава: зелёная база + пятна светлее/темнее (низкополигональный газон). */
  _makeGrassTexture() {
    const S = 128;
    const c = this._canvas2d(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#86d94f'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(20,90,30,0.16)';
      const x = Math.random() * S, y = Math.random() * S;
      ctx.fillRect(x, y, 2.2, 2.2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (this._maxAniso) tex.anisotropy = this._maxAniso;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Дневной фасад: окна как тёмно-голубые стёкла на цветной стене (цвет даёт material). */
  _makeFacadeTexture(variant = 0) {
    const W = 256, H = 512;
    const c = this._canvas2d(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);   // белая база → material.color тонирует
    const glass = ['#3b5a7a', '#2f6f7a', '#4a4f7a'][variant % 3];
    const cols = 4, rows = 9, mx = 10, my = 8;
    const cw = (W - mx * (cols + 1)) / cols;
    const ch = (H - my * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = mx + col * (cw + mx);
        const y = my + r * (ch + my);
        ctx.fillStyle = glass;
        ctx.fillRect(x, y, cw, ch);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';   // блик стекла
        ctx.fillRect(x, y, cw, ch * 0.35);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 2);
    if (this._maxAniso) tex.anisotropy = this._maxAniso;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Жёлто-чёрные диагональные полосы — «лежачий полицейский». */
  _makeStripeTexture() {
    const S = 64;
    const c = this._canvas2d(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f5c400'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 10;
    for (let x = -S; x < S * 2; x += 22) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + S, S); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 1);
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Зелёные шевроны «вперёд» на прозрачном фоне — буст-пад (газ). */
  _makeChevronTexture() {
    const S = 128;
    const c = this._canvas2d(S, S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = '#34ff9e'; ctx.lineWidth = 14; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const y = 24 + i * 38;     // вершина шеврона указывает вверх по текстуре (вперёд по дороге)
      ctx.beginPath();
      ctx.moveTo(20, y + 26); ctx.lineTo(S / 2, y); ctx.lineTo(S - 20, y + 26);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._bakedTextures.push(tex);
    return tex;
  }

  /** Пухлые белые облака (несколько групп сфер, без тумана → парят вдали). */
  _buildClouds() {
    this._clouds = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const puffGeo = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < 8; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(puffGeo, mat);
        m.position.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 4);
        m.scale.setScalar(1.6 + Math.random() * 2.2);
        cloud.add(m);
      }
      this._clouds.push(cloud);
      this._scene.add(cloud);
      this._placeCloud(cloud, SPAWN_Z + Math.random() * (ROAD_LEN + 60));
    }
  }

  _placeCloud(cloud, z) {
    cloud.position.set((Math.random() * 2 - 1) * 90, 34 + Math.random() * 30, z);
  }

  /** Низкополигональное дерево: коричневый ствол + 2 зелёных конуса. */
  _buildTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.38, 1.8, 9),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9, metalness: 0.0 })
    );
    trunk.position.y = 0.9;
    g.add(trunk);
    // Крона из мягких сфер (вместо острых конусов) — округлый, «живой» силуэт дерева.
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x37c457, roughness: 0.85, metalness: 0.0 });
    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    for (const [bx, by, bz, bs] of [[0, 2.4, 0, 1.5], [-0.8, 2.0, 0.3, 1.0], [0.8, 2.1, -0.2, 1.0], [0, 3.2, 0, 1.0]]) {
      const blob = new THREE.Mesh(blobGeo, leafMat);
      blob.position.set(bx, by, bz);
      blob.scale.setScalar(bs);
      g.add(blob);
    }
    return g;
  }

  _placeTree(t, z, side) {
    const offset = ROAD_HALF + 0.8 + Math.random() * 1.6;   // у обочины, перед зданиями
    const s = 0.8 + Math.random() * 0.7;
    t.scale.setScalar(s);
    t.position.set(side * offset, 0, z);
    t.rotation.y = Math.random() * Math.PI;
    t.userData.side = side;
  }

  /** Собирает простую машинку (group из коробок + колёса). */
  _buildCar(color, oncoming = false) {
    const g = new THREE.Group();
    // Скруглённый кузов с металлик-краской — отражает небо/город из environment-карты.
    const body = new THREE.Mesh(
      this._roundedBox(1.78, 0.64, 3.3, 0.34),
      new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.26, envMapIntensity: 1.1 })
    );
    body.position.y = 0.55;
    g.add(body);
    // Тёмный нижний обвес — добавляет объём и «приземляет» кузов.
    const skirt = new THREE.Mesh(
      this._roundedBox(1.84, 0.32, 3.36, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x1f2733, metalness: 0.4, roughness: 0.6 })
    );
    skirt.position.y = 0.34;
    g.add(skirt);
    // Кабина-стекло: низкая шероховатость + высокий envMap = зеркальный блик неба.
    const roof = new THREE.Mesh(
      this._roundedBox(1.46, 0.52, 1.7, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x9fdcff, metalness: 0.25, roughness: 0.07, envMapIntensity: 1.5 })
    );
    roof.position.set(0, 1.04, -0.1);
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
    this._hazardCount = 0; this._hazardHit = 0; this._reactionSum = 0; this._reactionN = 0;
    this._recRoll = 0; this._recPitch = 0; this._recYaw = 0;
    this._obstacleTimer = 0; this._coinTimer = 0; this._carX = 0;
    this._challengeIdx = 0; this._challengeTimer = 0; this._difficulty = 1; this._slalomSide = 1;
    this._kbPitch = 0; this._throttle = 1; this._steerNorm = 0;
    this._shield = false; this._powerupTimer = 0;
    this._magnet = false; this._magnetTimer = 0; this._bumpTimer = 0; this._boostTimer = 0;
    this._carBounceV = 0;
    this._car.position.x = 0; this._car.position.y = 0; this._car.rotation.z = 0;
    for (const o of this._obstacles) { o.visible = false; o.userData.active = false; }
    for (const c of this._coins)     { c.visible = false; c.userData.active = false; }
    for (const b of (this._bumps  || [])) { b.visible = false; b.userData.active = false; }
    for (const b of (this._boosts || [])) { b.visible = false; b.userData.active = false; }
    for (const p of (this._particles || [])) { p.visible = false; p.userData.active = false; }
    if (this._powerup)    { this._powerup.visible = false; this._powerup.userData.active = false; }
    if (this._shieldAura)   this._shieldAura.visible = false;
    this._applyTheme('city');
  }

  // ─── Спавн ────────────────────────────────────────────────────────────────────

  _spawnObstacle() {
    const o = this._obstacles.find((x) => !x.userData.active);
    if (!o) return;
    o.userData.active = true;
    o.userData.evaluated = false; o.userData.hazard = false; o.userData.reacted = false;
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
      o.userData.evaluated = false; o.userData.hazard = false; o.userData.reacted = false;
      o.position.set(x, 0, SPAWN_Z);
    }
    const c = this._coins.find((x) => !x.userData.active);
    if (c) {
      c.userData.active = true; c.visible = true; c.userData.zonal = false;
      c.position.set(gapCenter, 0.7, SPAWN_Z - 3);
      c.material.color.setHex(0xffd700); c.material.emissive.setHex(0xb8860b);
    }
  }

  /** Лежачий полицейский: полоса во всю дорогу. Безопасен только если приторможен (наклон назад). */
  _spawnBump() {
    const b = this._bumps.find((x) => !x.userData.active);
    if (!b) return;
    b.userData.active = true; b.userData.evaluated = false; b.visible = true;
    b.position.set(0, 0.18, SPAWN_Z);
  }

  /** Буст-пад: засчитывается, если проехать с газом (наклон вперёд) → бонус + ускорение. */
  _spawnBoost() {
    const b = this._boosts.find((x) => !x.userData.active);
    if (!b) return;
    b.userData.active = true; b.userData.scored = false; b.visible = true;
    const x = (Math.random() * 2 - 1) * (CAR_MAX_X - 1.2);
    b.position.set(x, 0.02, SPAWN_Z);
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
    } else if (ch === 'checkpoint') {
      this._bumpTimer += this._dtMs;
      if (this._bumpTimer >= Math.max(1700, 2600 - this._challengeIdx * 60)) {
        this._bumpTimer = 0; this._spawnBump();
      }
      if (this._coinTimer >= 1000) { this._coinTimer = 0; this._spawnCoin(); }
    } else if (ch === 'boost') {
      this._boostTimer += this._dtMs;
      if (this._boostTimer >= Math.max(1100, 1800 - this._challengeIdx * 50)) {
        this._boostTimer = 0; this._spawnBoost();
      }
      if (this._coinTimer >= 900) { this._coinTimer = 0; this._spawnCoin(); }
      const every = Math.max(900, 1500 - this._challengeIdx * 30);  // редкие встречные — газ не бездумный
      if (this._obstacleTimer >= every) { this._obstacleTimer = 0; this._spawnObstacle(); }
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
      // Масштаб по СВОЕМУ направлению: вправо — по rollPos, влево — по rollNeg. Полный поворот
      // достижим на персональном максимуме (важно при малом/асимметричном размахе у ДЦП).
      const rng = this._smoothRoll >= 0 ? this._rollPos : this._rollNeg;
      const norm = Math.max(-1, Math.min(1, this._smoothRoll / rng));
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
    this._steerNorm = this._carX / CAR_MAX_X;   // нормализованное положение руля для HUD
    // Плавно подводим машину к целевой позиции
    this._car.position.x += (this._carX - this._car.position.x) * Math.min(1, 0.25 * f);
    // Крен кузова при повороте
    const lean = -(this._car.position.x / CAR_MAX_X) * 0.18;
    this._car.rotation.z += (lean - this._car.rotation.z) * Math.min(1, 0.2 * f);
    // Отскок кузова после удара о «лежачего полицейского» (визуальный отклик вместо потери жизни).
    if (this._carBounceV !== 0 || this._car.position.y > 0) {
      const dts = this._dtMs / 1000;
      this._carBounceV -= 32 * dts;            // гравитация
      this._car.position.y += this._carBounceV * dts;
      if (this._car.position.y <= 0) { this._car.position.y = 0; this._carBounceV = 0; }
    }
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
    // Газ — по pitchPos, тормоз — по pitchNeg (персональный диапазон вперёд/назад).
    const prng = this._smoothPitch >= 0 ? this._pitchPos : this._pitchNeg;
    const np = Math.max(-1, Math.min(1, this._smoothPitch / prng));
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
    // Деревья
    if (this._trees) for (const t of this._trees) {
      t.position.z += dz;
      if (t.position.z > RECYCLE_Z + 4) this._placeTree(t, SPAWN_Z, t.userData.side);
    }
    // Облака — медленный параллакс (далеко, движутся плавнее дороги)
    if (this._clouds) for (const cl of this._clouds) {
      cl.position.z += dz * 0.35;
      if (cl.position.z > RECYCLE_Z + 40) this._placeCloud(cl, SPAWN_Z - Math.random() * 60);
    }
  }

  _updateObstacles(dz) {
    const carX = this._car.position.x;
    for (const o of this._obstacles) {
      if (!o.userData.active) continue;
      o.position.z += dz;

      // Реакция: на «линии решения» фиксируем, идёт ли препятствие на курсе столкновения.
      if (!o.userData.evaluated && o.position.z >= REACT_LINE) {
        o.userData.evaluated = true;
        if (Math.abs(o.position.x - carX) < HAZARD_MARGIN) {   // угроза на курсе машины
          o.userData.hazard = true;
          o.userData.reactT0 = this._lastFrameTime;
          o.userData.reactX0 = carX;
          this._hazardCount++;
        }
      }
      // Засекаем время реакции: машина ушла от позиции в момент появления угрозы.
      if (o.userData.hazard && !o.userData.reacted &&
          Math.abs(carX - o.userData.reactX0) > REACT_MOVE) {
        o.userData.reacted = true;
        this._reactionSum += (this._lastFrameTime - o.userData.reactT0);
        this._reactionN++;
      }

      if (o.position.z > RECYCLE_Z) {
        o.userData.active = false; o.visible = false;
        continue;
      }
      // Столкновение
      if (Math.abs(o.position.x - carX) < COLLIDE_X &&
          o.position.z > CAR_Z - COLLIDE_Z && o.position.z < CAR_Z + COLLIDE_Z) {
        o.userData.active = false; o.visible = false;
        if (o.userData.hazard) this._hazardHit++;   // угроза на курсе, по которой не увернулись
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
      // Магнит: близкие монеты подтягиваются к полосе машины (помощь при малом ROM).
      if (this._magnet && c.position.z > CAR_Z - 28 && c.position.z < CAR_Z + 2) {
        c.position.x += (carX - c.position.x) * Math.min(1, 0.07 * this._dtFactor);
      }
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
        this._burst(c.position.x, c.position.y, CAR_Z, c.userData.zonal ? 0x22d3ee : 0xffd54a,
                    c.userData.zonal ? 14 : 9);
        this.onScore?.(this._score);
        this._emitState();
      }
    }
  }

  /** Бонусы (щит/магнит): редкий спавн, подбор включает эффект; аура на машине пульсирует. */
  _updatePowerup(dz) {
    // Обратный отсчёт действия магнита.
    if (this._magnet) {
      this._magnetTimer -= this._dtMs;
      if (this._magnetTimer <= 0) { this._magnet = false; this._emitState(); }
    }
    const auraActive = this._shield || this._magnet;
    if (this._shieldAura) {
      this._shieldAura.visible = auraActive;
      if (auraActive) {
        this._shieldAura.material.color.setHex(this._shield ? 0x34d399 : 0x22d3ee);
        this._shieldAura.scale.setScalar(1 + Math.sin(Date.now() * 0.006) * 0.06);
      }
    }
    const p = this._powerup;
    if (!p) return;
    if (!p.userData.active) {
      // спавним, только если ни один эффект не активен и бонуса нет на сцене
      if (!this._shield && !this._magnet) {
        this._powerupTimer += this._dtMs;
        if (this._powerupTimer >= 9000) {
          this._powerupTimer = 0;
          p.userData.active = true; p.visible = true;
          p.userData.kind = Math.random() < 0.5 ? 'shield' : 'magnet';
          const mag = p.userData.kind === 'magnet';
          p.material.color.setHex(mag ? 0x22d3ee : 0x34d399);
          p.material.emissive.setHex(mag ? 0x0891b2 : 0x059669);
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
      const mag = p.userData.kind === 'magnet';
      if (mag) { this._magnet = true; this._magnetTimer = 7000; }
      else { this._shield = true; }
      this._burst(p.position.x, 0.8, CAR_Z, mag ? 0x22d3ee : 0x34d399, 16);
      this._emitState();
    }
  }

  /** Лежачие полицейские: безопасны, только если приторможен (throttle ≤ BRAKE_OK). Иначе — наезд. */
  _updateBumps(dz) {
    const carX = this._car.position.x;
    for (const b of this._bumps) {
      if (!b.userData.active) continue;
      b.position.z += dz;
      if (b.position.z > RECYCLE_Z) { b.userData.active = false; b.visible = false; continue; }
      if (!b.userData.evaluated &&
          b.position.z > CAR_Z - COLLIDE_Z && b.position.z < CAR_Z + COLLIDE_Z) {
        b.userData.evaluated = true;
        if (this._throttle > BRAKE_OK_THROTTLE) {        // не приторможен → толчок (БЕЗ потери жизни:
          // тормозить может не каждый ребёнок с ДЦП — наказывать за это нельзя). Сброс комбо + отскок
          // кузова; стимул тормозить — награда в ветке ниже, а не штраф жизнью.
          this._combo = 0; this._comboTimer = 0;
          this._carBounceV = 6.5;
          this._burst(carX, 0.6, CAR_Z, 0xffa500, 10);
          this._emitState();
        } else {                                          // приторможен → чисто прошёл + награда
          this._score += 2 * this._getComboMultiplier();
          this._burst(carX, 0.4, CAR_Z, 0x86efac, 8);
          this.onScore?.(this._score);
          this._emitState();
        }
      }
    }
  }

  /** Буст-пады: бонус, если проехать с газом (throttle ≥ BOOST_OK). Промах — без штрафа. */
  _updateBoosts(dz) {
    const carX = this._car.position.x;
    for (const b of this._boosts) {
      if (!b.userData.active) continue;
      b.position.z += dz;
      if (b.position.z > RECYCLE_Z) { b.userData.active = false; b.visible = false; continue; }
      if (!b.userData.scored && Math.abs(b.position.x - carX) < 1.5 &&
          b.position.z > CAR_Z - COLLIDE_Z && b.position.z < CAR_Z + COLLIDE_Z) {
        b.userData.scored = true;
        if (this._throttle >= BOOST_OK_THROTTLE) {
          this._score += 3 * this._getComboMultiplier();
          this._combo++; if (this._combo > this._maxCombo) this._maxCombo = this._combo;
          this._comboTimer = 2200;
          this._burst(carX, 0.5, CAR_Z, 0x34ff9e, 14);
          this.onScore?.(this._score);
          this._emitState();
        }
      }
    }
  }

  /** Активирует частицы из пула в точке (билборд-вспышка при сборе/наезде). */
  _burst(x, y, z, color, count) {
    if (!this._particles) return;
    let spawned = 0;
    for (const p of this._particles) {
      if (p.userData.active) continue;
      p.userData.active = true; p.visible = true;
      p.material.color.setHex(color); p.material.opacity = 1;
      p.position.set(x, y, z);
      const ang = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      p.userData.vx = Math.cos(ang) * sp;
      p.userData.vy = 2 + Math.random() * 4;
      p.userData.vz = Math.sin(ang) * sp;
      p.userData.life = p.userData.maxLife = 0.5 + Math.random() * 0.3;
      if (++spawned >= count) break;
    }
  }

  _updateParticles(dtSec) {
    if (!this._particles) return;
    for (const p of this._particles) {
      if (!p.userData.active) continue;
      p.userData.life -= dtSec;
      if (p.userData.life <= 0) { p.userData.active = false; p.visible = false; continue; }
      p.userData.vy -= 9 * dtSec;          // гравитация
      p.position.x += p.userData.vx * dtSec;
      p.position.y += p.userData.vy * dtSec;
      p.position.z += p.userData.vz * dtSec;
      const k = p.userData.life / p.userData.maxLife;
      p.material.opacity = k;
      p.scale.setScalar(0.5 + k);
      p.lookAt(this._camera.position);     // билборд к камере
    }
  }

  _updateRain() {
    if (!this._rain || !this._rain.visible) return;
    const arr = this._rain.geometry.attributes.position.array;
    const fall = 60 * (this._dtMs / 1000);
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] -= fall;
      if (arr[i] < 0) arr[i] += 40;
    }
    this._rain.geometry.attributes.position.needsUpdate = true;
  }

  /** Визуальная тема окружения: дождь (мокрый асфальт + капли), закат (тёплый свет) или город. */
  _applyTheme(theme) {
    this._sceneTheme = theme;
    const rain = theme === 'rain';
    if (this._rain) this._rain.visible = rain;
    if (this._scene) this._scene.background = (theme === 'sunset') ? this._sunsetSky : this._daySky;
    if (this._roadMat) { this._roadMat.roughness = rain ? 0.32 : 0.7; this._roadMat.needsUpdate = true; }
    if (this._scene && this._scene.fog) {
      const fog = this._scene.fog;
      if (rain)               { fog.color.setHex(0x9aa7bd); fog.near = 55; fog.far = 230; }
      else if (theme === 'sunset') { fog.color.setHex(0xffcf9e); fog.near = 90; fog.far = 320; }
      else                    { fog.color.setHex(0xdaf0ff); fog.near = 90; fog.far = 320; }
    }
    if (this._dirLight && this._ambLight) {
      if (rain)               { this._dirLight.color.setHex(0xcfe0ff); this._dirLight.intensity = 0.75; this._ambLight.intensity = 0.7; }
      else if (theme === 'sunset') { this._dirLight.color.setHex(0xffb066); this._dirLight.intensity = 1.05; this._ambLight.intensity = 0.8; }
      else                    { this._dirLight.color.setHex(0xfff4d6); this._dirLight.intensity = 1.15; this._ambLight.intensity = 0.85; }
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
    this._updateBumps(dz);
    this._updateBoosts(dz);
    this._updateParticles(dtSec);
    this._updateRain();

    // ── Испытания: каждые CHALLENGE_MS меняем тип и поднимаем сложность ──────────
    this._challengeTimer += this._dtMs;
    if (this._challengeTimer >= CHALLENGE_MS) {
      this._challengeTimer = 0;
      this._challengeIdx++;
      this._difficulty = 1 + Math.min(this._challengeIdx, 8) * 0.09;
      // Тема окружения меняется каждые 2 стадии — разнообразие сцены.
      const theme = SCENE_THEMES[Math.floor(this._challengeIdx / 2) % SCENE_THEMES.length];
      if (theme !== this._sceneTheme) this._applyTheme(theme);
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
      // Реакция на препятствия (когнитивно-моторный навык): среднее время реакции (мс),
      // доля объехавших угроз (0..1), число угроз на курсе. null, если угроз не было.
      reactionMs: this._reactionN ? Math.round(this._reactionSum / this._reactionN) : null,
      avoidanceRate: this._hazardCount
        ? +((this._hazardCount - this._hazardHit) / this._hazardCount).toFixed(3) : null,
      hazardCount: this._hazardCount,
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
