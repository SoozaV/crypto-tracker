import axios from 'axios';
import type {
  Wallet,
  AssetCatalog,
  AssetDetail,
  PortfolioSummary,
  Transaction,
  TransactionCreate,
  OhlcvResponse,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
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

export const getOhlcv = async (assetId: number, days: number = 30): Promise<OhlcvResponse> => {
  const res = await api.get(`/asset/${assetId}/ohlcv`, { params: { days } });
  return res.data;
};

export default api;