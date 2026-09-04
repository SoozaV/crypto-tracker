import React, { useEffect, useState } from 'react';
import { getTransactions } from '../services/api';
import type { Transaction } from '../types';
import { formatCurrency, formatQuantity } from '../utils/decimalHelper';

interface TransactionHistoryProps {
  walletId?: number;
  assetId?: number;
}

const TransactionHistory: React.FC<TransactionHistoryProps> = ({ walletId, assetId }) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await getTransactions(walletId, assetId);
      setTransactions(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching transactions:', err);
      setError('Error al cargar el historial');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [walletId, assetId]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="animate-pulse space-y-2">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 p-4 rounded-xl">
        {error}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
          Historial
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
          No hay transacciones registradas
        </p>
      </div>
    );
  }

  const getTypeBadge = (type: string) => {
    const isPositive = type === 'BUY' || type === 'DEPOSIT';
    const bg = isPositive
      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${bg}`}>{type}</span>;
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
        Historial de Transacciones
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="text-left py-2 font-medium">Tipo</th>
              <th className="text-left py-2 font-medium">Activo</th>
              <th className="text-right py-2 font-medium">Cantidad</th>
              <th className="text-right py-2 font-medium">Precio</th>
              <th className="text-right py-2 font-medium">Fee (USDT)</th>
              <th className="text-right py-2 font-medium">Fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {transactions.map((tx) => (
              <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                <td className="py-2">{getTypeBadge(tx.type)}</td>
                <td className="py-2 text-gray-600 dark:text-gray-300">
                  {tx.asset_symbol ?? tx.asset_id}
                </td>
                <td className="py-2 text-right font-mono">
                  {formatQuantity(tx.quantity, 8)}
                </td>
                <td className="py-2 text-right font-mono">
                  {formatCurrency(tx.price)}
                </td>
                <td className="py-2 text-right font-mono">
                  {formatCurrency(tx.fee_usdt)}
                </td>
                <td className="py-2 text-right text-gray-500 dark:text-gray-400 text-xs">
                  {new Date(tx.date_utc).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TransactionHistory;
