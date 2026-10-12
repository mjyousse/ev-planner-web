export interface Place { name: string; detail: string; lat: number; lon: number }

/** Address and place autocomplete from Photon (OpenStreetMap). */
export async function searchPlaces(q: string, bias?: { lat: number; lon: number }, signal?: AbortSignal): Promise<Place[]> {
  if (q.trim().length < 2) return [];
  const p = new URLSearchParams({ q, limit: '6', lang: 'en' });
  if (bias) { p.set('lat', String(bias.lat)); p.set('lon', String(bias.lon)); }
  const r = await fetch(`https://photon.komoot.io/api/?${p}`, { signal });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.features ?? []).map((f: any) => {
    const pr = f.properties ?? {};
    const name = pr.name ?? [pr.housenumber, pr.street].filter(Boolean).join(' ') ?? pr.city;
    const detail = [pr.city !== name ? pr.city : undefined, pr.state, pr.country].filter(Boolean).join(', ');
    return { name: name || detail, detail, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
  });
}
