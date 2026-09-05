import React, { useEffect, useState } from 'react';
import { getTransactions, deleteTransaction } from '../services/api';
import type { Transaction, AssetCatalog, Wallet } from '../types';
import { formatCurrency, formatPrice, formatQuantity, safeMul } from '../utils/decimalHelper';
import { formatDateTime } from '../utils/format';
import { Card, SectionLabel, Spinner } from './ui';

interface Props {
  walletId?: number;
  wallets: Wallet[];
  assets: AssetCatalog[];
  refreshKey: number;
  onChanged: () => void;
}

const TransactionHistory: React.FC<Props> = ({ walletId, wallets, assets, refreshKey, onChanged }) => {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<number | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getTransactions(walletId, assetFilter)
      .then((d) => alive && setTxs(d))
      .catch(() => alive && setError('No se pudo cargar el historial.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [walletId, assetFilter, refreshKey]);

  const decimalsFor = (assetId: number) => assets.find((a) => a.id === assetId)?.decimals ?? 8;
  const walletName = (id: number) => wallets.find((w) => w.id === id)?.name ?? `#${id}`;

  const onDelete = async (tx: Transaction) => {
    const label = `${tx.type} de ${formatQuantity(tx.quantity, decimalsFor(tx.asset_id))} ${tx.asset_symbol ?? ''}`.trim();
    if (!window.confirm(`¿Eliminar esta transacción?\n${label}\n\nEl coste promedio se recalculará.`)) return;
    setDeletingId(tx.id);
    setActionError(null);
    try {
      await deleteTransaction(tx.id);
      onChanged();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } };
      setActionError(ax.response?.data?.detail ?? 'No se pudo eliminar la transacción.');
    } finally {
      setDeletingId(null);
    }
  };

  const badge = (type: string) => {
    const inflow = type === 'BUY' || type === 'DEPOSIT';
    return (
      <span className={`num rounded-md px-2 py-0.5 text-xs font-medium ${inflow ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
        {type}
      </span>
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <SectionLabel>Historial de transacciones</SectionLabel>
        <select
          value={assetFilter ?? 'all'}
          onChange={(e) => setAssetFilter(e.target.value === 'all' ? undefined : Number(e.target.value))}
          className="num rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-ink outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="all">Todos los activos</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.symbol}</option>
          ))}
        </select>
      </div>

      {actionError && (
        <p className="border-b border-line bg-loss/10 px-4 py-2 text-sm text-loss">{actionError}</p>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2 p-4">
          <div className="h-9 rounded bg-surface2" />
          <div className="h-9 rounded bg-surface2" />
        </div>
      ) : error ? (
        <p className="p-5 text-sm text-loss">{error}</p>
      ) : txs.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted">No hay transacciones registradas.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pl-4 pr-3 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Wallet</th>
                <th className="px-3 py-2 font-medium">Activo</th>
                <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                <th className="px-3 py-2 text-right font-medium">Precio</th>
                <th className="px-3 py-2 text-right font-medium">Costo</th>
                <th className="px-3 py-2 text-right font-medium">Fecha (UTC)</th>
                <th className="py-2 pl-3 pr-4 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="border-t border-line/60 hover:bg-surface2">
                  <td className="py-2.5 pl-4 pr-3">{badge(t.type)}</td>
                  <td className="px-3 py-2.5 text-muted">{walletName(t.wallet_id)}</td>
                  <td className="px-3 py-2.5 text-ink">{t.asset_symbol ?? t.asset_id}</td>
                  <td className="num px-3 py-2.5 text-right text-ink">{formatQuantity(t.quantity, decimalsFor(t.asset_id))}</td>
                  <td className="num px-3 py-2.5 text-right text-muted">{formatPrice(t.price)}</td>
                  <td className="num px-3 py-2.5 text-right text-ink">{formatCurrency(safeMul(t.quantity, t.price))}</td>
                  <td className="num px-3 py-2.5 text-right text-xs text-muted">{formatDateTime(t.date_utc)}</td>
                  <td className="py-2.5 pl-3 pr-4 text-right">
                    <button
                      onClick={() => onDelete(t)}
                      disabled={deletingId === t.id}
                      title="Eliminar transacción"
                      className="rounded-md p-1.5 text-muted transition-colors hover:bg-loss/10 hover:text-loss disabled:opacity-50"
                    >
                      {deletingId === t.id ? <Spinner /> : '🗑'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

export default TransactionHistory;
