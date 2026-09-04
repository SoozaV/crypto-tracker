/**
 * Formateo de fechas robusto ante locales inválidos del entorno.
 * Algunos entornos exponen un locale que `Intl` rechaza (p. ej. "en-US@posix"),
 * lo que haría lanzar a toLocaleString(). Forzamos un locale válido y, si aun
 * así falla, caemos a una representación ISO legible.
 */
const LOCALE = 'es-ES';

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(LOCALE, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.replace('T', ' ').replace('Z', ' UTC');
  }
}

export function formatClock(d: Date): string {
  try {
    return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return d.toISOString().slice(11, 19);
  }
}
