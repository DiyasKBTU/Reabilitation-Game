import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

/**
 * График реальной траектории движения за сессию: угол кисти (roll) во времени.
 * Данные — сырой ряд IMU (downsampled) из `GET /sessions/{id}/trace`. Назначение —
 * наглядно показать, что записывается настоящая моторика, а не только агрегаты.
 *
 * props: points [{t, r, p}], height
 */
export default function MovementTrace({ points = [], height = 200 }) {
  if (!points.length) {
    return <div className="text-sm text-slate-400 py-8 text-center">Нет сырого ряда движения</div>;
  }
  const data = points.map((p) => ({ t: p.t, roll: p.r }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
               tickFormatter={(v) => `${Math.round(v)}с`} minTickGap={28} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
               width={42} tickFormatter={(v) => `${v}°`} />
        <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
          labelFormatter={(v) => `t = ${Number(v).toFixed(1)} с`}
          formatter={(v) => [`${typeof v === 'number' ? v.toFixed(1) : v}°`, 'Крен (roll)']}
        />
        <Line type="monotone" dataKey="roll" stroke="#6366f1" strokeWidth={2} dot={false} name="Крен" />
      </LineChart>
    </ResponsiveContainer>
  );
}
