import { Link } from 'react-router-dom';
import { useBleStore } from '../stores/bleStore';
import { PlayIcon, BluetoothIcon, ArrowLeftIcon, CheckCircleIcon } from './icons';

/**
 * Pre-game экран «Готовы?» — показывается ДО старта геймплея (движок уже построил
 * сцену, но не запущен). Даёт игроку подготовиться: проверить датчик, прочитать
 * управление, при необходимости откалиброваться. Старт — только по кнопке.
 */
export default function GameIntro({ title, icon: Icon, color, desc, controls = [], onStart, onBack }) {
  const connected = useBleStore((s) => s.connected);
  const calibrate = useBleStore((s) => s.calibrate);
  const applyNeutralOrZero = useBleStore((s) => s.applyNeutralOrZero);

  // Перед стартом применяем ОСОЗНАННО зафиксированную нейтраль, если она есть; иначе —
  // абсолютная ориентация датчика (без авто-захвата текущей позы). Датчик не закреплён жёстко,
  // поэтому случайный наклон на старте не должен становиться нулём.
  function handleStart() {
    if (connected) applyNeutralOrZero();
    onStart();
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/85 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className={`bg-gradient-to-br ${color} h-24 flex items-center justify-center`}>
          {Icon && <Icon size={40} className="text-white" />}
        </div>

        <div className="p-6">
          <h2 className="text-xl font-bold text-slate-800">{title}</h2>
          {desc && <p className="text-sm text-slate-500 mt-1 leading-relaxed">{desc}</p>}

          {/* Управление */}
          {controls.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Управление</div>
              {controls.map((c) => (
                <div key={c.label} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{c.label}</span>
                  <span className="font-medium text-slate-800">{c.keys}</span>
                </div>
              ))}
            </div>
          )}

          {/* Датчик */}
          <div className={`mt-3 flex items-center justify-between rounded-xl border p-3 ${connected ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={connected ? 'text-emerald-700 font-medium' : 'text-slate-600'}>
                {connected ? 'Датчик подключён' : 'Датчик не подключён — игра на стрелках ← →'}
              </span>
            </div>
            {connected
              ? <button onClick={calibrate} className="text-xs text-emerald-700 hover:underline whitespace-nowrap">Калибровать</button>
              : <Link to="/device" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline whitespace-nowrap"><BluetoothIcon size={13} /> Подключить</Link>}
          </div>

          <div className="mt-5 flex gap-3">
            <button onClick={onBack} className="btn-secondary">
              <ArrowLeftIcon size={16} /> Назад
            </button>
            <button onClick={handleStart} className="btn-primary flex-1 justify-center">
              <PlayIcon size={16} /> Начать
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
