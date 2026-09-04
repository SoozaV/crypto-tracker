import React, { useEffect, useState } from 'react';
import { getPortfolioSummary } from '../services/api';
import type { PortfolioSummary } from '../types';
import { formatCurrency, formatPercentage, getSign } from '../utils/decimalHelper';

interface DashboardProps {
  walletId?: number;
}

const Dashboard: React.FC<DashboardProps> = ({ walletId }) => {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await getPortfolioSummary(walletId);
      setSummary(data);
      setError(null);
    } catch {
      setError('Error al cargar el resumen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [walletId]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 animate-pulse">
        <div className="h-28 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
        <div className="h-28 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
        <div className="h-28 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 p-4 rounded-xl mb-6">
        {error || 'Sin datos disponibles'}
      </div>
    );
  }

  const getColorClass = (value: string | null) => {
    const sign = getSign(value);
    if (sign === 'zero') return 'text-gray-500';
    return sign === 'positive' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Valor Total
        </h3>
        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
          {formatCurrency(summary.total_value)}
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          PnL Total (No realizado)
        </h3>
        <p className={`text-2xl font-bold mt-1 ${getColorClass(summary.total_unrealized_pnl)}`}>
          {formatCurrency(summary.total_unrealized_pnl)}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Realizado: {formatCurrency(summary.total_realized_pnl)}
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          ROI Total
        </h3>
        <p className={`text-2xl font-bold mt-1 ${getColorClass(summary.total_roi_pct)}`}>
          {formatPercentage(summary.total_roi_pct)}
        </p>
      </div>
    </div>
  );
};

export default Dashboard;
