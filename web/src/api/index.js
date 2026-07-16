const BASE = import.meta.env.VITE_API_URL || '/api';

export async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('rg_token');
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) {
    // Протухший/недействительный токен: молча выйти и отправить на вход — иначе пользователь
    // остаётся «залогиненным» с ошибками на каждой странице. /auth/* не трогаем (401 там —
    // это просто «неверный пароль», редиректить нельзя).
    if (res.status === 401 && token && !path.startsWith('/auth/')) {
      localStorage.removeItem('rg_token');
      localStorage.removeItem('rg_user');
      if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Health (без авторизации) — статус сервиса, версия ML-модели, флаг демо-режима
  getHealth: () => apiFetch('/health'),

  // Auth
  register: (data) => apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  registerDoctor: (data) => apiFetch('/auth/register-doctor', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => apiFetch('/auth/me'),

  // Patients
  getPatients: () => apiFetch('/patients'),
  getPatient: (id) => apiFetch(`/patients/${id}`),
  createPatient: (data) => apiFetch('/patients', { method: 'POST', body: JSON.stringify(data) }),
  updatePatient: (id, data) => apiFetch(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // Неприкреплённые (самостоятельно зарегистрированные) пациенты + прикрепление к врачу
  getUnattachedPatients: () => apiFetch('/patients/unattached'),
  attachPatient: (id) => apiFetch(`/patients/${id}/attach`, { method: 'POST' }),

  // Sessions
  createSession: (data) => apiFetch('/sessions', { method: 'POST', body: JSON.stringify(data) }),
  getSessions: (params = {}) => apiFetch('/sessions?' + new URLSearchParams(params)),
  getSession: (id) => apiFetch(`/sessions/${id}`),
  // Сырой ряд движения сессии (угол во времени) для графика траектории
  getSessionTrace: (id) => apiFetch(`/sessions/${id}/trace`),
  labelSession: (id, data) => apiFetch(`/sessions/${id}/label`, { method: 'PATCH', body: JSON.stringify(data) }),
  // Калибровка: откалиброван ли пациент в игре (есть ли персональный baseline)
  getCalibrationStatus: (gameType = 'game1', patientId) =>
    apiFetch('/sessions/calibration/status?' + new URLSearchParams({ game_type: gameType, ...(patientId ? { patient_id: patientId } : {}) })),

  // Insights
  getInsights: (patientId, gameType = 'game1') => apiFetch(`/insights/${patientId}?game_type=${gameType}`),

  // Leaderboard
  getLeaderboard: (gameType = 'game1') => apiFetch(`/leaderboard?game_type=${gameType}`),

  // Profile
  getProfile: () => apiFetch('/profile'),
  updateProfile: (data) => apiFetch('/profile', { method: 'PATCH', body: JSON.stringify(data) }),

  // Admin
  getUsers: () => apiFetch('/admin/users'),
  updateUser: (id, data) => apiFetch(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id) => apiFetch(`/admin/users/${id}`, { method: 'DELETE' }),
  getDoctorInvites: () => apiFetch('/admin/doctor-invites'),
  createDoctorInvite: () => apiFetch('/admin/doctor-invites', { method: 'POST' }),
  deleteDoctorInvite: (id) => apiFetch(`/admin/doctor-invites/${id}`, { method: 'DELETE' }),
  // Тестовые пользователи (создаются админом для проверки/игры, изолированы от реальных)
  createTestUser: (data = {}) => apiFetch('/admin/test-users', { method: 'POST', body: JSON.stringify(data) }),
  deleteTestUser: (id) => apiFetch(`/admin/test-users/${id}`, { method: 'DELETE' }),
  // Сбор ML-данных: прогресс (счётчики) + выгрузка датасета (без сырого ряда — лёгкий JSON)
  getDatasetStats: () => apiFetch('/admin/dataset-stats'),
  exportMlDataset: (params = {}) => apiFetch('/admin/export/ml-dataset?' + new URLSearchParams(params)),
};
