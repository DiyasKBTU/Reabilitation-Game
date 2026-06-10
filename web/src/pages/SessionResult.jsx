import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/index.js';
import useSessionStore from '../stores/sessionStore';
import AnomalyBadge from '../components/AnomalyBadge';
import useAuthStore from '../stores/authStore';

function MetricRow({ label, value, unit = '' }) {
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}{unit}</span>
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
  const [pain, setPain] = useState('');
  const [fatigue, setFatigue] = useState('');
  const [labeled, setLabeled] = useState(false);

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
    try {
      await api.labelSession(id, {
        pain: pain ? parseInt(pain) : undefined,
        fatigue: fatigue ? parseInt(fatigue) : undefined,
      });
      setLabeled(true);
    } catch {}
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

      {/* Pain label */}
      {!labeled && user?.role === 'patient' && (
        <div className="card p-4 mb-4">
          <h3 className="font-semibold text-slate-700 mb-3">Как вы себя чувствуете?</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Боль (0–2)</label>
              <select className="input" value={pain} onChange={(e) => setPain(e.target.value)}>
                <option value="">—</option>
                <option value="0">0 — Нет боли</option>
                <option value="1">1 — Небольшая</option>
                <option value="2">2 — Сильная</option>
              </select>
            </div>
            <div>
              <label className="label">Усталость (1–10)</label>
              <select className="input" value={fatigue} onChange={(e) => setFatigue(e.target.value)}>
                <option value="">—</option>
                {[1,2,3,4,5,6,7,8,9,10].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
          <button onClick={handleLabel} className="btn-primary mt-3 w-full">Сохранить оценку</button>
        </div>
      )}
      {labeled && <p className="text-center text-green-600 text-sm mb-4">✓ Оценка сохранена</p>}

      <div className="flex gap-3">
        <button onClick={() => navigate(session.game_type === 'game2' ? '/game/3d' : '/game/2d')} className="btn-primary flex-1">Играть снова</button>
        <button onClick={() => navigate('/leaderboard')} className="btn-secondary flex-1">Рейтинг</button>
      </div>
    </div>
  );
}
