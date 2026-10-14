import { plan, type PlannerInput, type TripPlan } from './planner';
import type { Charger } from './pricing';

export interface ChargerFilters { networks: string[]; maxPricePerKWh?: number; minKW?: number }

export const KNOWN_NETWORKS = ['Electrify America', 'EVgo', 'IONNA', 'ChargePoint', 'Tesla', 'Rivian', 'Mercedes-Benz', 'Walmart', 'Francis Energy', 'Shell Recharge', 'bp pulse', 'Circle K'];

export const networkMatches = (network: string, allowed: string[]) =>
  !allowed.length || allowed.some((a) => network.toLowerCase().includes(a.toLowerCase()));

export function applyFilters(chargers: Charger[], f: ChargerFilters, use = { price: true, speed: true, network: true }): Charger[] {
  return chargers.filter((c) =>
    (!use.network || networkMatches(c.network, f.networks))
    && (!use.speed || f.minKW == null || c.powerKW >= f.minKW)
    && (!use.price || f.maxPricePerKWh == null || (c.price?.perKWh ?? 0) <= f.maxPricePerKWh));
}

/** Plans with the filters, relaxing them one at a time when no route works, and says what was relaxed. */
export function planWithFilters(input: PlannerInput, f: ChargerFilters, planner: (i: PlannerInput) => TripPlan = plan): { plan: TripPlan; notes: string[] } {
  type Step = { price: boolean; speed: boolean; network: boolean; vot?: number; note?: string };
  const steps: Step[] = [{ price: true, speed: true, network: true }];
  if (f.maxPricePerKWh != null) steps.push({ price: false, speed: true, network: true, vot: 5, note: 'Your settings gave no valid route: relaxed the price limit and chose the cheapest chargers available.' });
  if (f.minKW != null) steps.push({ price: true, speed: false, network: true, vot: 200, note: 'Your settings gave no valid route: relaxed the minimum speed and chose the fastest chargers available.' });
  if (f.maxPricePerKWh != null && f.minKW != null) steps.push({ price: false, speed: false, network: true, note: 'Your settings gave no valid route: relaxed both the price and speed limits.' });
  if (f.networks.length) steps.push({ price: false, speed: false, network: false, note: 'Your settings gave no valid route: used every network, not just your chosen ones.' });
  let first: unknown;
  for (const s of steps) {
    try {
      const p = planner({ ...input, chargers: applyFilters(input.chargers, f, s), valueOfTimePerHour: s.vot ?? input.valueOfTimePerHour });
      return { plan: p, notes: s.note ? [s.note] : [] };
    } catch (e) { first ??= e; }
  }
  throw first;
}

export interface SavedPlace { name: string; detail: string; lat: number; lon: number }

export const samePlace = (a: SavedPlace, b: SavedPlace) => Math.abs(a.lat - b.lat) < 0.001 && Math.abs(a.lon - b.lon) < 0.001;
export const addRecent = (p: SavedPlace, list: SavedPlace[], limit = 8) => [p, ...list.filter((x) => !samePlace(x, p))].slice(0, limit);

/** A trip that can be saved locally or shared as a link. */
export interface TripSpec { from: SavedPlace; to: SavedPlace; startSoC: number; arriveSoC: number; minSoC: number; vehicleId: string }

export function encodeTrip(t: TripSpec): string {
  const q = new URLSearchParams({
    f: t.from.name, fl: `${t.from.lat.toFixed(5)},${t.from.lon.toFixed(5)}`,
    t: t.to.name, tl: `${t.to.lat.toFixed(5)},${t.to.lon.toFixed(5)}`,
    s: String(t.startSoC), a: String(t.arriveSoC), m: String(t.minSoC), v: t.vehicleId,
  });
  return q.toString();
}

export function decodeTrip(query: string): TripSpec | undefined {
  const q = new URLSearchParams(query.replace(/^[#?]/, ''));
  const ll = (k: string) => { const [a, b] = (q.get(k) ?? '').split(',').map(Number); return Number.isFinite(a) && Number.isFinite(b) && q.get(k) ? { lat: a, lon: b } : undefined; };
  const fl = ll('fl'), tl = ll('tl');
  if (!fl || !tl) return undefined;
  const n = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && q.get(k) !== null ? v : d; };
  return {
    from: { name: q.get('f') || 'Start', detail: '', ...fl }, to: { name: q.get('t') || 'Destination', detail: '', ...tl },
    startSoC: n('s', 85), arriveSoC: n('a', 20), minSoC: n('m', 10), vehicleId: q.get('v') ?? '',
  };
}

/** Elevation profile as an SVG polyline, distance on x and height on y. */
export function elevationPath(points: { km: number; elevationM: number }[], w: number, h: number): { d: string; minM: number; maxM: number } | undefined {
  if (points.length < 2) return undefined;
  const total = points[points.length - 1].km || 1;
  const els = points.map((p) => p.elevationM);
  const minM = Math.min(...els), maxM = Math.max(...els), span = Math.max(maxM - minM, 10);
  const step = Math.max(1, Math.floor(points.length / 300));
  const d = points.filter((_, i) => i % step === 0 || i === points.length - 1)
    .map((p, i) => `${i ? 'L' : 'M'}${((p.km / total) * w).toFixed(1)},${(h - ((p.elevationM - minM) / span) * h).toFixed(1)}`).join('');
  return { d, minM, maxM };
}
