import React, { useEffect, useState } from 'react';
import { createTransaction, getAssetDetail } from '../services/api';
import type { AssetCatalog, TransactionCreate, Wallet } from '../types';
import { toDecimal, safeDiv, safeMul, formatCurrency, formatPrice, formatQuantity } from '../utils/decimalHelper';
import { Card, SectionLabel } from './ui';

interface Props {
  wallets: Wallet[];
  assets: AssetCatalog[];
  walletId?: number;
  onSuccess: () => void;
}

const field =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/40 placeholder:text-muted';

/**
 * Entrada flexible. Siempre indicas la CANTIDAD en cripto, y luego eliges cómo
 * dar el importe con un conmutador:
 *   - "Total (USDT)": lo que pagaste/recibiste en total (fees incluidos).
 *   - "Precio unit." : el precio por unidad (el "Cost Price" de Binance).
 * Internamente se envía el precio unitario al backend (fee = 0, ya incluido).
 */
type PriceMode = 'total' | 'unit';

const TransactionForm: React.FC<Props> = ({ wallets, assets, walletId, onSuccess }) => {
  const [form, setForm] = useState({
    wallet_id: walletId ?? 0,
    asset_id: 0,
    type: 'BUY' as TransactionCreate['type'],
    quantity: '',
    amount: '', // total o precio unitario según priceMode
    date: new Date().toISOString().slice(0, 16),
  });
  const [priceMode, setPriceMode] = useState<PriceMode>('total');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    setForm((p) => ({
      ...p,
      wallet_id: p.wallet_id || walletId || wallets[0]?.id || 0,
      asset_id: p.asset_id || assets[0]?.id || 0,
    }));
  }, [wallets, assets, walletId]);

  const reduces = form.type === 'SELL' || form.type === 'WITHDRAWAL';
  const needsAmount = form.type !== 'WITHDRAWAL';

  useEffect(() => {
    if (reduces && form.asset_id && form.wallet_id) {
      getAssetDetail(form.asset_id, form.wallet_id)
        .then((d) => setBalance(d.quantity))
        .catch(() => setBalance(null));
    } else {
      setBalance(null);
    }
  }, [reduces, form.asset_id, form.wallet_id]);

  const qtyOk = form.quantity && !toDecimal(form.quantity).isZero();
  // Precio unitario resultante (para enviar) y total resultante (para mostrar).
  const unitPrice =
    needsAmount && form.amount && qtyOk
      ? priceMode === 'unit'
        ? form.amount
        : safeDiv(form.amount, form.quantity)
      : null;
  const totalValue =
    needsAmount && form.amount && qtyOk
      ? priceMode === 'total'
        ? form.amount
        : safeMul(form.amount, form.quantity)
      : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.wallet_id || !form.asset_id || !form.quantity) {
      setError('Faltan campos: wallet, activo y cantidad.');
      return;
    }
    if (needsAmount && !form.amount) {
      setError(priceMode === 'unit' ? 'Indica el precio unitario.' : 'Indica el total en USDT.');
      return;
    }
    if (reduces && balance !== null && toDecimal(form.quantity).greaterThan(toDecimal(balance))) {
      setError(`No hay saldo suficiente. Disponible: ${formatQuantity(balance)}.`);
      return;
    }
    try {
      setLoading(true);
      const price = needsAmount ? (unitPrice ?? '0') : '0';
      await createTransaction({
        wallet_id: form.wallet_id,
        asset_id: form.asset_id,
        type: form.type,
        quantity: form.quantity,
        price,
        fee: '0',
        fee_currency: 'USDT',
        fee_usdt: '0',
        date: new Date(form.date).toISOString(),
      });
      setError(null);
      setForm((p) => ({ ...p, quantity: '', amount: '' }));
      onSuccess();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } };
      setError(ax.response?.data?.detail ?? 'No se pudo registrar la transacción.');
    } finally {
      setLoading(false);
    }
  };

  const types: Array<{ v: TransactionCreate['type']; label: string }> = [
    { v: 'BUY', label: 'Compra' },
    { v: 'SELL', label: 'Venta' },
    { v: 'DEPOSIT', label: 'Depósito' },
    { v: 'WITHDRAWAL', label: 'Retiro' },
  ];

  const amountLabel =
    priceMode === 'unit'
      ? 'Precio unitario / Cost Price (USDT)'
      : form.type === 'SELL'
        ? 'Total recibido (USDT, neto de fees)'
        : 'Total pagado (USDT, fees incluidos)';

  return (
    <Card className="p-5">
      <SectionLabel>Nueva transacción</SectionLabel>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {types.map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setForm({ ...form, type: t.v })}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                form.type === t.v ? 'bg-accent text-white' : 'text-muted hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs text-muted">Wallet</span>
            <select value={form.wallet_id} onChange={(e) => setForm({ ...form, wallet_id: Number(e.target.value) })} className={field}>
              <option value={0}>Elige wallet</option>
              {wallets.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted">Activo</span>
            <select value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: Number(e.target.value) })} className={field}>
              <option value={0}>Elige activo</option>
              {assets.map((a) => (<option key={a.id} value={a.id}>{a.symbol}</option>))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted">Fecha (tu hora local → se guarda en UTC)</span>
            <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`num ${field}`} required />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted">Cantidad (en cripto)</span>
            <input type="number" step="any" placeholder="0.00" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={`num ${field}`} required />
          </label>

          {needsAmount && (
            <div className="space-y-1 sm:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">{amountLabel}</span>
                {/* Conmutador Total / Precio unitario */}
                <div className="flex rounded-md border border-line p-0.5">
                  {(['total', 'unit'] as PriceMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPriceMode(m)}
                      className={`rounded px-2 py-0.5 text-[0.7rem] transition-colors ${
                        priceMode === m ? 'bg-accent text-white' : 'text-muted hover:text-ink'
                      }`}
                    >
                      {m === 'total' ? 'Total' : 'Precio unit.'}
                    </button>
                  ))}
                </div>
              </div>
              <input type="number" step="any" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={`num ${field}`} required />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {needsAmount && unitPrice && totalValue && (
            <span className="num">
              {priceMode === 'total'
                ? `≈ ${formatPrice(unitPrice)} por unidad`
                : `≈ ${formatCurrency(totalValue)} en total`}
              {' '}(fee incluido)
            </span>
          )}
          {reduces && (
            <span className="num">
              {balance !== null ? `Saldo disponible: ${formatQuantity(balance)}` : 'Consultando saldo…'}
            </span>
          )}
          {form.type === 'WITHDRAWAL' && (
            <span>El retiro reduce cantidad y coste proporcional; no genera PnL.</span>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={loading} className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">
            {loading ? 'Guardando…' : 'Registrar transacción'}
          </button>
          {error && <span className="text-sm text-loss">{error}</span>}
        </div>
      </form>
    </Card>
  );
};

export default TransactionForm;
