import { useEffect, useState } from 'react';
import { api } from '../api/index.js';

const ROLE_LABEL = { patient: 'Пациент', doctor: 'Врач', admin: 'Администратор' };

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [creatingTest, setCreatingTest] = useState(false);
  const [newCreds, setNewCreds] = useState(null);

  useEffect(() => {
    Promise.all([api.getUsers(), api.getDoctorInvites()])
      .then(([us, inv]) => { setUsers(us); setInvites(inv); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function createInvite() {
    try {
      const inv = await api.createDoctorInvite();
      setInvites((list) => [inv, ...list]);
    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteInvite(id) {
    try {
      await api.deleteDoctorInvite(id);
      setInvites((list) => list.filter((i) => i.id !== id));
    } catch (e) {
      alert(e.message);
    }
  }

  function copyCode(code) {
    navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(''), 1500);
  }

  async function toggleAccess(uid, field, current) {
    try {
      const updated = await api.updateUser(uid, { [field]: !current });
      setUsers((us) => us.map((u) => u.id === uid ? { ...u, [field]: !current } : u));
    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteUser(uid, username) {
    if (!confirm(`Удалить пользователя ${username}?`)) return;
    try {
      await api.deleteUser(uid);
      setUsers((us) => us.filter((u) => u.id !== uid));
    } catch (e) {
      alert(e.message);
    }
  }

  async function createTest() {
    setCreatingTest(true);
    try {
      const res = await api.createTestUser({});
      setNewCreds(res);
      setUsers(await api.getUsers());   // подтянуть новую тест-учётку в список
    } catch (e) {
      alert(e.message);
    } finally {
      setCreatingTest(false);
    }
  }

  async function deleteTest(uid, username) {
    if (!confirm(`Удалить тестового пользователя ${username} и ВСЕ его данные (сессии, очки)?`)) return;
    try {
      await api.deleteTestUser(uid);
      setUsers((us) => us.filter((u) => u.id !== uid));
    } catch (e) {
      alert(e.message);
    }
  }

  const testUsers = users.filter((u) => u.is_test);

  if (loading) return <div className="flex items-center justify-center h-full text-slate-400">Загрузка...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Администрирование</h1>
      {error && <p className="text-red-600 mb-4">{error}</p>}

      {/* Тестовые пользователи — для проверки/игры без влияния на реальных пациентов */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-slate-800">Тестовые пользователи</h2>
            <p className="text-xs text-slate-400">Учётки для проверки и игры. Изолированы от реальных пациентов; удаляются вместе со всеми данными.</p>
          </div>
          <button onClick={createTest} disabled={creatingTest} className="btn-primary text-sm px-3 py-1.5">
            {creatingTest ? 'Создание…' : 'Создать тест-пациента'}
          </button>
        </div>
        {newCreds && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <div className="font-medium text-emerald-800 mb-1">Создан тестовый пациент — сохраните данные входа:</div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-slate-700">
              <span>логин: <b>{newCreds.username}</b></span>
              <span>пароль: <b>{newCreds.password}</b></span>
            </div>
          </div>
        )}
        {testUsers.length === 0 ? (
          <p className="text-sm text-slate-400">Тестовых пользователей нет.</p>
        ) : (
          <ul className="divide-y divide-slate-50">
            {testUsers.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-700">{u.username} <span className="text-slate-400">· {u.email}</span></span>
                <button onClick={() => deleteTest(u.id, u.username)} className="text-red-500 hover:text-red-700 text-xs font-medium">Удалить</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-slate-800">Коды приглашения для врачей</h2>
            <p className="text-xs text-slate-400">Передайте код врачу — он зарегистрируется на странице «Регистрация врача».</p>
          </div>
          <button onClick={createInvite} className="btn-primary text-sm px-3 py-1.5">Создать код</button>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm text-slate-400">Кодов пока нет.</p>
        ) : (
          <ul className="divide-y divide-slate-50">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between py-2 gap-2">
                <code className={`text-sm font-mono ${inv.used ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{inv.code}</code>
                <div className="flex items-center gap-3">
                  {inv.used
                    ? <span className="badge badge-normal">Использован</span>
                    : <span className="badge badge-info">Активен</span>}
                  {!inv.used && (
                    <button onClick={() => copyCode(inv.code)} className="text-blue-600 hover:underline text-xs font-medium">
                      {copied === inv.code ? 'Скопировано' : 'Копировать'}
                    </button>
                  )}
                  <button onClick={() => deleteInvite(inv.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">Удалить</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-4 py-3 font-medium text-slate-500">Пользователь</th>
              <th className="text-left px-4 py-3 font-medium text-slate-500 hidden sm:table-cell">Роль</th>
              <th className="text-center px-3 py-3 font-medium text-slate-500 hidden md:table-cell">Платформа</th>
              <th className="text-center px-3 py-3 font-medium text-slate-500 hidden md:table-cell">БД</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">
                    {u.username}
                    {u.is_test && <span className="badge badge-info ml-2">ТЕСТ</span>}
                  </div>
                  <div className="text-xs text-slate-400">{u.email}</div>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className={`badge ${u.role === 'admin' ? 'badge-critical' : u.role === 'doctor' ? 'badge-info' : 'badge-normal'}`}>
                    {ROLE_LABEL[u.role] || u.role}
                  </span>
                </td>
                <td className="px-3 py-3 text-center hidden md:table-cell">
                  <button
                    onClick={() => toggleAccess(u.id, 'platform_access', u.platform_access)}
                    className={`w-8 h-4 rounded-full transition-colors ${u.platform_access ? 'bg-green-500' : 'bg-slate-300'}`}
                  />
                </td>
                <td className="px-3 py-3 text-center hidden md:table-cell">
                  <button
                    onClick={() => toggleAccess(u.id, 'database_access', u.database_access)}
                    className={`w-8 h-4 rounded-full transition-colors ${u.database_access ? 'bg-green-500' : 'bg-slate-300'}`}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => deleteUser(u.id, u.username)}
                    className="text-red-500 hover:text-red-700 text-xs font-medium"
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
