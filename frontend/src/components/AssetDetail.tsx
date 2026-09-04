import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { createChart, LineStyle, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { getAssetDetail, getOhlcv, refreshPriceHistory } from '../services/api';
import type { AssetDetail as AssetDetailType, OhlcvCandle } from '../types';
import {
  formatCurrency,
  formatQuantity,
  formatPercentage,
  toDecimal,
} from '../utils/decimalHelper';
import { useTheme } from '../theme';
import { Card, SectionLabel, ChangeChip, signClass, Spinner } from './ui';

interface Props {
  walletId?: number;
}
interface DetailWithCandles extends AssetDetailType {
  candles: OhlcvCandle[];
}

/**
 * Lee un token de color del tema (formato "R G B") y lo devuelve como
 * rgb(R, G, B). Ojo: Lightweight Charts NO parsea la sintaxis con espacios
 * `rgb(15 23 42)`; necesita comas, de ahí el split/join.
 */
function cssRgb(varName: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!v) return '#888888';
  const parts = v.split(/\s+/);
  return parts.length === 3 ? `rgb(${parts.join(', ')})` : v;
}

const PERIODS = [7, 30, 90, 365];

const AssetDetail: React.FC<Props> = ({ walletId }) => {
  const { assetId } = useParams<{ assetId: string }>();
  const { theme } = useTheme();
  const chartRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<DetailWithCandles | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!assetId) return;
    try {
      setLoading(true);
      const [det, ohlcv] = await Promise.all([
        getAssetDetail(Number(assetId), walletId),
        getOhlcv(Number(assetId), days),
      ]);
      setDetail({ ...det, candles: ohlcv.candles });
      setError(null);
    } catch {
      setError('No se pudo cargar el activo.');
    } finally {
      setLoading(false);
    }
  }, [assetId, walletId, days]);

  useEffect(() => {
    load();
  }, [load]);

  const doRefreshHistory = async () => {
    if (!assetId) return;
    setRefreshing(true);
    try {
      await refreshPriceHistory(Math.max(days, 200));
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  // Gráfico: se reconstruye cuando cambian los datos o el tema.
  useEffect(() => {
    if (!chartRef.current || !detail?.candles?.length) return;
    const container = chartRef.current;
    container.innerHTML = '';

    const textColor = cssRgb('--text');
    const gridColor = cssRgb('--border');
    const gain = cssRgb('--gain');
    const loss = cssRgb('--loss');
    const accent = cssRgb('--accent');

    const chart: IChartApi = createChart(container, {
      layout: { background: { color: 'transparent' }, textColor },
      // Locale explícito: no dependemos del locale del sistema (que en algunos
      // entornos es inválido y rompería el formateo del eje de tiempo).
      localization: { locale: 'es-ES' },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor: gridColor },
      timeScale: { borderColor: gridColor, timeVisible: false },
      width: container.clientWidth || 600,
      height: 380,
      crosshair: { horzLine: { labelBackgroundColor: accent }, vertLine: { labelBackgroundColor: accent } },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: gain,
      downColor: loss,
      wickUpColor: gain,
      wickDownColor: loss,
      borderVisible: false,
    });

    const candleData = detail.candles.map((c) => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000) as UTCTimestamp,
      open: Number(toDecimal(c.open).toString()),
      high: Number(toDecimal(c.high).toString()),
      low: Number(toDecimal(c.low).toString()),
      close: Number(toDecimal(c.close).toString()),
    }));
    candleSeries.setData(candleData);

    // Línea de coste promedio del usuario (ámbar), superpuesta al precio.
    if (detail.avg_price && !toDecimal(detail.avg_price).isZero() && candleData.length) {
      const avg = Number(toDecimal(detail.avg_price).toString());
      const avgSeries = chart.addLineSeries({
        color: accent,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'Tu prom.',
      });
      avgSeries.setData(candleData.map((d) => ({ time: d.time, value: avg })));
    }

    chart.timeScale().fitContent();

    // ResizeObserver: mantiene el ancho sincronizado aunque el contenedor cambie
    // de tamaño por el layout (más fiable que el evento 'resize' de la ventana).
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w > 0) chart.applyOptions({ width: w });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [detail, theme]);

  if (loading && !detail) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-40 rounded bg-surface2" />
        <div className="h-96 rounded-2xl bg-surface2" />
      </div>
    );
  }
  if (error || !detail) {
    return <Card className="p-5 text-sm text-loss">{error ?? 'Activo no encontrado.'}</Card>;
  }

  const stats: Array<{ k: string; v: string; cls?: string }> = [
    { k: 'Cantidad', v: formatQuantity(detail.quantity, detail.decimals ?? 8) },
    { k: 'Tu precio prom.', v: formatCurrency(detail.avg_price), cls: 'text-accent' },
    { k: 'Precio actual', v: detail.price_now != null ? formatCurrency(detail.price_now) : '—' },
    { k: 'Valor', v: formatCurrency(detail.value) },
    { k: 'Coste', v: formatCurrency(detail.cost_basis) },
    { k: 'PnL no realizado', v: formatCurrency(detail.unrealized_pnl), cls: signClass(detail.unrealized_pnl) },
    { k: 'PnL realizado', v: formatCurrency(detail.realized_pnl), cls: signClass(detail.realized_pnl) },
    { k: 'ROI (tu rendimiento)', v: formatPercentage(detail.roi_pct), cls: signClass(detail.roi_pct) },
    { k: 'Asignación', v: formatPercentage(detail.allocation_pct) },
  ];

  return (
    <div className="space-y-5">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        ← Volver al portafolio
      </Link>

      {/* Cabecera del activo */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="num flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-sm font-semibold text-accent">
              {detail.symbol.slice(0, 3).toUpperCase()}
            </span>
            <div>
              <h2 className="text-xl font-semibold text-ink">{detail.symbol.toUpperCase()}</h2>
              {detail.name && <p className="text-sm text-muted">{detail.name}</p>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[0.7rem] text-muted">Mercado (precio)</span>
            <div className="flex items-center gap-2">
              <ChangeChip value={detail.changes?.change_24h_pct} label="24h" />
              <ChangeChip value={detail.changes?.change_7d_pct} label="7d" />
              <ChangeChip value={detail.changes?.change_30d_pct} label="30d" />
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted">
          <span className="text-ink">Mercado</span> = cuánto se movió el precio del activo en cada ventana (igual para todos).{' '}
          <span className="text-ink">Tu ROI</span> = tu rendimiento según tu coste promedio. Son cosas distintas.
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.k}>
              <dt className="text-xs text-muted">{s.k}</dt>
              <dd className={`num mt-0.5 text-sm font-medium ${s.cls ?? 'text-ink'}`}>{s.v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Gráfico */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Precio y tu coste promedio</SectionLabel>
          <div className="flex items-center gap-2">
            <button
              onClick={doRefreshHistory}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink disabled:opacity-50"
            >
              {refreshing ? <Spinner /> : '↻'} Actualizar velas
            </button>
            <div className="flex rounded-lg border border-line p-0.5">
              {PERIODS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`num rounded-md px-2.5 py-1 text-xs transition-colors ${
                    days === d ? 'bg-accent text-white' : 'text-muted hover:text-ink'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>
        <div ref={chartRef} className="h-[380px] w-full" />
      </Card>
    </div>
  );
};

export default AssetDetail;
