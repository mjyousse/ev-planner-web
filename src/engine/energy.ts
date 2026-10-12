import { averageSpeedKmh, bearingDeg, totalKm, type DrivingRoute, type RoutePoint } from './geo';
import type { VehicleProfile } from './vehicles';

export const DRIVER_KG = 80;
export const REFERENCE_TEMP_C = 20;

export interface ModelOptions {
  /** Learned or manual multiplier on consumption (1 = reference). */
  correction: number;
  drivetrainEfficiency: number;
  regenEfficiency: number;
  useWeather: boolean;
  /** Speed you drive relative to the limit (1.0 = at the limit). */
  speedFactor: number;
  /** Speed at which the reference consumption applies, km/h. */
  referenceSpeedKmh: number;
  /** Never faster than this, km/h. */
  maxSpeedKmh: number;
}

export const MPH = 1.609344;

export function defaultModelOptions(): ModelOptions {
  return { correction: 1, drivetrainEfficiency: 0.9, regenEfficiency: 0.65, useWeather: true, speedFactor: 1, referenceSpeedKmh: 62 * MPH, maxSpeedKmh: 80 * MPH };
}

/** Physics-flavoured consumption scaled from a reference figure, with wind, air density and temperature. */
export class EnergyModel {
  constructor(public profile: VehicleProfile, public opts: ModelOptions = defaultModelOptions()) {}

  get totalMassKg() { return this.profile.curbMassKg + this.profile.extraWeightKg + DRIVER_KG; }

  /** Speed actually driven on a road with this limit, km/h. */
  drivingSpeedKmh(limitKmh: number): number {
    return Math.max(15, Math.min(limitKmh * this.opts.speedFactor, this.opts.maxSpeedKmh));
  }

  /** Flat-road consumption, Wh/km. Aero grows with speed squared. */
  whPerKm(limitKmh: number): number {
    const v = this.drivingSpeedKmh(limitKmh);
    const ref = Math.max(this.opts.referenceSpeedKmh, 30);
    const massRatio = this.totalMassKg / (this.profile.curbMassKg + DRIVER_KG);
    const rolling = 0.4 * massRatio;
    const aero = 0.5 * (v / ref) ** 2;
    const aux = 0.1 * (ref / v);
    return this.profile.referenceWhPerKm * (rolling + aero + aux) * this.opts.correction;
  }

  /** Dry air density at sea-level pressure, kg/m³. */
  static airDensity(tempC: number): number { return 101325 / (287.05 * (tempC + 273.15)); }

  /** Extra aero Wh/km versus still air at 20 °C. Positive headwind blows into the car. */
  aeroDeltaWhPerKm(limitKmh: number, headwindMs: number, tempC?: number): number {
    const v = this.drivingSpeedKmh(limitKmh) / 3.6;
    const vAir = v + headwindMs;
    const rho = EnergyModel.airDensity(tempC ?? REFERENCE_TEMP_C);
    const rho0 = EnergyModel.airDensity(REFERENCE_TEMP_C);
    const force = 0.5 * rho * this.profile.cdA * vAir * Math.abs(vAir);
    const reference = 0.5 * rho0 * this.profile.cdA * v * v;
    return (force - reference) / 3.6 / this.opts.drivetrainEfficiency;
  }

  /** Cabin heating/cooling and battery conditioning as a multiplier. */
  static temperatureFactor(tempC?: number): number {
    if (tempC === undefined) return 1;
    if (tempC < 15) return 1 + Math.min(0.35, 0.012 * (15 - tempC));
    if (tempC > 30) return 1 + Math.min(0.15, 0.01 * (tempC - 30));
    return 1;
  }

  /** kWh for a stretch including climbing (or regen on descents). */
  energyKWh(distanceKm: number, limitKmh: number, climbM: number, headwindMs = 0, tempC?: number, weather = this.opts.useWeather): number {
    let wh = this.whPerKm(limitKmh);
    if (weather) wh = wh * EnergyModel.temperatureFactor(tempC) + this.aeroDeltaWhPerKm(limitKmh, headwindMs, tempC) * this.opts.correction;
    const flat = (Math.max(wh, 0) * distanceKm) / 1000;
    const potential = (this.totalMassKg * 9.81 * climbM) / 3.6e6;
    return flat + (climbM >= 0 ? potential / this.opts.drivetrainEfficiency : potential * this.opts.regenEfficiency);
  }
}

