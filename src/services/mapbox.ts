import { routeFromCoordinates, type LatLon } from '../engine/geo';
import type { RouteCandidate } from './routing';

/** Public (pk) token baked in at build time. Empty when not configured; the app then falls back to OSRM. */
export const MAPBOX_TOKEN: string = (import.meta as any).env?.VITE_MAPBOX_TOKEN ?? '';

export type Congestion = 'unknown' | 'low' | 'moderate' | 'heavy' | 'severe';
export interface Lane { indications: string[]; valid: boolean; active: boolean }
export interface RouteStep { instruction: string; road: string; distanceM: number; durationS: number; lanes: Lane[] }
export interface TrafficRun { level: Congestion; coords: [number, number][] }

export const CONGESTION_COLOR: Record<Congestion, string> = {
  unknown: '#3b82f6', low: '#22c55e', moderate: '#eab308', heavy: '#f97316', severe: '#dc2626',
};

export function directionsUrl(from: LatLon, to: LatLon, token: string): string {
  const q = new URLSearchParams({
    alternatives: 'true', geometries: 'geojson', overview: 'full', steps: 'true',
    annotations: 'congestion,duration', access_token: token,
  });
  return `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.lon.toFixed(5)},${from.lat.toFixed(5)};${to.lon.toFixed(5)},${to.lat.toFixed(5)}?${q}`;
}

/** Groups consecutive segments with the same congestion level into runs for drawing. */
export function trafficRuns(coords: [number, number][], congestion: string[]): TrafficRun[] {
  const runs: TrafficRun[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const level = (congestion[i] ?? 'unknown') as Congestion;
    const last = runs.at(-1);
    if (last && last.level === level) last.coords.push(coords[i + 1]);
    else runs.push({ level, coords: [coords[i], coords[i + 1]] });
  }
  return runs;
}

/** Lanes shown for a maneuver come from the last intersection with lane data before it. */
function lanesBefore(prev: any): Lane[] {
  const xs = (prev?.intersections ?? []).filter((x: any) => Array.isArray(x.lanes));
  const last = xs.at(-1);
  return (last?.lanes ?? []).map((l: any) => ({ indications: l.indications ?? [], valid: !!l.valid, active: !!(l.active ?? l.valid) }));
}

export function parseMapboxRoutes(j: any): RouteCandidate[] {
  return (j?.routes ?? []).map((route: any) => {
    const raw: [number, number][] = route.geometry.coordinates;
    const coords: LatLon[] = raw.map(([lon, lat]) => ({ lat, lon }));
    const roads = new Map<string, number>();
    const steps: RouteStep[] = [];
    const congestion: string[] = [];
    for (const leg of route.legs ?? []) {
      congestion.push(...(leg.annotation?.congestion ?? []));
      const ls: any[] = leg.steps ?? [];
      ls.forEach((st, i) => {
        const n = st.ref || st.name;
        if (n) roads.set(n, (roads.get(n) ?? 0) + (st.distance ?? 0));
        steps.push({
          instruction: st.maneuver?.instruction ?? '', road: n ?? '', distanceM: st.distance ?? 0, durationS: st.duration ?? 0,
          lanes: i > 0 ? lanesBefore(ls[i - 1]) : [],
        });
      });
    }
    const name = [...roads.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    return {
      route: routeFromCoordinates(coords, route.duration, 1), name, steps,
      trafficMinutes: route.duration / 60,
      typicalMinutes: route.duration_typical != null ? route.duration_typical / 60 : undefined,
      traffic: congestion.length ? trafficRuns(raw, congestion) : undefined,
    };
  });
}

/** Minutes lost to current traffic compared with a typical drive, when Mapbox reports both. */
export const trafficDelayMinutes = (c: Pick<RouteCandidate, 'trafficMinutes' | 'typicalMinutes'>) =>
  c.trafficMinutes != null && c.typicalMinutes != null ? Math.max(0, c.trafficMinutes - c.typicalMinutes) : undefined;

const ARROW: Record<string, string> = {
  uturn: '↶', 'sharp left': '↰', left: '←', 'slight left': '↖', straight: '↑', 'slight right': '↗', right: '→', 'sharp right': '↱',
};
export const laneArrow = (l: Lane) => l.indications.map((i) => ARROW[i] ?? '↑').join('');

/** Mapbox style for MapLibre; Mapbox terms require Directions results to be shown on a Mapbox map. */
export const mapboxStyleUrl = (dark: boolean, token = MAPBOX_TOKEN) =>
  `https://api.mapbox.com/styles/v1/mapbox/${dark ? 'dark-v11' : 'streets-v12'}?access_token=${token}`;

/** Rewrites mapbox:// URLs inside Mapbox styles to HTTPS so MapLibre can load them. */
export function mapboxTransformUrl(url: string, token = MAPBOX_TOKEN): string {
  if (!url.startsWith('mapbox://')) return url;
  const t = `access_token=${token}`;
  let m = url.match(/^mapbox:\/\/sprites\/([^/]+)\/([^@.?]+)(@2x)?\.(json|png)/);
  if (m) return `https://api.mapbox.com/styles/v1/${m[1]}/${m[2]}/sprite${m[3] ?? ''}.${m[4]}?${t}`;
  m = url.match(/^mapbox:\/\/fonts\/(.+)$/);
  if (m) return `https://api.mapbox.com/fonts/v1/${m[1]}?${t}`;
  m = url.match(/^mapbox:\/\/([^?]+)$/);
  if (m) return `https://api.mapbox.com/v4/${m[1]}.json?secure&${t}`;
  return url;
}
