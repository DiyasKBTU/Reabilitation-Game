import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import AnomalyBadge from '../components/AnomalyBadge';
import SessionChart from '../components/SessionChart';
import MovementTrace from '../components/MovementTrace';
import Disclaimer from '../components/Disclaimer';
import {
  NORMS, styleFor, statusOf, fmtMetric, avg, STATUS_STYLE, modeLabel, isMeasured, measuredValue,
} from '../lib/clinical';
import {
  ArrowLeftIcon, PrinterIcon, AlertTriangleIcon, TrendingUpIcon, TrendingDownIcon, MinusIcon,
  RulerIcon, GaugeIcon, ActivityIcon, WavesIcon, PauseIcon, RepeatIcon, TimerIcon,
  TargetIcon, BrainIcon, ShieldIcon, CheckCircleIcon, FileTextIcon,
} from '../components/icons';

const ICONS = {
  ruler: RulerIcon, gauge: GaugeIcon, activity: ActivityIcon, waves: WavesIcon,
  pause: PauseIcon, repeat: RepeatIcon, timer: TimerIcon,
};
const KPI_KEYS = ['rom', 'peakVelocity', 'smoothnessIndex', 'tremorIndex', 'tremorPower', 'pauseRatio', 'activeTimeSec'];
// Метрики калибровочного сравнения (старт → сейчас). Совпадают с BASELINE_METRICS бэкенда.
const BASELINE_ORDER = ['rom', 'smoothnessIndex', 'peakVelocity', 'tremorIndex', 'pauseRatio'];
// Вторичная ось управления (multi-axis, напр. газ/тормоз в City Driver) — компактный набор.
const AXIS_KPI_KEYS = ['rom', 'peakVelocity', 'smoothnessIndex', 'tremorIndex'];
const GAMES = [['game1', 'Space Catcher'], ['game2', 'City Driver']];
// Короткие RU-метки классов паттерна движения (для шкал вероятностей). Полные — в pattern.labelRu.
const PATTERN_RU = { normal: 'Норма', spastic: 'Спастика', asymmetric: 'Асимметрия', tremor: 'Тремор' };

const SEV = {
  critical:  { ...STATUS_STYLE.bad,  label: 'Критично' },
  attention: { ...STATUS_STYLE.warn, label: 'Внимание' },
  warning:   { ...STATUS_STYLE.warn, label: 'Внимание' },
  info:      { ...STATUS_STYLE.neutral, label: 'Инфо' },
};
const AREA_ICON = { safety: ShieldIcon, neuro: BrainIcon, asymmetry: TargetIcon };

