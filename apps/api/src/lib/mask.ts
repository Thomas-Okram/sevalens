/** PII masking helpers. List views always use masked values. */
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w[0] + '*' : w.slice(0, w.length > 4 ? 2 : 1) + '*'.repeat(Math.min(6, w.length - (w.length > 4 ? 2 : 1)))))
    .join(' ');
}

export const maskAadhaar = (last4: string) => `XXXX-XXXX-${last4}`;
