import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { ThemeProvider, useTheme } from './theme';
import { usePortfolioSummary, useCatalog } from './hooks/usePortfolio';
import Dashboard from './components/Dashboard';
import WalletSelector from './components/WalletSelector';
import AssetList from './components/AssetList';
import AllocationChart from './components/AllocationChart';
import AssetDetail from './components/AssetDetail';
import TransactionForm from './components/TransactionForm';
import TransactionHistory from './components/TransactionHistory';
import Onboarding from './components/Onboarding';
import Settings from './components/Settings';
import { Spinner } from './components/ui';
import { formatClock } from './utils/format';

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Cambiar tema"
      className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted hover:text-ink"
    >
      {theme === 'dark' ? '☀︎' : '☾'}
    </button>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const [walletId, setWalletId] = useState<number | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const catalog = useCatalog(refreshKey);
  const portfolio = usePortfolioSummary(walletId, refreshKey);

  const bump = () => setRefreshKey((k) => k + 1);

  // Refresco automático cada 5 minutos (tarea 5.12). Refresca EN SITIO vía
  // refreshKey; ya no remonta los componentes (sin parpadeo de skeletons).
  useEffect(() => {
    const id = setInterval(bump, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const updated = portfolio.updatedAt ? formatClock(portfolio.updatedAt) : null;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Cabecera */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 text-lg font-semibold text-ink">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">◈</span>
              Crypto Tracker
            </Link>
            <span className="num rounded-md bg-surface2 px-1.5 py-0.5 text-[0.7rem] text-muted">spot · USDT</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {catalog.wallets.length > 0 ? (
              <WalletSelector wallets={catalog.wallets} selectedWalletId={walletId} onWalletChange={setWalletId} />
            ) : (
              <Link to="/onboarding" className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
                Configura tu primera wallet →
              </Link>
            )}
            <button
              onClick={() => portfolio.reload()}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted hover:text-ink"
              title={updated ? `Actualizado a las ${updated}` : 'Actualizar'}
            >
              {portfolio.loading ? <Spinner /> : '↻'}
              <span className="num hidden sm:inline">{updated ?? '—'}</span>
            </button>
            <Link to="/onboarding" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted hover:text-ink">
              Setup
            </Link>
            <Link to="/settings" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted hover:text-ink">
              Ajustes
            </Link>
            <ThemeToggle />
          </div>
        </header>

        {portfolio.error && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-loss/40 bg-loss/10 px-4 py-3">
            <span className="text-sm text-loss">{portfolio.error}</span>
            <button
              onClick={() => portfolio.reload()}
              className="rounded-lg border border-loss/40 px-3 py-1.5 text-sm text-loss hover:bg-loss/10"
            >
              Reintentar
            </button>
          </div>
        )}

        <Routes>
          <Route
            path="/"
            element={
              <div className="space-y-6">
                <Dashboard summary={portfolio.summary} loading={portfolio.loading} error={portfolio.error} />
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <AssetList summary={portfolio.summary} loading={portfolio.loading} error={portfolio.error} />
                  </div>
                  <AllocationChart summary={portfolio.summary} loading={portfolio.loading} />
                </div>
                <TransactionForm
                  wallets={catalog.wallets}
                  assets={catalog.assets}
                  walletId={walletId}
                  onSuccess={bump}
                />
                <TransactionHistory walletId={walletId} wallets={catalog.wallets} assets={catalog.assets} refreshKey={refreshKey} onChanged={bump} />
              </div>
            }
          />
          <Route path="/asset/:assetId" element={<AssetDetail walletId={walletId} />} />
          <Route path="/settings" element={<Settings wallets={catalog.wallets} onChanged={bump} />} />
          <Route
            path="/onboarding"
            element={<Onboarding wallets={catalog.wallets} onComplete={() => { bump(); navigate('/'); }} />}
          />
        </Routes>

        <footer className="mt-10 border-t border-line pt-5 text-center text-xs text-muted">
          Local y privado · Precios en tiempo real vía CoinGecko · Velas de Binance · Precisión con Decimal.js
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ThemeProvider>
  );
}