export interface LegWeather {
  headwindMs: number;
  temperatureC?: number;
  deltaKWh: number;
  baseKWh: number;
}
export const weatherPercent = (w: LegWeather) => (w.baseKWh > 0.01 ? (w.deltaKWh / w.baseKWh) * 100 : 0);

/** Headwind component against the segment bearing, m/s. */
export function headwind(a: RoutePoint, b: RoutePoint): number {
  const p = b.windMs !== undefined ? b : a;
  if (p.windMs === undefined) return 0;
  return p.windMs * Math.cos(((p.windFromDeg - bearingDeg(a, b)) * Math.PI) / 180);
}

/** Cumulative energy, time and weather along a route so any leg is priced in O(log n). */
export class RouteEnergy {
  readonly cumKWh: number[] = [0];
  /** Per-segment Wh/km, for colouring the map. */
  readonly segWhPerKm: number[] = [];
  readonly segSpeedKmh: number[] = [];
  private cumBase = [0]; private cumHead = [0]; private cumTemp = [0]; private cumTempKm = [0]; private cumMin = [0];

  constructor(public route: DrivingRoute, public model: EnergyModel) {
    const fallback = averageSpeedKmh(route);
    const pts = route.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = b.km - a.km;
      const climb = b.elevationM - a.elevationM;
      const hw = headwind(a, b);
      const t = b.temperatureC ?? a.temperatureC;
      const limit = b.speedLimitKmh ?? a.speedLimitKmh ?? fallback;
      const e = model.energyKWh(d, limit, climb, hw, t);
      this.cumMin.push(this.cumMin[i - 1] + (d / model.drivingSpeedKmh(limit)) * 60);
      this.cumKWh.push(this.cumKWh[i - 1] + e);
      this.cumBase.push(this.cumBase[i - 1] + model.energyKWh(d, limit, climb, 0, undefined, false));
      this.cumHead.push(this.cumHead[i - 1] + hw * d);
      this.cumTemp.push(this.cumTemp[i - 1] + (t ?? 0) * d);
      this.cumTempKm.push(this.cumTempKm[i - 1] + (t === undefined ? 0 : d));
      this.segWhPerKm.push(d > 0 ? (e * 1000) / d : 0);
      this.segSpeedKmh.push(model.drivingSpeedKmh(limit));
    }
  }

  private interp(arr: number[], km: number): number {
    const pts = this.route.points;
    if (pts.length < 2 || arr.length !== pts.length || km <= 0) return 0;
    if (km >= totalKm(this.route)) return arr.at(-1)!;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].km <= km) lo = mid; else hi = mid;
    }
    const span = pts[hi].km - pts[lo].km;
    const t = span > 0 ? (km - pts[lo].km) / span : 0;
    return arr[lo] + (arr[hi] - arr[lo]) * t;
  }

  kWh(a: number, b: number) { return this.interp(this.cumKWh, b) - this.interp(this.cumKWh, a); }
  minutes(a: number, b: number) { return this.interp(this.cumMin, b) - this.interp(this.cumMin, a); }
  averageSpeedKmh(a: number, b: number) { const m = this.minutes(a, b); return m > 0 ? (b - a) / (m / 60) : 0; }

  temperatureAt(km: number): number | undefined {
    const pts = this.route.points;
    if (!pts.length) return undefined;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].km <= km) lo = mid; else hi = mid; }
    return pts[hi].temperatureC ?? pts[lo].temperatureC;
  }

  weather(a: number, b: number): LegWeather {
    const d = Math.max(b - a, 1e-6);
    const base = this.interp(this.cumBase, b) - this.interp(this.cumBase, a);
    const tKm = this.interp(this.cumTempKm, b) - this.interp(this.cumTempKm, a);
    return {
      headwindMs: (this.interp(this.cumHead, b) - this.interp(this.cumHead, a)) / d,
      temperatureC: tKm > 0.01 ? (this.interp(this.cumTemp, b) - this.interp(this.cumTemp, a)) / tKm : undefined,
      deltaKWh: this.kWh(a, b) - base,
      baseKWh: base,
    };
  }
}
