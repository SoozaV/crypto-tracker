/**
 * Fase 7 — Registro de indicadores disponibles. Para AÑADIR uno nuevo:
 *   1. Impleméntalo en builtin.ts (o en tu propio archivo) según la interfaz
 *      Indicator, traduciendo la lógica de Pine con utils/pineAdapter.ts.
 *   2. Añádelo a este array.
 * El panel de la UI lo listará automáticamente con su checkbox.
 */
import type { Indicator } from './types';
import {
  smaIndicator,
  rsiIndicator,
  stochIndicator,
  emaCrossIndicator,
  ichimokuObOsIndicator,
} from './builtin';

export const INDICATORS: Indicator[] = [
  smaIndicator(20),
  emaCrossIndicator(9, 21),
  rsiIndicator(14),
  stochIndicator(14, 3),
  ichimokuObOsIndicator(50, 26, 52),
];
