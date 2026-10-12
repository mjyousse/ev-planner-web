import { describe, expect, it } from 'vitest';
import { ChargeTable, chargeMinutes, coldChargeFactor, effectivePowerKW } from '../src/engine/charge';
import { EV9_GTLINE, IONIQ5_LR, chargePowerKW } from '../src/engine/vehicles';

describe('charge time', () => {
  it('EV9 GT-Line 10→80% on a 350 kW charger is about Kia’s 24 minutes', () => {
    const m = chargeMinutes(EV9_GTLINE, 10, 80, 350);
    expect(m).toBeGreaterThan(21);
    expect(m).toBeLessThan(27);
  });

  it('is capped by a slow charger', () => {
    expect(chargeMinutes(EV9_GTLINE, 10, 80, 50)).toBeGreaterThan(chargeMinutes(EV9_GTLINE, 10, 80, 350) * 2.5);
    expect(effectivePowerKW(EV9_GTLINE, 30, 50)).toBeCloseTo(47.5);
  });

  it('interpolates the curve', () => {
    expect(chargePowerKW(EV9_GTLINE, 15)).toBeCloseTo(208.5);
    expect(chargePowerKW(IONIQ5_LR, -5)).toBe(150);
    expect(chargePowerKW(IONIQ5_LR, 120)).toBe(12);
  });

  it('table agrees with direct integration and is additive', () => {
    const t = new ChargeTable(EV9_GTLINE, 350);
    expect(t.minutes(10, 80)).toBeCloseTo(chargeMinutes(EV9_GTLINE, 10, 80, 350), 0);
    expect(t.minutes(10, 50) + t.minutes(50, 80)).toBeCloseTo(t.minutes(10, 80), 6);
    expect(t.minutes(80, 10)).toBe(0);
  });

  it('cold packs charge slower', () => {
    expect(coldChargeFactor(20)).toBe(1);
    expect(coldChargeFactor(0)).toBeCloseTo(0.7);
    expect(coldChargeFactor(-40)).toBe(0.55);
    expect(chargeMinutes(EV9_GTLINE, 10, 80, 350, 0.25, 0.7)).toBeGreaterThan(chargeMinutes(EV9_GTLINE, 10, 80, 350));
  });
});
