import type { LatLon } from '../engine/geo';

const ll = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

export const appleMapsUrl = (to: LatLon, name?: string) =>
  `https://maps.apple.com/?daddr=${ll(to)}&dirflg=d${name ? `&q=${encodeURIComponent(name)}` : ''}`;

export const googleMapsUrl = (to: LatLon) =>
  `https://www.google.com/maps/dir/?api=1&destination=${ll(to)}&travelmode=driving`;

/** Whole trip in Google Maps with every charging stop as a waypoint (Google allows up to 9). */
export function googleTripUrl(from: LatLon, to: LatLon, stops: LatLon[]): string {
  const p = new URLSearchParams({ api: '1', origin: ll(from), destination: ll(to), travelmode: 'driving' });
  if (stops.length) p.set('waypoints', stops.slice(0, 9).map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${p}`;
}
