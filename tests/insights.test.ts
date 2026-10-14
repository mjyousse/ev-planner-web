import { describe, expect, it } from 'vitest';
import { arrivalBand, arrivalRange, costLines, efficiency, fmtEfficiency, fmtTemp, nextEfficiency, pickRoute, rangeText, EFFICIENCY_UNITS, type RouteSummary } from '../src/engine/insights';
import { parseRoutes } from '../src/services/routing';
import { totalKm } from '../src/engine/geo';

const options: RouteSummary[] = [
  { index: 0, name: 'I-35', km: 300, totalMinutes: 200, cost: 30, energyKWh: 75, arrivalSoC: 18, stops: 1 },
  { index: 1, name: 'US-77', km: 290, totalMinutes: 215, cost: 18, energyKWh: 66, arrivalSoC: 24, stops: 1 },
  { index: 2, name: 'TX-6', km: 320, totalMinutes: 230, cost: 25, energyKWh: 70, arrivalSoC: 21, stops: 1 },
];

describe('insights', () => {
  it('formats temperature in either unit', () => {
    expect(fmtTemp(25, 'F')).toBe('77°F');
    expect(fmtTemp(25, 'C')).toBe('25°C');
    expect(fmtTemp(undefined, 'F')).toBe('—');
  });

  it('converts average energy use between units', () => {
    const km = 160.9344;
    expect(efficiency('miPerKWh', 30, km)).toBeCloseTo(3.333, 2);
    expect(efficiency('kWhPer100mi', 30, km)).toBeCloseTo(30, 5);
    expect(efficiency('kWhPer100km', 30, km)).toBeCloseTo(18.64, 2);
    expect(fmtEfficiency('whPerMi', 30, km)).toBe('300 Wh/mi');
    expect(efficiency('miPerKWh', 0, km)).toBeUndefined();
    let u = EFFICIENCY_UNITS[0];
    const seen = new Set<string>();
    for (let i = 0; i < EFFICIENCY_UNITS.length; i++) { seen.add(u); u = nextEfficiency(u); }
    expect(seen.size).toBe(EFFICIENCY_UNITS.length);
    expect(u).toBe(EFFICIENCY_UNITS[0]);
  });

  it('picks the route that matches the preference', () => {
    expect(pickRoute(options, 'fastest')?.index).toBe(0);
    expect(pickRoute(options, 'cheapest')?.index).toBe(1);
    expect(pickRoute(options, 'efficient')?.index).toBe(1);
    expect(pickRoute(options, 'balanced')?.index).toBe(1);
    expect(pickRoute([], 'fastest')).toBeUndefined();
  });

  it('shows arrival as a range', () => {
    expect(rangeText(arrivalRange(options)!)).toBe('18–24%');
    const [lo, hi] = arrivalBand(20, 50, 96);
    expect(lo).toBeCloseTo(14.79, 1);
    expect(hi).toBeCloseTo(25.21, 1);
    expect(arrivalBand(2, 50, 96)[0]).toBe(0);
  });

  it('explains how a stop is priced', () => {
    const l = costLines(46, 0.92, 0.48, 25);
    expect(l[1]).toContain('50.0 kWh');
    expect(l[2]).toBe('× $0.48/kWh = $24.00');
    expect(l[3]).toBe('+ $1.00 session or per-minute fees');
    expect(l.at(-1)).toBe('= $25.00');
    expect(costLines(46, 0.92, 0.48, 24)).toHaveLength(4);
  });

  it('parses OSRM alternatives and names them by main road', () => {
    const r = parseRoutes({ routes: [
      { duration: 3600, geometry: { coordinates: [[-97, 30], [-97, 30.5]] }, legs: [{ steps: [{ distance: 1000, name: 'Main St' }, { distance: 54000, name: '', ref: 'I 35' }] }] },
      { duration: 4000, geometry: { coordinates: [[-97, 30], [-97.1, 30.5]] }, legs: [] },
    ] });
    expect(r).toHaveLength(2);
    expect(r[0].name).toBe('I 35');
    expect(totalKm(r[0].route)).toBeGreaterThan(50);
    expect(r[1].name).toBe('');
  });
});
