export interface LatLon { lat: number; lon: number }

export interface RoutePoint {
  lat: number;
  lon: number;
  /** Distance from the start, km. */
  km: number;
  elevationM: number;
  /** Forecast wind at vehicle height, m/s, and the direction it blows from. */
  windMs?: number;
  windFromDeg: number;
  temperatureC?: number;
  /** Posted (or road-class) limit for the segment ending here, km/h. */
  speedLimitKmh?: number;
}

export interface DrivingRoute {
  points: RoutePoint[];
  /** Router travel time, seconds. */
  travelTime: number;
  hasElevation: boolean;
  hasWeather: boolean;
  hasSpeedLimits: boolean;
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function fastDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const x = rad(lon2 - lon1) * Math.cos(rad((lat1 + lat2) / 2));
  const y = rad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * R;
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const la1 = rad(a.lat), la2 = rad(b.lat), dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const totalKm = (r: DrivingRoute) => r.points.at(-1)?.km ?? 0;
export const averageSpeedKmh = (r: DrivingRoute) => totalKm(r) / Math.max(r.travelTime / 3600, 0.01);

/** Builds a route from raw coordinates, resampled to roughly `spacingKm`. */
export function routeFromCoordinates(coords: LatLon[], travelTime: number, spacingKm = 1): DrivingRoute {
  const points: RoutePoint[] = [];
  let total = 0, since = 0;
  coords.forEach((c, i) => {
    if (i > 0) {
      const d = distanceKm(coords[i - 1], c);
      total += d;
      since += d;
    }
    if (i === 0 || i === coords.length - 1 || since >= spacingKm) {
      points.push({ lat: c.lat, lon: c.lon, km: total, elevationM: 0, windFromDeg: 0 });
      since = 0;
    }
  });
  return { points, travelTime, hasElevation: false, hasWeather: false, hasSpeedLimits: false };
}

/** Nearest route point to a coordinate: its distance along the route and off it. */
export function locate(route: DrivingRoute, c: LatLon): { routeKm: number; offRouteKm: number } {
  let best = 0, bestD = Infinity;
  route.points.forEach((p, i) => {
    const d = fastDistanceKm(c.lat, c.lon, p.lat, p.lon);
    if (d < bestD) { bestD = d; best = i; }
  });
  return { routeKm: route.points[best]?.km ?? 0, offRouteKm: bestD === Infinity ? 0 : bestD };
}

/** Indices roughly every `spacingKm`, always including the last point. */
export function sampleIndices(route: DrivingRoute, spacingKm: number): number[] {
  const idx: number[] = [];
  let last = -Infinity;
  route.points.forEach((p, i) => {
    if (p.km - last >= spacingKm) { idx.push(i); last = p.km; }
  });
  const end = route.points.length - 1;
  if (end >= 0 && idx.at(-1) !== end) idx.push(end);
  return idx;
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
