/**
 * Helper de precisión para el frontend (tarea 0.6).
 *
 * Igual que el backend usa `Decimal` de Python, el frontend usa `decimal.js`
 * para no arrastrar el error de los `number` de JavaScript (IEEE-754):
 *
 *     0.1 + 0.2 === 0.30000000000000004   // number nativo (mal)
 *     safeAdd("0.1", "0.2") === "0.3"      // decimal.js (exacto)
 *
 * Regla: en toda la UI, las cantidades/importes se manejan como string y se
 * operan con estas funciones; nunca con + o toFixed nativos.
 */
import Decimal from "decimal.js";

// Precisión amplia y redondeo "half up", coherente con el backend.
Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

export type Numeric = string | number | Decimal;

/** Convierte cualquier entrada a Decimal de forma segura. */
export function toDecimal(value: Numeric): Decimal {
  // Los number se pasan por String() para no heredar el ruido binario.
  return value instanceof Decimal ? value : new Decimal(String(value));
}

/** Suma exacta. Devuelve string para almacenar/mostrar sin pérdida. */
export function safeAdd(a: Numeric, b: Numeric): string {
  return toDecimal(a).plus(toDecimal(b)).toString();
}

/** Resta exacta. */
export function safeSub(a: Numeric, b: Numeric): string {
  return toDecimal(a).minus(toDecimal(b)).toString();
}

/** Multiplicación exacta. */
export function safeMul(a: Numeric, b: Numeric): string {
  return toDecimal(a).times(toDecimal(b)).toString();
}

/** División exacta (lanza si el divisor es 0). */
export function safeDiv(a: Numeric, b: Numeric): string {
  const divisor = toDecimal(b);
  if (divisor.isZero()) throw new Error("safeDiv: división por cero");
  return toDecimal(a).div(divisor).toString();
}

/**
 * Formatea una cantidad de cripto con un número fijo de decimales,
 * recortando ceros a la derecha innecesarios.
 *   formatCrypto("0.50000000", 8) -> "0.5"
 *   formatCrypto("1.23456789012", 8) -> "1.23456789"
 */
export function formatCrypto(value: Numeric, decimals = 8): string {
  const d = toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_DOWN);
  // toString() ya elimina ceros a la derecha ("0.5" en vez de "0.50000000").
  return d.toString();
}

/**
 * Formatea un importe en moneda base (USDT) con separadores de miles y N
 * decimales fijos (por defecto 2).
 *   formatMoney("20010") -> "20,010.00"
 */
export function formatMoney(value: Numeric, decimals = 2, currency = "USDT"): string {
  const d = toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  const parts = d.toFixed(decimals).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${parts.join(".")} ${currency}`.trim();
}

/** Precio promedio ponderado = coste / cantidad. 0 si cantidad es 0. */
export function averagePrice(totalCost: Numeric, totalQuantity: Numeric): string {
  const qty = toDecimal(totalQuantity);
  if (qty.isZero()) return "0";
  return toDecimal(totalCost).div(qty).toString();
}

/** Alias de UI: importe USDT con separadores. */
export function formatCurrency(value: Numeric, decimals = 2): string {
  return formatMoney(value, decimals);
}

/**
 * Formatea un PRECIO por unidad con decimales ADAPTATIVOS. Los tokens muy baratos
 * (SHIB, PEPE) necesitan más decimales para no mostrarse como "0.00":
 *   >= 1     -> 2 decimales             (79,828.00)
 *   >= 0.01  -> 4 decimales             (0.1234)
 *   < 0.01   -> 4 cifras significativas (0.00000535)
 */
export function formatPrice(value: Numeric | null | undefined, currency = "USDT"): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = toDecimal(value);
  if (d.isZero()) return `0.00 ${currency}`;
  const abs = d.abs();
  let out: string;
  if (abs.greaterThanOrEqualTo(1)) {
    out = d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  } else if (abs.greaterThanOrEqualTo(0.01)) {
    out = d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  } else {
    out = d.toSignificantDigits(4, Decimal.ROUND_HALF_UP).toString();
  }
  const parts = out.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${parts.join(".")} ${currency}`;
}

/** Alias de UI: cantidad de cripto. */
export function formatQuantity(value: Numeric, decimals = 8): string {
  return formatCrypto(value, decimals);
}

/** Formatea un porcentaje (p. ej. ROI / asignación) con 2 decimales. */
export function formatPercentage(value: Numeric | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  return `${d.toFixed(decimals)}%`;
}

/** Signo de un valor numérico para colorear PnL/ROI en la UI. */
export function getSign(value: Numeric | null | undefined): "positive" | "negative" | "zero" {
  if (value === null || value === undefined || value === "") return "zero";
  const d = toDecimal(value);
  if (d.isZero()) return "zero";
  return d.isPositive() ? "positive" : "negative";
}

/** Porcentaje con signo explícito (+/-) para chips de cambio 24h/7d/30d. */
export function formatSignedPercentage(value: Numeric | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  const sign = d.isPositive() && !d.isZero() ? "+" : "";
  return `${sign}${d.toFixed(decimals)}%`;
}

/** Importe compacto para cifras grandes: 1.2K, 3.4M. Sin moneda. */
export function formatCompact(value: Numeric, decimals = 1): string {
  const d = toDecimal(value);
  const abs = d.abs();
  const sign = d.isNegative() ? "-" : "";
  if (abs.greaterThanOrEqualTo(1_000_000_000))
    return `${sign}${abs.div(1_000_000_000).toDecimalPlaces(decimals).toString()}B`;
  if (abs.greaterThanOrEqualTo(1_000_000))
    return `${sign}${abs.div(1_000_000).toDecimalPlaces(decimals).toString()}M`;
  if (abs.greaterThanOrEqualTo(1_000))
    return `${sign}${abs.div(1_000).toDecimalPlaces(decimals).toString()}K`;
  return d.toDecimalPlaces(2).toString();
}
