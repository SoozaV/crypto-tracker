import type { ReactNode } from 'react';
import { getSign, formatSignedPercentage } from '../utils/decimalHelper';

/** Tarjeta base del panel. */
export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children?: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Tag className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</Tag>
  );
}

/** Encabezado pequeño de sección (sin all-caps chillón). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[0.8rem] font-medium tracking-wide text-muted">{children}</h3>
  );
}

/** Devuelve la clase de color según signo (ganancia/pérdida/neutro). */
export function signClass(value: string | null | undefined): string {
  const s = getSign(value);
  if (s === 'zero') return 'text-muted';
  return s === 'positive' ? 'text-gain' : 'text-loss';
}

/** Chip compacto para cambios de precio (24h/7d/30d). */
export function ChangeChip({
  value,
  label,
}: {
  value: string | null | undefined;
  label?: string;
}) {
  const s = getSign(value);
  const tone =
    s === 'zero'
      ? 'bg-surface2 text-muted'
      : s === 'positive'
        ? 'bg-gain/10 text-gain'
        : 'bg-loss/10 text-loss';
  const arrow = s === 'zero' ? '' : s === 'positive' ? '▲ ' : '▼ ';
  return (
    <span className={`num inline-flex items-center rounded-md px-1.5 py-0.5 text-xs ${tone}`}>
      {label && <span className="mr-1 opacity-60">{label}</span>}
      {value == null || value === '' ? '—' : `${arrow}${formatSignedPercentage(value).replace(/^[+-]/, '')}`}
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
