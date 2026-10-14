export interface CurvePoint { soc: number; kw: number }

export interface VehicleProfile {
  id: string;
  name: string;
  trim: string;
  /** Usable pack energy, kWh. */
  usableKWh: number;
  /** Flat-road consumption at 100 km/h in mild, still air, Wh/km. */
  referenceWhPerKm: number;
  curbMassKg: number;
  extraWeightKg: number;
  maxChargeKW: number;
  /** DC fast-charging curve, sorted by SoC. */
  curve: CurvePoint[];
  /** Can use Tesla Superchargers (NACS adapter or native). */
  acceptsTesla: boolean;
  /** Drag coefficient × frontal area, m². */
  cdA: number;
  builtIn: boolean;
  /** Gross (nominal) pack energy published by the maker, display only. Planning uses usableKWh. */
  grossKWh?: number;
}

export const capacityText = (v: VehicleProfile) =>
  v.grossKWh && v.grossKWh > v.usableKWh ? `${v.grossKWh.toFixed(1)} kWh (${Math.round(v.usableKWh)} usable)` : `${Math.round(v.usableKWh)} kWh`;

export function chargePowerKW(p: VehicleProfile, soc: number): number {
  const c = p.curve;
  if (!c.length) return p.maxChargeKW;
  if (soc <= c[0].soc) return c[0].kw;
  const last = c[c.length - 1];
  if (soc >= last.soc) return last.kw;
  for (let i = 1; i < c.length; i++) {
    if (soc <= c[i].soc) {
      const a = c[i - 1], b = c[i];
      const t = (soc - a.soc) / Math.max(b.soc - a.soc, 1e-4);
      return a.kw + (b.kw - a.kw) * t;
    }
  }
  return last.kw;
}

const pts = (arr: [number, number][]): CurvePoint[] => arr.map(([soc, kw]) => ({ soc, kw }));

/** 2026 Kia EV9 GT-Line AWD: 99.8 kWh gross (Kia), 96 kWh usable (EV Database), 800 V, 10–80% in about 24 min. */
export const EV9_GTLINE: VehicleProfile = {
  id: 'kia-ev9-gtline-awd-2026', name: 'Kia EV9', trim: 'GT-Line AWD · 2026',
  usableKWh: 96, referenceWhPerKm: 235, curbMassKg: 2650, extraWeightKg: 0, maxChargeKW: 215,
  curve: pts([[0, 140], [5, 180], [10, 205], [20, 212], [30, 210], [40, 200], [50, 185], [60, 165], [70, 145], [75, 125], [80, 100], [85, 75], [90, 50], [95, 30], [100, 12]]),
  acceptsTesla: true, cdA: 0.28 * 2.95, builtIn: true, grossKWh: 99.8,
};

export const IONIQ5_LR: VehicleProfile = {
  id: 'hyundai-ioniq5-lr-awd-2025', name: 'Hyundai Ioniq 5', trim: 'Long Range AWD · 2025',
  usableKWh: 80, referenceWhPerKm: 190, curbMassKg: 2160, extraWeightKg: 0, maxChargeKW: 235,
  curve: pts([[0, 150], [10, 225], [20, 232], [30, 230], [40, 225], [50, 215], [60, 200], [70, 175], [75, 150], [80, 110], [90, 55], [100, 12]]),
  acceptsTesla: true, cdA: 0.288 * 2.6, builtIn: true,
};

export const MODELY_LR: VehicleProfile = {
  id: 'tesla-modely-lr-awd', name: 'Tesla Model Y', trim: 'Long Range AWD',
  usableKWh: 75, referenceWhPerKm: 155, curbMassKg: 1980, extraWeightKg: 0, maxChargeKW: 250,
  curve: pts([[0, 170], [10, 250], [20, 240], [30, 200], [40, 170], [50, 140], [60, 115], [70, 95], [80, 75], [90, 45], [100, 15]]),
  acceptsTesla: true, cdA: 0.23 * 2.6, builtIn: true,
};

type Spec = [id: string, name: string, trim: string, usable: number, whPerKm: number, massKg: number, maxKW: number, curve: [number, number][], tesla: boolean, cdA: number, gross?: number];

