import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { getAssetDetail, getOhlcv, refreshPriceHistory } from '../services/api';
import type { AssetDetail as AssetDetailType, OhlcvCandle, Interval } from '../types';
import {
  formatCurrency,
  formatPrice,
  formatQuantity,
  formatPercentage,
  toDecimal,
} from '../utils/decimalHelper';
import { useTheme } from '../theme';
import { Card, SectionLabel, ChangeChip, signClass, Spinner } from './ui';
import { INDICATORS } from '../indicators/registry';
import type { OHLCV, IndicatorLine } from '../indicators/types';

interface Props {
  walletId?: number;
}
interface DetailWithCandles extends AssetDetailType {
  candles: OhlcvCandle[];
}

function cssRgb(varName: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!v) return '#888888';
  const parts = v.split(/\s+/);
  return parts.length === 3 ? `rgb(${parts.join(', ')})` : v;
}

const INTERVALS: Array<{ label: string; value: Interval }> = [
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
  { label: '1s', value: '1w' },
];
const limitFor = (i: Interval) => (i === '1d' ? 365 : i === '1w' ? 300 : 400);

const AssetDetail: React.FC<Props> = ({ walletId }) => {
  const { assetId } = useParams<{ assetId: string }>();
  const { theme } = useTheme();
  const mainRef = useRef<HTMLDivElement>(null);
  const oscRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<DetailWithCandles | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState<Interval>('1d');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    if (!assetId) return;
    try {
      setLoading(true);
      const [det, ohlcv] = await Promise.all([
        getAssetDetail(Number(assetId), walletId),
        getOhlcv(Number(assetId), { interval, limit: limitFor(interval) }),
      ]);
      setDetail({ ...det, candles: ohlcv.candles });
      setError(null);
    } catch {
      setError('No se pudo cargar el activo.');
    } finally {
      setLoading(false);
    }
  }, [assetId, walletId, interval]);

  useEffect(() => {
    load();
  }, [load]);

  const doRefreshHistory = async () => {
    if (!assetId) return;
    setRefreshing(true);
    try {
      await refreshPriceHistory(365);
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const activeOscillators = INDICATORS.filter((i) => active.has(i.id) && i.pane === 'oscillator');
  const hasOsc = activeOscillators.length > 0;

  // Construcción del gráfico: velas + overlays + osciladores (panel sincronizado).
  useEffect(() => {
    if (!mainRef.current || !detail?.candles?.length) return;
    const container = mainRef.current;
    container.innerHTML = '';

    const textColor = cssRgb('--text');
    const gridColor = cssRgb('--border');
    const gain = cssRgb('--gain');
    const loss = cssRgb('--loss');
    const accent = cssRgb('--accent');
    const intraday = interval === '1h' || interval === '4h';

    const baseOpts = {
      layout: { background: { color: 'transparent' }, textColor },
      localization: { locale: 'es-ES' },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor: gridColor },
      crosshair: {
        horzLine: { labelBackgroundColor: accent },
        vertLine: { labelBackgroundColor: accent },
      },
    };

    const main: IChartApi = createChart(container, {
      ...baseOpts,
      timeScale: { borderColor: gridColor, timeVisible: intraday, secondsVisible: false },
      width: container.clientWidth || 600,
      height: 360,
    });

    const candleSeries = main.addCandlestickSeries({
      upColor: gain, downColor: loss, wickUpColor: gain, wickDownColor: loss, borderVisible: false,
    });

    const num = (v: string) => Number(toDecimal(v).toString());
    const candleData = detail.candles.map((c) => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000) as UTCTimestamp,
      open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close),
    }));
    candleSeries.setData(candleData);

    // Línea de coste promedio del usuario (ámbar).
    if (detail.avg_price && !toDecimal(detail.avg_price).isZero()) {
      const avg = num(detail.avg_price);
      const avgSeries = main.addLineSeries({
        color: accent, lineWidth: 2, lineStyle: LineStyle.Dashed,
        priceLineVisible: false, lastValueVisible: true, title: 'Tu prom.',
      });
      avgSeries.setData(candleData.map((d) => ({ time: d.time, value: avg })));
    }

    // Velas como OHLCV numérico para los indicadores.
    const ohlcvNum: OHLCV[] = candleData.map((d) => ({
      time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
    }));

    // Dibuja una línea; si trae colorAt, la parte en tramos de color (verde/rojo/
    // gris) manteniéndola continua (solape de 1 punto). Traduce el `color := …`
    // condicional de Pine. Devuelve una serie (para colgar niveles de referencia).
    const drawLine = (chart: IChartApi, line: IndicatorLine, width = 2): ISeriesApi<'Line'> | null => {
      const pts = line.data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
      if (pts.length === 0) return null;
      const lw = width as 1 | 2 | 3 | 4;
      if (!line.colorAt) {
        const s = chart.addLineSeries({ color: line.color, lineWidth: lw, priceLineVisible: false, lastValueVisible: false });
        s.setData(pts);
        return s;
      }
      const colorAt = line.colorAt;
      const segments: { color: string; data: typeof pts }[] = [];
      for (let i = 0; i < pts.length; i++) {
        const col = colorAt(pts[i].value);
        const last = segments[segments.length - 1];
        if (!last || last.color !== col) {
          const seg = { color: col, data: [] as typeof pts };
          if (i > 0) seg.data.push(pts[i - 1]); // solape para que los tramos se toquen
          seg.data.push(pts[i]);
          segments.push(seg);
        } else {
          last.data.push(pts[i]);
        }
      }
      let lastSeries: ISeriesApi<'Line'> | null = null;
      for (const seg of segments) {
        const s = chart.addLineSeries({ color: seg.color, lineWidth: lw, priceLineVisible: false, lastValueVisible: false });
        s.setData(seg.data);
        lastSeries = s;
      }
      return lastSeries;
    };

    // Overlays (SMA, EMA cross) sobre el panel de precio.
    for (const ind of INDICATORS) {
      if (!active.has(ind.id) || ind.pane !== 'price') continue;
      const res = ind.compute(ohlcvNum);
      for (const line of res.lines) drawLine(main, line, line.lineWidth ?? 2);
    }

    main.timeScale().fitContent();

    // Panel de osciladores (RSI/Stoch/Ichimoku), sincronizado con el principal.
    let osc: IChartApi | null = null;
    if (hasOsc && oscRef.current) {
      const oc = oscRef.current;
      oc.innerHTML = '';
      osc = createChart(oc, {
        ...baseOpts,
        timeScale: { borderColor: gridColor, timeVisible: intraday, secondsVisible: false, visible: true },
        width: oc.clientWidth || 600,
        height: 150,
      });

      // Serie "fantasma" (whitespace) que cubre TODO el rango de velas. Sin esto,
      // el oscilador tendría menos puntos (los indicadores empiezan más tarde por
      // el warm-up) y su fitContent estiraría un rango distinto -> desalineado.
      const ghost = osc.addLineSeries({ lastValueVisible: false, priceLineVisible: false });
      ghost.setData(candleData.map((d) => ({ time: d.time })));

      let levelSeries: ISeriesApi<'Line'> | null = null;
      for (const ind of activeOscillators) {
        const res = ind.compute(ohlcvNum);
        for (const line of res.lines) {
          const s = drawLine(osc, line, 2);
          if (s && !levelSeries) levelSeries = s;
        }
        if (res.levels && levelSeries) {
          for (const lv of res.levels) {
            levelSeries.createPriceLine({
              price: lv, color: gridColor, lineWidth: 1,
              lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
            });
          }
        }
      }

      // Mismo rango visible que el principal (ambos tienen ahora el mismo dominio
      // temporal, así que los índices lógicos coinciden -> alineados).
      const mainRange = main.timeScale().getVisibleLogicalRange();
      if (mainRange) osc.timeScale().setVisibleLogicalRange(mainRange);
      else osc.timeScale().fitContent();

      // Sincronizar rango temporal en ambos sentidos (con guardia anti-bucle).
      let syncing = false;
      const mts = main.timeScale();
      const ots = osc.timeScale();
      mts.subscribeVisibleLogicalRangeChange((r) => {
        if (syncing || !r || !osc) return;
        syncing = true; ots.setVisibleLogicalRange(r); syncing = false;
      });
      ots.subscribeVisibleLogicalRangeChange((r) => {
        if (syncing || !r) return;
        syncing = true; mts.setVisibleLogicalRange(r); syncing = false;
      });
    }

    // Igualar el ancho de la escala de precio en ambos paneles para que las velas
    // y el oscilador queden ALINEADOS en el tiempo (si no, sus áreas difieren).
    const alignScales = () => {
      try {
        const w = Math.max(
          main.priceScale('right').width(),
          osc ? osc.priceScale('right').width() : 0,
        );
        if (w > 0) {
          main.priceScale('right').applyOptions({ minimumWidth: w });
          if (osc) osc.priceScale('right').applyOptions({ minimumWidth: w });
        }
      } catch {
        /* noop */
      }
    };
    requestAnimationFrame(alignScales);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w > 0) main.applyOptions({ width: w });
      if (osc && oscRef.current) osc.applyOptions({ width: oscRef.current.clientWidth });
      alignScales();
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      main.remove();
      if (osc) osc.remove();
    };
  }, [detail, theme, interval, active, hasOsc]); // eslint-disable-line

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
    { k: 'Tu precio prom.', v: formatPrice(detail.avg_price), cls: 'text-accent' },
    { k: 'Precio actual', v: formatPrice(detail.price_now) },
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

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="num flex h-10 items-center justify-center rounded-xl bg-accent/10 px-2.5 text-sm font-semibold text-accent">
              {detail.symbol.toUpperCase()}
            </span>
            <div>
              <h2 className="text-xl font-semibold text-ink">{detail.name ?? detail.symbol.toUpperCase()}</h2>
              {detail.name && <p className="num text-sm text-muted">{detail.symbol.toUpperCase()}</p>}
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
              {INTERVALS.map((it) => (
                <button
                  key={it.value}
                  onClick={() => setInterval(it.value)}
                  className={`num rounded-md px-2.5 py-1 text-xs transition-colors ${
                    interval === it.value ? 'bg-accent text-white' : 'text-muted hover:text-ink'
                  }`}
                >
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Panel de indicadores (7.4) */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Indicadores:</span>
          {INDICATORS.map((ind) => {
            const on = active.has(ind.id);
            return (
              <button
                key={ind.id}
                onClick={() => toggle(ind.id)}
                className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                  on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink'
                }`}
              >
                {on ? '✓ ' : ''}{ind.name}
              </button>
            );
          })}
        </div>

        <div ref={mainRef} className="h-[360px] w-full" />
        {hasOsc && <div ref={oscRef} className="mt-2 h-[150px] w-full border-t border-line pt-2" />}
      </Card>
    </div>
  );
};

export default AssetDetail;
