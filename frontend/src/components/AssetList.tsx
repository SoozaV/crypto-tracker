import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { PortfolioSummary, AssetDetail } from '../types';
import { formatQuantity, formatCurrency, formatPrice, formatPercentage, toDecimal } from '../utils/decimalHelper';
import { Card, SectionLabel, ChangeChip, signClass } from './ui';

interface Props {
  summary: PortfolioSummary | null;
  loading: boolean;
  error: string | null;
}

const AssetList: React.FC<Props> = ({ summary, loading, error }) => {
  const navigate = useNavigate();

  if (loading && !summary) {
    return (
      <Card className="animate-pulse p-4">
        <div className="mb-3 h-4 w-32 rounded bg-surface2" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-2 h-12 rounded-lg bg-surface2" />
        ))}
      </Card>
    );
  }
  if (error && !summary) return <Card className="p-5 text-sm text-loss">{error}</Card>;
  if (!summary) return null;

  const held = summary.assets.filter((a) => !toDecimal(a.quantity).isZero());

  if (held.length === 0) {
    return (
      <Card className="p-10 text-center">
        <p className="text-ink">Aún no hay posiciones en este scope</p>
        <p className="mt-1 text-sm text-muted">
          Registra una compra o depósito abajo, o usa la configuración inicial.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <SectionLabel>Posiciones</SectionLabel>
        <span className="num text-xs text-muted">{held.length} activos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 pl-4 pr-3 font-medium">Activo</th>
              <th className="px-3 py-2 text-right font-medium">Cantidad</th>
              <th className="px-3 py-2 text-right font-medium">Tu prom.</th>
              <th className="px-3 py-2 text-right font-medium">Precio</th>
              <th className="px-3 py-2 text-right font-medium" title="Cambio del precio de mercado del activo en las últimas 24h (igual para todos, fuente CoinGecko)">
                Mercado 24h
              </th>
              <th className="px-3 py-2 text-right font-medium" title="Ganancia/pérdida no realizada de tu posición (precio actual − tu coste)">
                Tu PnL
              </th>
              <th className="px-3 py-2 text-right font-medium" title="Tu rendimiento: (precio actual − tu precio promedio) / tu precio promedio">
                Tu ROI
              </th>
              <th className="py-2 pl-3 pr-4 text-right font-medium">Asignación</th>
            </tr>
          </thead>
          <tbody>
            {held.map((a: AssetDetail) => {
              const alloc = Number(a.allocation_pct);
              return (
                <tr
                  key={a.asset_id}
                  onClick={() => navigate(`/asset/${a.asset_id}`)}
                  className="cursor-pointer border-t border-line/60 transition-colors hover:bg-surface2"
                >
                  <td className="py-3 pl-4 pr-3">
                    <div className="flex items-center gap-3">
                      <span className="num flex h-7 items-center justify-center rounded-lg bg-accent/10 px-2 text-xs font-semibold text-accent">
                        {a.symbol.toUpperCase()}
                      </span>
                      <span className="text-sm text-ink">{a.name ?? a.symbol.toUpperCase()}</span>
                    </div>
                  </td>
                  <td className="num px-3 py-3 text-right text-ink">
                    {formatQuantity(a.quantity, a.decimals ?? 8)}
                  </td>
                  {/* Precio promedio del usuario en ámbar: el mismo color que su
                      línea de coste en el gráfico de velas. */}
                  <td className="num px-3 py-3 text-right text-accent">
                    {formatPrice(a.avg_price)}
                  </td>
                  <td className="num px-3 py-3 text-right text-ink">
                    {formatPrice(a.price_now)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <ChangeChip value={a.changes?.change_24h_pct} />
                  </td>
                  <td className={`num px-3 py-3 text-right ${signClass(a.unrealized_pnl)}`}>
                    {formatCurrency(a.unrealized_pnl)}
                  </td>
                  <td className={`num px-3 py-3 text-right ${signClass(a.roi_pct)}`}>
                    {formatPercentage(a.roi_pct)}
                  </td>
                  <td className="py-3 pl-3 pr-4">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface2">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.min(alloc, 100)}%` }}
                        />
                      </div>
                      <span className="num w-12 text-right text-xs text-muted">
                        {formatPercentage(a.allocation_pct)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export default AssetList;
