import { locate, type DrivingRoute } from '../engine/geo';
import { displayNetwork, networkPowerKW, type Charger } from '../engine/pricing';

export const NREL_ENDPOINT = 'https://developer.nlr.gov/api/alt-fuel-stations/v1/nearby-route.json';

export function lineString(route: DrivingRoute, maxPoints = 180): string {
  const pts = route.points;
  const stride = Math.max(1, Math.ceil(pts.length / maxPoints));
  const picked = pts.filter((_, i) => i % stride === 0);
  if (pts.length && picked.at(-1) !== pts.at(-1)) picked.push(pts.at(-1)!);
  return 'LINESTRING(' + picked.map((p) => `${p.lon.toFixed(5)} ${p.lat.toFixed(5)}`).join(', ') + ')';
}

export function parseStations(json: any): Omit<Charger, 'routeKm' | 'detourKm'>[] {
  return (json?.fuel_stations ?? []).filter((s: any) => typeof s.id === 'number' && typeof s.latitude === 'number').map((s: any) => {
    const network = displayNetwork(s.ev_network ?? 'Non-Networked');
    return {
      id: s.id, name: s.station_name ?? network, network,
      address: [s.street_address, s.city, s.state].filter(Boolean).join(', '),
      lat: s.latitude, lon: s.longitude, dcPorts: s.ev_dc_fast_num ?? 1,
      powerKW: networkPowerKW(network), powerIsEstimated: true,
      connectors: s.ev_connector_types ?? [], pricingText: s.ev_pricing ?? undefined,
    };
  });
}

/** Open, public DC fast chargers within `corridorMiles` of the route (NREL AFDC). */
export async function fetchChargers(route: DrivingRoute, apiKey: string, corridorMiles = 2, signal?: AbortSignal): Promise<Charger[]> {
  const body = new URLSearchParams({
    route: lineString(route), distance: String(corridorMiles), fuel_type: 'ELEC', ev_charging_level: 'dc_fast',
    status: 'E', access: 'public', limit: 'all',
  });
  const r = await fetch(`${NREL_ENDPOINT}?api_key=${encodeURIComponent(apiKey || 'DEMO_KEY')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal,
  });
  if (r.status === 429) throw new Error('The NREL charger database is rate limiting this key. Add your own free key in Settings, or wait a minute.');
  if (r.status === 403) throw new Error('NREL rejected the API key. Check it in Settings.');
  if (!r.ok) throw new Error(`The charger database returned an error (${r.status}).`);
  return parseStations(await r.json()).map((s) => {
    const l = locate(route, s);
    return { ...s, routeKm: l.routeKm, detourKm: l.offRouteKm };
  });
}
