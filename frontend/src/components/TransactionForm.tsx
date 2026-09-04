import React, { useEffect, useState } from 'react';
import { getAssetCatalog, getWallets, createTransaction, getAssetDetail } from '../services/api';
import type { AssetCatalog, TransactionCreate, Wallet } from '../types';
import { toDecimal } from '../utils/decimalHelper';

interface TransactionFormProps {
  walletId?: number;
  onSuccess: () => void;
}

const TransactionForm: React.FC<TransactionFormProps> = ({ walletId, onSuccess }) => {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [assets, setAssets] = useState<AssetCatalog[]>([]);
  const [form, setForm] = useState({
    wallet_id: walletId || 0,
    asset_id: 0,
    type: 'BUY' as TransactionCreate['type'],
    quantity: '',
    price: '',
    fee: '0',
    fee_currency: 'USDT',
    fee_usdt: '0',
    date: new Date().toISOString().slice(0, 16),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    Promise.all([getWallets(), getAssetCatalog()])
      .then(([w, a]) => {
        setWallets(w);
        setAssets(a);
        setForm((prev) => ({
          ...prev,
          wallet_id: prev.wallet_id || walletId || (w[0]?.id ?? 0),
          asset_id: prev.asset_id || (a[0]?.id ?? 0),
        }));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (walletId) {
      setForm((prev) => ({ ...prev, wallet_id: walletId }));
    }
  }, [walletId]);

  useEffect(() => {
    if ((form.type === 'SELL' || form.type === 'WITHDRAWAL') && form.asset_id && form.wallet_id) {
      setBalanceLoading(true);
      getAssetDetail(form.asset_id, form.wallet_id)
        .then((detail) => setBalance(detail.quantity))
        .catch(() => setBalance(null))
        .finally(() => setBalanceLoading(false));
    } else {
      setBalance(null);
      setBalanceLoading(false);
    }
  }, [form.asset_id, form.wallet_id, form.type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.wallet_id || !form.asset_id || !form.quantity || !form.price) {
      setError('Completa todos los campos obligatorios');
      return;
    }

    if ((form.type === 'SELL' || form.type === 'WITHDRAWAL') && balance !== null) {
      if (toDecimal(form.quantity).greaterThan(toDecimal(balance))) {
        setError(`No tienes suficiente saldo. Disponible: ${balance}`);
        return;
      }
    }

    try {
      setLoading(true);
      const payload: TransactionCreate = {
        wallet_id: form.wallet_id,
        asset_id: form.asset_id,
        type: form.type,
        quantity: form.quantity,
        price: form.price,
        fee: form.fee || '0',
        fee_currency: form.fee_currency || 'USDT',
        fee_usdt: form.fee_usdt || '0',
        date: new Date(form.date).toISOString(),
      };
      await createTransaction(payload);
      setError(null);
      setForm((prev) => ({ ...prev, quantity: '', price: '', fee: '0', fee_usdt: '0' }));
      onSuccess();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || 'Error al crear transacción');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
        Nueva Transacción
      </h3>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <select
          value={form.wallet_id}
          onChange={(e) => setForm({ ...form, wallet_id: Number(e.target.value) })}
          className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          required
        >
          <option value="0">Wallet</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>

        <select
          value={form.asset_id}
          onChange={(e) => setForm({ ...form, asset_id: Number(e.target.value) })}
          className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          required
        >
          <option value="0">Activo</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.symbol}
            </option>
          ))}
        </select>

        <select
          value={form.type}
          onChange={(e) =>
            setForm({ ...form, type: e.target.value as TransactionCreate['type'] })
          }
          className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="BUY">Compra</option>
          <option value="SELL">Venta</option>
          <option value="DEPOSIT">Depósito</option>
          <option value="WITHDRAWAL">Retiro</option>
        </select>

        <input
          type="number"
          step="any"
          placeholder="Cantidad"
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          required
        />

        <input
          type="number"
          step="any"
          placeholder="Precio (USDT)"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          required
        />

        <input
          type="number"
          step="any"
          placeholder="Fee (USDT)"
          value={form.fee_usdt}
          onChange={(e) =>
            setForm({ ...form, fee_usdt: e.target.value, fee: e.target.value })
          }
          className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
        />

        <input
          type="datetime-local"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          required
        />

        {(form.type === 'SELL' || form.type === 'WITHDRAWAL') && (
          <div className="md:col-span-4 text-xs text-gray-500 dark:text-gray-400">
            {balanceLoading
              ? 'Consultando saldo...'
              : balance !== null
                ? `Saldo disponible: ${balance}`
                : 'No se pudo consultar el saldo'}
          </div>
        )}

        <div className="md:col-span-4 flex items-center gap-4">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
          {error && <span className="text-red-600 text-sm">{error}</span>}
        </div>
      </form>
    </div>
  );
};

export default TransactionForm;
