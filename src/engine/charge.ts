import { chargePowerKW, type VehicleProfile } from './vehicles';

/** Fraction of a charger's nameplate the car typically sees. */
export const CHARGER_DERATE = 0.95;

export function effectivePowerKW(p: VehicleProfile, soc: number, chargerKW: number, powerScale = 1): number {
  return Math.max(1, Math.min(chargePowerKW(p, soc) * powerScale, chargerKW * CHARGER_DERATE));
}

/** Cold packs accept less power even with preconditioning. 1.0 at 15 °C and above, ~0.7 at 0 °C. */
export function coldChargeFactor(tempC?: number): number {
  if (tempC === undefined || tempC >= 15) return 1;
  return Math.max(0.55, 1 - 0.02 * (15 - tempC));
}

/** Minutes to charge from `from`% to `to`%, integrating the curve and capping at the charger. */
export function chargeMinutes(p: VehicleProfile, from: number, to: number, chargerKW: number, step = 0.25, powerScale = 1): number {
  if (to <= from) return 0;
  let soc = from, hours = 0;
  while (soc < to - 1e-9) {
    const next = Math.min(to, soc + step);
    const kWh = ((next - soc) / 100) * p.usableKWh;
    hours += kWh / effectivePowerKW(p, (soc + next) / 2, chargerKW, powerScale);
    soc = next;
  }
  return hours * 60;
}

/** Cumulative minutes from 0% in 0.5% steps for one profile/charger pair. */
export class ChargeTable {
  private cum: number[] = [0];
  constructor(p: VehicleProfile, chargerKW: number, powerScale = 1) {
    for (let s = 0; s < 100; s += 0.5) this.cum.push(this.cum.at(-1)! + chargeMinutes(p, s, s + 0.5, chargerKW, 0.25, powerScale));
  }
  private at(soc: number): number {
    const x = Math.min(Math.max(soc, 0), 100) / 0.5;
    const i = Math.floor(x);
    if (i >= this.cum.length - 1) return this.cum.at(-1)!;
    return this.cum[i] + (this.cum[i + 1] - this.cum[i]) * (x - i);
  }
  minutes(from: number, to: number): number { return Math.max(0, this.at(to) - this.at(from)); }
}
