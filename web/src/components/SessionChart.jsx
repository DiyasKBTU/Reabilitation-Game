import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { NORMS, goodThreshold, measuredValue } from '../lib/clinical';

/**
 * График динамики одного признака по сессиям (от старых к новым).
 * Поддерживает коридор нормы (ReferenceLine) и %-признаки (плавность/тремор/паузы).
 *
 * props: sessions, metric, label, color, height, showNorm
 */
export default function SessionChart({
  sessions, metric = 'score', label = 'Очки', color = '#3b82f6',
  height = 190, showNorm = true,
}) {
  const norm = NORMS[metric];
  const isPct = !!norm?.pct;

  const data = [...sessions]
    .reverse()
    .map((s, i) => {
      // measuredValue → null для серийных признаков на частичных (Firebase) сессиях:
      // такие точки не рисуем (иначе ложный провал в 0 на графике плавности/тремора).
      const raw = metric === 'score' ? s.score : measuredValue(metric, s.features);
      const value = raw == null ? null : (isPct ? raw * 100 : raw);
      return { n: i + 1, value, date: new Date(s.created_at).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' }) };
    })
    .filter((d) => d.value !== null && !Number.isNaN(d.value));

  if (!data.length) {
    return <div className="text-sm text-slate-400 py-8 text-center">Нет данных для графика</div>;
  }

  const ref = showNorm && metric !== 'score' ? goodThreshold(metric) : null;
  const gid = `grad-${metric}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
               domain={isPct ? [0, 100] : ['auto', 'auto']} width={42} />
        {ref != null && (
          <ReferenceLine y={ref} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.7}
            label={{ value: `норма ${norm.higherBetter ? '≥' : '≤'} ${ref}${norm.unit}`, position: 'insideTopRight', fontSize: 10, fill: '#10b981' }} />
        )}
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
          labelStyle={{ color: '#64748b', fontWeight: 600 }}
          formatter={(v) => [`${typeof v === 'number' ? v.toFixed(isPct ? 0 : 1) : v}${norm?.unit || ''}`, label]}
        />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5}
          fill={`url(#${gid})`} dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 4 }} name={label} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
