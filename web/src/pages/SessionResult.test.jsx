import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Сессия для теста; vi.hoisted — чтобы фабрики vi.mock (поднимаются наверх) могли её видеть.
const { session } = vi.hoisted(() => ({
  session: {
    id: 's1', patient_id: 'p1', game_type: 'game1',
    score: 100, max_combo: 5, duration_sec: 20, level: 1,
    features: {
      valid: true, rom: 50, peakVelocity: 100, smoothnessIndex: 0.8,
      tremorIndex: 0.1, pauseRatio: 0.1, repetitions: 10, activeTimeSec: 18,
    },
  },
}));

vi.mock('../api/index.js', () => ({
  api: {
    getSession: vi.fn().mockResolvedValue(session),
    getInsights: vi.fn().mockResolvedValue({}),
    labelSession: vi.fn(),
  },
}));
// Параметр маршрута и навигация — мокаем, остальное (Link, MemoryRouter) берём настоящее.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({ id: 's1' }),
  useNavigate: () => vi.fn(),
}));
// Сессия приходит из стора (минуем сетевой getSession); пациент → форма оценки видна.
vi.mock('../stores/sessionStore', () => ({ default: () => ({ lastSession: session }) }));
vi.mock('../stores/authStore', () => ({ default: () => ({ user: { role: 'patient' } }) }));
vi.mock('../components/AnomalyBadge', () => ({ default: () => null }));

import SessionResult from './SessionResult';
import { api } from '../api/index.js';

const renderPage = () => render(<MemoryRouter><SessionResult /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getInsights.mockResolvedValue({});
});

describe('SessionResult — ввод оценки (метки ML)', () => {
  it('кнопка «Сохранить» заблокирована, пока ничего не выбрано', async () => {
    renderPage();
    const save = await screen.findByRole('button', { name: 'Сохранить оценку' });
    expect(save).toBeDisabled();
  });

  it('сохраняет оценку с pain=0 («Нет боли» — метка нормы не отбрасывается)', async () => {
    api.labelSession.mockResolvedValueOnce({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Нет' }));
    const save = screen.getByRole('button', { name: 'Сохранить оценку' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await screen.findByText('Оценка сохранена');
    expect(api.labelSession).toHaveBeenCalledWith('s1', { pain: 0, fatigue: undefined });
  });

  it('при сбое сохранения показывает ошибку и оставляет форму для повтора', async () => {
    api.labelSession.mockRejectedValueOnce(new Error('network'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Небольшая' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить оценку' }));
    await screen.findByText(/Не удалось сохранить/);
    expect(screen.getByText('Как вы себя чувствуете?')).toBeInTheDocument();
  });
});
