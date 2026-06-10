import { ANOMALY_MAP, STATUS_STYLE, modeLabel } from '../lib/clinical';

/**
 * Бейдж статуса аномалии. Без эмодзи: цветная точка + подпись + счёт + режим.
 * mode показывается текстом ("ML-модель" / "персональная норма"), а не значком.
 */
export default function AnomalyBadge({ anomaly, className = '', showMode = true }) {
  if (!anomaly) return null;
  const { status, anomalyScore, mode } = anomaly;
  const meta = ANOMALY_MAP[status] || { label: status, tone: 'neutral' };
  const s = STATUS_STYLE[meta.tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${s.bg} ${s.text} ${s.border} ${className}`}
    >
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      {meta.label}
      {anomalyScore > 0 && <span className="font-semibold tabular-nums">{anomalyScore}%</span>}
      {showMode && mode && mode !== 'none' && (
        <span className="opacity-60 font-normal hidden sm:inline">· {modeLabel(mode)}</span>
      )}
    </span>
  );
}
