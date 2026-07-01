import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import { PlusIcon, SearchIcon, UsersIcon, ChevronRightIcon, AlertTriangleIcon } from '../components/icons';

function NewPatientModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    full_name: '', diagnosis: '', age: '', gender: '',
    create_login: false, iin: '', pin: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);   // {iin, pin} — креды входа после создания

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.create_login && !/^\d{12}$/.test(form.iin)) {
      setError('Для входа нужен ИИН из 12 цифр');
      return;
    }
    setLoading(true);
    try {
      const patient = await api.createPatient({
        full_name: form.full_name,
        diagnosis: form.diagnosis || undefined,
        age: form.age ? parseInt(form.age) : undefined,
        gender: form.gender || undefined,
        iin: form.iin || undefined,
        create_login: form.create_login,
        pin: form.pin || undefined,
      });
      onCreated(patient);                          // добавить в список (модалку не закрываем сами)
      if (patient.pin) setCreated({ iin: patient.iin, pin: patient.pin });  // показать креды
      else onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Экран с выданными данными входа (показываются один раз — передать родителю).
  if (created) {
    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-slate-800 mb-1">Пациент создан</h2>
          <p className="text-sm text-slate-500 mb-4">Данные для входа — передайте родителю. ПИН показывается один раз.</p>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-1 font-mono text-slate-800">
            <div>ИИН (логин): <b>{created.iin}</b></div>
            <div>ПИН (пароль): <b>{created.pin}</b></div>
          </div>
          <button onClick={onClose} className="btn-primary w-full mt-5">Готово</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">Новый пациент</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Полное имя *</label>
            <input className="input" value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required autoFocus />
          </div>
          <div>
            <label className="label">Диагноз</label>
            <input className="input" value={form.diagnosis}
              onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
              placeholder="Необязательно" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Возраст</label>
              <input type="number" className="input" value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
                min="1" max="120" placeholder="—" />
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

          {/* Вход для пациента: ИИН (логин) + ПИН (авто, можно задать свой) */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.create_login}
                onChange={(e) => setForm({ ...form, create_login: e.target.checked })} />
              Создать вход (ребёнок играет сам)
            </label>
            {form.create_login && (
              <div className="mt-3 space-y-2">
                <div>
                  <label className="label">ИИН ребёнка (логин)</label>
                  <input className="input" value={form.iin} inputMode="numeric" maxLength={12}
                    onChange={(e) => setForm({ ...form, iin: e.target.value.replace(/\D/g, '') })}
                    placeholder="12 цифр" />
                </div>
                <div>
                  <label className="label">ПИН <span className="font-normal text-slate-400">(пусто — сгенерируем)</span></label>
                  <input className="input" value={form.pin}
                    onChange={(e) => setForm({ ...form, pin: e.target.value })}
                    placeholder="Авто" />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PatientList() {
  const [patients, setPatients] = useState([]);
  const [unattached, setUnattached] = useState([]);   // самостоятельно зарегистрированные, без врача
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [attaching, setAttaching] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setError(false);
    api.getPatients()
      .then(setPatients)
      .catch(() => setError(true))  // ошибка сети не маскируется под пустой список
      .finally(() => setLoading(false));
    // Неприкреплённые пациенты — отдельно; их отсутствие/ошибка не ломает основной список.
    api.getUnattachedPatients().then(setUnattached).catch(() => setUnattached([]));
  }, [reloadKey]);

  async function handleAttach(p) {
    setAttaching(p.id);
    try {
      const attached = await api.attachPatient(p.id);
      setUnattached((prev) => prev.filter((x) => x.id !== p.id));
      setPatients((prev) => [attached, ...prev]);
    } catch (_) {
      // прикрепление не удалось (напр. пациента уже забрал другой врач) — обновим списки
      setReloadKey((k) => k + 1);
    } finally {
      setAttaching('');
    }
  }

  const filtered = patients.filter((p) =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.diagnosis || '').toLowerCase().includes(search.toLowerCase())
  );

  function handleCreated(patient) {
    setPatients((prev) => [patient, ...prev]);
    // модалку НЕ закрываем здесь: если создан вход — она сама покажет ИИН/ПИН, затем onClose.
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {showModal && <NewPatientModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Пациенты</h1>
          {!loading && !error && <p className="text-sm text-slate-500 mt-0.5">{patients.length} в наблюдении</p>}
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <PlusIcon size={16} /> Добавить
        </button>
      </div>

      <div className="relative mb-4">
        <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Поиск по имени или диагнозу..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Неприкреплённые пациенты — самостоятельно зарегистрировались, ждут прикрепления к врачу. */}
      {unattached.length > 0 && (
        <div className="card p-4 mb-4 border-blue-200 bg-blue-50/40">
          <div className="flex items-center gap-2 mb-3">
            <UsersIcon size={16} className="text-blue-500" />
            <h3 className="font-semibold text-slate-800">Неприкреплённые пациенты</h3>
            <span className="text-xs text-slate-500">зарегистрировались сами — прикрепите к себе</span>
          </div>
          <div className="space-y-2">
            {unattached.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-white border border-slate-200 px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium text-slate-800">{p.full_name}</span>
                  {p.diagnosis && <span className="text-slate-400"> · {p.diagnosis}</span>}
                </div>
                <button onClick={() => handleAttach(p)} disabled={attaching === p.id}
                  className="btn-primary text-sm py-1.5">
                  {attaching === p.id ? 'Прикрепление…' : 'Прикрепить'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-slate-400 text-center py-12">Загрузка...</div>
      ) : error ? (
        <div className="card text-center py-14">
          <AlertTriangleIcon size={36} className="mx-auto mb-3 text-amber-400" />
          <div className="text-slate-600 font-medium">Не удалось загрузить список пациентов</div>
          <div className="text-sm text-slate-400 mt-1">Проверьте соединение и попробуйте ещё раз.</div>
          <button onClick={() => setReloadKey((k) => k + 1)} className="btn-primary text-sm mt-4">Повторить</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-14">
          <UsersIcon size={36} className="mx-auto mb-3 text-slate-300" />
          <div className="text-slate-500">{search ? 'Пациентов не найдено' : 'Добавьте первого пациента'}</div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Имя</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Диагноз</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Возраст</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/doctor/patient/${p.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {p.full_name}
                    {p.is_test && <span className="badge badge-info ml-2">ТЕСТ</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                    {p.diagnosis || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                    {p.age || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRightIcon size={16} className="inline text-slate-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
