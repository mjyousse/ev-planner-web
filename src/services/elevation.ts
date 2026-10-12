import { chunk, sampleIndices, type DrivingRoute } from '../engine/geo';

/** Terrain height from Open-Meteo's free elevation API, sampled ~every 2 km and interpolated. */
export async function addElevation(route: DrivingRoute, spacingKm = 2): Promise<DrivingRoute> {
  const idx = sampleIndices(route, spacingKm);
  const samples: { km: number; m: number }[] = [];
  try {
    for (const c of chunk(idx, 100)) {
      const lat = c.map((i) => route.points[i].lat.toFixed(4)).join(',');
      const lon = c.map((i) => route.points[i].lon.toFixed(4)).join(',');
      const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
      if (!r.ok) return route;
      const e: number[] = (await r.json()).elevation ?? [];
      if (e.length !== c.length) return route;
      c.forEach((i, k) => samples.push({ km: route.points[i].km, m: e[k] }));
    }
  } catch { return route; }
  let k = 0;
  const points = route.points.map((p) => {
    while (k < samples.length - 2 && samples[k + 1].km <= p.km) k++;
    const a = samples[k], b = samples[Math.min(k + 1, samples.length - 1)];
    const span = b.km - a.km;
    const f = span > 0 ? Math.min(Math.max((p.km - a.km) / span, 0), 1) : 0;
    return { ...p, elevationM: a.m + (b.m - a.m) * f };
  });
  return { ...route, points, hasElevation: true };
}
