import { create } from 'zustand';
import { BleService } from '@ble/index.js';

// Синглтон — один BleService на всё приложение
const bleService = new BleService({ alpha: 0.22 });
bleService.enableKeyboard(3); // клавиатурный fallback всегда активен

const useBleStore = create((set, get) => ({
  connected: false,
  status: 'Не подключено',
  lastReading: null,

  async connect({ acceptAll = false } = {}) {
    await bleService.connect({ acceptAll });
  },

  disconnect() {
    bleService.disconnect();
  },

  calibrate() {
    bleService.calibrate?.();
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
