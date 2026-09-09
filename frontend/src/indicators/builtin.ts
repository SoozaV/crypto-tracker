/**
 * Fase 7.2 + 7.5 — Indicadores integrados, calculados en el frontend con la
 * librería `technicalindicators`. Cada función recibe las velas y devuelve las
 * líneas ya alineadas en el tiempo (la librería recorta el "warm-up", así que
 * desplazamos cada salida a la vela que le corresponde).
 */
import { SMA, EMA, RSI, Stochastic } from 'technicalindicators';
import type { Indicator, OHLCV, LinePoint } from './types';

const closes = (c: OHLCV[]) => c.map((x) => x.close);

/** Alinea una serie de la librería (longitud n-período+1) con los tiempos de las velas. */
function align(values: number[], candles: OHLCV[]): LinePoint[] {
  const offset = candles.length - values.length; // nº de velas de warm-up
  const out: LinePoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || Number.isNaN(v)) continue;
    out.push({ time: candles[offset + i].time, value: v });
  }
  return out;
}

export const smaIndicator = (period = 20, color = '#3B82F6'): Indicator => ({
  id: `sma${period}`,
  name: `SMA ${period}`,
  pane: 'price',
  compute(candles) {
    const values = SMA.calculate({ period, values: closes(candles) });
    return { lines: [{ key: `sma${period}`, title: `SMA ${period}`, color, data: align(values, candles) }] };
  },
});

export const rsiIndicator = (period = 14): Indicator => ({
  id: `rsi${period}`,
  name: `RSI ${period}`,
  pane: 'oscillator',
  compute(candles) {
    const values = RSI.calculate({ period, values: closes(candles) });
    return {
      lines: [{ key: `rsi${period}`, title: `RSI ${period}`, color: '#A78BFA', data: align(values, candles) }],
      levels: [30, 70],
    };
  },
});

export const stochIndicator = (period = 14, signalPeriod = 3): Indicator => ({
  id: `stoch${period}_${signalPeriod}`,
  name: `Stoch ${period},${signalPeriod}`,
  pane: 'oscillator',
  compute(candles) {
    const res = Stochastic.calculate({
      period,
      signalPeriod,
      high: candles.map((c) => c.high),
      low: candles.map((c) => c.low),
      close: closes(candles),
    });
    const k = res.map((r) => r.k);
    const d = res.map((r) => r.d);
    return {
      lines: [
        { key: 'stoch_k', title: '%K', color: '#22D3EE', data: align(k, candles) },
        { key: 'stoch_d', title: '%D', color: '#F97316', data: align(d, candles) },
      ],
      levels: [20, 80],
    };
  },
});

/**
 * 7.5 — Indicador CUSTOM traducido de Pine Script a TypeScript:
 * "Cruce de EMA 9 y 21" (un clásico de TradingView).
 *
 *   // --- Pine Script original ---
 *   //@version=5
 *   indicator("EMA Cross", overlay=true)
 *   fast = ta.ema(close, 9)
 *   slow = ta.ema(close, 21)
 *   plot(fast, color=color.orange)
 *   plot(slow, color=color.blue)
 *
 * Traducción: ta.ema(close, n) -> EMA.calculate({period:n, values:closes});
 * plot(x) -> una IndicatorLine. Overlay=true -> pane 'price'.
 */
export const emaCrossIndicator = (fast = 9, slow = 21): Indicator => ({
  id: `emacross_${fast}_${slow}`,
  name: `EMA cross ${fast}/${slow}`,
  pane: 'price',
  compute(candles) {
    const cl = closes(candles);
    const emaFast = EMA.calculate({ period: fast, values: cl });
    const emaSlow = EMA.calculate({ period: slow, values: cl });
    return {
      lines: [
        { key: `ema${fast}`, title: `EMA ${fast}`, color: '#E0A542', data: align(emaFast, candles) },
        { key: `ema${slow}`, title: `EMA ${slow}`, color: '#3B82F6', data: align(emaSlow, candles) },
      ],
    };
  },
});

/**
 * Indicador CUSTOM traducido de Pine Script: "Ichimoku Overbought/Oversold".
 *
 *   // --- Pine v5 (resumen) ---
 *   indicator("Ichimoku Overbought/Oversold", overlay=false)
 *   tenkan = ta.sma(close, 50); kijun = ta.sma(close, 26)
 *   senkou_span_a = (tenkan + kijun) / 2
 *   senkou_span_b = ta.sma(close, 52)
 *   dA = (close - senkou_span_a)/senkou_span_a
 *   dB = (close - senkou_span_b)/senkou_span_b
 *   over  = close>span_a and close>span_b ? dA : 0
 *   under = close<span_a and close<span_b ? dB : 0
 *   signal = round(clamp((over+under)*100, -10, 10), 2)
 *   plot(signal); hline(7); hline(-7)
 *
 * Notas de la traducción:
 *   - overlay=false           -> pane: 'oscillator'
 *   - ta.sma(close, n)        -> smaFull(closes, n)  (alineado por barra)
 *   - hline(7)/hline(-7)      -> levels: [7, -7]
 *   - `overbought=80/oversold=20` y `displacement` están declarados pero NO se
 *     usan en la señal del script original, así que se omiten.
 *   - El color verde/rojo por tramo del Pine no se puede en una línea básica de
 *     Lightweight Charts v4; los niveles ±7 cumplen la misma función visual.
 */

/** SMA de longitud completa (NaN durante el warm-up) para poder combinar por barra. */
function smaFull(values: number[], period: number): number[] {
  const raw = SMA.calculate({ period, values });
  const pad = values.length - raw.length;
  return [...new Array(Math.max(pad, 0)).fill(NaN), ...raw];
}

export const ichimokuObOsIndicator = (
  tenkanP = 50,
  kijunP = 26,
  senkouBP = 52,
): Indicator => ({
  id: `ichi_obos_${tenkanP}_${kijunP}_${senkouBP}`,
  name: 'Ichimoku OB/OS',
  pane: 'oscillator',
  compute(candles) {
    const close = closes(candles);
    const tenkan = smaFull(close, tenkanP);
    const kijun = smaFull(close, kijunP);
    const senkouB = smaFull(close, senkouBP);

    const data: LinePoint[] = [];
    for (let i = 0; i < candles.length; i++) {
      const t = tenkan[i];
      const k = kijun[i];
      const b = senkouB[i];
      const c = close[i];
      if (Number.isNaN(t) || Number.isNaN(k) || Number.isNaN(b) || b === 0) continue;

      const spanA = (t + k) / 2;
      if (spanA === 0) continue;
      const dA = (c - spanA) / spanA;
      const dB = (c - b) / b;
      const over = c > spanA && c > b ? dA : 0;
      const under = c < spanA && c < b ? dB : 0;

      let signal = (over + under) * 100;
      signal = Math.max(Math.min(signal, 10), -10); // clamp a [-10, 10]
      signal = Math.round(signal * 100) / 100; // 2 decimales
      data.push({ time: candles[i].time, value: signal });
    }

    return {
      lines: [{
        key: 'ichi_obos',
        title: 'Ichimoku OB/OS',
        color: '#8A97AB',
        data,
        // color := signal>=7 ? verde : signal<=-7 ? rojo : gris  (Pine original)
        colorAt: (v) => (v >= 7 ? '#26A69A' : v <= -7 ? '#EF5350' : '#8A97AB'),
      }],
      levels: [7, -7],
    };
  },
});
