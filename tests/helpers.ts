import { routeFromCoordinates, type DrivingRoute } from '../src/engine/geo';
import type { Charger } from '../src/engine/pricing';

/** Straight northbound route of `km` length at `speedKmh` with 1 km points. */
export function straightRoute(km: number, speedKmh = 110): DrivingRoute {
  const coords = Array.from({ length: Math.round(km) + 1 }, (_, i) => ({ lat: 30 + i / 111.19, lon: -97 }));
  const r = routeFromCoordinates(coords, (km / speedKmh) * 3600, 1);
  return { ...r, points: r.points.map((p) => ({ ...p, speedLimitKmh: speedKmh })) };
}

let nextId = 1;
export function charger(routeKm: number, network = 'Electrify America', powerKW = 350, detourKm = 0.3): Charger {
  return { id: nextId++, name: `${network} @${routeKm}`, network, address: '', lat: 30 + routeKm / 111.19, lon: -97, dcPorts: 4,
    powerKW, powerIsEstimated: true, connectors: ['J1772COMBO'], routeKm, detourKm };
}
