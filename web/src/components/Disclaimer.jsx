import { AlertTriangleIcon } from './icons';

/**
 * Видимый дисклеймер «не медицинское изделие / не диагноз».
 * Показывается на дашборде врача и на экране результата пациента.
 * Закрывает требование по этике: аналитика носит вспомогательный характер.
 */
export default function Disclaimer({ className = '' }) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 ${className}`}
    >
      <AlertTriangleIcon size={15} className="mt-0.5 shrink-0 text-amber-500" />
      <span>
        Аналитика носит <b>вспомогательный</b> характер и не является медицинским заключением
        или диагнозом. Она не заменяет очный осмотр врача. Решения о лечении и нагрузке принимает
        специалист.
      </span>
    </div>
  );
}
