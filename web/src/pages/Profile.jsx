import { useState } from 'react';
import { api } from '../api/index.js';
import useAuthStore from '../stores/authStore';
import useBleStore from '../stores/bleStore';

const ROLE_LABEL = { patient: 'Пациент', doctor: 'Врач', admin: 'Администратор' };

export default function Profile() {
  const { user, login, token } = useAuthStore();
  const { connected, status, connect, calibrate } = useBleStore();
  const [email, setEmail] = useState(user?.email || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateProfile({ email });
      login(token, { ...user, email: updated.email });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Профиль</h1>

      <div className="card p-6 mb-4">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-2xl">
            {user?.role === 'doctor' ? '🩺' : user?.role === 'admin' ? '⚙️' : '👤'}
          </div>
          <div>
            <div className="font-bold text-slate-800 text-lg">{user?.username}</div>
            <span className="badge-info">{ROLE_LABEL[user?.role] || user?.role}</span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saved ? '✓ Сохранено' : saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </div>

      {/* BLE section */}
      <div className="card p-6">
        <h3 className="font-semibold text-slate-700 mb-3">Устройство BLE (IMU)</h3>
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-slate-300'}`} />
          <span className="text-sm text-slate-600">{status}</span>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          ESP32-C3 + IMU. Управление кисти — roll оси. Клавиши ← → — клавиатурный режим.
        </p>
        <div className="flex gap-2">
          {!connected
            ? <button onClick={connect} className="btn-primary">Подключить BLE</button>
            : <>
                <button onClick={calibrate} className="btn-secondary">Калибровать</button>
              </>
          }
        </div>
      </div>
    </div>
  );
}
