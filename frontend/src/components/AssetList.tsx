import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPortfolioSummary } from '../services/api';
import type { AssetDetail } from '../types';
import { formatQuantity, formatCurrency, formatPercentage, getSign, toDecimal } from '../utils/decimalHelper';

interface AssetListProps {
  walletId?: number;
}

const AssetList: React.FC<AssetListProps> = ({ walletId }) => {
  const [assets, setAssets] = useState<AssetDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const summary = await getPortfolioSummary(walletId);
      const held = summary.assets.filter((a) => !toDecimal(a.quantity).isZero());
      setAssets(held);
      setError(null);
    } catch (err) {
      console.error('Error fetching assets:', err);
      setError('Error al cargar los activos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [walletId]);

  const getColor = (value: string | null) => {
    const sign = getSign(value);
    if (sign === 'zero') return 'text-gray-500';
    return sign === 'positive' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  };

  const getBg = (value: string | null) => {
    const sign = getSign(value);
    if (sign === 'zero') return 'bg-gray-100 dark:bg-gray-800';
    return sign === 'positive' ? 'bg-green-50 dark:bg-green-900/30' : 'bg-red-50 dark:bg-red-900/30';
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-14 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
        <div className="h-14 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
        <div className="h-14 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
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

  if (assets.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center text-gray-500 dark:text-gray-400">
        <p className="text-lg">No tienes activos en esta wallet</p>
        <p className="text-sm mt-1">Agrega una transacción de compra o depósito para comenzar</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900/50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Activo
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Cantidad
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Precio Prom.
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Precio Actual
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              PnL (USDT)
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              ROI
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              % Portafolio
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {assets.map((asset) => (
            <tr
              key={asset.asset_id}
              className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <Link to={`/asset/${asset.asset_id}`} className="flex items-center group">
                  <div className="flex-shrink-0 h-8 w-8 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-xs">
                    {asset.symbol.substring(0, 3).toUpperCase()}
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {asset.symbol.toUpperCase()}
                    </p>
                    {asset.name && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">{asset.name}</p>
                    )}
                  </div>
                </Link>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 dark:text-white font-mono">
                {formatQuantity(asset.quantity, asset.decimals ?? 8)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-300 font-mono">
                {formatCurrency(asset.avg_price)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-300 font-mono">
                {asset.price_now != null ? formatCurrency(asset.price_now) : '—'}
              </td>
              <td
                className={`px-6 py-4 whitespace-nowrap text-right text-sm font-mono font-medium ${getColor(asset.unrealized_pnl)}`}
              >
                <span className={`px-2 py-1 rounded ${getBg(asset.unrealized_pnl)}`}>
                  {formatCurrency(asset.unrealized_pnl)}
                </span>
              </td>
              <td
                className={`px-6 py-4 whitespace-nowrap text-right text-sm font-mono font-medium ${getColor(asset.roi_pct)}`}
              >
                {formatPercentage(asset.roi_pct)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-300 font-mono">
                {formatPercentage(asset.allocation_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AssetList;
