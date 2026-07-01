import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import useAuthStore from '../stores/authStore';

export default function RegisterDoctor() {
  // Регистрация врача — только по коду-приглашению от администратора/центра (B2B).
  const [form, setForm] = useState({ username: '', email: '', password: '', invite_code: '', consent: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.registerDoctor(form);
      login(res.access_token, res.user);
      navigate('/doctor/patients');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-8">
      <h2 className="text-xl font-bold text-slate-800 mb-6 text-center">Регистрация врача</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Код приглашения</label>
          <input className="input" value={form.invite_code}
            onChange={(e) => setForm({ ...form, invite_code: e.target.value })} required />
        </div>
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
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          Код приглашения выдаёт администратор реабилитационного центра. Без кода
          зарегистрироваться врачом нельзя.
        </p>
        <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={form.consent}
            onChange={(e) => setForm({ ...form, consent: e.target.checked })} required />
          <span>
            Я даю согласие на обработку персональных данных и понимаю, что аналитика носит
            вспомогательный характер и не является медицинским диагнозом.
          </span>
        </label>
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <button type="submit" disabled={loading || !form.consent} className="btn-primary w-full py-2.5">
          {loading ? 'Регистрация...' : 'Зарегистрироваться'}
        </button>
      </form>
      <p className="text-center text-sm text-slate-500 mt-4">
        Регистрируетесь как пациент?{' '}
        <Link to="/register" className="text-blue-600 hover:underline font-medium">Сюда</Link>
      </p>
    </div>
  );
}
