/**
 * Клинические нормы и форматирование признаков движения.
 *
 * Пороги синхронизированы с api/app/ml/recommendations.py (объект T), чтобы
 * цветовая разметка дашборда совпадала с логикой движка рекомендаций.
 * Это не диагноз — ориентиры для интерпретации врачом.
 */

// higherBetter=true  → больше = лучше (ROM, скорость, плавность, повторы, время)
// higherBetter=false → меньше = лучше (тремор, паузы)
export const NORMS = {
  rom: {
    key: 'rom', label: 'Амплитуда (ROM)', unit: '°', icon: 'ruler',
    higherBetter: true, good: 30, warn: 15, decimals: 0,
    hint: 'Диапазон движения сустава. Снижение — возможна боль/щажение.',
  },
  peakVelocity: {
    key: 'peakVelocity', label: 'Пиковая скорость', unit: '°/с', icon: 'gauge',
    higherBetter: true, good: 40, warn: 20, decimals: 0,
    hint: 'Максимальная угловая скорость. Замедление — возможна усталость.',
  },
  smoothnessIndex: {
    key: 'smoothnessIndex', label: 'Плавность', unit: '%', icon: 'activity',
    higherBetter: true, good: 0.7, warn: 0.4, pct: true, decimals: 0,
    hint: 'Гладкость траектории (1 = плавно). Рывковость — боль/нарушение координации.',
  },
  tremorIndex: {
    key: 'tremorIndex', label: 'Тремор', unit: '%', icon: 'waves',
    higherBetter: false, good: 0.4, warn: 0.65, pct: true, decimals: 0,
    hint: 'Частота дрожания (по сменам направления). Рост — усталость/неврология.',
  },
  tremorPower: {
    key: 'tremorPower', label: 'Дрожь (спектр)', unit: '%', icon: 'waves',
    higherBetter: false, good: 0.01, warn: 0.03, pct: true, decimals: 0,
    hint: 'Доля мощности движения в полосе дрожи 3–12 Гц (частотный анализ, FFT). Рост — тремор/неврология.',
  },
  pauseRatio: {
    key: 'pauseRatio', label: 'Паузы', unit: '%', icon: 'pause',
    higherBetter: false, good: 0.3, warn: 0.5, pct: true, decimals: 0,
    hint: 'Доля времени без движения. Много пауз — усталость.',
  },
  repetitions: {
    key: 'repetitions', label: 'Повторений', unit: '', icon: 'repeat',
    higherBetter: true, good: 15, warn: 8, decimals: 0,
    hint: 'Число повторов движения за сессию.',
  },
  activeTimeSec: {
    key: 'activeTimeSec', label: 'Активное время', unit: 'с', icon: 'timer',
    higherBetter: true, good: 40, warn: 20, decimals: 0,
    hint: 'Длительность активной фазы. Малое время — низкая выносливость.',
  },
};

// Признаки, требующие сырого временного ряда IMU — НЕ вычислимы из агрегатов Firebase.
// Зеркало api/app/ingest/firebase.py:SERIES_DEPENDENT. На частичных сессиях (features.partial)
// их значение = 0 означает «не измерено», а не реальный ноль → показывать «—», а не как метрику.
export const SERIES_DEPENDENT = new Set([
  'peakVelocity', 'meanAbsVelocity', 'meanJerk', 'smoothnessIndex',
  'tremorIndex', 'tremorFreqHz', 'tremorPower',
  'symmetryIndex', 'pauseRatio', 'repetitions', 'activeTimeSec',
]);

/** Измерен ли признак в этой сессии. На частичных данных (partial) серийные признаки не измерены. */
export function isMeasured(metricKey, features) {
  if (!features) return false;
  if (features.partial && SERIES_DEPENDENT.has(metricKey)) return false;
  return true;
}

/** Значение признака с учётом измеримости: null, если на частичных данных признак не измерен. */
export function measuredValue(metricKey, features) {
  if (!isMeasured(metricKey, features)) return null;
  const v = features[metricKey];
  return v == null || Number.isNaN(v) ? null : v;
}

/** Статус значения относительно нормы: 'good' | 'warn' | 'bad'. */
export function statusOf(key, value) {
  const n = NORMS[key];
  if (!n || value == null || Number.isNaN(value)) return 'neutral';
  if (n.higherBetter) {
    if (value >= n.good) return 'good';
    if (value >= n.warn) return 'warn';
    return 'bad';
  }
  if (value <= n.good) return 'good';
  if (value <= n.warn) return 'warn';
  return 'bad';
}

/** Tailwind-классы для статуса (текст/фон/граница/точка). */
export const STATUS_STYLE = {
  good:    { text: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  warn:    { text: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200',   dot: 'bg-amber-500',   bar: 'bg-amber-500' },
  bad:     { text: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200',     dot: 'bg-red-500',     bar: 'bg-red-500' },
  neutral: { text: 'text-slate-600',   bg: 'bg-slate-50',    border: 'border-slate-200',   dot: 'bg-slate-300',   bar: 'bg-slate-400' },
};

export function styleFor(key, value) {
  return STATUS_STYLE[statusOf(key, value)] || STATUS_STYLE.neutral;
}

/** Человекочитаемое значение признака с учётом %/единиц. */
export function fmtMetric(key, value) {
  const n = NORMS[key];
  if (value == null || Number.isNaN(value)) return '—';
  if (!n) return String(value);
  const v = n.pct ? value * 100 : value;
  return v.toFixed(n.decimals ?? 0);
}

/** Подпись «целевого» коридора нормы для оси/подписи графика. */
export function normLabel(key) {
  const n = NORMS[key];
  if (!n) return '';
  const g = n.pct ? `${Math.round(n.good * 100)}%` : `${n.good}${n.unit}`;
  return n.higherBetter ? `норма ≥ ${g}` : `норма ≤ ${g}`;
}

/** Значение «хорошего» порога в единицах отображения (для reference-линии). */
export function goodThreshold(key) {
  const n = NORMS[key];
  if (!n) return null;
  return n.pct ? n.good * 100 : n.good;
}

/** Среднее по числовому массиву (null-safe). */
export function avg(arr) {
  const xs = arr.filter((x) => typeof x === 'number' && !Number.isNaN(x));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Карта статуса аномалии → подпись/стиль (без эмодзи). */
export const ANOMALY_MAP = {
  normal:                 { label: 'Норма',          tone: 'good' },
  attention:              { label: 'Внимание',       tone: 'warn' },
  critical:               { label: 'Критично',       tone: 'bad' },
  insufficient_baseline:  { label: 'Мало данных',    tone: 'neutral' },
  no_data:                { label: 'Нет данных',     tone: 'neutral' },
};

export function modeLabel(mode) {
  if (mode === 'ml') return 'ML-модель';
  if (mode === 'rule') return 'персональная норма';
  return '';
}
