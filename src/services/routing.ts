import { routeFromCoordinates, type DrivingRoute, type LatLon } from '../engine/geo';
import { directionsUrl, MAPBOX_TOKEN, parseMapboxRoutes, type RouteStep, type TrafficRun } from './mapbox';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

/** Car route from the public OSRM demo server, resampled to ~1 km points. */
export async function fetchRoute(from: LatLon, to: LatLon, signal?: AbortSignal): Promise<DrivingRoute> {
  const url = `${OSRM}${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Routing failed (${r.status}). The public router may be busy; try again.`);
  const j = await r.json();
  const route = j.routes?.[0];
  if (!route) throw new Error('No driving route found between those places.');
  const coords: LatLon[] = route.geometry.coordinates.map(([lon, lat]: [number, number]) => ({ lat, lon }));
  return routeFromCoordinates(coords, route.duration, 1);
}

export interface RouteCandidate {
  route: DrivingRoute;
  name: string;
  steps?: RouteStep[];
  /** Drive time with current traffic (Mapbox only). */
  trafficMinutes?: number;
  /** Drive time on a typical day (Mapbox only). */
  typicalMinutes?: number;
  traffic?: TrafficRun[];
}

// Routes are reused for a few minutes so replanning after a settings change doesn't spend another API call.
const cache = new Map<string, { at: number; routes: RouteCandidate[] }>();
const CACHE_MS = 5 * 60_000;
export const routeCacheKey = (from: LatLon, to: LatLon, provider: string) =>
  `${provider}:${from.lat.toFixed(4)},${from.lon.toFixed(4)}>${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
export const usingMapbox = () => !!MAPBOX_TOKEN;

/** Mapbox driving-traffic when a token is configured, otherwise OSRM. */
export async function fetchRoutesCached(from: LatLon, to: LatLon, signal?: AbortSignal, now = Date.now()): Promise<RouteCandidate[]> {
  const key = routeCacheKey(from, to, usingMapbox() ? 'mapbox' : 'osrm');
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.routes;
  let routes: RouteCandidate[] = [];
  if (usingMapbox()) {
    try {
      const r = await fetch(directionsUrl(from, to, MAPBOX_TOKEN), { signal });
      if (r.ok) routes = parseMapboxRoutes(await r.json());
    } catch (e) { if ((e as Error).name === 'AbortError') throw e; }
  }
  if (!routes.length) routes = await fetchRoutes(from, to, signal);
  cache.set(key, { at: now, routes });
  return routes;
}

/** Main route plus up to two OSRM alternatives. */
export async function fetchRoutes(from: LatLon, to: LatLon, signal?: AbortSignal): Promise<RouteCandidate[]> {
  const url = `${OSRM}${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&alternatives=2&steps=true`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Routing failed (${r.status}). The public router may be busy; try again.`);
  const routes = parseRoutes(await r.json());
  if (!routes.length) throw new Error('No driving route found between those places.');
  return routes;
}

export function parseRoutes(j: any): RouteCandidate[] {
  return (j?.routes ?? []).map((route: any) => {
    const coords: LatLon[] = route.geometry.coordinates.map(([lon, lat]: [number, number]) => ({ lat, lon }));
    const roads = new Map<string, number>();
    for (const leg of route.legs ?? []) for (const st of leg.steps ?? []) {
      const n = st.ref || st.name;
      if (n) roads.set(n, (roads.get(n) ?? 0) + (st.distance ?? 0));
    }
    const name = [...roads.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    return { route: routeFromCoordinates(coords, route.duration, 1), name };
  });
}
