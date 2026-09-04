import React, { useEffect, useState } from 'react';
import { getWallets } from '../services/api';
import type { Wallet } from '../types';

interface WalletSelectorProps {
  selectedWalletId?: number;
  onWalletChange: (id: number | undefined) => void;
}

const WalletSelector: React.FC<WalletSelectorProps> = ({ selectedWalletId, onWalletChange }) => {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWallets()
      .then(setWallets)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="w-48 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"></div>;
  }

  if (wallets.length === 0) {
    return (
      <div className="text-sm text-yellow-600 dark:text-yellow-400">
        Sin wallets. Usa Setup.
      </div>
    );
  }

  return (
    <select
      value={selectedWalletId ?? 'all'}
      onChange={(e) => onWalletChange(e.target.value === 'all' ? undefined : Number(e.target.value))}
      className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition"
    >
      <option value="all">Todas</option>
      {wallets.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name} ({w.type})
        </option>
      ))}
    </select>
  );
};

export default WalletSelector;
