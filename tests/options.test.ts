import { describe, expect, it } from 'vitest';
import { addRecent, applyFilters, decodeTrip, elevationPath, encodeTrip, planWithFilters, type TripSpec } from '../src/engine/options';
import { pickRoute, type RouteSummary } from '../src/engine/insights';
import { BUILT_INS, capacityText, EV9_GTLINE } from '../src/engine/vehicles';
import type { Charger } from '../src/engine/pricing';
import type { PlannerInput, TripPlan } from '../src/engine/planner';

const ch = (id: number, network: string, powerKW: number, perKWh: number) =>
  ({ id, name: `C${id}`, network, address: '', lat: 0, lon: 0, dcPorts: 4, powerKW, powerIsEstimated: false, connectors: [], price: { perKWh } }) as unknown as Charger;
const chargers = [ch(1, 'Electrify America', 350, 0.56), ch(2, 'Tesla Supercharger', 250, 0.42), ch(3, 'EVgo', 100, 0.39)];

describe('charger filters', () => {
  it('filters by network, speed and price', () => {
    expect(applyFilters(chargers, { networks: ['tesla'] }).map((c) => c.id)).toEqual([2]);
    expect(applyFilters(chargers, { networks: [], minKW: 200 }).map((c) => c.id)).toEqual([1, 2]);
    expect(applyFilters(chargers, { networks: [], maxPricePerKWh: 0.45 }).map((c) => c.id)).toEqual([2, 3]);
  });

  it('relaxes limits in order and explains what changed', () => {
    const fake = (i: PlannerInput) => { if (!i.chargers.some((c) => c.id === 1)) throw new Error('no route'); return { ok: true } as unknown as TripPlan; };
    const input = { chargers, valueOfTimePerHour: 30 } as unknown as PlannerInput;
    expect(planWithFilters(input, { networks: [] }, fake).notes).toEqual([]);
    expect(planWithFilters(input, { networks: [], maxPricePerKWh: 0.45 }, fake).notes[0]).toMatch(/price/);
    expect(planWithFilters(input, { networks: ['EVgo'] }, fake).notes[0]).toMatch(/every network/);
    expect(() => planWithFilters({ ...input, chargers: [] }, { networks: [] }, fake)).toThrow('no route');
  });
});

describe('stops slider', () => {
  it('prefers fewer stops when the penalty is high', () => {
    const o: RouteSummary[] = [
      { index: 0, name: 'A', km: 500, totalMinutes: 300, cost: 40, energyKWh: 120, arrivalSoC: 20, stops: 3 },
      { index: 1, name: 'B', km: 500, totalMinutes: 320, cost: 40, energyKWh: 120, arrivalSoC: 20, stops: 1 },
    ];
    expect(pickRoute(o, 'fastest', 0)?.index).toBe(0);
    expect(pickRoute(o, 'fastest', 45)?.index).toBe(1);
  });
});

describe('places and trips', () => {
  const home = { name: 'Home', detail: '', lat: 30.2672, lon: -97.7431 };
  it('keeps recents newest first without duplicates', () => {
    let r = addRecent(home, []);
    r = addRecent({ name: 'Dallas', detail: '', lat: 32.78, lon: -96.8 }, r);
    r = addRecent({ ...home, lat: home.lat + 0.0001 }, r);
    expect(r.map((p) => p.name)).toEqual(['Home', 'Dallas']);
    for (let i = 0; i < 20; i++) r = addRecent({ name: `P${i}`, detail: '', lat: i, lon: i }, r);
    expect(r).toHaveLength(8);
  });

  it('round-trips a share link', () => {
    const t: TripSpec = { from: home, to: { name: 'Dallas, TX', detail: '', lat: 32.7767, lon: -96.797 }, startSoC: 90, arriveSoC: 15, minSoC: 8, vehicleId: 'ev9' };
    const back = decodeTrip(`#${encodeTrip(t)}`)!;
    expect(back.to.name).toBe('Dallas, TX');
    expect(back.from.lat).toBeCloseTo(home.lat, 4);
    expect([back.startSoC, back.arriveSoC, back.minSoC, back.vehicleId]).toEqual([90, 15, 8, 'ev9']);
    expect(decodeTrip('#foo=1')).toBeUndefined();
  });

  it('draws an elevation profile', () => {
    const e = elevationPath([{ km: 0, elevationM: 100 }, { km: 5, elevationM: 300 }, { km: 10, elevationM: 200 }], 100, 50)!;
    expect(e.d.startsWith('M0.0,50.0')).toBe(true);
    expect([e.minM, e.maxM]).toEqual([100, 300]);
    expect(elevationPath([], 100, 50)).toBeUndefined();
  });
});

describe('vehicles', () => {
  it('shows EV9 gross capacity and offers more cars', () => {
    expect(EV9_GTLINE.usableKWh).toBe(96);
    expect(capacityText(EV9_GTLINE)).toContain('99.8');
    expect(BUILT_INS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(BUILT_INS.map((v) => v.id)).size).toBe(BUILT_INS.length);
  });
});
