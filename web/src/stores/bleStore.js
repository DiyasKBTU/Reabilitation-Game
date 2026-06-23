import { create } from 'zustand';
import { BleService } from '@ble/index.js';

// ─── Сохранённая калибровка устройства (localStorage) ────────────────────────
// Две вещи переживают перезагрузку страницы:
//   1) invert  — инверсия осей (исправляет «наклон вправо → объект едет влево»);
//   2) neutral — «нейтраль по умолчанию»: поза, которую пользователь один раз зафиксировал
//      как ноль (offset сырых углов). На старте игры она применяется автоматически.
// localStorage держим в web (а не в packages/ble) — пакет остаётся независимым от браузера.
const CALIB_KEY = 'rg_ble_calib';

function loadCalib() {
  try {
    const raw = localStorage.getItem(CALIB_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      return {
        invert: { roll: false, pitch: false, yaw: false, ...(c.invert || {}) },
        neutral: c.neutral || null,
      };
    }
  } catch (_) { /* битый JSON / нет доступа — берём дефолт */ }
  // Дефолт: ось руля инвертирована — частый эффект крепления датчика («вправо = влево»).
  // Меняется тумблером на странице «Устройство», если у конкретного датчика это не так.
  return { invert: { roll: true, pitch: false, yaw: false }, neutral: null };
}

function saveCalib(c) {
  try { localStorage.setItem(CALIB_KEY, JSON.stringify(c)); } catch (_) { /* не критично */ }
}

const calib = loadCalib();

// Синглтон — один BleService на всё приложение (инверсия из сохранённой калибровки)
const bleService = new BleService({
  alpha: 0.22,
  invertRoll: calib.invert.roll,
  invertPitch: calib.invert.pitch,
  invertYaw: calib.invert.yaw,
});
bleService.enableKeyboard(3); // клавиатурный fallback всегда активен
if (calib.neutral) bleService.setOffsets(calib.neutral); // восстановить сохранённую нейтраль

const useBleStore = create((set, get) => ({
  connected: false,
  status: 'Не подключено',
  lastReading: null,
  invert: { ...calib.invert },
  hasNeutral: !!calib.neutral,

  async connect({ acceptAll = false } = {}) {
    await bleService.connect({ acceptAll });
  },

  disconnect() {
    bleService.disconnect();
  },

  // Аппаратный ноль на ESP32 (команда CALIB). Сбрасывает и клиентский offset.
  calibrate() {
    bleService.calibrate?.();
  },

  // Клиентский ноль «текущая поза = 0» (без команды устройству, без сохранения).
  zeroNow() {
    bleService.zeroNow?.();
  },

  /**
   * Зафиксировать ТЕКУЩУЮ позу кисти как «нейтраль по умолчанию».
   * Пользователь ставит устройство в удобное положение и один раз нажимает кнопку —
   * дальше эта поза считается нулём и восстанавливается на старте каждой игры.
   */
  fixNeutral() {
    bleService.zeroNow?.();
    calib.neutral = bleService.getOffsets?.() || null;
    saveCalib(calib);
    set({ hasNeutral: !!calib.neutral });
  },

  /** Сбросить сохранённую нейтраль (вернуться к «ноль = поза на старте игры»). */
  clearNeutral() {
    calib.neutral = null;
    bleService.setOffsets?.({ yaw: 0, pitch: 0, roll: 0 });
    saveCalib(calib);
    set({ hasNeutral: false });
  },

  /** Инверсия оси ('roll' | 'pitch' | 'yaw'). Сохраняется и применяется сразу. */
  setInvert(axis, value) {
    calib.invert = { ...calib.invert, [axis]: !!value };
    bleService.setInvert?.({ [axis]: !!value });
    saveCalib(calib);
    set({ invert: { ...calib.invert } });
  },

  /**
   * Применить ноль на старте игры: если сохранена нейтраль — её, иначе обнулить по текущей позе.
   * Так «зафиксированный дефолт» реально используется, а без него работает прежний анти-дрейф.
   */
  applyNeutralOrZero() {
    if (calib.neutral) bleService.setOffsets?.(calib.neutral);
    else bleService.zeroNow?.();
  },
}));

// Подключаем события к стору
bleService.addEventListener('data', (e) => {
  useBleStore.setState({ lastReading: e.detail });
});
bleService.addEventListener('connected', () => {
  useBleStore.setState({ connected: true, status: 'Подключено' });
});
bleService.addEventListener('disconnected', () => {
  useBleStore.setState({ connected: false, status: 'Отключено' });
});
bleService.addEventListener('status', (e) => {
  useBleStore.setState({ status: e.detail?.text ?? String(e.detail) });
});
bleService.addEventListener('error', (e) => {
  useBleStore.setState({ status: 'Ошибка: ' + (e.detail?.message ?? e.detail) });
});

export { useBleStore, bleService };
export default useBleStore;
