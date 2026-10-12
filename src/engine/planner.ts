import { ChargeTable, coldChargeFactor } from './charge';
import { RouteEnergy, type EnergyModel, type LegWeather } from './energy';
import { totalKm, type DrivingRoute } from './geo';
import { isTeslaOnly, networkPricePerKWh, priceNote, type Charger, type PriceSource } from './pricing';

export interface PlannerInput {
  route: DrivingRoute;
  chargers: Charger[];
  model: EnergyModel;
  startSoC: number;
  targetArrivalSoC: number;
  minChargerArrivalSoC: number;
  /** $/hour you'd pay to save time. Higher favours speed over price. */
  valueOfTimePerHour?: number;
  stopOverheadMinutes?: number;
  socStep?: number;
  maxChargeSoC?: number;
  chargingEfficiency?: number;
  teslaMember?: boolean;
}

export interface PlannedStop {
  charger: Charger;
  routeKm: number;
  arriveSoC: number;
  departSoC: number;
  chargeMinutes: number;
  energyKWh: number;
  cost: number;
  pricePerKWh: number;
  priceSource: PriceSource;
  priceNote?: string;
  driveMinutesFromPrevious: number;
  legWeather?: LegWeather;
  legSpeedKmh: number;
}

export interface TripPlan {
  stops: PlannedStop[];
  arrivalSoC: number;
  driveMinutes: number;
  chargeMinutes: number;
  overheadMinutes: number;
  totalMinutes: number;
  totalCost: number;
  totalKm: number;
  totalKWh: number;
  weather?: LegWeather;
  finalLegWeather?: LegWeather;
  finalLegSpeedKmh: number;
  energy: RouteEnergy;
}

export class UnreachableError extends Error {
  constructor(public maxReachKm: number) {
    super(`No charger combination reaches your destination with these limits (reachable to about ${Math.round(maxReachKm)} km). Try a lower arrival target or minimum charger arrival.`);
  }
}

/** Stops that add less than this are not worth pulling off for. */
export const MIN_CHARGE_PCT = 5;

/** Keeps the strongest station within each 2 km stretch so the graph stays small. */
export function prune(chargers: Charger[]): Charger[] {
  const buckets = new Map<number, Charger>();
  for (const c of chargers) {
    const k = Math.floor(c.routeKm / 2);
    const e = buckets.get(k);
    if (!e || c.powerKW > e.powerKW || (c.powerKW === e.powerKW && c.detourKm < e.detourKm)) buckets.set(k, c);
  }
  return [...buckets.values()];
}

class MinHeap<T> {
  private items: [T, number][] = [];
  get size() { return this.items.length; }
  push(v: T, p: number) {
    const it = this.items; it.push([v, p]);
    let i = it.length - 1;
    while (i > 0) { const q = (i - 1) >> 1; if (it[q][1] <= it[i][1]) break; [it[q], it[i]] = [it[i], it[q]]; i = q; }
  }
  pop(): [T, number] | undefined {
    const it = this.items;
    if (!it.length) return undefined;
    [it[0], it[it.length - 1]] = [it[it.length - 1], it[0]];
    const top = it.pop()!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < it.length && it[l][1] < it[m][1]) m = l;
      if (r < it.length && it[r][1] < it[m][1]) m = r;
      if (m === i) break;
      [it[i], it[m]] = [it[m], it[i]]; i = m;
    }
    return top;
  }
}

/**
 * Shortest-path search over (charger, departure SoC) states.
 * Cost = drive time + stop overhead + charge time + money ÷ value of time.
 */
