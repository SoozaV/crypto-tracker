import { useEffect, useRef, useState } from 'react';
import { searchCoins } from '../services/api';
import type { CoinSearchResult } from '../types';
import { Spinner } from './ui';

export interface PickedCoin {
  symbol: string;
  name: string;
  coingecko_id: string;
  binance_symbol: string;
}

interface Props {
  value: PickedCoin | null;
  onPick: (coin: PickedCoin) => void;
}

const field =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/40 placeholder:text-muted';

/**
 * Busca la moneda en CoinGecko y deja elegir la correcta. Así el coingecko_id
 * queda ligado a la elección (no puedes poner símbolo BTC con id de otra moneda).
 * El par de Binance se propone como {SÍMBOLO}USDT (editable en avanzado).
 */
export default function AssetPicker({ value, onPick }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CoinSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      searchCoins(q.trim())
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300); // debounce
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (c: CoinSearchResult) => {
    onPick({
      symbol: c.symbol,
      name: c.name ?? c.symbol,
      coingecko_id: c.id,
      binance_symbol: `${c.symbol.toUpperCase()}USDT`,
    });
    setQ('');
    setResults([]);
    setOpen(false);
  };

  const hasValue = !!value?.symbol;

  return (
    <div ref={boxRef} className="relative">
      {hasValue ? (
        <div className="flex items-center justify-between rounded-lg border border-line bg-surface2 px-3 py-2">
          <span className="text-sm text-ink">
            <span className="num font-medium">{value.symbol}</span>
            <span className="text-muted"> · {value.name}</span>
            <span className="num ml-2 text-xs text-muted">({value.coingecko_id})</span>
          </span>
          <button
            type="button"
            onClick={() => {
              onPick({ symbol: '', name: '', coingecko_id: '', binance_symbol: '' });
              setQ('');
              setResults([]);
              setOpen(false);
            }}
            className="text-xs text-muted hover:text-ink"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Busca la moneda: bitcoin, ETH, solana…"
          className={field}
          autoComplete="off"
        />
      )}

      {open && !hasValue && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface shadow-xl">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
              <Spinner /> Buscando…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted">Sin resultados</div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface2"
            >
              {c.thumb && <img src={c.thumb} alt="" className="h-5 w-5 rounded-full" />}
              <span className="num font-medium text-ink">{c.symbol}</span>
              <span className="text-muted">{c.name}</span>
              {c.market_cap_rank != null && (
                <span className="num ml-auto text-xs text-muted">#{c.market_cap_rank}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
