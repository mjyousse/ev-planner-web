export const KM_PER_MI = 1.609344;
export const mi = (km: number) => km / KM_PER_MI;
export const fmtMi = (km: number) => `${Math.round(mi(km))} mi`;
export const fmtMph = (kmh: number) => `${Math.round(mi(kmh))} mph`;
export const fmtPct = (p: number) => `${Math.round(p)}%`;
export const fmtMoney = (d: number) => `$${d.toFixed(2)}`;
export const fmtF = (c?: number) => (c === undefined ? '—' : `${Math.round((c * 9) / 5 + 32)}°F`);
export function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
export function fmtWind(headwindMs: number): string {
  const mph = Math.abs(headwindMs) * 2.23694;
  if (mph < 1) return 'calm';
  return `${Math.round(mph)} mph ${headwindMs > 0 ? 'headwind' : 'tailwind'}`;
}
export const fmtClock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
