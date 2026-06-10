import { useBleStore, bleService } from '../stores/bleStore';

export default function BlePanel({ className = '' }) {
  const { connected, status, lastReading, disconnect, calibrate } = useBleStore();

  const r = lastReading?.smooth;

  return (
    <div className={`card p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-slate-300'}`} />
          <span className="text-xs font-medium text-slate-700">BLE</span>
        </div>
        <span className="text-xs text-slate-400">{status}</span>
      </div>

      {r && (
        <div className="grid grid-cols-3 gap-1 mb-2 text-center">
          {[['R', r.roll], ['P', r.pitch], ['Y', r.yaw]].map(([k, v]) => (
            <div key={k} className="bg-slate-50 rounded p-1">
              <div className="text-xs text-slate-400">{k}</div>
              <div className="text-sm font-mono font-bold text-slate-700">{(v ?? 0).toFixed(1)}°</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1">
        {!connected ? (
          <>
            <button onClick={() => bleService.connect()} className="btn-primary flex-1 text-xs py-1">Подключить</button>
            <button
              onClick={() => bleService.connect({ acceptAll: true })}
              className="btn-secondary text-xs py-1 px-2"
              title="Показать все BLE-устройства (если ESP32 не виден в списке)"
            >Все</button>
          </>
        ) : (
          <>
            <button onClick={calibrate} className="btn-secondary flex-1 text-xs py-1">Калибр.</button>
            <button onClick={disconnect} className="btn-secondary flex-1 text-xs py-1">Откл.</button>
          </>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-1 text-center">← → стрелки = управление без устройства</p>
    </div>
  );
}
