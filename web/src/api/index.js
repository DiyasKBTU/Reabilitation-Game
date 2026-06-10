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
  login: (data) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => apiFetch('/auth/me'),

  // Patients
  getPatients: () => apiFetch('/patients'),
  getPatient: (id) => apiFetch(`/patients/${id}`),
  createPatient: (data) => apiFetch('/patients', { method: 'POST', body: JSON.stringify(data) }),
  updatePatient: (id, data) => apiFetch(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Sessions
  createSession: (data) => apiFetch('/sessions', { method: 'POST', body: JSON.stringify(data) }),
  getSessions: (params = {}) => apiFetch('/sessions?' + new URLSearchParams(params)),
  getSession: (id) => apiFetch(`/sessions/${id}`),
  labelSession: (id, data) => apiFetch(`/sessions/${id}/label`, { method: 'PATCH', body: JSON.stringify(data) }),

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
};
