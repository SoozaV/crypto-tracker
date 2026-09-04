export interface Wallet {
  id: number;
  name: string;
  type: string;
}

export interface AssetCatalog {
  id: number;
  symbol: string;
  name: string | null;
  decimals: number;
  coingecko_id: string | null;
  binance_symbol: string | null;
}

export interface PriceChanges {
  symbol: string;
  price: string | null;
  change_24h_pct: string | null;
  change_7d_pct: string | null;
  change_30d_pct: string | null;
}

/** Fila de activo dentro de /portfolio/summary o /asset/{id}. */
export interface AssetDetail {
  asset_id: number;
  symbol: string;
  name: string | null;
  quantity: string;
  avg_price: string;
  price_now: string | null;
  price_available: boolean;
  value: string;
  cost_basis: string;
  unrealized_pnl: string;
  realized_pnl: string;
  roi_pct: string | null;
  allocation_pct: string;
  decimals?: number;
  scope?: string;
  wallet_id?: number | null;
  changes?: PriceChanges;
}

export interface PortfolioSummary {
  scope: string;
  wallet_id: number | null;
  total_value: string;
  total_cost_basis: string;
  total_unrealized_pnl: string;
  total_realized_pnl: string;
  total_roi_pct: string | null;
  assets: AssetDetail[];
}

export interface Transaction {
  id: number;
  wallet_id: number;
  asset_id: number;
  type: "BUY" | "SELL" | "DEPOSIT" | "WITHDRAWAL";
  quantity: string;
  price: string;
  fee: string;
  fee_currency: string;
  fee_usdt: string;
  date_utc: string;
  asset_symbol?: string;
}

/** Payload de POST /api/transactions (TransactionIn del backend). */
export interface TransactionCreate {
  wallet_id: number;
  asset_id: number;
  type: "BUY" | "SELL" | "DEPOSIT" | "WITHDRAWAL";
  quantity: string;
  price: string;
  fee?: string;
  fee_currency?: string;
  fee_usdt?: string | null;
  date: string;
}

export interface OhlcvCandle {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface OhlcvResponse {
  asset_id: number;
  symbol: string;
  days: number;
  candles: OhlcvCandle[];
}
