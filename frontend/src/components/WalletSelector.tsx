import React from 'react';
import type { Wallet } from '../types';

interface Props {
  wallets: Wallet[];
  selectedWalletId?: number;
  onWalletChange: (id: number | undefined) => void;
}

const WalletSelector: React.FC<Props> = ({ wallets, selectedWalletId, onWalletChange }) => {
  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-surface">
      <span className="pl-3 pr-1 text-xs text-muted">Scope</span>
      <select
        value={selectedWalletId ?? 'all'}
        onChange={(e) => onWalletChange(e.target.value === 'all' ? undefined : Number(e.target.value))}
        className="num cursor-pointer rounded-xl bg-transparent py-2 pl-1 pr-3 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/40"
      >
        <option value="all">Todas las wallets</option>
        {wallets.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} · {w.type}
          </option>
        ))}
      </select>
    </div>
  );
};

export default WalletSelector;
