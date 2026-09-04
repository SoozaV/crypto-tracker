import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import WalletSelector from './components/WalletSelector';
import AssetList from './components/AssetList';
import AllocationChart from './components/AllocationChart';
import AssetDetail from './components/AssetDetail';
import TransactionForm from './components/TransactionForm';
import TransactionHistory from './components/TransactionHistory';
import Onboarding from './components/Onboarding';

function AppContent() {
  const [selectedWalletId, setSelectedWalletId] = useState<number | undefined>(undefined);
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setRefreshKey(prev => prev + 1), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              🪙 Crypto Tracker
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">v0.2</span>
            </Link>
            <button
              onClick={() => navigate('/onboarding')}
              className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-300"
            >
              ⚙️ Setup
            </button>
          </div>
          <WalletSelector selectedWalletId={selectedWalletId} onWalletChange={setSelectedWalletId} />
        </div>

        <Routes>
          <Route path="/" element={
            <>
              <Dashboard key={refreshKey} walletId={selectedWalletId} />
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6">
                <div className="lg:col-span-3">
                  <AssetList key={refreshKey} walletId={selectedWalletId} />
                </div>
                <div className="lg:col-span-1">
                  <AllocationChart key={refreshKey} walletId={selectedWalletId} />
                </div>
              </div>
              <div className="mt-6">
                <TransactionForm walletId={selectedWalletId} onSuccess={() => setRefreshKey(prev => prev + 1)} />
              </div>
              <div className="mt-6">
                <TransactionHistory key={refreshKey} walletId={selectedWalletId} />
              </div>
            </>
          } />
          <Route path="/asset/:assetId" element={<AssetDetail walletId={selectedWalletId} />} />
          <Route path="/onboarding" element={<Onboarding onComplete={() => { navigate('/'); setRefreshKey(prev => prev + 1); }} />} />
        </Routes>

        <footer className="mt-8 text-center text-xs text-gray-400 dark:text-gray-600 border-t border-gray-200 dark:border-gray-800 pt-4">
          Datos en tiempo real vía CoinGecko · Precios en USDT · Precisión con Decimal.js
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}