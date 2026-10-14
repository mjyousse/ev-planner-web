import type { EfficiencyUnit, RoutePreference, TemperatureUnit } from './engine/insights';
import { BUILT_INS, EV9_GTLINE, type VehicleProfile } from './engine/vehicles';

export interface Settings {
  nrelKey: string;
  teslaMember: boolean;
  useWeather: boolean;
  useSpeedLimits: boolean;
  useElevation: boolean;
  referenceSpeedMph: number;
  maxSpeedMph: number;
  speedFactor: number;
  correction: number;
  preference: RoutePreference;
  useMiles: boolean;
  temperatureUnit: TemperatureUnit;
  efficiencyUnit: EfficiencyUnit;
  corridorMiles: number;
  colorBy: 'consumption' | 'speed';
  navApp: 'ask' | 'apple' | 'google';
  dcfcProxyUrl: string;
  vehicleId: string;
}

export const DEFAULTS: Settings = {
  nrelKey: 'DEMO_KEY', teslaMember: false, useWeather: true, useSpeedLimits: true, useElevation: true,
  referenceSpeedMph: 62, maxSpeedMph: 80, speedFactor: 1, correction: 1, preference: 'fastest', useMiles: true, temperatureUnit: 'F', efficiencyUnit: 'miPerKWh', corridorMiles: 2,
  colorBy: 'consumption', navApp: 'ask', dcfcProxyUrl: '', vehicleId: EV9_GTLINE.id,
};

const KEY = 'evp.settings.v1';
const VKEY = 'evp.vehicles.v1';

export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { localStorage.setItem(KEY, JSON.stringify(s)); }

/** Built-ins (possibly edited) plus custom profiles. */
export function loadVehicles(): VehicleProfile[] {
  let saved: VehicleProfile[] = [];
  try { saved = JSON.parse(localStorage.getItem(VKEY) ?? '[]'); } catch { /* ignore */ }
  const byId = new Map(saved.map((v) => [v.id, v]));
  const list = BUILT_INS.map((b) => byId.get(b.id) ?? structuredClone(b));
  for (const v of saved) if (!BUILT_INS.some((b) => b.id === v.id)) list.push(v);
  return list;
}
export function saveVehicles(v: VehicleProfile[]) { localStorage.setItem(VKEY, JSON.stringify(v)); }
