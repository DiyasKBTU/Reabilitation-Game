import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import useAuthStore from '../stores/authStore';

// Формы ДЦП (из docs/RESEARCH_DCP). Пустое значение — «уточнит врач».
const DIAGNOSES = [
  'ДЦП, спастическая диплегия',
  'ДЦП, спастический гемипарез',
  'ДЦП, дискинетическая (гиперкинетическая) форма',
  'ДЦП, атаксическая форма',
  'ДЦП, смешанная форма',
  'Другое',
];

export default function Register() {
  // Публичная регистрация — только пациент. Роль не выбирается (врача добавляет администратор).
  // Медданные (имя, диагноз, возраст, пол) пишутся в карту пациента; можно изменить в профиле.
  const [form, setForm] = useState({
    iin: '', password: '', consent: false,
    full_name: '', diagnosis: '', age: '', gender: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (!/^\d{12}$/.test(form.iin)) {
      setError('ИИН должен состоять из 12 цифр');
      setLoading(false);
      return;
    }
    try {
      const res = await api.register({
        iin: form.iin,
        password: form.password,
        consent: form.consent,
        full_name: form.full_name || undefined,
        diagnosis: form.diagnosis || undefined,
        age: form.age ? parseInt(form.age) : undefined,
        gender: form.gender || undefined,
      });
      login(res.access_token, res.user);
      navigate('/calibrate');   // новый пациент → сразу на калибровку (точка отсчёта)
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
          <label className="label">Имя пациента</label>
          <input className="input" value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="Имя и фамилия ребёнка" />
        </div>
        <div>
          <label className="label">ИИН ребёнка</label>
          <input className="input" value={form.iin} inputMode="numeric" maxLength={12}
            onChange={(e) => setForm({ ...form, iin: e.target.value.replace(/\D/g, '') })}
            placeholder="12 цифр" required autoComplete="username" />
          <p className="text-xs text-slate-400 mt-1">Это и будет логином для входа — его не нужно запоминать отдельно.</p>
        </div>
        <div>
          <label className="label">Пароль (ПИН)</label>
          <input type="password" className="input" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} required
            autoComplete="new-password" />
        </div>

        {/* Медданные карты пациента (необязательны; диагноз можно уточнить с врачом позже) */}
        <div>
          <label className="label">Диагноз <span className="font-normal text-slate-400">(необязательно)</span></label>
          <select className="input" value={form.diagnosis}
            onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}>
            <option value="">Не указан / уточнит врач</option>
            {DIAGNOSES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Возраст</label>
            <input type="number" min="1" max="120" className="input" value={form.age}
              onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="—" />
          </div>
          <div>
            <label className="label">Пол</label>
            <select className="input" value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="">—</option>
              <option value="М">Мужской</option>
              <option value="Ж">Женский</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          Регистрируется пациент. Доступ врача выдаёт администратор; врач сам прикрепит вас
          к себе в системе.
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
        {/* Подсказка, почему кнопка неактивна: без согласия форма не отправляется. */}
        {!form.consent && !loading && (
          <p className="text-xs text-slate-400 text-center">Отметьте согласие выше, чтобы продолжить</p>
        )}
      </form>
      <p className="text-center text-sm text-slate-500 mt-4">
        Уже есть аккаунт?{' '}
        <Link to="/login" className="text-blue-600 hover:underline font-medium">Войти</Link>
      </p>
      <p className="text-center text-sm text-slate-500 mt-1">
        Вы врач с кодом приглашения?{' '}
        <Link to="/register-doctor" className="text-blue-600 hover:underline font-medium">Регистрация врача</Link>
      </p>
    </div>
  );
}
