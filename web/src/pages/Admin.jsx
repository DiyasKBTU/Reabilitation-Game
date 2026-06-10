import { useEffect, useState } from 'react';
import { api } from '../api/index.js';

const ROLE_LABEL = { patient: 'Пациент', doctor: 'Врач', admin: 'Администратор' };

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div className="flex items-center justify-center h-full text-slate-400">Загрузка...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Администрирование</h1>
      {error && <p className="text-red-600 mb-4">{error}</p>}

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
                  <div className="font-medium text-slate-800">{u.username}</div>
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
