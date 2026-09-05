import { useCallback, useEffect, useState } from 'react';
import { getPortfolioSummary, getWallets, getAssetCatalog } from '../services/api';
import type { PortfolioSummary, Wallet, AssetCatalog } from '../types';

/**
 * Fuente única del resumen del portafolio. Antes Dashboard, AssetList y
 * AllocationChart pedían /portfolio/summary por separado (3 llamadas idénticas
 * por render). Aquí se pide UNA vez y se comparte. `reload()` refresca en sitio
 * (sin desmontar componentes, así el refresco de 5 min no parpadea).
 */
export function usePortfolioSummary(walletId: number | undefined, refreshKey: number) {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(
    async (showSpinner = true) => {
      // Reintentos ante un blip del backend (p. ej. si uvicorn se recargó justo
      // en ese instante). Así un F5 desafortunado no muestra el error de golpe.
      const attempts = 3;
      for (let i = 0; i < attempts; i++) {
        try {
          if (showSpinner && i === 0) setLoading(true);
          const data = await getPortfolioSummary(walletId);
          setSummary(data);
          setUpdatedAt(new Date());
          setError(null);
          setLoading(false);
          return;
        } catch {
          if (i < attempts - 1) {
            await new Promise((r) => setTimeout(r, 700 * (i + 1)));
            continue;
          }
          setError('No se pudo cargar el portafolio. ¿Está el backend en marcha?');
          setLoading(false);
        }
      }
    },
    [walletId],
  );

  // showSpinner solo en el primer load de cada scope; los refrescos son silenciosos.
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);

  useEffect(() => {
    if (refreshKey > 0) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return { summary, loading, error, updatedAt, reload: () => load(false) };
}

/** Catálogo (wallets + activos), compartido por el selector y el formulario. */
export function useCatalog(refreshKey: number) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [assets, setAssets] = useState<AssetCatalog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getWallets(), getAssetCatalog()])
      .then(([w, a]) => {
        if (!alive) return;
        setWallets(w);
        setAssets(a);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return { wallets, assets, loading };
}
