import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { money, monthLabel, monthTick } from '@/lib/format';

const tooltipStyle = {
  contentStyle: { background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, color: 'var(--color-ink)' },
  labelStyle: { color: 'var(--color-subtle)', marginBottom: 2 },
  itemStyle: { padding: 0 },
};
const yTick = (v: number) => money(v, { compact: true }).replace('.00', '');

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
}

export function BalanceArea({ data, series, height = 200, stacked = true, dashedFrom }: { data: Record<string, unknown>[]; series: SeriesDef[]; height?: number; stacked?: boolean; dashedFrom?: string }) {
  void dashedFrom;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={monthTick} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickFormatter={yTick} tickLine={false} axisLine={false} width={52} />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => monthLabel(String(l))} formatter={(v: number, n) => [money(v), n]} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stackId={stacked ? '1' : undefined}
            stroke={s.color}
            fill={s.color}
            fillOpacity={stacked ? 0.35 : 0.12}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, series, height = 220 }: { data: Record<string, unknown>[]; series: SeriesDef[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={monthTick} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickFormatter={yTick} tickLine={false} axisLine={false} width={52} />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => monthLabel(String(l))} formatter={(v: number, n) => [money(v), n]} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, series, height = 200, stacked = false }: { data: Record<string, unknown>[]; series: SeriesDef[]; height?: number; stacked?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={monthTick} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tickFormatter={yTick} tickLine={false} axisLine={false} width={52} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--color-muted)' }} labelFormatter={(l) => monthLabel(String(l))} formatter={(v: number, n) => [money(v), n]} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? '1' : undefined} radius={stacked ? 0 : [3, 3, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 180 }: { data: { name: string; value: number; color: string }[]; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} formatter={(v: number, n) => [`${money(v)} (${total ? ((v / total) * 100).toFixed(1) : 0}%)`, n]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[11px] text-subtle">Total</div>
        <div className="text-sm font-semibold tabular-nums">{money(total, { compact: true })}</div>
      </div>
    </div>
  );
}
