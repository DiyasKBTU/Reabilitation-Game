import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Перехватываем конфиг движка (вызвать onGameOver вручную) и слушатели bleService
// (эмулировать события датчика: data / disconnected / connected — без реального BLE).
const hoisted = vi.hoisted(() => ({ cfg: null, handlers: {} }));

vi.mock('@game2d/index.js', () => ({
  Game2DEngine: class {
    constructor(_canvas, cfg) { hoisted.cfg = cfg; }
    start() {}
    destroy() {}
    updateInput() {}
  },
}));
vi.mock('../api/index.js', () => ({ api: { createSession: vi.fn() } }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../stores/bleStore', () => ({
  useBleStore: () => ({ lastReading: null }),
  bleService: {
    addEventListener: (type, fn) => { (hoisted.handlers[type] ||= []).push(fn); },
    removeEventListener: vi.fn(),
  },
  resetInputStats: vi.fn(),
  getInputSource: vi.fn(() => 'none'),
}));
vi.mock('../stores/authStore', () => ({ default: () => ({ user: { role: 'patient' } }) }));
vi.mock('../stores/sessionStore', () => ({ default: () => ({ setLastSession: vi.fn() }) }));
// «Начать» нужна тестам обрыва датчика: баннер показывается только в НАЧАТОЙ игре.
vi.mock('../components/GameIntro', () => ({
  default: ({ onStart }) => <button onClick={onStart}>Начать</button>,
}));
vi.mock('../components/BlePanel', () => ({ default: () => null }));

function emit(type, detail) {
  (hoisted.handlers[type] || []).forEach((fn) => fn({ detail }));
}

import Game2D from './Game2D';
import { api } from '../api/index.js';

describe('Game2D — сохранение результата', () => {
  it('при сбое createSession показывает оверлей ошибки с «Повторить» (сессия не теряется)', async () => {
    api.createSession.mockRejectedValueOnce(new Error('network'));
    render(<MemoryRouter><Game2D /></MemoryRouter>);

    // Движок создан эффектом — эмулируем конец игры его колбэком.
    await act(async () => {
      await hoisted.cfg.onGameOver({
        score: 10, maxCombo: 2, zoneHits: 1, durationSec: 12, level: 1, imuTimeSeries: [],
      });
    });

    expect(await screen.findByText('Не удалось сохранить результат')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });
});

describe('Game2D — обрыв датчика во время игры', () => {
  it('показывает баннер при disconnected (если датчик использовался) и прячет при reconnect', async () => {
    hoisted.handlers = {};
    render(<MemoryRouter><Game2D /></MemoryRouter>);
    await act(async () => { screen.getByRole('button', { name: 'Начать' }).click(); });

    // Пришли данные РЕАЛЬНОГО датчика (без source) → затем обрыв.
    await act(async () => {
      emit('data', { smooth: { roll: 5, pitch: 0, yaw: 0 }, calib: { roll: 5, pitch: 0, yaw: 0 } });
      emit('disconnected');
    });
    expect(await screen.findByText(/Датчик отключился/)).toBeInTheDocument();

    // Датчик вернулся → баннер исчез.
    await act(async () => { emit('connected'); });
    expect(screen.queryByText(/Датчик отключился/)).toBeNull();
  });

  it('НЕ показывает баннер, если игра шла только на клавиатуре', async () => {
    hoisted.handlers = {};
    render(<MemoryRouter><Game2D /></MemoryRouter>);
    await act(async () => { screen.getByRole('button', { name: 'Начать' }).click(); });

    await act(async () => {
      emit('data', { source: 'keyboard', smooth: { roll: 5, pitch: 0, yaw: 0 }, calib: { roll: 5, pitch: 0, yaw: 0 } });
      emit('disconnected');
    });
    expect(screen.queryByText(/Датчик отключился/)).toBeNull();
  });
});
