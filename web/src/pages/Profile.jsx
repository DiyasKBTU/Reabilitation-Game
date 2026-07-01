import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import useAuthStore from '../stores/authStore';
import useBleStore from '../stores/bleStore';
import {
  UserIcon, StethoscopeIcon, SettingsIcon, CheckCircleIcon, BluetoothIcon,
} from '../components/icons';

const ROLE_LABEL = { patient: 'Пациент', doctor: 'Врач', admin: 'Администратор' };
const ROLE_ICON = { patient: UserIcon, doctor: StethoscopeIcon, admin: SettingsIcon };
const DIAGNOSES = [
  'ДЦП, спастическая диплегия',
  'ДЦП, спастический гемипарез',
  'ДЦП, дискинетическая (гиперкинетическая) форма',
  'ДЦП, атаксическая форма',
  'ДЦП, смешанная форма',
  'Другое',
];

export default function Profile() {
  const { user, login, token } = useAuthStore();
  const { connected, status, connect, calibrate } = useBleStore();
  const isPatient = user?.role === 'patient';
  const RoleIcon = ROLE_ICON[user?.role] || UserIcon;

  const [email, setEmail] = useState(user?.email || '');
  const [card, setCard] = useState({ full_name: '', diagnosis: '', age: '', gender: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Подтягиваем медкарту пациента (отдельная коллекция patients): имя, диагноз, возраст, пол.
  useEffect(() => {
    api.getProfile().then((p) => {
      setEmail(p.email || '');
      if (p.patient) {
        setCard({
          full_name: p.patient.full_name || '',
          diagnosis: p.patient.diagnosis || '',
          age: p.patient.age ?? '',
          gender: p.patient.gender || '',
        });
      }
    }).catch(() => {});
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { email };
      if (isPatient) {
        payload.full_name = card.full_name || undefined;
        payload.diagnosis = card.diagnosis || undefined;
        payload.age = card.age ? parseInt(card.age) : undefined;
        payload.gender = card.gender || undefined;
      }
      const updated = await api.updateProfile(payload);
      login(token, { ...user, email: updated.email });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* транзиентная ошибка — кнопка вернётся в исходное */ }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Профиль</h1>

      <div className="card p-6 mb-4">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <RoleIcon size={24} />
          </div>
          <div>
            <div className="font-bold text-slate-800 text-lg">{card.full_name || user?.username}</div>
            <span className="badge-info">{ROLE_LABEL[user?.role] || user?.role}</span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          {isPatient && (
            <>
              <div>
                <label className="label">Имя пациента</label>
                <input className="input" value={card.full_name}
                  onChange={(e) => setCard({ ...card, full_name: e.target.value })}
                  placeholder="Имя и фамилия" />
              </div>
              <div>
                <label className="label">Диагноз</label>
                <input className="input" list="dx-list" value={card.diagnosis}
                  onChange={(e) => setCard({ ...card, diagnosis: e.target.value })}
                  placeholder="Не указан / уточнит врач" />
                <datalist id="dx-list">
                  {DIAGNOSES.map((d) => <option key={d} value={d} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Возраст</label>
                  <input type="number" min="1" max="120" className="input" value={card.age}
                    onChange={(e) => setCard({ ...card, age: e.target.value })} placeholder="—" />
                </div>
                <div>
                  <label className="label">Пол</label>
                  <select className="input" value={card.gender}
                    onChange={(e) => setCard({ ...card, gender: e.target.value })}>
                    <option value="">—</option>
                    <option value="М">Мужской</option>
                    <option value="Ж">Женский</option>
                  </select>
                </div>
              </div>
            </>
          )}
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saved ? <><CheckCircleIcon size={16} /> Сохранено</> : saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </div>

      {/* BLE / устройство */}
      <div className="card p-6">
        <h3 className="font-semibold text-slate-700 mb-3">Устройство BLE (IMU)</h3>
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <span className="text-sm text-slate-600">{status}</span>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          ESP32-C3 + IMU. Управление кистью — ось крена (roll). Без датчика — стрелки на клавиатуре.
        </p>
        <div className="flex gap-2">
          {!connected
            ? <button onClick={connect} className="btn-primary"><BluetoothIcon size={15} /> Подключить BLE</button>
            : <button onClick={calibrate} className="btn-secondary">Обнулить позу</button>}
        </div>
      </div>
    </div>
  );
}
