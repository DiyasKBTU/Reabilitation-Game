import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import useAuthStore from '../stores/authStore';

// Демо-учётки (совпадают с api/app/demo/seed.py). Показываются только при demo_mode.
const DEMO = {
  doctor:  { username: 'demo_doctor',  password: 'demo1234' },
  patient: { username: 'demo_patient', password: 'demo1234' },
};

// Куда вести после входа в зависимости от роли.
function routeFor(user) {
  if (user?.role === 'admin') return '/admin';
  if (user?.role === 'doctor') return '/doctor';
  return '/game';
}

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [demoBusy, setDemoBusy] = useState('');
  const { login } = useAuthStore();
  const navigate = useNavigate();

  // Узнаём у бэкенда, включён ли демо-режим → показывать ли кнопки быстрого входа.
  useEffect(() => {
    api.getHealth().then((h) => setDemoMode(!!h.demo_mode)).catch(() => {});
  }, []);

  async function doLogin(credentials) {
    const res = await api.login(credentials);
    login(res.access_token, res.user);
    navigate(routeFor(res.user));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await doLogin(form);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDemo(role) {
    setError('');
    setDemoBusy(role);
    try {
      await doLogin(DEMO[role]);
    } catch (e) {
      setError(e.message);
    } finally {
      setDemoBusy('');
    }
  }

  return (
    <div className="card p-8">
      <h2 className="text-xl font-bold text-slate-800 mb-6 text-center">Вход</h2>

      {demoMode && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
          <div className="text-sm font-semibold text-blue-800 mb-1">Быстрый вход (тест)</div>
          <p className="text-xs text-slate-500 mb-3">
            Вход в один клик по тестовым учёткам — данные и ML-аналитика уже заполнены.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => handleDemo('doctor')} disabled={!!demoBusy}
              className="btn-primary py-2 text-sm">
              {demoBusy === 'doctor' ? 'Вход...' : 'Войти как врач'}
            </button>
            <button type="button" onClick={() => handleDemo('patient')} disabled={!!demoBusy}
              className="btn-secondary py-2 text-sm">
              {demoBusy === 'patient' ? 'Вход...' : 'Войти как пациент'}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">ИИН или логин</label>
          <input
            className="input"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="Пациент — ИИН (12 цифр)"
            required autoFocus autoComplete="username"
          />
        </div>
        <div>
          <label className="label">Пароль</label>
          <input
            type="password"
            className="input"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required autoComplete="current-password"
          />
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
          {loading ? 'Вход...' : 'Войти'}
        </button>
      </form>
      <p className="text-center text-sm text-slate-500 mt-4">
        Нет аккаунта?{' '}
        <Link to="/register" className="text-blue-600 hover:underline font-medium">Зарегистрироваться</Link>
      </p>
    </div>
  );
}