function Section({ title, aside, children, className = '' }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || aside) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="font-semibold text-slate-800">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function MetricCard({ metricKey, value, baseline, measured = true }) {
  const n = NORMS[metricKey];
  const Icon = ICONS[n.icon] || ActivityIcon;

  // Частичные данные (агрегаты Firebase): признак не измерен — показываем «—», а не ложный 0.
  if (!measured) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 flex flex-col gap-2"
           title="Нет сырого ряда движения: сессия импортирована из агрегатов (Firebase)">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Icon size={15} /> {n.label}
          </span>
          <span className="w-2 h-2 rounded-full bg-slate-200" />
        </div>
        <span className="text-2xl font-bold text-slate-300 tabular-nums">—</span>
        <span className="text-xs text-slate-400">не измерено · нет сырого ряда</span>
      </div>
    );
  }

  const s = styleFor(metricKey, value);
  const display = fmtMetric(metricKey, value);

  let delta = null;
  if (baseline != null && value != null) {
    const dv = (n.pct ? value * 100 : value) - (n.pct ? baseline * 100 : baseline);
    if (Math.abs(dv) >= (n.pct ? 1 : 0.5)) delta = dv;
  }
  const improving = delta != null && (n.higherBetter ? delta > 0 : delta < 0);
  const DeltaIcon = delta == null ? MinusIcon : delta > 0 ? TrendingUpIcon : TrendingDownIcon;

  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} p-4 flex flex-col gap-2`} title={n.hint}>
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
          <Icon size={15} /> {n.label}
        </span>
        <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-800 tabular-nums">{display}</span>
        {n.unit && <span className="text-sm text-slate-400">{n.unit}</span>}
      </div>
      {delta != null ? (
        <span className={`inline-flex items-center gap-1 text-xs ${improving ? 'text-emerald-600' : 'text-red-500'}`}>
          <DeltaIcon size={13} />
          {delta > 0 ? '+' : ''}{n.pct ? delta.toFixed(0) : delta.toFixed(1)}{n.unit} к личной норме
        </span>
      ) : (
        <span className="text-xs text-slate-400">личная норма: {baseline != null ? fmtMetric(metricKey, baseline) + (n.unit || '') : '—'}</span>
      )}
    </div>
  );
}

function ProgressStat({ label, first, last, unit = '', higherBetter = true, pct = false }) {
  if (first == null || last == null) return null;
  const a = pct ? first * 100 : first;
  const b = pct ? last * 100 : last;
  const d = b - a;
  const improving = higherBetter ? d > 0 : d < 0;
  const DeltaIcon = Math.abs(d) < 0.5 ? MinusIcon : d > 0 ? TrendingUpIcon : TrendingDownIcon;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="flex items-center gap-2 text-sm tabular-nums">
        <span className="text-slate-400">{a.toFixed(pct ? 0 : 1)}{unit}</span>
        <span className="text-slate-300">→</span>
        <span className="font-semibold text-slate-800">{b.toFixed(pct ? 0 : 1)}{unit}</span>
        <span className={`inline-flex items-center gap-0.5 text-xs ${Math.abs(d) < 0.5 ? 'text-slate-400' : improving ? 'text-emerald-600' : 'text-red-500'}`}>
          <DeltaIcon size={13} />{d > 0 ? '+' : ''}{d.toFixed(pct ? 0 : 1)}
        </span>
      </div>
    </div>
  );
}

// Калибровочное сравнение «старт → сейчас». Карточка на метрику: значение калибровки →
// текущее, % изменения, цвет/стрелка по `improved` (направление «лучше» считает бэкенд).
function BaselineCompare({ delta }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {BASELINE_ORDER.filter((k) => delta[k]).map((k) => {
        const d = delta[k];
        const n = NORMS[k];
        const flat = Math.abs(d.change) < (n.pct ? 0.005 : 0.05);
        const DeltaIcon = flat ? MinusIcon : d.change > 0 ? TrendingUpIcon : TrendingDownIcon;
        const color = flat ? 'text-slate-400' : d.improved ? 'text-emerald-600' : 'text-red-500';
        return (
          <div key={k} className="rounded-xl border border-slate-200 bg-white p-4" title={n.hint}>
            <div className="text-xs font-medium text-slate-500">{n.label}</div>
            <div className="flex items-baseline gap-1.5 mt-1.5">
              <span className="text-sm text-slate-400 tabular-nums">{fmtMetric(k, d.baseline)}{n.unit}</span>
              <span className="text-slate-300">→</span>
              <span className="text-xl font-bold text-slate-800 tabular-nums">{fmtMetric(k, d.current)}{n.unit}</span>
            </div>
            <div className={`mt-1 inline-flex items-center gap-1 text-xs ${color}`}>
              <DeltaIcon size={13} />
              {flat ? 'без изменений' : `${d.changePct > 0 ? '+' : ''}${d.changePct}% от старта`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PatientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [insights, setInsights] = useState(null);
  const [tab, setTab] = useState(0);
  const [gameType, setGameType] = useState('game1');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [trace, setTrace] = useState(null);   // сырой ряд движения последней пригодной сессии

  useEffect(() => {
    setLoading(true);
    setError(false);
    Promise.all([
      api.getPatient(id),
      api.getSessions({ patient_id: id, game_type: gameType, limit: 30 }),
      api.getInsights(id, gameType),
    ]).then(([p, s, ins]) => {
      setPatient(p);
      setSessions(s);
      setInsights(ins);
    }).catch(() => setError(true))  // транзиентная ошибка не выбрасывает врача со страницы
      .finally(() => setLoading(false));
  }, [id, gameType, reloadKey]);

  // Траектория движения последней аналитически пригодной сессии (сырой ряд IMU).
  useEffect(() => {
    const latest = sessions.find((s) => s.features && s.features.valid);
    if (!latest) { setTrace(null); return; }
    api.getSessionTrace(latest.id).then(setTrace).catch(() => setTrace(null));
  }, [sessions]);

  if (loading) return <div className="flex items-center justify-center h-full text-slate-400">Загрузка...</div>;
  if (error) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
      <AlertTriangleIcon size={32} className="text-amber-500" />
      <div>
        <p className="text-slate-700 font-medium">Не удалось загрузить данные пациента</p>
        <p className="text-sm text-slate-400 mt-1">Проверьте соединение и попробуйте ещё раз.</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/doctor/patients')} className="btn-secondary text-sm">
          <ArrowLeftIcon size={15} /> К пациентам
        </button>
        <button onClick={() => setReloadKey((k) => k + 1)} className="btn-primary text-sm">Повторить</button>
      </div>
    </div>
  );
  if (!patient) return null;

  const f = insights?.features;
  const axisFeatures = insights?.axis_features; // вторичные оси управления (multi-axis игры)
  const anomaly = insights?.anomaly;
  const recs = insights?.recommendations;
  const narr = insights?.narrative;
  const pattern = insights?.pattern;   // паттерн движения (классификатор, синтетика — подсказка)
  // Калибровка: персональная точка старта и прогресс относительно неё (с бэкенда).
  const baseline = insights?.baseline;
  const delta = insights?.delta_vs_baseline;
  const analyzableCount = sessions.filter((s) => s.features && s.features.valid).length;
  const hasBaselineProgress = baseline && delta && Object.keys(delta).length > 0 && analyzableCount > 1;
  const hasData = f && f.valid;
  const partial = !!f?.partial; // частичные данные (агрегаты Firebase): реален только ROM
  const history = sessions.slice(1).map((s) => s.features).filter((x) => x && x.valid);
  const baselineOf = (k) => avg(history.map((h) => measuredValue(k, h)));

  // Прогресс: среднее первых 3 vs последних 3 сессий (хронологически)
  const chrono = [...sessions].reverse();
  const firstFeat = chrono.slice(0, 3).map((s) => s.features).filter((x) => x && x.valid);
  const lastFeat = chrono.slice(-3).map((s) => s.features).filter((x) => x && x.valid);
  const progressReady = sessions.length >= 4 && firstFeat.length && lastFeat.length;
  const pAvg = (set, k) => avg(set.map((x) => measuredValue(k, x)));
  const pScore = (set) => avg(set.map((s) => s.score));

  const plan = recs?.sessionPlan;
  const planLevel = { increase: 'Повысить нагрузку', hold: 'Сохранить уровень', decrease: 'Снизить нагрузку' }[plan?.levelAdvice];
  const reportDate = new Date().toLocaleDateString('ru', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="p-6 max-w-5xl mx-auto print:p-0 print:max-w-none">
      {/* Header / chrome */}
      <div className="flex items-start justify-between mb-5 print:hidden">
        <div>
          <button onClick={() => navigate('/doctor/patients')}
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-700 mb-2">
            <ArrowLeftIcon size={15} /> Пациенты
          </button>
          <h1 className="text-2xl font-bold text-slate-800">{patient.full_name}</h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
            {patient.age && <span>{patient.age} лет</span>}
            {patient.gender && <span>· {patient.gender}</span>}
            {patient.diagnosis && <span>· {patient.diagnosis}</span>}
            <span>· сессий: {insights?.session_count ?? sessions.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {anomaly && <AnomalyBadge anomaly={anomaly} />}
          <button onClick={() => window.print()} className="btn-secondary text-sm">
            <PrinterIcon size={15} /> Печать отчёта
          </button>
        </div>
      </div>

      {/* Print-only report header */}
      <div className="hidden print:flex items-center justify-between mb-6 pb-4 border-b border-slate-300">
        <div className="flex items-center gap-2">
          <FileTextIcon size={22} />
          <div>
            <div className="font-bold text-lg text-slate-900">Отчёт по реабилитации — Axis</div>
            <div className="text-sm text-slate-600">{patient.full_name}
              {patient.diagnosis ? ` · ${patient.diagnosis}` : ''}{patient.age ? ` · ${patient.age} лет` : ''}</div>
          </div>
        </div>
        <div className="text-sm text-slate-500 text-right">
          <div>{reportDate}</div>
          <div>{GAMES.find((g) => g[0] === gameType)?.[1]}</div>
        </div>
      </div>

      {/* Game switch */}
      <div className="flex items-center gap-2 mb-5 print:hidden">
        <span className="text-sm text-slate-500">Игра:</span>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {GAMES.map(([g, label]) => (
            <button key={g} onClick={() => setGameType(g)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${gameType === g ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-5 print:hidden">
        {['Обзор', 'Сессии'].map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
              ${tab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {hasData && <Disclaimer className="mb-5" />}

      {!hasData && (
        <Section>
          <div className="text-center py-10 text-slate-400">
            <ActivityIcon size={32} className="mx-auto mb-3 text-slate-300" />
            <p>Нет данных движения по игре «{GAMES.find((g) => g[0] === gameType)?.[1]}».</p>
            <button
              onClick={() => setGameType(gameType === 'game1' ? 'game2' : 'game1')}
              className="mt-3 text-sm text-blue-600 hover:underline">
              Посмотреть «{GAMES.find((g) => g[0] !== gameType)?.[1]}» →
            </button>
          </div>
        </Section>
      )}

      {/* ──────────── ОБЗОР ──────────── */}
      {hasData && (tab === 0) && (
        <div className="space-y-5">
          {/* Качество/источник данных анализируемой сессии — честный контекст под цифрами */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-slate-600">
              <span className={`w-1.5 h-1.5 rounded-full ${f?.partial ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span className="font-medium text-slate-700">Качество данных:</span>
              {f?.partial
                ? <span className="text-amber-700">частичные (агрегаты устройства) — часть метрик не измерена («—»)</span>
                : <span className="text-emerald-700">полный ряд движения (IMU)</span>}
              <span className="text-slate-300">·</span>
              <span>пригодных сессий: {analyzableCount} из {sessions.length}</span>
              {anomaly?.baselineSize != null && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>
                    норма по {anomaly.baselineSize} сесс.
                    {anomaly.baselineSize < 3 && <span className="text-amber-700"> (мало — вердикт предварительный)</span>}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Clinical narrative (LLM-explainer / авто-сводка) */}
          {narr?.text && (
            <Section
              title="Клиническое заключение"
              aside={
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <BrainIcon size={13} />
                  {narr.source === 'llm' ? `ИИ · ${narr.provider}` : 'авто-сводка'}
                </span>
              }
            >
              <p className="text-sm text-slate-700 leading-relaxed">{narr.text}</p>
            </Section>
          )}

          {/* Паттерн движения (классификатор, синтетика — подсказка, не диагноз) */}
          {pattern && (
            <Section
              title="Паттерн движения"
              aside={
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <BrainIcon size={13} /> подсказка, не диагноз
                </span>
              }
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-semibold text-slate-800">{pattern.labelRu}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${pattern.lowConfidence ? 'bg-slate-100 text-slate-500' : 'bg-violet-100 text-violet-700'}`}>
                  уверенность {Math.round((pattern.confidence ?? 0) * 100)}%{pattern.lowConfidence ? ' · низкая' : ''}
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {Object.entries(pattern.probs || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([cls, p]) => (
                    <div key={cls} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-xs text-slate-500">{PATTERN_RU[cls] || cls}</span>
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.round(p * 100)}%` }} />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums text-slate-500">{Math.round(p * 100)}%</span>
                    </div>
                  ))}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Распознавание паттерна обучено на синтетике (модель {pattern.modelVersion}). Поддержка решения врача, не диагноз.
              </p>
            </Section>
          )}

          {/* Alert / anomaly explanation */}
          {anomaly && (anomaly.status === 'critical' || anomaly.status === 'attention') && (
            <div className={`rounded-xl border p-4 ${anomaly.status === 'critical' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start gap-3">
                <AlertTriangleIcon size={20} className={anomaly.status === 'critical' ? 'text-red-600 mt-0.5' : 'text-amber-600 mt-0.5'} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-semibold ${anomaly.status === 'critical' ? 'text-red-800' : 'text-amber-800'}`}>
                      {anomaly.status === 'critical' ? 'Признаки боли/усталости' : 'Лёгкое отклонение от нормы'}
                    </span>
                    <span className="text-xs text-slate-500">
                      достоверность {anomaly.anomalyScore}% · {modeLabel(anomaly.mode)} · baseline {anomaly.baselineSize} сессий
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{anomaly.note}</p>
                  {anomaly.flags?.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {anomaly.flags.map((fl, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className={`w-1.5 h-1.5 rounded-full ${fl.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                          <span className="text-slate-700">
                            {fl.axisLabel && <span className="text-slate-400 font-normal">[{fl.axisLabel}] </span>}
                            {fl.label}:
                          </span>
                          <span className="tabular-nums text-slate-500">
                            {fl.current} vs норма {fl.baseline} <span className="text-slate-400">({fl.z}σ)</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
          {anomaly && anomaly.status === 'normal' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircleIcon size={18} /> Сессия в пределах личной нормы пациента.
            </div>
          )}

          {/* Калибровка: персональная стартовая точка и прогресс от неё */}
          {baseline && (
            hasBaselineProgress ? (
              <Section title="От калибровки до сейчас"
                aside={
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                    <TargetIcon size={13} />
                    старт {new Date(baseline.calibrated_at).toLocaleDateString('ru')}
                  </span>
                }>
                <BaselineCompare delta={delta} />
                <p className="text-xs text-slate-400 mt-3">
                  Прогресс считается относительно первой (калибровочной) сессии — персональной нормы пациента.
                </p>
              </Section>
            ) : (
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 flex items-start gap-3">
                <TargetIcon size={20} className="text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-blue-800">Калибровка выполнена</div>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Стартовая точка зафиксирована {new Date(baseline.calibrated_at).toLocaleDateString('ru')}.
                    Прогресс относительно неё появится со следующей сессии.
                  </p>
                </div>
              </div>
            )
          )}

          {/* KPI grid */}
          <Section title="Последняя сессия"
            aside={<span className="text-xs text-slate-400">
              {partial ? 'оценка по амплитуде — сырой ряд движения не записан' : 'цвет — относительно клинических ориентиров'}
            </span>}>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {KPI_KEYS.map((k) => (
                <MetricCard key={k} metricKey={k} value={measuredValue(k, f)}
                  baseline={baselineOf(k)} measured={isMeasured(k, f)} />
              ))}
            </div>
            {isMeasured('tremorFreqHz', f) && f.tremorFreqHz > 0 && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500">
                <WavesIcon size={13} className="text-amber-500" />
                Доминирующая частота дрожи ~{f.tremorFreqHz} Гц
                <span className="text-slate-400">
                  (частотный анализ, полоса 3–12 Гц{f.tremorFreqHz >= 4 && f.tremorFreqHz <= 6 ? ' · паттерн покоя' : ''})
                </span>
              </p>
            )}
          </Section>

          {/* Траектория движения — реальный сигнал датчика (доказывает, что данные настоящие) */}
          {trace?.points?.length > 0 && (
            <Section title="Траектория движения"
              aside={<span className="text-xs text-slate-400">
                {trace.is_calibration ? 'калибровочная сессия' : 'последняя сессия'} · {trace.count} точек
              </span>}>
              <MovementTrace points={trace.points} />
              <p className="text-xs text-slate-400 mt-2">
                Реальный сигнал датчика: угол поворота кисти (roll) во времени, после нейтрализации.
              </p>
            </Section>
          )}

          {/* Вторичная ось управления (multi-axis: напр. газ/тормоз в City Driver).
              Теперь анализируется и входит в общий вердикт — показываем её собственный статус. */}
          {axisFeatures && Object.entries(axisFeatures).map(([axis, data]) => (
            data.features && data.features.valid && (
              <Section key={axis} title="Вторая ось управления"
                aside={
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{data.label}</span>
                    {data.anomaly && <AnomalyBadge anomaly={data.anomaly} showMode={false} />}
                  </div>
                }>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {AXIS_KPI_KEYS.map((k) => (
                    <MetricCard key={k} metricKey={k} value={measuredValue(k, data.features)}
                      measured={isMeasured(k, data.features)} />
                  ))}
                </div>
              </Section>
            )
          ))}

          {/* Weak side + progress */}
          <div className="grid md:grid-cols-2 gap-5">
            {recs?.weakSide && (
              <Section title="Асимметрия / слабая сторона">
                {recs.weakSide.detected ? (
                  <div>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-3xl font-bold text-slate-800">{recs.weakSide.asymmetryPct}%</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${SEV[recs.weakSide.severity]?.bg} ${SEV[recs.weakSide.severity]?.text}`}>
                        {SEV[recs.weakSide.severity]?.label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">{recs.weakSide.label}</p>
                    <p className="text-xs text-slate-400 mt-2">{recs.weakSide.evidence}</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircleIcon size={16} /> Выраженной асимметрии не выявлено.
                  </div>
                )}
              </Section>
            )}

            {progressReady && (
              <Section title="Прогресс" aside={<span className="text-xs text-slate-400">первые 3 → последние 3</span>}>
                <ProgressStat label="Очки" first={pScore(chrono.slice(0, 3))} last={pScore(chrono.slice(-3))} higherBetter />
                <ProgressStat label="Амплитуда (ROM)" first={pAvg(firstFeat, 'rom')} last={pAvg(lastFeat, 'rom')} unit="°" higherBetter />
                <ProgressStat label="Плавность" first={pAvg(firstFeat, 'smoothnessIndex')} last={pAvg(lastFeat, 'smoothnessIndex')} unit="%" pct higherBetter />
                <ProgressStat label="Тремор" first={pAvg(firstFeat, 'tremorIndex')} last={pAvg(lastFeat, 'tremorIndex')} unit="%" pct higherBetter={false} />
                <ProgressStat label="Паузы" first={pAvg(firstFeat, 'pauseRatio')} last={pAvg(lastFeat, 'pauseRatio')} unit="%" pct higherBetter={false} />
              </Section>
            )}
          </div>

          {/* Charts */}
          {sessions.length > 1 && (
            <Section title="Динамика">
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Амплитуда (ROM), °</div>
                  <SessionChart sessions={sessions} metric="rom" label="ROM" color="#10b981" baseline={baseline?.features?.rom} />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Плавность, %</div>
                  <SessionChart sessions={sessions} metric="smoothnessIndex" label="Плавность" color="#3b82f6" baseline={baseline?.features?.smoothnessIndex} />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Тремор, %</div>
                  <SessionChart sessions={sessions} metric="tremorIndex" label="Тремор" color="#f59e0b" baseline={baseline?.features?.tremorIndex} />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Игровой результат</div>
                  <SessionChart sessions={sessions} metric="score" label="Очки" color="#8b5cf6" showNorm={false} />
                </div>
              </div>
            </Section>
          )}

          {/* Session plan */}
          {plan && (
            <Section title="План следующей сессии">
              <div className="flex flex-wrap gap-2">
                {planLevel && <Chip>{planLevel}</Chip>}
                {plan.targetRomDeg != null && <Chip>Целевой ROM: {plan.targetRomDeg}°</Chip>}
                {plan.suggestedDurationSec != null && <Chip>Длительность: {plan.suggestedDurationSec} с</Chip>}
                {plan.weakSideExtraRepsPct > 0 && <Chip>Слабая сторона: +{plan.weakSideExtraRepsPct}% повторов</Chip>}
                {plan.emphasizeQualityOverScore && <Chip>Акцент: качество &gt; очки</Chip>}
              </div>
            </Section>
          )}

          {/* Recommendations */}
          {recs?.items?.length > 0 && (
            <Section title="Рекомендации">
              {recs.focus && <p className="text-sm text-slate-500 -mt-2 mb-3">{recs.focus}</p>}
              <div className="space-y-2.5">
                {recs.items.map((item) => {
                  const sev = SEV[item.severity] || SEV.info;
                  const Icon = AREA_ICON[item.area] || ActivityIcon;
                  return (
                    <div key={item.id} className={`rounded-lg border ${sev.border} ${sev.bg} p-3.5`}>
                      <div className="flex items-start gap-3">
                        <Icon size={18} className={`${sev.text} mt-0.5 shrink-0`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-800">{item.finding}</span>
                            <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${sev.bg} ${sev.text} border ${sev.border}`}>{sev.label}</span>
                          </div>
                          <p className="text-sm text-slate-600 mt-1">{item.recommendation}</p>
                          {item.evidence && <p className="text-xs text-slate-400 mt-1.5">{item.evidence}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {recs.note && <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-100">{recs.note}</p>}
            </Section>
          )}
        </div>
      )}

      {/* ──────────── СЕССИИ ──────────── */}
      {tab === 1 && (
        <Section className="p-0 overflow-hidden">
          {sessions.length === 0 ? (
            <div className="text-slate-400 text-center py-10">Нет сессий</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-500">
                    <th className="px-4 py-3 font-medium">Дата</th>
                    <th className="px-4 py-3 font-medium">Очки</th>
                    <th className="px-4 py-3 font-medium">ROM</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">Плавность</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">Тремор</th>
                    <th className="px-4 py-3 font-medium hidden md:table-cell">Боль</th>
                    <th className="px-4 py-3 font-medium hidden md:table-cell">Усталость</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const sf = s.features;
                    return (
                      <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {new Date(s.created_at).toLocaleDateString('ru')}
                          {s.is_calibration && <span className="ml-2 badge-info" title="Калибровочная сессия — персональная точка старта">старт</span>}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800 tabular-nums">{s.score}</td>
                        <td className="px-4 py-3"><Cell k="rom" v={measuredValue('rom', sf)} /></td>
                        <td className="px-4 py-3 hidden sm:table-cell"><Cell k="smoothnessIndex" v={measuredValue('smoothnessIndex', sf)} /></td>
                        <td className="px-4 py-3 hidden sm:table-cell"><Cell k="tremorIndex" v={measuredValue('tremorIndex', sf)} /></td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          {s.label?.pain != null ? (
                            <span className={s.label.pain > 1 ? 'badge-critical' : s.label.pain > 0 ? 'badge-attention' : 'badge-normal'}>
                              {['Нет', 'Слабая', 'Сильная'][s.label.pain]}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-slate-600 tabular-nums">
                          {s.label?.fatigue != null ? `${s.label.fatigue}/10` : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function Chip({ children }) {
  return <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium">{children}</span>;
}

function Cell({ k, v }) {
  if (v == null) return <span className="text-slate-300">—</span>;
  const s = styleFor(k, v);
  const n = NORMS[k];
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums text-slate-700">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {fmtMetric(k, v)}{n?.unit}
    </span>
  );
}
