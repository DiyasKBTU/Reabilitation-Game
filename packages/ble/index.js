/**
 * packages/ble — BLE-сервис для RehabGame
 *
 * Framework-agnostic ES-модуль. Никаких зависимостей от React/DOM кроме
 * Web Bluetooth API и EventTarget (встроены в браузер).
 *
 * Использование:
 *   import { BleService } from '../../packages/ble/index.js';
 *
 *   const ble = new BleService({ alpha: 0.22 });   // game1
 *   const ble = new BleService({ alpha: 0.12 });   // game2
 *
 *   ble.addEventListener('data',         e => console.log(e.detail));
 *   ble.addEventListener('status',       e => console.log(e.detail.text));
 *   ble.addEventListener('connected',    () => ...);
 *   ble.addEventListener('disconnected', () => ...);
 *   ble.addEventListener('error',        e => console.error(e.detail.message));
 *
 *   await ble.connect();   // открывает браузерный диалог выбора устройства
 *   ble.calibrate();       // отправляет команду CALIB на ESP32
 *   ble.resetYaw();        // отправляет команду RESET_YAW
 *   ble.disconnect();
 *
 * Keyboard fallback (для тестирования без устройства):
 *   ble.enableKeyboard();  // стрелки и A/D управляют roll/pitch
 *   ble.disableKeyboard();
 */

// UUID-ы GATT-сервиса ESP32-C3-IMU
const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const DATA_UUID    = "abcd1234-ab12-ab12-ab12-abcdef123456";
const CALIB_UUID   = "abcd1235-ab12-ab12-ab12-abcdef123456";

const DEVICE_NAME  = "ESP32-C3-IMU";

