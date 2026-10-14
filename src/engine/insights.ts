export type TemperatureUnit = 'F' | 'C';
export const tempValue = (c: number, u: TemperatureUnit) => (u === 'F' ? (c * 9) / 5 + 32 : c);
export const fmtTemp = (c: number | undefined, u: TemperatureUnit) => (c === undefined ? '—' : `${Math.round(tempValue(c, u))}°${u}`);

export type EfficiencyUnit = 'miPerKWh' | 'kWhPer100mi' | 'whPerMi' | 'kmPerKWh' | 'kWhPer100km';
export const EFFICIENCY_UNITS: EfficiencyUnit[] = ['miPerKWh', 'kWhPer100mi', 'whPerMi', 'kmPerKWh', 'kWhPer100km'];
export const EFFICIENCY_LABEL: Record<EfficiencyUnit, string> = {
  miPerKWh: 'mi/kWh', kWhPer100mi: 'kWh/100 mi', whPerMi: 'Wh/mi', kmPerKWh: 'km/kWh', kWhPer100km: 'kWh/100 km',
};

export function efficiency(u: EfficiencyUnit, kWh: number, km: number): number | undefined {
  if (!(kWh > 0) || !(km > 0)) return undefined;
  const mi = km / 1.609344;
  switch (u) {
    case 'miPerKWh': return mi / kWh;
    case 'kWhPer100mi': return (kWh / mi) * 100;
    case 'whPerMi': return (kWh * 1000) / mi;
    case 'kmPerKWh': return km / kWh;
    case 'kWhPer100km': return (kWh / km) * 100;
  }
}

export function fmtEfficiency(u: EfficiencyUnit, kWh: number, km: number): string {
  const v = efficiency(u, kWh, km);
  if (v === undefined) return '–';
  const n = u === 'whPerMi' ? String(Math.round(v)) : u === 'miPerKWh' || u === 'kmPerKWh' ? v.toFixed(2) : v.toFixed(1);
  return `${n} ${EFFICIENCY_LABEL[u]}`;
}

export const nextEfficiency = (u: EfficiencyUnit) => EFFICIENCY_UNITS[(EFFICIENCY_UNITS.indexOf(u) + 1) % EFFICIENCY_UNITS.length];

export type RoutePreference = 'fastest' | 'balanced' | 'cheapest' | 'efficient';
export const PREFERENCES: Record<RoutePreference, { title: string; detail: string; valueOfTime: number }> = {
  fastest: { title: 'Fastest', detail: 'Shortest total time, even if charging costs more.', valueOfTime: 150 },
  balanced: { title: 'Balanced', detail: 'Trades a few minutes for noticeably cheaper charging.', valueOfTime: 25 },
  cheapest: { title: 'Cheapest', detail: 'Lowest charging cost, even if it takes longer.', valueOfTime: 4 },
  efficient: { title: 'Most efficient', detail: 'Route that uses the least energy after hills, wind, temperature and speed.', valueOfTime: 25 },
};

export interface RouteSummary { index: number; name: string; km: number; totalMinutes: number; cost: number; energyKWh: number; arrivalSoC: number; stops: number }

export function pickRoute(options: RouteSummary[], pref: RoutePreference): RouteSummary | undefined {
  const key: (o: RouteSummary) => [number, number] =
    pref === 'fastest' ? (o) => [o.totalMinutes, o.cost]
      : pref === 'cheapest' ? (o) => [o.cost, o.totalMinutes]
        : pref === 'efficient' ? (o) => [o.energyKWh, o.totalMinutes]
          : (o) => [o.totalMinutes + (o.cost / PREFERENCES.balanced.valueOfTime) * 60, 0];
  return options.reduce<RouteSummary | undefined>((best, o) => {
    if (!best) return o;
    const a = key(o), b = key(best);
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? o : best;
  }, undefined);
}

export function arrivalRange(options: RouteSummary[]): [number, number] | undefined {
  if (!options.length) return undefined;
  const s = options.map((o) => o.arrivalSoC);
  return [Math.min(...s), Math.max(...s)];
}

export function arrivalBand(arrivalSoC: number, finalLegKWh: number, usableKWh: number, uncertainty = 0.1): [number, number] {
  const d = ((finalLegKWh * uncertainty) / Math.max(usableKWh, 1)) * 100;
  return [Math.max(0, arrivalSoC - d), Math.min(100, arrivalSoC + d)];
}

export function rangeText([lo, hi]: [number, number]): string {
  const a = Math.round(lo), b = Math.round(hi);
  return a === b ? `${a}%` : `${a}–${b}%`;
}

export function costLines(addedKWh: number, efficiency: number, rate: number, total: number): string[] {
  const billed = addedKWh / Math.max(efficiency, 0.5);
  const energyCost = billed * rate;
  const fees = Math.max(0, total - energyCost);
  const out = [
    `${addedKWh.toFixed(1)} kWh into the battery`,
    `÷ 92% charging efficiency = ${billed.toFixed(1)} kWh from the charger`,
    `× $${rate.toFixed(2)}/kWh = $${energyCost.toFixed(2)}`,
  ];
  if (fees >= 0.01) out.push(`+ $${fees.toFixed(2)} session or per-minute fees`);
  out.push(`= $${total.toFixed(2)}`);
  return out;
}
