import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import { PlusIcon, SearchIcon, UsersIcon, ChevronRightIcon, AlertTriangleIcon } from '../components/icons';

function NewPatientModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ full_name: '', diagnosis: '', age: '', gender: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const patient = await api.createPatient({
        full_name: form.full_name,
        diagnosis: form.diagnosis || undefined,
        age: form.age ? parseInt(form.age) : undefined,
        gender: form.gender || undefined,
      });
      onCreated(patient);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setError(false);
    api.getPatients()
      .then(setPatients)
      .catch(() => setError(true))  // ошибка сети не маскируется под пустой список
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const filtered = patients.filter((p) =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.diagnosis || '').toLowerCase().includes(search.toLowerCase())
  );

  function handleCreated(patient) {
    setPatients((prev) => [patient, ...prev]);
    setShowModal(false);
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
                  <td className="px-4 py-3 font-medium text-slate-800">{p.full_name}</td>
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
