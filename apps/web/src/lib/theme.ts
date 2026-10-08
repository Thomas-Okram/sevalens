import type { AttentionFactorKey, Severity } from '@sevalens/shared';

/** Status palette (validated, colour-blind-safe when paired with icon + label). */
export const SEV_COLOR: Record<Severity, string> = { low: '#0ca30c', medium: '#fab219', high: '#d03b3b' };
export const SEV_LABEL: Record<Severity, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** Fixed categorical order for attention factors — colour follows the factor, never its rank. */
export const FACTOR_COLOR: Record<AttentionFactorKey, string> = {
  coverageGap: '#2a78d6',
  slaBreach: '#eb6834',
  anomalies: '#1baf7a',
  disbursementFailure: '#e87ba4',
  remoteness: '#4a3aa7',
};

export const NAVY = '#0B1F3A';
export const TEAL = '#14B8A6';
export const SERIES = { primary: '#2a78d6', secondary: '#eb6834' };
export const GRID = '#e2e8f0';
export const AXIS = '#64748b';