export function plan(input: PlannerInput): TripPlan {
  const vot = input.valueOfTimePerHour ?? 25;
  const overhead = input.stopOverheadMinutes ?? 4;
  const socStep = input.socStep ?? 5;
  const maxSoC = input.maxChargeSoC ?? 100;
  const eff = input.chargingEfficiency ?? 0.92;
  const { route, model } = input;
  const profile = model.profile;
  const total = totalKm(route);
  const energy = new RouteEnergy(route, model);
  const usable = profile.usableKWh;
  const detourWhPerKm = model.whPerKm(50);

  const candidates = prune(input.chargers.filter((c) => (profile.acceptsTesla || !isTeslaOnly(c)) && c.routeKm > 0.5 && c.routeKm < total - 0.5))
    .sort((a, b) => a.routeKm - b.routeKm);
  const nodeKm = [0, ...candidates.map((c) => c.routeKm), total];
  const last = nodeKm.length - 1;

  const tables = new Map<string, ChargeTable>();
  const table = (kw: number, scale: number) => {
    const k = `${Math.round(kw)}:${Math.round(scale * 100)}`;
    let t = tables.get(k);
    if (!t) { t = new ChargeTable(profile, kw, scale); tables.set(k, t); }
    return t;
  };

  type Link = { from: string; stop?: PlannedStop };
  const keyOf = (node: number, soc: number) => `${node}|${Math.round(soc * 10)}`;
  const nodeOf = (k: string) => parseInt(k, 10);
  const start = keyOf(0, input.startSoC);
  const best = new Map<string, number>([[start, 0]]);
  const socOf = new Map<string, number>([[start, input.startSoC]]);
  const link = new Map<string, Link>();
  const heap = new MinHeap<string>();
  heap.push(start, 0);
  let reachKm = 0;
  let goal: string | undefined;

  const relax = (s: string, cost: number, soc: number, l: Link) => {
    if (cost < (best.get(s) ?? Infinity)) { best.set(s, cost); socOf.set(s, soc); link.set(s, l); heap.push(s, cost); }
  };

  for (let top = heap.pop(); top; top = heap.pop()) {
    const [state, cost] = top;
    if (cost > (best.get(state) ?? Infinity) + 1e-9) continue;
    const node = nodeOf(state);
    if (node === last) { goal = state; break; }
    const soc = socOf.get(state)!;
    const fromKm = nodeKm[node];
    const fromDetour = node === 0 ? 0 : candidates[node - 1].detourKm;

    for (let j = node + 1; j <= last; j++) {
      const toKm = nodeKm[j];
      const toDetour = j === last ? 0 : candidates[j - 1].detourKm;
      const legKWh = energy.kWh(fromKm, toKm) + ((fromDetour + toDetour) * detourWhPerKm) / 1000;
      const arrive = soc - (legKWh / usable) * 100;
      if (arrive < input.minChargerArrivalSoC - 40) break;
      if (arrive >= 0) reachKm = Math.max(reachKm, toKm);
      const driveMin = energy.minutes(fromKm, toKm) + ((fromDetour + toDetour) / 40) * 60;

      if (j === last) {
        if (arrive < input.targetArrivalSoC - 1e-6) continue;
        relax(keyOf(j, arrive), cost + driveMin * 60, arrive, { from: state });
        continue;
      }
      if (arrive < input.minChargerArrivalSoC - 1e-6) continue;
      const charger = candidates[j - 1];
      const price = charger.price ?? { perKWh: networkPricePerKWh(charger.network, input.teslaMember), source: 'estimate' as const, note: priceNote(charger.network, input.teslaMember) };
      const scale = model.opts.useWeather ? coldChargeFactor(energy.temperatureAt(toKm)) : 1;
      const t = table(charger.powerKW, scale);

      let departs: number[] = [];
      for (let d = Math.floor(arrive / socStep) * socStep + socStep; d <= maxSoC + 1e-9; d += socStep) departs.push(d);
      const need = input.targetArrivalSoC + (energy.kWh(toKm, total) / usable) * 100 + ((toDetour * detourWhPerKm) / 1000 / usable) * 100;
      const roundedNeed = Math.ceil(need + 0.5);
      if (roundedNeed > arrive && roundedNeed <= maxSoC) departs.push(roundedNeed);
      if (roundedNeed <= maxSoC) departs = departs.filter((d) => d <= roundedNeed);

      for (const depart of departs) {
        if (depart < arrive + MIN_CHARGE_PCT) continue;
        const chargeMin = t.minutes(arrive, depart);
        const kWh = ((depart - arrive) / 100) * usable;
        const money = (kWh / eff) * price.perKWh;
        const stepCost = driveMin * 60 + overhead * 60 + chargeMin * 60 + (money / Math.max(vot, 1)) * 3600;
        relax(keyOf(j, depart), cost + stepCost, depart, {
          from: state,
          stop: {
            charger, routeKm: toKm, arriveSoC: arrive, departSoC: depart, chargeMinutes: chargeMin, energyKWh: kWh, cost: money,
            pricePerKWh: price.perKWh, priceSource: price.source, priceNote: price.note, driveMinutesFromPrevious: driveMin, legSpeedKmh: 0,
          },
        });
      }
    }
  }

  if (!goal) throw new UnreachableError(reachKm);

  const stops: PlannedStop[] = [];
  let cursor = goal;
  let finalLegMin = 0, first = true;
  for (let l = link.get(cursor); l; l = link.get(cursor)) {
    if (first) {
      const fn = nodeOf(l.from);
      const det = fn === 0 ? 0 : candidates[fn - 1].detourKm;
      finalLegMin = energy.minutes(nodeKm[fn], total) + (det / 40) * 60;
      first = false;
    }
    if (l.stop) stops.push(l.stop);
    cursor = l.from;
  }
  stops.reverse();

  const weatherOn = model.opts.useWeather && route.hasWeather;
  let prev = 0;
  for (const s of stops) {
    if (weatherOn) s.legWeather = energy.weather(prev, s.routeKm);
    s.legSpeedKmh = energy.averageSpeedKmh(prev, s.routeKm);
    prev = s.routeKm;
  }
  const charge = stops.reduce((a, s) => a + s.chargeMinutes, 0);
  const drive = stops.reduce((a, s) => a + s.driveMinutesFromPrevious, 0) + finalLegMin;
  const overheadMin = stops.length * overhead;
  return {
    stops, arrivalSoC: socOf.get(goal)!, driveMinutes: drive, chargeMinutes: charge, overheadMinutes: overheadMin,
    totalMinutes: drive + charge + overheadMin, totalCost: stops.reduce((a, s) => a + s.cost, 0), totalKm: total,
    totalKWh: energy.kWh(0, total),
    weather: weatherOn ? energy.weather(0, total) : undefined,
    finalLegWeather: weatherOn ? energy.weather(prev, total) : undefined,
    finalLegSpeedKmh: energy.averageSpeedKmh(prev, total), energy,
  };
}
