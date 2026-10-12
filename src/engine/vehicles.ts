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
}

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

/** 2026 Kia EV9 GT-Line AWD: ~96 kWh usable, 800 V, 10–80% in about 24 min. */
export const EV9_GTLINE: VehicleProfile = {
  id: 'kia-ev9-gtline-awd-2026', name: 'Kia EV9', trim: 'GT-Line AWD · 2026',
  usableKWh: 96, referenceWhPerKm: 235, curbMassKg: 2650, extraWeightKg: 0, maxChargeKW: 215,
  curve: pts([[0, 140], [5, 180], [10, 205], [20, 212], [30, 210], [40, 200], [50, 185], [60, 165], [70, 145], [75, 125], [80, 100], [85, 75], [90, 50], [95, 30], [100, 12]]),
  acceptsTesla: true, cdA: 0.28 * 2.95, builtIn: true,
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

export const BUILT_INS: VehicleProfile[] = [EV9_GTLINE, IONIQ5_LR, MODELY_LR];
