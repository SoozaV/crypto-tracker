/**
 * Fase 7.6 — Guía práctica para traducir Pine Script a TypeScript usando
 * `technicalindicators` + Lightweight Charts.
 *
 * Pine trabaja "serie a serie" (cada barra tiene un valor); aquí trabajamos con
 * ARRAYS. La librería devuelve arrays más cortos (recorta el warm-up), así que
 * al dibujar hay que alinear cada valor con su vela (ver `align()` en builtin.ts).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TABLA DE EQUIVALENCIAS
 * ─────────────────────────────────────────────────────────────────────────────
 *   Pine                         TypeScript (technicalindicators)
 *   ──────────────────────────   ─────────────────────────────────────────────
 *   ta.sma(close, n)             SMA.calculate({ period: n, values: closes })
 *   ta.ema(close, n)             EMA.calculate({ period: n, values: closes })
 *   ta.rsi(close, n)             RSI.calculate({ period: n, values: closes })
 *   ta.stoch(high,low,close,n)   Stochastic.calculate({ period:n, signalPeriod:3,
 *                                   high, low, close })
 *   ta.macd(close, f, s, sig)    MACD.calculate({ fastPeriod:f, slowPeriod:s,
 *                                   signalPeriod:sig, values: closes })
 *   ta.atr(n)                    ATR.calculate({ period:n, high, low, close })
 *   ta.crossover(a, b)           crossUp(a, b)      (abajo)
 *   ta.crossunder(a, b)          crossDown(a, b)    (abajo)
 *
 *   plot(serie, color=…)         una IndicatorLine { key, title, color, data }
 *   hline(70)                    IndicatorResult.levels = [70]
 *   overlay=true                 pane: 'price'      (sobre las velas)
 *   overlay=false / panel        pane: 'oscillator' (panel inferior)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PASOS PARA UN INDICADOR NUEVO
 *   1. Extrae closes/high/low de las velas: const cl = candles.map(c => c.close)
 *   2. Calcula con la librería -> array de valores.
 *   3. Alinéalo con align(values, candles) (builtin.ts) para emparejar tiempos.
 *   4. Devuelve { lines:[{ key,title,color,data }], levels? } y pon el `pane`.
 *   5. Regístralo en registry.ts.
 */
import type { LinePoint } from '../indicators/types';

/** ta.crossover(a,b): true en el índice i si a cruza a b hacia ARRIBA. */
export function crossUp(a: number[], b: number[]): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < a.length; i++) {
    out.push(i > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i]);
  }
  return out;
}

/** ta.crossunder(a,b): true si a cruza a b hacia ABAJO. */
export function crossDown(a: number[], b: number[]): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < a.length; i++) {
    out.push(i > 0 && a[i - 1] >= b[i - 1] && a[i] < b[i]);
  }
  return out;
}

/** Convierte un array plano de valores en puntos {time,value} dado un array de tiempos. */
export function toLine(values: number[], times: number[]): LinePoint[] {
  const offset = times.length - values.length;
  return values
    .map((v, i) => ({ time: times[offset + i], value: v }))
    .filter((p) => p.time !== undefined && !Number.isNaN(p.value));
}
