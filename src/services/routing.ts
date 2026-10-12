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
