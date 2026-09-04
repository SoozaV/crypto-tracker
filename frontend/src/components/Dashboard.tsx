import React from 'react';
import type { PortfolioSummary } from '../types';
import { formatCurrency, formatPercentage } from '../utils/decimalHelper';
import { Card, signClass } from './ui';

interface Props {
  summary: PortfolioSummary | null;
  loading: boolean;
  error: string | null;
}

const Dashboard: React.FC<Props> = ({ summary, loading, error }) => {
  if (loading && !summary) {
    return (
      <div className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-surface2" />
        ))}
      </div>
    );
  }

  if (error && !summary) {
    return (
      <Card className="p-5 text-sm text-loss">{error}</Card>
    );
  }
  if (!summary) return null;

  const scopeLabel = summary.scope === 'wallet' ? 'Wallet seleccionada' : 'Todas las wallets';

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Valor total: la cifra protagonista del panel. */}
      <Card className="p-5 lg:col-span-1 sm:col-span-2">
        <p className="text-xs text-muted">Valor del portafolio</p>
        <p className="num mt-1 text-3xl font-semibold text-ink">
          {formatCurrency(summary.total_value)}
        </p>
        <p className="mt-1 text-xs text-muted">{scopeLabel}</p>
      </Card>

      <Card className="p-5">
        <p className="text-xs text-muted">PnL no realizado</p>
        <p className={`num mt-1 text-2xl font-semibold ${signClass(summary.total_unrealized_pnl)}`}>
          {formatCurrency(summary.total_unrealized_pnl)}
        </p>
        <p className="num mt-1 text-xs text-muted">
          Realizado {formatCurrency(summary.total_realized_pnl)}
        </p>
      </Card>

      <Card className="p-5">
        <p className="text-xs text-muted">ROI total</p>
        <p className={`num mt-1 text-2xl font-semibold ${signClass(summary.total_roi_pct)}`}>
          {formatPercentage(summary.total_roi_pct)}
        </p>
        <p className="num mt-1 text-xs text-muted">
          Coste {formatCurrency(summary.total_cost_basis)}
        </p>
      </Card>

      <Card className="p-5">
        <p className="text-xs text-muted">Activos con posición</p>
        <p className="num mt-1 text-2xl font-semibold text-ink">
          {summary.assets.filter((a) => Number(a.quantity) > 0).length}
        </p>
        <p className="num mt-1 text-xs text-muted">
          {summary.assets.length} en catálogo del scope
        </p>
      </Card>
    </div>
  );
};

export default Dashboard;
