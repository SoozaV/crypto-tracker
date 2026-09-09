/**
 * Fase 7.1 — Interfaz de indicadores.
 *
 * Un indicador toma las velas OHLCV y devuelve una o más líneas para dibujar,
 * indicando si van SOBRE el precio (overlay: SMA, EMA) o en un panel aparte
 * (oscilador: RSI, Stoch). Añadir uno nuevo = implementar `compute()` y
 * registrarlo en `registry.ts`. Ver `utils/pineAdapter.ts` para traducir Pine.
 */
export interface OHLCV {
  time: number; // segundos UTC (UTCTimestamp de lightweight-charts)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LinePoint {
  time: number;
  value: number;
}

export interface IndicatorLine {
  key: string;
  title: string;
  color: string;
  data: LinePoint[];
  lineWidth?: number;
  /**
   * Color por valor (opcional). Si se define, la línea se dibuja en tramos con el
   * color que devuelva para cada punto (p. ej. verde en sobrecompra, rojo en
   * sobreventa). Traduce el `color := …` condicional de Pine Script.
   */
  colorAt?: (value: number) => string;
}

/** 'price' = overlay sobre las velas; 'oscillator' = panel inferior (0–100). */
export type IndicatorPane = 'price' | 'oscillator';

export interface IndicatorResult {
  lines: IndicatorLine[];
  /** Niveles horizontales de referencia (p. ej. 30/70 del RSI). */
  levels?: number[];
}

export interface Indicator {
  id: string;
  name: string;
  pane: IndicatorPane;
  defaultOn?: boolean;
  compute(candles: OHLCV[]): IndicatorResult;
}
