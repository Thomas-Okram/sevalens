export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-IN');
export const fmtPct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
export const fmtINR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const fmtCompact = (n: number) =>
  n >= 1e7 ? `${(n / 1e7).toFixed(1)} Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)} L` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
export const fmtDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtMonth = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
