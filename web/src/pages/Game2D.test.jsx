import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Перехватываем конфиг движка, чтобы вызвать его onGameOver вручную (без реальной игры).
const hoisted = vi.hoisted(() => ({ cfg: null }));

vi.mock('@game2d/index.js', () => ({
  Game2DEngine: class {
    constructor(_canvas, cfg) { hoisted.cfg = cfg; }
    start() {}
    destroy() {}
  },
}));
vi.mock('../api/index.js', () => ({ api: { createSession: vi.fn() } }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../stores/bleStore', () => ({
  useBleStore: () => ({ lastReading: null }),
  bleService: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
}));
vi.mock('../stores/authStore', () => ({ default: () => ({ user: { role: 'patient' } }) }));
vi.mock('../stores/sessionStore', () => ({ default: () => ({ setLastSession: vi.fn() }) }));
vi.mock('../components/GameIntro', () => ({ default: () => null }));
vi.mock('../components/BlePanel', () => ({ default: () => null }));

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
