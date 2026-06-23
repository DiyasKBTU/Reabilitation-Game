import { useBleStore, bleService } from '../stores/bleStore';
import { BluetoothIcon, TargetIcon, CheckCircleIcon } from '../components/icons';

/** Горизонтальный индикатор оси: центр = нейтраль, маркер = текущий угол.
 *  Помогает проверить симметрию руля после калибровки («налево/направо одинаково»). */
function AxisBar({ label, value, range, leftHint, rightHint }) {
  const norm = Math.max(-1, Math.min(1, (value ?? 0) / range)); // -1..1
  const pct = 50 + norm * 50;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
        <span>{leftHint}</span>
        <span className="font-medium text-slate-700">{label}: {(value ?? 0).toFixed(1)}°</span>
        <span>{rightHint}</span>
      </div>
      <div className="relative h-3 rounded-full bg-slate-100">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-300" />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-blue-600 shadow transition-[left] duration-75"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Тумблер настройки (вкл/выкл) с подписью и пояснением. */
function Toggle({ label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-slate-300"
    >
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>}
      </span>
      <span className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export default function DeviceSetup() {
  const { connected, status, lastReading, disconnect, calibrate,
          invert, hasNeutral, fixNeutral, clearNeutral, setInvert } = useBleStore();
  const r = lastReading?.smooth;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Устройство</h1>
      <p className="text-slate-500 text-sm mb-6">Подключение и калибровка датчика движения (ESP32 + IMU)</p>

      {/* Статус подключения */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`flex items-center justify-center w-10 h-10 rounded-xl ${connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
              <BluetoothIcon size={20} />
            </span>
            <div>
              <div className="font-semibold text-slate-800">
                {connected ? 'Датчик подключён' : 'Датчик не подключён'}
              </div>
              <div className="text-xs text-slate-400">{status}</div>
            </div>
          </div>
          {!connected ? (
            <div className="flex gap-2">
              <button onClick={() => bleService.connect()} className="btn-primary text-sm">
                <BluetoothIcon size={15} /> Подключить
              </button>
              <button onClick={() => bleService.connect({ acceptAll: true })} className="btn-secondary text-sm"
                title="Показать все BLE-устройства, если ESP32 не виден">Все</button>
            </div>
          ) : (
            <button onClick={disconnect} className="btn-secondary text-sm">Отключить</button>
          )}
        </div>

        {!connected && (
          <p className="mt-4 text-sm text-slate-500 bg-slate-50 rounded-lg p-3">
            Без датчика игры работают на клавиатуре (стрелки <b>← →</b> — руль, <b>↑ ↓</b> — газ/тормоз).
            Для управления кистью включите ESP32 и нажмите «Подключить» (нужен браузер с Web Bluetooth — Chrome/Edge).
          </p>
        )}
      </div>

      {/* Живые показания + калибровка */}
      {connected && (
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Ориентация кисти</h3>
            <button onClick={calibrate} className="btn-secondary text-sm">
              <TargetIcon size={15} /> Калибровать (обнулить)
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[['Крен (roll)', r?.roll], ['Тангаж (pitch)', r?.pitch], ['Рыскание (yaw)', r?.yaw]].map(([k, v]) => (
              <div key={k} className="bg-slate-50 rounded-xl p-3 text-center">
                <div className="text-xs text-slate-400">{k}</div>
                <div className="text-xl font-mono font-bold text-slate-800 tabular-nums">{(v ?? 0).toFixed(1)}°</div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <AxisBar label="Руль" value={r?.roll} range={45} leftHint="◀ влево" rightHint="вправо ▶" />
            <AxisBar label="Газ/тормоз" value={r?.pitch} range={30} leftHint="тормоз" rightHint="газ" />
          </div>

          <div className="mt-5 flex items-start gap-2 text-sm text-slate-600 bg-blue-50 rounded-lg p-3">
            <CheckCircleIcon size={16} className="text-blue-500 mt-0.5 shrink-0" />
            <span>
              Держите кисть в нейтральном (ровном) положении и нажмите <b>«Калибровать»</b> — это
              обнулит текущую позу. Если поворот в одну сторону кажется слабее — почти всегда сбита
              нейтраль: откалибруйтесь и проверьте по индикатору «Руль», что маркер симметрично уходит
              влево и вправо до краёв.
            </span>
          </div>
        </div>
      )}

      {/* Направление и нейтраль по умолчанию (сохраняются в браузере) */}
      <div className="card p-5">
        <h3 className="font-semibold text-slate-800 mb-1">Направление и нейтраль</h3>
        <p className="text-xs text-slate-500 mb-4">
          Настройки сохраняются в браузере и применяются автоматически на старте каждой игры.
        </p>

        <div className="space-y-3">
          <Toggle
            label="Инвертировать руль (крен)"
            hint="Включите, если при наклоне кисти вправо объект едет влево."
            checked={!!invert?.roll}
            onChange={(v) => setInvert('roll', v)}
          />
          <Toggle
            label="Инвертировать газ/тормоз (тангаж)"
            hint="Включите, если наклон вперёд тормозит, а назад — разгоняет (City Driver)."
            checked={!!invert?.pitch}
            onChange={(v) => setInvert('pitch', v)}
          />
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-800">Нейтраль по умолчанию</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {hasNeutral
                  ? 'Сохранена. Поза восстанавливается на старте каждой игры.'
                  : 'Не задана. Поставьте кисть удобно и зафиксируйте — это станет нулём.'}
              </div>
            </div>
            {hasNeutral && (
              <button onClick={clearNeutral} className="btn-secondary text-sm whitespace-nowrap">Сбросить</button>
            )}
          </div>
          <button
            onClick={fixNeutral}
            disabled={!connected}
            className="btn-primary text-sm mt-3 w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            title={connected ? '' : 'Сначала подключите датчик'}
          >
            <CheckCircleIcon size={15} /> {hasNeutral ? 'Зафиксировать заново' : 'Зафиксировать текущее положение'}
          </button>
          {!connected && (
            <p className="text-xs text-slate-400 mt-2 text-center">Доступно после подключения датчика.</p>
          )}
        </div>
      </div>
    </div>
  );
}
