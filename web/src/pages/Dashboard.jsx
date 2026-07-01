import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import {
  UsersIcon, AlertTriangleIcon, TargetIcon, TrendingUpIcon, ChevronRightIcon,
  StethoscopeIcon, CheckCircleIcon,
} from '../components/icons';

const ATTENTION = new Set(['attention', 'critical']);

function StatCard({ Icon, label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-500',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <div className="card p-5">
      <span className={`flex items-center justify-center w-10 h-10 rounded-xl mb-3 ${tones[tone]}`}>
        <Icon size={20} />
      </span>
      <div className="text-2xl font-bold text-slate-800 tabular-nums">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === 'critical') return <span className="badge-critical">боль/усталость</span>;
  if (status === 'attention') return <span className="badge-attention">внимание</span>;
  if (status === 'normal') return <span className="badge-normal">норма</span>;
  return <span className="badge-info">нет данных</span>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);     // [{p, ins}]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(false);
    api.getPatients()
      .then(async (patients) => {
        // Аналитика по каждому пациенту (game1). N невелик; ошибка по одному не валит дашборд.
        const out = await Promise.all(patients.map(async (p) => {
          try { return { p, ins: await api.getInsights(p.id, 'game1') }; }
          catch { return { p, ins: null }; }
        }));
        setRows(out);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  if (loading) return <div className="flex items-center justify-center h-full text-slate-400">Загрузка обзора...</div>;
  if (error) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
      <AlertTriangleIcon size={32} className="text-amber-500" />
      <p className="text-slate-700 font-medium">Не удалось загрузить обзор</p>
      <button onClick={() => setReloadKey((k) => k + 1)} className="btn-primary text-sm">Повторить</button>
    </div>
  );

  const total = rows.length;
  const attention = rows.filter((r) => ATTENTION.has(r.ins?.anomaly?.status));
  const calibrated = rows.filter((r) => r.ins?.baseline);
  const progressed = rows
    .map((r) => ({ ...r, rom: r.ins?.delta_vs_baseline?.rom }))
    .filter((r) => r.rom)
    .sort((a, b) => b.rom.changePct - a.rom.changePct);
  const avgRom = progressed.length
    ? Math.round(progressed.reduce((s, r) => s + r.rom.changePct, 0) / progressed.length)
    : null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Обзор</h1>
          <p className="text-sm text-slate-500 mt-0.5">Сводка по пациентам в наблюдении</p>
        </div>
        <button onClick={() => navigate('/doctor/patients')} className="btn-secondary text-sm">
          <UsersIcon size={16} /> Все пациенты
        </button>
      </div>

      {/* Сводные показатели */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard Icon={UsersIcon} label="Пациентов" value={total} tone="blue" />
        <StatCard Icon={AlertTriangleIcon} label="Требуют внимания" value={attention.length}
          tone={attention.length ? 'amber' : 'slate'} sub={attention.length ? 'по последней сессии' : 'все в норме'} />
        <StatCard Icon={TargetIcon} label="Откалибровано" value={`${calibrated.length}/${total}`}
          tone="emerald" sub="есть точка отсчёта" />
        <StatCard Icon={TrendingUpIcon} label="Средний прогресс" value={avgRom == null ? '—' : `${avgRom > 0 ? '+' : ''}${avgRom}%`}
          tone={avgRom > 0 ? 'emerald' : 'slate'} sub="амплитуда от старта" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Требуют внимания */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangleIcon size={18} className="text-amber-500" />
            <h3 className="font-semibold text-slate-800">Требуют внимания</h3>
          </div>
          {attention.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 py-6 justify-center">
              <CheckCircleIcon size={18} /> Все пациенты в пределах личной нормы.
            </div>
          ) : (
            <div className="space-y-2">
              {attention.map(({ p, ins }) => (
                <button key={p.id} onClick={() => navigate(`/doctor/patient/${p.id}`)}
                  className="w-full flex items-center justify-between rounded-lg border border-slate-200 hover:bg-slate-50 px-3 py-2.5 text-left">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{p.full_name}</div>
                    {p.diagnosis && <div className="text-xs text-slate-400">{p.diagnosis}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={ins?.anomaly?.status} />
                    <ChevronRightIcon size={15} className="text-slate-300" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Прогресс */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUpIcon size={18} className="text-emerald-500" />
            <h3 className="font-semibold text-slate-800">Динамика амплитуды</h3>
          </div>
          {progressed.length === 0 ? (
            <div className="text-sm text-slate-400 py-6 text-center">
              Пока нет данных для сравнения со стартом.
            </div>
          ) : (
            <div className="space-y-2">
              {progressed.slice(0, 6).map(({ p, rom }) => (
                <button key={p.id} onClick={() => navigate(`/doctor/patient/${p.id}`)}
                  className="w-full flex items-center justify-between rounded-lg border border-slate-200 hover:bg-slate-50 px-3 py-2.5 text-left">
                  <div className="text-sm font-medium text-slate-800">{p.full_name}</div>
                  <div className="flex items-center gap-2 text-sm tabular-nums">
                    <span className="text-slate-400">{rom.baseline.toFixed(0)}°→{rom.current.toFixed(0)}°</span>
                    <span className={`inline-flex items-center gap-0.5 font-medium ${rom.improved ? 'text-emerald-600' : 'text-red-500'}`}>
                      {rom.changePct > 0 ? '+' : ''}{rom.changePct}%
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {total === 0 && (
        <div className="card text-center py-14 mt-5">
          <StethoscopeIcon size={36} className="mx-auto mb-3 text-slate-300" />
          <div className="text-slate-500">Пока нет пациентов в наблюдении.</div>
          <button onClick={() => navigate('/doctor/patients')} className="btn-primary text-sm mt-4">К пациентам</button>
        </div>
      )}
    </div>
  );
}
