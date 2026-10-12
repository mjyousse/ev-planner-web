import { averageSpeedKmh, chunk, sampleIndices, type DrivingRoute } from '../engine/geo';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const CLASSES = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|unclassified|residential';
const ORDER = ['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'secondary', 'primary_link', 'secondary_link', 'tertiary', 'unclassified', 'residential'];

export function parseMaxspeed(raw?: string): number | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().split(';')[0];
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(s);
  const v = m ? parseFloat(m[1]) : NaN;
  if (!(v > 5)) return undefined;
  return s.includes('mph') ? v * 1.609344 : v;
}

/** Typical US limits by road class when `maxspeed` is missing, km/h. */
export function defaultKmh(highway: string): number {
  const mph: Record<string, number> = { motorway: 70, trunk: 65, primary: 55, motorway_link: 45, trunk_link: 45, primary_link: 45, secondary_link: 45, secondary: 45, tertiary: 35 };
  return (mph[highway] ?? 30) * 1.609344;
}

const rank = (h: string) => { const i = ORDER.indexOf(h); return i < 0 ? ORDER.length : i; };

/** The most important road near the point is assumed to be the one being driven. */
export function bestLimitKmh(ways: Record<string, string>[]): number | undefined {
  if (!ways.length) return undefined;
  const w = ways.reduce((a, b) => (rank(b.highway ?? '') < rank(a.highway ?? '') ? b : a));
  return parseMaxspeed(w.maxspeed) ?? defaultKmh(w.highway ?? '');
}

/** Splits Overpass output into one tag list per query point using `make m` markers. */
export function parseGroups(json: any): Record<string, string>[][] | undefined {
  const els = json?.elements;
  if (!Array.isArray(els)) return undefined;
  const groups: Record<string, string>[][] = [];
  let cur: Record<string, string>[] = [];
  for (const e of els) {
    if (e.type === 'm') { groups.push(cur); cur = []; } else if (e.tags) cur.push(e.tags);
  }
  return groups;
}

export function applyLimits(samples: { km: number; kmh: number }[], route: DrivingRoute): DrivingRoute {
  const s = [...samples].sort((a, b) => a.km - b.km);
  if (!s.length) return route;
  let k = 0;
  const points = route.points.map((p) => {
    while (k < s.length - 1 && Math.abs(s[k + 1].km - p.km) <= Math.abs(s[k].km - p.km)) k++;
    return { ...p, speedLimitKmh: s[k].kmh };
  });
  return { ...route, points, hasSpeedLimits: true };
}

/** Rejects limits that disagree badly with the router's travel time (matched to side roads). */
export function isPlausible(r: DrivingRoute): boolean {
  if (r.travelTime <= 0 || r.points.length < 2) return true;
  const avg = averageSpeedKmh(r);
  let min = 0;
  for (let i = 1; i < r.points.length; i++) min += ((r.points[i].km - r.points[i - 1].km) / Math.max(r.points[i].speedLimitKmh ?? avg, 15)) * 60;
  const ratio = min / (r.travelTime / 60);
  return ratio > 0.7 && ratio < 1.35;
}

async function overpass(q: string): Promise<Record<string, string>[][] | undefined> {
  for (const url of ENDPOINTS) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) { const g = parseGroups(await r.json()); if (g) return g; }
    } catch { /* try the next mirror */ }
  }
  return undefined;
}

/** Posted limits from OpenStreetMap sampled ~every 5 km; falls back to router speeds. */
export async function addSpeedLimits(route: DrivingRoute, spacingKm = 5): Promise<DrivingRoute> {
  const idx = sampleIndices(route, spacingKm);
  const samples: { km: number; kmh: number }[] = [];
  for (const c of chunk(idx, 80)) {
    let q = '[out:json][timeout:25];\n';
    for (const i of c) {
      const p = route.points[i];
      q += `way(around:30,${p.lat.toFixed(5)},${p.lon.toFixed(5)})[highway~"^(${CLASSES})$"];out tags;make m;out;\n`;
    }
    const groups = await overpass(q);
    if (!groups || groups.length !== c.length) return route;
    c.forEach((i, k) => { const v = bestLimitKmh(groups[k]); if (v) samples.push({ km: route.points[i].km, kmh: v }); });
  }
  const limited = applyLimits(samples, route);
  return isPlausible(limited) ? limited : route;
}
