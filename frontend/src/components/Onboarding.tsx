import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupInitialBalance } from '../services/api';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    wallet_name: 'Mi Wallet',
    symbol: 'BTC',
    quantity: '',
    total_cost: '',
    decimals: 8,
    wallet_type: 'EXCHANGE',
    coingecko_id: 'bitcoin',
    binance_symbol: 'BTCUSDT',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.quantity || !form.total_cost) {
      setError('Completa cantidad y coste total');
      return;
    }

    try {
      setLoading(true);
      await setupInitialBalance({
        wallet_name: form.wallet_name,
        symbol: form.symbol,
        quantity: form.quantity,
        total_cost: form.total_cost,
        decimals: form.decimals,
        wallet_type: form.wallet_type,
        coingecko_id: form.coingecko_id || undefined,
        binance_symbol: form.binance_symbol || undefined,
      });
      setError(null);
      onComplete();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || 'Error al configurar el balance inicial');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Configuración Inicial
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Ingresa tu primera wallet y depósito inicial.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Nombre de Wallet
          </label>
          <input
            type="text"
            value={form.wallet_name}
            onChange={(e) => setForm({ ...form, wallet_name: e.target.value })}
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Símbolo (ej. BTC, ETH)
          </label>
          <input
            type="text"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Cantidad
          </label>
          <input
            type="number"
            step="any"
            placeholder="0.5"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Coste total (USDT)
          </label>
          <input
            type="number"
            step="any"
            placeholder="25000"
            value={form.total_cost}
            onChange={(e) => setForm({ ...form, total_cost: e.target.value })}
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Decimales (ej. 8 para BTC, 18 para ETH)
          </label>
          <input
            type="number"
            placeholder="8"
            value={form.decimals}
            onChange={(e) => setForm({ ...form, decimals: Number(e.target.value) })}
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            CoinGecko ID (opcional)
          </label>
          <input
            type="text"
            placeholder="bitcoin"
            value={form.coingecko_id}
            onChange={(e) => setForm({ ...form, coingecko_id: e.target.value })}
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Binance symbol (opcional)
          </label>
          <input
            type="text"
            placeholder="BTCUSDT"
            value={form.binance_symbol}
            onChange={(e) => setForm({ ...form, binance_symbol: e.target.value.toUpperCase() })}
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {loading ? 'Guardando...' : 'Guardar y empezar'}
        </button>

        {error && <div className="text-red-600 text-sm">{error}</div>}
      </form>

      <button
        onClick={() => navigate('/')}
        className="mt-4 text-sm text-gray-500 hover:underline"
      >
        Omitir (ir al dashboard)
      </button>
    </div>
  );
};

export default Onboarding;
