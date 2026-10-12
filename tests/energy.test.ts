import { describe, expect, it } from 'vitest';
import { EnergyModel, MPH, RouteEnergy, defaultModelOptions, headwind } from '../src/engine/energy';
import { EV9_GTLINE } from '../src/engine/vehicles';
import { straightRoute } from './helpers';

const model = (o = {}) => new EnergyModel(EV9_GTLINE, { ...defaultModelOptions(), ...o });

describe('energy model', () => {
  it('matches the reference consumption at the reference speed', () => {
    const m = model();
    expect(m.whPerKm(62 * MPH)).toBeCloseTo(EV9_GTLINE.referenceWhPerKm, 0);
  });

  it('75 mph uses noticeably more per mile than 55 mph', () => {
    const m = model();
    const ratio = m.whPerKm(75 * MPH) / m.whPerKm(55 * MPH);
    expect(ratio).toBeGreaterThan(1.25);
    expect(ratio).toBeLessThan(1.6);
  });

  it('clamps driving speed to max speed and applies the speed factor', () => {
    expect(model().drivingSpeedKmh(200)).toBeCloseTo(80 * MPH);
    expect(model({ speedFactor: 1.1 }).drivingSpeedKmh(100)).toBeCloseTo(110);
  });

  it('headwind costs energy, tailwind saves it', () => {
    const m = model();
    const still = m.energyKWh(100, 110, 0, 0, 20);
    expect(m.energyKWh(100, 110, 0, 5, 20)).toBeGreaterThan(still);
    expect(m.energyKWh(100, 110, 0, -5, 20)).toBeLessThan(still);
  });

  it('cold air is denser and cabin heat costs more', () => {
    expect(EnergyModel.airDensity(-10)).toBeGreaterThan(EnergyModel.airDensity(30));
    expect(EnergyModel.temperatureFactor(0)).toBeCloseTo(1.18);
    expect(EnergyModel.temperatureFactor(20)).toBe(1);
    expect(EnergyModel.temperatureFactor(-50)).toBe(1.35);
  });

  it('climbing costs energy and descending recovers part of it', () => {
    const m = model();
    const flat = m.energyKWh(10, 100, 0);
    const up = m.energyKWh(10, 100, 300) - flat;
    const down = flat - m.energyKWh(10, 100, -300);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
    expect(down).toBeLessThan(up);
  });

  it('computes headwind from wind direction against travel bearing', () => {
    const a = { lat: 30, lon: -97, km: 0, elevationM: 0, windFromDeg: 0 };
    const b = { ...a, lat: 30.1, km: 11, windMs: 10, windFromDeg: 0 }; // northbound into a north wind
    expect(headwind(a, b)).toBeCloseTo(10, 1);
    expect(headwind(a, { ...b, windFromDeg: 180 })).toBeCloseTo(-10, 1);
  });

  it('route energy is cumulative and interpolates', () => {
    const e = new RouteEnergy(straightRoute(200), model());
    expect(e.kWh(0, 200)).toBeCloseTo(e.kWh(0, 80) + e.kWh(80, 200), 6);
    expect(e.kWh(0, 100)).toBeGreaterThan(15);
    expect(e.minutes(0, 110)).toBeCloseTo(60, 0);
  });
});
