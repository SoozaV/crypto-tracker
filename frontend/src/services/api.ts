import axios from 'axios';
import type {
  Wallet,
  AssetCatalog,
  AssetDetail,
  PortfolioSummary,
  Transaction,
  TransactionCreate,
  OhlcvResponse,
  CoinSearchResult,
  ExportBundle,
  ImportReport,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000,
});

export const getWallets = async (): Promise<Wallet[]> => {
  const res = await api.get('/wallets');
  return res.data;
};

export const getAssetCatalog = async (): Promise<AssetCatalog[]> => {
  const res = await api.get('/assets');
  return res.data;
};

export const getAssetDetail = async (assetId: number, walletId?: number): Promise<AssetDetail> => {
  const params = walletId ? { wallet_id: walletId } : {};
  const res = await api.get(`/asset/${assetId}`, { params });
  return res.data;
};

export const getPortfolioSummary = async (walletId?: number): Promise<PortfolioSummary> => {
  const params = walletId ? { wallet_id: walletId } : {};
  const res = await api.get('/portfolio/summary', { params });
  return res.data;
};

export const getTransactions = async (walletId?: number, assetId?: number): Promise<Transaction[]> => {
  const params: Record<string, number> = {};
  if (walletId !== undefined) params.wallet_id = walletId;
  if (assetId !== undefined) params.asset_id = assetId;
  const res = await api.get('/transactions', { params });
  return res.data;
};

export const createTransaction = async (data: TransactionCreate): Promise<Transaction> => {
  const res = await api.post('/transactions', data);
  return res.data;
};

export const deleteTransaction = async (id: number): Promise<{ deleted: number }> => {
  const res = await api.delete(`/transactions/${id}`);
  return res.data;
};

export const searchCoins = async (q: string): Promise<CoinSearchResult[]> => {
  const res = await api.get('/coins/search', { params: { q } });
  return res.data;
};

export const renameWallet = async (
  id: number,
  data: { name?: string; type?: string },
): Promise<Wallet> => {
  const res = await api.patch(`/wallets/${id}`, data);
  return res.data;
};

export const exportData = async (walletId?: number): Promise<ExportBundle> => {
  const res = await api.get('/export', { params: walletId ? { wallet_id: walletId } : {} });
  return res.data;
};

export const importData = async (payload: ExportBundle): Promise<ImportReport> => {
  const res = await api.post('/import', payload);
  return res.data;
};

export const resetAll = async (): Promise<{ deleted: Record<string, number> }> => {
  const res = await api.post('/admin/reset', { confirm: true });
  return res.data;
};

export const setupInitialBalance = async (payload: {
  wallet_name: string;
  symbol: string;
  quantity: string;
  total_cost: string;
  decimals?: number;
  wallet_type?: string;
  name?: string;
  coingecko_id?: string;
  binance_symbol?: string;
  date?: string;
}): Promise<{ transaction_id: number; wallet_id: number; asset_id: number }> => {
  const res = await api.post('/setup', payload);
  return res.data;
};

export const getOhlcv = async (
  assetId: number,
  opts: { interval?: string; limit?: number } = {},
): Promise<OhlcvResponse> => {
  const res = await api.get(`/asset/${assetId}/ohlcv`, {
    params: { interval: opts.interval ?? '1d', limit: opts.limit ?? 300 },
  });
  return res.data;
};

/** Fuerza la actualización del histórico OHLCV (mismo trabajo que el cron diario). */
export const refreshPriceHistory = async (days: number = 200): Promise<unknown> => {
  const res = await api.post('/admin/refresh-prices', null, { params: { days } });
  return res.data;
};

export default api;