// Приводит угол к диапазону [-180, 180]
function normalizeAngle(v) {
  while (v >  180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

export class BleService extends EventTarget {
  /**
   * @param {object} options
   * @param {number}  options.alpha        - вес нового значения в EMA (0..1). По умолч. 0.22
   * @param {string}  options.deviceName   - имя BLE-устройства для фильтра поиска
   * @param {boolean} options.invertRoll   - инвертировать ось крена (если «вправо» едет влево)
   * @param {boolean} options.invertPitch  - инвертировать ось тангажа (газ/тормоз наоборот)
   * @param {boolean} options.invertYaw    - инвертировать ось рыскания
   */
  constructor({ alpha = 0.22, deviceName = DEVICE_NAME,
                invertRoll = false, invertPitch = false, invertYaw = false } = {}) {
    super();

    this.alpha      = alpha;
    this.deviceName = deviceName;

    // Инверсия осей: исправляет зеркальное управление (наклон вправо → объект едет влево).
    // Зависит от того, как физически закреплён датчик на кисти, поэтому это настройка, а не
    // константа. Применяется ТОЛЬКО к данным реального устройства (не к клавиатуре) после
    // вычитания нуля, перед сглаживанием — так инверсия влияет и на управление, и на ML-запись
    // (запись остаётся «истинным» движением). Сохраняется на стороне web (bleStore → localStorage).
    this.invertRoll  = invertRoll;
    this.invertPitch = invertPitch;
    this.invertYaw   = invertYaw;

    // Публичное состояние — читать напрямую
    this.connected  = false;
    this.yaw        = 0;
    this.pitch      = 0;
    this.roll       = 0;
    this.smoothYaw  = 0;
    this.smoothPitch = 0;
    this.smoothRoll  = 0;

    // Программное обнуление («ноль = текущая поза кисти»). Захватывается zeroNow() на старте
    // игры и вычитается из входящих углов ДО сглаживания — платформа/машина не «уезжает»
    // из-за ненулевого базового наклона датчика и накопленного до старта EMA. Не зависит от
    // прошивки: аппаратный calibrate() (CALIB) и клиентский zeroNow() НЕ комбинируются —
    // см. их доки (иначе была бы двойная коррекция).
    this.yawOffset   = 0;
    this.pitchOffset = 0;
    this.rollOffset  = 0;

    // Приватное
    this._device    = null;
    this._calibChar = null;
    this._kbActive  = false;
    this._kbHandler = null;
    this._kbRaf     = null;   // id requestAnimationFrame keyboard-петли
    this._kbHeld    = null;   // Set зажатых клавиш
  }

  // ─── Подключение ───────────────────────────────────────────────────────────

  /**
   * @param {object} options
   * @param {boolean} options.acceptAll - показать все BLE-устройства (для отладки / нестандартное имя)
   */
  async connect({ acceptAll = false } = {}) {
    if (!navigator.bluetooth) {
      this._emitError("Web Bluetooth API недоступен. Нужен Chrome/Edge + HTTPS или localhost.");
      return;
    }
    try {
      const requestOptions = acceptAll
        ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID] }
        : {
            filters: [{ name: this.deviceName }],
            optionalServices: [SERVICE_UUID]
          };

      // requestDevice() вызывается первым — до любых setState/emit
      // иначе React re-render может прервать user-gesture context в Chrome
      this._device = await navigator.bluetooth.requestDevice(requestOptions);
      this._emitStatus("Подключение...");

      this._device.addEventListener("gattserverdisconnected", () => {
        this.connected = false;
        this._emitStatus("Отключено");
        this.dispatchEvent(new CustomEvent("disconnected"));
      });

      const server   = await this._device.gatt.connect();
      const service  = await server.getPrimaryService(SERVICE_UUID);
      const dataChar = await service.getCharacteristic(DATA_UUID);
      this._calibChar = await service.getCharacteristic(CALIB_UUID);

      await dataChar.startNotifications();
      dataChar.addEventListener("characteristicvaluechanged", (e) => this._handleData(e));

      this.connected = true;
      this._emitStatus("Подключено ✓");
      this.dispatchEvent(new CustomEvent("connected"));
    } catch (err) {
      // Пользователь закрыл диалог — не ошибка, просто отмена
      if (err.name === "NotFoundError") {
        this._emitStatus("Отменено");
        return;
      }
      this._emitError(err.message || String(err));
    }
  }

  disconnect() {
    try {
      if (this._device?.gatt?.connected) this._device.gatt.disconnect();
    } catch (_) { /* уже отключено */ }
    this.connected = false;
    this._emitStatus("Отключено");
    this.dispatchEvent(new CustomEvent("disconnected"));
  }

  // ─── Команды устройства ────────────────────────────────────────────────────

  calibrate() {
    // Аппаратный ноль на самом ESP32: устройство становится точкой отсчёта. Клиентский
    // offset при этом сбрасываем — иначе двойная коррекция (и устройство, и клиент вычтут
    // базовый наклон). Сглаживание тоже обнуляем, чтобы старое значение не «вытекало».
    this.yawOffset = this.pitchOffset = this.rollOffset = 0;
    this.smoothYaw = this.smoothPitch = this.smoothRoll = 0;
    return this._sendCommand("CALIB");
  }

  /**
   * Программный ноль: ТЕКУЩАЯ поза кисти становится нулём (offset = последние сырые углы),
   * накопленный EMA сбрасывается. Чисто клиентский, без команды устройству — поэтому нет
   * задержки и нет конфликта с аппаратным CALIB. Вызывается при старте игры, чтобы убрать
   * лёгкое «уезжание» платформы/машины в начальной позиции из-за ненулевого базового наклона.
   */
  zeroNow() {
    this.yawOffset   = this.yaw;
    this.pitchOffset = this.pitch;
    this.rollOffset  = this.roll;
    this.smoothYaw = this.smoothPitch = this.smoothRoll = 0;
  }

  /**
   * Включить/выключить инверсию осей. Передавайте только нужные поля.
   * Пример: setInvert({ roll: true }) — исправить «наклон вправо → едет влево».
   */
  setInvert({ roll, pitch, yaw } = {}) {
    if (roll  !== undefined) this.invertRoll  = !!roll;
    if (pitch !== undefined) this.invertPitch = !!pitch;
    if (yaw   !== undefined) this.invertYaw   = !!yaw;
  }

  /**
   * Явно задать ноль (offset) — для восстановления сохранённой «нейтрали по умолчанию».
   * Передавайте сырые углы позы, которую считаем нейтральной. Сбрасывает EMA.
   */
  setOffsets({ yaw, pitch, roll } = {}) {
    if (yaw   !== undefined) this.yawOffset   = yaw;
    if (pitch !== undefined) this.pitchOffset = pitch;
    if (roll  !== undefined) this.rollOffset  = roll;
    this.smoothYaw = this.smoothPitch = this.smoothRoll = 0;
  }

  /** Текущий ноль (offset) — чтобы web мог сохранить «нейтраль по умолчанию» в localStorage. */
  getOffsets() {
    return { yaw: this.yawOffset, pitch: this.pitchOffset, roll: this.rollOffset };
  }

  resetYaw() {
    return this._sendCommand("RESET_YAW");
  }

  async _sendCommand(cmd) {
    if (!this._calibChar) {
      this._emitError("Сначала подключитесь к BLE");
      return;
    }
    try {
      await this._calibChar.writeValue(new TextEncoder().encode(cmd));
      this._emitStatus(`${cmd} отправлено`);
    } catch (err) {
      this._emitError(`Ошибка команды ${cmd}: ${err.message}`);
    }
  }

  // ─── Обработка входящих данных ─────────────────────────────────────────────

  _handleData(event) {
    const raw   = new TextDecoder().decode(event.target.value);
    const parts = raw.trim().split(",").map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) return;

    this.yaw   = normalizeAngle(parts[0]);   // сырые показания датчика (нужны zeroNow и диагностике)
    this.pitch = parts[1];
    this.roll  = parts[2];

    // Калибровка: «ноль = поза в момент zeroNow()». Вычитаем offset ДО сглаживания.
    let cy = normalizeAngle(this.yaw - this.yawOffset);
    let cp = this.pitch - this.pitchOffset;
    let cr = this.roll  - this.rollOffset;

    // Инверсия осей (исправление зеркального управления). После калибровки, до сглаживания —
    // чтобы и управление (smooth), и ML-запись (calib) отражали истинное направление движения.
    if (this.invertYaw)   cy = -cy;
    if (this.invertPitch) cp = -cp;
    if (this.invertRoll)  cr = -cr;

    // EMA-сглаживание откалиброванного сигнала: smoothed = prev*(1-α) + new*α
    const a = this.alpha, b = 1 - a;
    this.smoothYaw   = this.smoothYaw   * b + cy * a;
    this.smoothPitch = this.smoothPitch * b + cp * a;
    this.smoothRoll  = this.smoothRoll  * b + cr * a;

    this.dispatchEvent(new CustomEvent("data", {
      detail: {
        raw:   { yaw: this.yaw, pitch: this.pitch, roll: this.roll },        // истинные показания датчика
        // Калиброванный, но НЕ сглаженный сигнал. Управление берёт smooth (без джиттера),
        // а ML-запись — calib: EMA — это low-pass, он гасит тремор 4–8 Гц ДО записи, поэтому
        // в imu_time_series должен идти именно несглаженный угол (см. features._spectral_tremor).
        calib: { yaw: cy, pitch: cp, roll: cr },
        smooth: { yaw: this.smoothYaw, pitch: this.smoothPitch, roll: this.smoothRoll }, // калибр. + сглаж. (управление)
        timestamp: Date.now()
      }
    }));
  }

  // ─── Keyboard fallback (тест без устройства) ──────────────────────────────

  /**
   * Включает управление с клавиатуры.
   * Стрелка влево / A  →  roll -= step
   * Стрелка вправо / D →  roll += step
   * Стрелка вверх      →  pitch -= step
   * Стрелка вниз       →  pitch += step
   * @param {number} step - шаг изменения угла в градусах (по умолч. 5)
   */
  enableKeyboard(step = 5) {
    if (this._kbActive) return;

    const held = new Set();
    this._kbHeld = held;
    this._kbRaf  = null;

    const tick = () => {
      let changed = false;
      if (held.has("ArrowLeft")  || held.has("KeyA")) { this.roll  -= step; changed = true; }
      if (held.has("ArrowRight") || held.has("KeyD")) { this.roll  += step; changed = true; }
      if (held.has("ArrowUp"))                        { this.pitch -= step; changed = true; }
      if (held.has("ArrowDown"))                      { this.pitch += step; changed = true; }

      if (changed) {
        this.roll  = Math.max(-90,  Math.min(90,  this.roll));
        this.pitch = Math.max(-90,  Math.min(90,  this.pitch));

        const a = this.alpha, b = 1 - a;
        this.smoothRoll  = this.smoothRoll  * b + this.roll  * a;
        this.smoothPitch = this.smoothPitch * b + this.pitch * a;

        this.dispatchEvent(new CustomEvent("data", {
          detail: {
            raw:    { yaw: this.yaw, pitch: this.pitch, roll: this.roll },
            calib:  { yaw: normalizeAngle(this.yaw - this.yawOffset), pitch: this.pitch - this.pitchOffset, roll: this.roll - this.rollOffset },
            smooth: { yaw: this.smoothYaw, pitch: this.smoothPitch, roll: this.smoothRoll },
            timestamp: Date.now(),
            source: "keyboard"
          }
        }));
      }
      // Петля живёт только пока есть зажатые клавиши — иначе останавливаемся
      // (раньше tick перезапускался безусловно → бесконечный raf-цикл даже без нажатий).
      if (held.size) {
        this._kbRaf = requestAnimationFrame(tick);
      } else {
        this._kbRaf = null;
      }
    };

    this._kbHandler = {
      keydown: (e) => { held.add(e.code); if (this._kbRaf == null) this._kbRaf = requestAnimationFrame(tick); },
      keyup:   (e) => { held.delete(e.code); }
    };

    window.addEventListener("keydown", this._kbHandler.keydown);
    window.addEventListener("keyup",   this._kbHandler.keyup);
    this._kbActive = true;
    this._emitStatus("Keyboard fallback активен (стрелки / A,D)");
  }

  disableKeyboard() {
    if (!this._kbActive || !this._kbHandler) return;
    window.removeEventListener("keydown", this._kbHandler.keydown);
    window.removeEventListener("keyup",   this._kbHandler.keyup);
    // Гарантированно гасим raf-петлю (даже если клавиша была зажата) — нет утечки.
    if (this._kbRaf != null) { cancelAnimationFrame(this._kbRaf); this._kbRaf = null; }
    if (this._kbHeld) this._kbHeld.clear();
    this._kbHandler = null;
    this._kbActive  = false;
  }

  // ─── Вспомогательные методы событий ──────────────────────────────────────

  _emitStatus(text) {
    this.dispatchEvent(new CustomEvent("status", { detail: { text } }));
  }

  _emitError(message) {
    this.dispatchEvent(new CustomEvent("error", { detail: { message } }));
  }
}