/** More common EVs. Figures are typical published values (EV Database, maker specs); curves are simplified. */
const SPECS: Spec[] = [
  ['kia-ev6-lr-awd', 'Kia EV6', 'Long Range AWD', 80, 185, 2090, 235, [[0, 150], [10, 225], [30, 230], [50, 210], [70, 170], [80, 110], [90, 55], [100, 12]], true, 0.28 * 2.6, 84],
  ['hyundai-ioniq6-lr-rwd', 'Hyundai Ioniq 6', 'Long Range RWD', 74, 150, 1950, 235, [[0, 150], [10, 225], [30, 230], [50, 210], [70, 170], [80, 110], [90, 55], [100, 12]], true, 0.21 * 2.3, 77.4],
  ['hyundai-ioniq9-lr-awd', 'Hyundai Ioniq 9', 'Long Range AWD', 106, 225, 2600, 230, [[0, 150], [10, 215], [30, 225], [50, 205], [70, 165], [80, 110], [90, 55], [100, 12]], true, 0.26 * 2.95, 110.3],
  ['tesla-model3-lr-awd', 'Tesla Model 3', 'Long Range AWD', 75, 140, 1830, 250, [[0, 170], [10, 250], [20, 240], [30, 200], [50, 140], [70, 95], [80, 75], [90, 45], [100, 15]], true, 0.22 * 2.2, 82],
  ['tesla-modelx-lr', 'Tesla Model X', 'Long Range', 95, 210, 2400, 250, [[0, 170], [10, 250], [25, 220], [40, 170], [60, 120], [80, 70], [100, 15]], true, 0.24 * 2.9, 100],
  ['ford-mache-er-awd', 'Ford Mustang Mach-E', 'Extended Range AWD', 91, 195, 2230, 150, [[0, 100], [10, 150], [40, 145], [60, 110], [80, 70], [90, 40], [100, 12]], true, 0.29 * 2.6, 98.7],
  ['ford-f150-lightning-er', 'Ford F-150 Lightning', 'Extended Range', 131, 300, 2950, 155, [[0, 110], [10, 155], [40, 150], [60, 110], [80, 70], [90, 40], [100, 12]], true, 0.44 * 3.5],
  ['chevy-equinox-ev-fwd', 'Chevrolet Equinox EV', 'FWD', 85, 175, 2100, 150, [[0, 100], [10, 150], [40, 145], [60, 110], [80, 70], [90, 40], [100, 12]], true, 0.30 * 2.6],
  ['chevy-blazer-ev-awd', 'Chevrolet Blazer EV', 'AWD', 85, 200, 2400, 150, [[0, 100], [10, 150], [40, 145], [60, 110], [80, 70], [90, 40], [100, 12]], true, 0.30 * 2.7],
  ['rivian-r1s-large', 'Rivian R1S', 'Large pack Dual', 135, 270, 3000, 220, [[0, 150], [10, 210], [30, 210], [50, 180], [70, 130], [80, 100], [90, 55], [100, 12]], true, 0.33 * 3.2, 140],
  ['vw-id4-pro-awd', 'Volkswagen ID.4', 'Pro AWD', 77, 190, 2200, 175, [[0, 120], [10, 175], [30, 170], [50, 130], [70, 95], [80, 75], [90, 45], [100, 12]], true, 0.28 * 2.6, 82],
  ['bmw-ix-xdrive50', 'BMW iX', 'xDrive50', 105, 210, 2500, 195, [[0, 140], [10, 195], [30, 190], [50, 160], [70, 120], [80, 90], [90, 50], [100, 12]], true, 0.25 * 2.8, 111.5],
  ['kia-ev9-lr-rwd', 'Kia EV9', 'Long Range RWD', 96, 220, 2450, 215, [[0, 140], [10, 205], [30, 210], [50, 185], [70, 145], [80, 100], [90, 50], [100, 12]], true, 0.28 * 2.95, 99.8],
];

export const MORE_VEHICLES: VehicleProfile[] = SPECS.map(([id, name, trim, usableKWh, referenceWhPerKm, curbMassKg, maxChargeKW, curve, acceptsTesla, cdA, grossKWh]) => ({
  id, name, trim, usableKWh, referenceWhPerKm, curbMassKg, extraWeightKg: 0, maxChargeKW, curve: pts(curve), acceptsTesla, cdA, builtIn: true, grossKWh,
}));

export const BUILT_INS: VehicleProfile[] = [EV9_GTLINE, IONIQ5_LR, MODELY_LR, ...MORE_VEHICLES];
