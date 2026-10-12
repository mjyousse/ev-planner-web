import { describe, expect, it } from 'vitest';
import { EnergyModel, defaultModelOptions } from '../src/engine/energy';
import { plan, prune, UnreachableError } from '../src/engine/planner';
import { networkPricePerKWh, priceNote, ListingPricingProvider } from '../src/engine/pricing';
import { EV9_GTLINE } from '../src/engine/vehicles';
import { googleTripUrl } from '../src/services/links';
import { parseMaxspeed } from '../src/services/speedlimits';
import { charger, straightRoute } from './helpers';

const model = () => new EnergyModel(EV9_GTLINE, defaultModelOptions());

describe('planner', () => {
  it('needs no stop when the battery covers the trip', () => {
    const p = plan({ route: straightRoute(150), chargers: [charger(75)], model: model(), startSoC: 90, targetArrivalSoC: 20, minChargerArrivalSoC: 10 });
    expect(p.stops).toHaveLength(0);
    expect(p.arrivalSoC).toBeGreaterThan(20);
  });

  it('adds stops on a long trip and meets every limit', () => {
    const chargers = [100, 180, 260, 340, 420, 500].map((k) => charger(k));
    const p = plan({ route: straightRoute(600), chargers, model: model(), startSoC: 80, targetArrivalSoC: 20, minChargerArrivalSoC: 10 });
    expect(p.stops.length).toBeGreaterThanOrEqual(1);
    expect(p.arrivalSoC).toBeGreaterThanOrEqual(20 - 1e-6);
    for (const s of p.stops) {
      expect(s.arriveSoC).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(s.departSoC).toBeGreaterThan(s.arriveSoC);
      expect(s.chargeMinutes).toBeGreaterThan(0);
      expect(s.cost).toBeGreaterThan(0);
    }
    expect(p.totalMinutes).toBeCloseTo(p.driveMinutes + p.chargeMinutes + p.overheadMinutes, 6);
  });

  it('prefers a fast charger over a slow one at the same spot', () => {
    const slow = charger(180, 'ChargePoint', 50);
    const fast = charger(186, 'Electrify America', 350);
    const p = plan({ route: straightRoute(420), chargers: [slow, fast], model: model(), startSoC: 80, targetArrivalSoC: 15, minChargerArrivalSoC: 10 });
    expect(p.stops.map((s) => s.charger.id)).toEqual([fast.id]);
  });

  it('uses the Tesla non-member price unless membership is on', () => {
    const t = charger(250, 'Tesla Supercharger', 250);
    const base = { route: straightRoute(500), chargers: [t], model: model(), startSoC: 80, targetArrivalSoC: 15, minChargerArrivalSoC: 10 };
    const p = plan(base);
    expect(p.stops[0].pricePerKWh).toBe(0.58);
    expect(p.stops[0].priceNote).toBe('non-member est.');
    expect(plan({ ...base, teslaMember: true }).stops[0].pricePerKWh).toBe(0.43);
  });

  it('reports how far you can get when unreachable', () => {
    expect(() => plan({ route: straightRoute(900), chargers: [], model: model(), startSoC: 80, targetArrivalSoC: 20, minChargerArrivalSoC: 10 }))
      .toThrow(UnreachableError);
  });

  it('prunes to the strongest charger per 2 km', () => {
    const a = charger(10.2, 'ChargePoint', 62), b = charger(10.9, 'Electrify America', 350), c = charger(30);
    expect(prune([a, b, c]).map((x) => x.id).sort()).toEqual([b.id, c.id].sort());
  });
});

describe('pricing and helpers', () => {
  it('has the guest estimate table', () => {
    expect(networkPricePerKWh('Electrify America')).toBe(0.56);
    expect(networkPricePerKWh('EVgo')).toBe(0.62);
    expect(networkPricePerKWh('ChargePoint')).toBe(0.49);
    expect(networkPricePerKWh('IONNA')).toBe(0.55);
    expect(networkPricePerKWh('Rivian Adventure')).toBe(0.53);
    expect(networkPricePerKWh('bp pulse')).toBe(0.59);
    expect(networkPricePerKWh('Shell Recharge')).toBe(0.55);
    expect(networkPricePerKWh('Independent')).toBe(0.52);
    expect(priceNote('EVgo')).toBe('guest est.');
  });

  it('reads $/kWh from listing text', () => {
    expect(ListingPricingProvider.parse('$0.48 per kWh')).toBe(0.48);
    expect(ListingPricingProvider.parse('$0.30/min')).toBeUndefined();
  });

  it('parses OSM maxspeed', () => {
    expect(parseMaxspeed('70 mph')).toBeCloseTo(112.65, 1);
    expect(parseMaxspeed('100')).toBe(100);
    expect(parseMaxspeed('none')).toBeUndefined();
  });

  it('builds a Google Maps trip URL with waypoints', () => {
    const u = googleTripUrl({ lat: 30.27, lon: -97.74 }, { lat: 32.78, lon: -96.8 }, [{ lat: 31.5, lon: -97.1 }]);
    expect(u).toContain('waypoints=31.500000%2C-97.100000');
    expect(u).toContain('destination=32.780000%2C-96.800000');
  });
});
