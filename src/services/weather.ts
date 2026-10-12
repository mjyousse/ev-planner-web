import { averageSpeedKmh, chunk, sampleIndices, type DrivingRoute } from '../engine/geo';

/** 10 m wind scaled to ~1–2 m above open road (log profile, z0 ≈ 0.1 m). */
export const HEIGHT_FACTOR = 0.75;

export interface WeatherSample { km: number; windMs: number; windFromDeg: number; temperatureC: number }

export const toVector = (speed: number, fromDeg: number): [number, number] => {
  const r = (fromDeg * Math.PI) / 180;
  return [speed * Math.sin(r), speed * Math.cos(r)];
};
export const toPolar = (x: number, y: number) => ({ speed: Math.hypot(x, y), fromDeg: ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 });

/** Interpolates an Open-Meteo hourly series at a unix time; wind as a vector. */
export function valueAt(loc: any, unix: number): { windMs: number; fromDeg: number; tempC: number } | undefined {
  const h = loc?.hourly;
  const times: number[] = h?.time ?? [];
  const ws: number[] = h?.wind_speed_10m ?? [], wd: number[] = h?.wind_direction_10m ?? [], tt: number[] = h?.temperature_2m ?? [];
  if (!times.length || ws.length !== times.length) return undefined;
  let i = 0;
  while (i < times.length - 2 && times[i + 1] <= unix) i++;
  const j = Math.min(i + 1, times.length - 1);
  const f = j === i ? 0 : Math.min(Math.max((unix - times[i]) / (times[j] - times[i]), 0), 1);
  if ([ws[i], ws[j], wd[i], wd[j], tt[i], tt[j]].some((v) => v == null)) return undefined;
  const a = toVector(ws[i], wd[i]), b = toVector(ws[j], wd[j]);
  const p = toPolar(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
  return { windMs: p.speed, fromDeg: p.fromDeg, tempC: tt[i] + (tt[j] - tt[i]) * f };
}

/** Spreads samples onto every route point by distance. */
export function applyWeather(samples: WeatherSample[], route: DrivingRoute): DrivingRoute {
  const s = [...samples].sort((a, b) => a.km - b.km);
  if (!s.length) return route;
  let k = 0;
  const points = route.points.map((p) => {
    let a = s[0], b = s[0];
    if (p.km >= s.at(-1)!.km) { a = b = s.at(-1)!; }
    else if (p.km > s[0].km) { while (k < s.length - 2 && s[k + 1].km <= p.km) k++; a = s[k]; b = s[k + 1]; }
    const span = b.km - a.km;
    const f = span > 0 ? (p.km - a.km) / span : 0;
    const va = toVector(a.windMs, a.windFromDeg), vb = toVector(b.windMs, b.windFromDeg);
    const w = toPolar(va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f);
    return { ...p, windMs: w.speed, windFromDeg: w.fromDeg, temperatureC: a.temperatureC + (b.temperatureC - a.temperatureC) * f };
  });
  return { ...route, points, hasWeather: true };
}

/** Open-Meteo hourly wind and temperature at the time you pass each point. */
export async function addWeather(route: DrivingRoute, departure = new Date(), spacingKm = 20): Promise<DrivingRoute> {
  const idx = sampleIndices(route, spacingKm);
  const speed = Math.max(averageSpeedKmh(route), 1);
  const samples: WeatherSample[] = [];
  try {
    for (const c of chunk(idx, 50)) {
      const lat = c.map((i) => route.points[i].lat.toFixed(4)).join(',');
      const lon = c.map((i) => route.points[i].lon.toFixed(4)).join(',');
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timeformat=unixtime&timezone=GMT&forecast_days=3`);
      if (!r.ok) return route;
      const j = await r.json();
      const locs = Array.isArray(j) ? j : [j];
      if (locs.length !== c.length) return route;
      for (let k = 0; k < c.length; k++) {
        const km = route.points[c[k]].km;
        const eta = departure.getTime() / 1000 + (km / speed) * 3600;
        const v = valueAt(locs[k], eta);
        if (!v) return route;
        samples.push({ km, windMs: v.windMs * HEIGHT_FACTOR, windFromDeg: v.fromDeg, temperatureC: v.tempC });
      }
    }
  } catch { return route; }
  return applyWeather(samples, route);
}
