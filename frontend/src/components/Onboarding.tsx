import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupInitialBalance } from '../services/api';
import type { Wallet } from '../types';
import { Card } from './ui';
import AssetPicker, { type PickedCoin } from './AssetPicker';

interface Props {
  wallets: Wallet[];
  onComplete: () => void;
}

const field =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/40 placeholder:text-muted';

const NEW = '__new__';

/**
 * "Cargar posición inicial": crea/reutiliza una wallet y registra el saldo de
 * partida de una cripto como un DEPÓSITO. Pensado para el primer uso o para
 * añadir una moneda nueva al catálogo.
 */
const Onboarding: React.FC<Props> = ({ wallets, onComplete }) => {
  const navigate = useNavigate();
  const [walletChoice, setWalletChoice] = useState<string>(wallets[0] ? String(wallets[0].id) : NEW);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletType, setNewWalletType] = useState('EXCHANGE');
  const [coin, setCoin] = useState<PickedCoin | null>(null);
  const [quantity, setQuantity] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [decimals, setDecimals] = useState(8);
  const [advanced, setAdvanced] = useState(false);
  const [binance, setBinance] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = walletChoice === NEW;
  const walletName = isNew ? newWalletName.trim() : wallets.find((w) => String(w.id) === walletChoice)?.name ?? '';
  const hasCoin = !!coin?.symbol;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletName) return setError('Indica el nombre de la nueva wallet.');
    if (!hasCoin) return setError('Busca y elige la moneda.');
    if (!quantity || !totalCost) return setError('Indica cantidad y coste total.');
    try {
      setLoading(true);
      await setupInitialBalance({
        wallet_name: walletName,
        wallet_type: isNew ? newWalletType : undefined,
        symbol: coin!.symbol,
        name: coin!.name,
        coingecko_id: coin!.coingecko_id,
        binance_symbol: (binance || coin!.binance_symbol) || undefined,
        quantity,
        total_cost: totalCost,
        decimals,
      });
      setError(null);
      onComplete();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } };
      setError(ax.response?.data?.detail ?? 'No se pudo guardar la posición inicial.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Card className="p-7">
        <h2 className="text-xl font-semibold text-ink">Cargar posición inicial</h2>
        <p className="mt-1 text-sm text-muted">
          Registra una cripto y su saldo de partida en una wallet. Se guarda como un
          <span className="text-ink"> depósito</span>. Úsalo la primera vez o cuando
          añadas una moneda nueva. Todo es local y con precisión Decimal.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          {/* Wallet: existente o nueva */}
          <div className="space-y-1">
            <span className="text-xs text-muted">Wallet</span>
            <select value={walletChoice} onChange={(e) => setWalletChoice(e.target.value)} className={field}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>{w.name} · {w.type}</option>
              ))}
              <option value={NEW}>➕ Crear wallet nueva…</option>
            </select>
          </div>

          {isNew && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-muted">Nombre de la nueva wallet</span>
                <input value={newWalletName} onChange={(e) => setNewWalletName(e.target.value)} placeholder="Binance, Ledger…" className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted">Tipo</span>
                <select value={newWalletType} onChange={(e) => setNewWalletType(e.target.value)} className={field}>
                  <option value="EXCHANGE">Exchange</option>
                  <option value="COLD">Cartera fría</option>
                  <option value="HOT">Cartera caliente</option>
                  <option value="OTHER">Otra</option>
                </select>
              </label>
            </div>
          )}

          {/* Moneda: buscador */}
          <div className="space-y-1">
            <span className="text-xs text-muted">Moneda</span>
            <AssetPicker value={coin} onPick={setCoin} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted">Cantidad</span>
              <input type="number" step="any" placeholder="0.5" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`num ${field}`} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">Coste total (USDT)</span>
              <input type="number" step="any" placeholder="25000" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} className={`num ${field}`} />
            </label>
          </div>

          <button type="button" onClick={() => setAdvanced((a) => !a)} className="text-xs text-muted hover:text-ink">
            {advanced ? '▾' : '▸'} Opciones avanzadas
          </button>
          {advanced && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-line p-3">
              <label className="space-y-1">
                <span className="text-xs text-muted">Decimales (solo display)</span>
                <input type="number" value={decimals} onChange={(e) => setDecimals(Number(e.target.value))} className={`num ${field}`} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted">Par de Binance (velas)</span>
                <input value={binance} onChange={(e) => setBinance(e.target.value.toUpperCase())} placeholder={coin?.binance_symbol ?? 'BTCUSDT'} className={`num ${field}`} />
              </label>
            </div>
          )}

          {hasCoin && quantity && totalCost && walletName && (
            <p className="rounded-lg bg-surface2 px-3 py-2 text-xs text-muted">
              Se registrará un <span className="text-ink">depósito</span> de{' '}
              <span className="num text-ink">{quantity} {coin!.symbol}</span> por{' '}
              <span className="num text-ink">{totalCost} USDT</span> en{' '}
              <span className="text-ink">{walletName}</span>
              {isNew ? ' (wallet nueva)' : ''}.
            </p>
          )}

          {error && <p className="text-sm text-loss">{error}</p>}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={loading} className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              {loading ? 'Guardando…' : 'Guardar posición'}
            </button>
            <button type="button" onClick={() => navigate('/')} className="text-sm text-muted hover:text-ink">
              Volver
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default Onboarding;
