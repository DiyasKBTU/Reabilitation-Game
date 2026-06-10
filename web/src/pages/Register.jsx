import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import useAuthStore from '../stores/authStore';

export default function Register() {
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'patient' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.register(form);
      login(res.access_token, res.user);
      navigate('/game');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-8">
      <h2 className="text-xl font-bold text-slate-800 mb-6 text-center">Регистрация</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Логин</label>
          <input className="input" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div>
          <label className="label">Пароль</label>
          <input type="password" className="input" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </div>
        <div>
          <label className="label">Роль</label>
          <select className="input" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="patient">Пациент</option>
            <option value="doctor">Врач</option>
          </select>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
          {loading ? 'Регистрация...' : 'Зарегистрироваться'}
        </button>
      </form>
      <p className="text-center text-sm text-slate-500 mt-4">
        Уже есть аккаунт?{' '}
        <Link to="/login" className="text-blue-600 hover:underline font-medium">Войти</Link>
      </p>
    </div>
  );
}
