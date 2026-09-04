import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { PortfolioSummary } from '../types';
import { formatPercentage, formatCurrency, toDecimal } from '../utils/decimalHelper';
import { Card, SectionLabel } from './ui';

interface Props {
  summary: PortfolioSummary | null;
  loading: boolean;
}

const COLORS = ['#E0A542', '#3B82F6', '#26A69A', '#A78BFA', '#F472B6', '#22D3EE', '#F97316', '#84CC16'];

const AllocationChart: React.FC<Props> = ({ summary, loading }) => {
  if (loading && !summary) {
    return <Card className="h-full min-h-[320px] animate-pulse bg-surface2" />;
  }
  if (!summary) return null;

  const data = summary.assets
    .filter((d) => toDecimal(d.allocation_pct).greaterThan(0))
    .map((d, i) => ({
      name: d.symbol.toUpperCase(),
      value: Number(d.allocation_pct),
      valueUsd: d.value,
      pct: formatPercentage(d.allocation_pct),
      color: COLORS[i % COLORS.length],
    }));

  return (
    <Card className="flex h-full flex-col p-4">
      <SectionLabel>Distribución</SectionLabel>
      {data.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-10 text-center text-sm text-muted">
          Sin datos de asignación todavía
        </div>
      ) : (
        <>
          <div className="mt-2">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {data.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as (typeof data)[number];
                    return (
                      <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                        <p className="font-medium text-ink">{p.name}</p>
                        <p className="num text-muted">{p.pct} · {formatCurrency(p.valueUsd)}</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 space-y-1.5">
            {data.map((e) => (
              <li key={e.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-ink">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: e.color }} />
                  {e.name}
                </span>
                <span className="num text-muted">{e.pct}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
};

export default AllocationChart;
