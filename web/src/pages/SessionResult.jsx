import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/index.js';
import useSessionStore from '../stores/sessionStore';
import AnomalyBadge from '../components/AnomalyBadge';
import Disclaimer from '../components/Disclaimer';
import useAuthStore from '../stores/authStore';
import { CheckCircleIcon, AlertTriangleIcon } from '../components/icons';

// Оценка самочувствия = ground-truth метки для ML (норма/аномалия). pain=0 — «нет боли» (норма).
const PAIN_OPTS = [
  { v: 0, label: 'Нет' },
  { v: 1, label: 'Небольшая' },
  { v: 2, label: 'Сильная' },
];
const FATIGUE_OPTS = Array.from({ length: 10 }, (_, i) => ({ v: i + 1, label: String(i + 1) }));

function MetricRow({ label, value, unit = '' }) {
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}{unit}</span>
    </div>
  );
}

// Сегментированный выбор: крупные тач-кнопки вместо нативного <select> (пациент, планшет).
// Повторный клик по активной — сброс (исправление ошибочного нажатия).
function Choice({ options, value, onChange, ariaLabel, itemClassName = '' }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : o.v)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${itemClassName} ${
              active
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function SessionResult() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lastSession } = useSessionStore();
  const { user } = useAuthStore();
  const [session, setSession] = useState(lastSession);
  const [insights, setInsights] = useState(null);
  const [pain, setPain] = useState(null);
  const [fatigue, setFatigue] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const canSave = pain != null || fatigue != null;

  useEffect(() => {
    if (!session && id) {
      api.getSession(id).then(setSession).catch(() => navigate('/game'));
    }
  }, [id]);

  useEffect(() => {
    if (session?.patient_id) {
      api.getInsights(session.patient_id, session.game_type).then(setInsights).catch(() => {});
    }
  }, [session]);

  async function handleLabel() {
    // pain=0 («Нет боли») — валидная метка нормы, не отбрасываем как falsy.
    if (pain == null && fatigue == null) return;
    setSaveState('saving');
    try {
      await api.labelSession(id, {
        pain: pain != null ? pain : undefined,
        fatigue: fatigue != null ? fatigue : undefined,
      });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  if (!session) return <div className="flex items-center justify-center h-full"><div className="text-slate-400">Загрузка...</div></div>;

  const f = session.features;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Результат сессии</h1>
        <Link to="/game" className="btn-secondary text-sm">← К играм</Link>
      </div>

      {/* Score */}
      <div className="card p-6 mb-4 text-center">
        <div className="text-5xl font-bold text-blue-600 mb-1">{session.score}</div>
        <div className="text-slate-500 text-sm">очков</div>
        <div className="flex justify-center gap-4 mt-3 text-sm text-slate-600">
          <span>Комбо: <b>{session.max_combo}</b></span>
          <span>Время: <b>{session.duration_sec?.toFixed(0)}с</b></span>
          <span>Уровень: <b>{session.level}</b></span>
        </div>
        {insights?.anomaly && (
          <div className="mt-3">
            <AnomalyBadge anomaly={insights.anomaly} />
          </div>
        )}
      </div>

      {/* Features */}
      {f && f.valid && (
        <div className="card p-4 mb-4">
          <h3 className="font-semibold text-slate-700 mb-3">Показатели движения</h3>
          <MetricRow label="Амплитуда (ROM)" value={f.rom} unit="°" />
          <MetricRow label="Пиковая скорость" value={f.peakVelocity} unit="°/с" />
          <MetricRow label="Плавность" value={(f.smoothnessIndex * 100).toFixed(0)} unit="%" />
          <MetricRow label="Тремор" value={(f.tremorIndex * 100).toFixed(0)} unit="%" />
          <MetricRow label="Паузы" value={(f.pauseRatio * 100).toFixed(0)} unit="%" />
          <MetricRow label="Повторений" value={f.repetitions} />
          <MetricRow label="Активное время" value={f.activeTimeSec} unit="с" />
        </div>
      )}

      {/* Recommendations */}
      {insights?.recommendations?.items?.length > 0 && (
        <div className="card p-4 mb-4">
          <h3 className="font-semibold text-slate-700 mb-3">Рекомендации</h3>
          <p className="text-sm text-slate-600 mb-3">{insights.recommendations.focus}</p>
          <div className="space-y-2">
            {insights.recommendations.items.slice(0, 3).map((item) => (
              <div key={item.id} className={`p-3 rounded-lg text-sm
                ${item.severity === 'critical' ? 'bg-red-50 text-red-800'
                  : item.severity === 'attention' ? 'bg-yellow-50 text-yellow-800'
                  : 'bg-blue-50 text-blue-800'}`}
              >
                <div className="font-medium mb-0.5">{item.finding}</div>
                <div className="opacity-80">{item.recommendation}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Оценка самочувствия — ground-truth метки для ML. Удобный тач-ввод, обязателен хотя бы один пункт. */}
      {saveState !== 'saved' && user?.role === 'patient' && (
        <div className="card p-4 mb-4">
          <h3 className="font-semibold text-slate-700 mb-1">Как вы себя чувствуете?</h3>
          <p className="text-xs text-slate-400 mb-4">Помогает врачу и подбору нагрузки. Достаточно указать любой пункт.</p>
          <div className="space-y-4">
            <div>
              <span className="label">Боль</span>
              <Choice ariaLabel="Уровень боли" options={PAIN_OPTS} value={pain} onChange={setPain} />
            </div>
            <div>
              <span className="label">Усталость <span className="font-normal text-slate-400">(1 — бодрость, 10 — изнеможение)</span></span>
              <Choice ariaLabel="Уровень усталости" options={FATIGUE_OPTS} value={fatigue} onChange={setFatigue}
                itemClassName="min-w-[2.5rem] justify-center" />
            </div>
          </div>
          {saveState === 'error' && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-red-600">
              <AlertTriangleIcon size={15} /> Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.
            </p>
          )}
          <button onClick={handleLabel} disabled={!canSave || saveState === 'saving'}
            className="btn-primary mt-4 w-full">
            {saveState === 'saving' ? 'Сохранение…' : 'Сохранить оценку'}
          </button>
        </div>
      )}
      {saveState === 'saved' && (
        <p className="mb-4 inline-flex w-full items-center justify-center gap-1.5 text-sm text-emerald-600">
          <CheckCircleIcon size={16} /> Оценка сохранена
        </p>
      )}

      {(f && f.valid) || insights?.recommendations?.items?.length > 0 ? (
        <Disclaimer className="mb-4" />
      ) : null}

      <div className="flex gap-3">
        <button onClick={() => navigate(session.game_type === 'game2' ? '/game/3d' : '/game/2d')} className="btn-primary flex-1">Играть снова</button>
        <button onClick={() => navigate('/leaderboard')} className="btn-secondary flex-1">Рейтинг</button>
      </div>
    </div>
  );
}
