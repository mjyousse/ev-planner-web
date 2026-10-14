import { routeFromCoordinates, type DrivingRoute, type LatLon } from '../engine/geo';

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

export interface RouteCandidate { route: DrivingRoute; name: string }

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
