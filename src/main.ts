import maplibregl, { type GeoJSONSource, type Map as MLMap, type Marker } from 'maplibre-gl';
import './style.css';
import { EnergyModel, MPH, weatherPercent } from './engine/energy';
import type { LatLon } from './engine/geo';
import { plan, type TripPlan } from './engine/planner';
import { DCFCTrackerProxyPricingProvider, EstimatePricingProvider, LayeredPricingProvider, ListingPricingProvider, type Charger } from './engine/pricing';
import { chargePowerKW, type VehicleProfile } from './engine/vehicles';
import { esc, fmtClock, fmtDuration, fmtF, fmtMi, fmtMoney, fmtMph, fmtPct, fmtWind, mi } from './format';
import { addElevation } from './services/elevation';
import { searchPlaces, type Place } from './services/geocode';
import { appleMapsUrl, googleMapsUrl, googleTripUrl } from './services/links';
import { fetchChargers } from './services/nrel';
import { fetchRoute } from './services/routing';
import { addSpeedLimits } from './services/speedlimits';
import { addWeather } from './services/weather';
import { DEFAULTS, loadSettings, loadVehicles, saveSettings, saveVehicles, type Settings } from './settings';

const $ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll(s)] as T[];

let settings: Settings = loadSettings();
let vehicles: VehicleProfile[] = loadVehicles();
const vehicle = () => vehicles.find((v) => v.id === settings.vehicleId) ?? vehicles[0];

const places: { from?: Place; to?: Place } = {
  from: { name: 'Austin', detail: 'Texas, United States', lat: 30.2672, lon: -97.7431 },
  to: { name: 'Dallas', detail: 'Texas, United States', lat: 32.7767, lon: -96.797 },
};

// ---------- Map ----------
const dark = matchMedia('(prefers-color-scheme: dark)');
const styleUrl = () => `https://tiles.openfreemap.org/styles/${dark.matches ? 'dark' : 'liberty'}`;
const map: MLMap = new maplibregl.Map({ container: 'map', style: styleUrl(), center: [-97.3, 31.5], zoom: 6, attributionControl: { compact: true } });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false } }), 'top-right');
let markers: Marker[] = [];
let lastPlan: TripPlan | undefined;
let lastChargers: Charger[] = [];
const legend = document.createElement('div');
legend.className = 'legend';
document.body.append(legend);

function ensureLayers() {
  if (map.getSource('route')) return;
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('chargers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b1220', 'line-width': 9, 'line-opacity': 0.35 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
  map.addLayer({ id: 'chargers', type: 'circle', source: 'chargers', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 6],
    'circle-color': ['case', ['get', 'tesla'], '#e11d48', '#0ea5e9'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2, 'circle-opacity': 0.9 } });
  map.on('click', 'chargers', (e) => {
    const p = e.features?.[0]?.properties as any;
    if (!p) return;
    new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat)
      .setHTML(`<b>${esc(p.name)}</b><br>${esc(p.network)} · ${p.ports} DC ports · ~${p.kw} kW<br><span style="opacity:.7">${esc(p.address)}</span>`).addTo(map);
  });
  map.on('mouseenter', 'chargers', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'chargers', () => (map.getCanvas().style.cursor = ''));
}
map.on('load', () => { ensureLayers(); if (lastPlan) drawPlan(lastPlan); });
dark.addEventListener('change', () => { map.setStyle(styleUrl()); map.once('styledata', () => { ensureLayers(); if (lastPlan) drawPlan(lastPlan); }); });

function rampColor(t: number): string {
  const stops = [[16, 185, 129], [234, 179, 8], [249, 115, 22], [239, 68, 68]];
  const x = Math.min(Math.max(t, 0), 0.999) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c.join(',')})`;
}

function drawPlan(p: TripPlan) {
  if (!map.isStyleLoaded() || !map.getSource('route')) return;
  const pts = p.energy.route.points;
  const byConsumption = settings.colorBy === 'consumption';
  const vals = byConsumption ? p.energy.segWhPerKm : p.energy.segSpeedKmh;
  const sorted = [...vals].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? 0, hi = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
  const features: GeoJSON.Feature[] = [];
  const step = 2;
  for (let i = 0; i < pts.length - 1; i += step) {
    const j = Math.min(i + step, pts.length - 1);
    const v = vals.slice(i, j).reduce((a, b) => a + b, 0) / Math.max(1, j - i);
    features.push({ type: 'Feature', properties: { color: rampColor((v - lo) / Math.max(hi - lo, 1e-6)) },
      geometry: { type: 'LineString', coordinates: pts.slice(i, j + 1).map((q) => [q.lon, q.lat]) } });
  }
  (map.getSource('route') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  (map.getSource('chargers') as GeoJSONSource).setData({ type: 'FeatureCollection', features: lastChargers.map((c) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
    properties: { name: c.name, network: c.network, ports: c.dcPorts, kw: Math.round(c.powerKW), address: c.address, tesla: c.network.toLowerCase().includes('tesla') },
  })) });

  markers.forEach((m) => m.remove());
  markers = [];
  const end = (color: string) => { const el = document.createElement('div'); el.className = 'marker-end'; el.style.background = color; return el; };
  markers.push(new maplibregl.Marker({ element: end('#64748b') }).setLngLat([pts[0].lon, pts[0].lat]).addTo(map));
  markers.push(new maplibregl.Marker({ element: end('#10b981') }).setLngLat([pts.at(-1)!.lon, pts.at(-1)!.lat]).addTo(map));
  p.stops.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'marker-num';
    el.textContent = String(i + 1);
    markers.push(new maplibregl.Marker({ element: el }).setLngLat([s.charger.lon, s.charger.lat])
      .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(`<b>${i + 1}. ${esc(s.charger.name)}</b><br>${fmtPct(s.arriveSoC)} → ${fmtPct(s.departSoC)} · ${fmtDuration(s.chargeMinutes)} · ${fmtMoney(s.cost)}`)).addTo(map));
  });

  const unit = byConsumption ? 'Wh/mi' : 'mph';
  const conv = (v: number) => Math.round(byConsumption ? v * 1.609344 : mi(v));
  legend.innerHTML = `<b>${byConsumption ? 'Consumption' : 'Driving speed'}</b><div class="ramp" style="background:linear-gradient(90deg,${[0, 0.33, 0.66, 1].map(rampColor).join(',')})"></div><div class="ends"><span>${conv(lo)}</span><span>${conv(hi)} ${unit}</span></div>`;
  legend.style.display = 'block';

  const b = new maplibregl.LngLatBounds();
  pts.forEach((q) => b.extend([q.lon, q.lat]));
  const mobile = innerWidth <= 760;
  map.fitBounds(b, { padding: mobile ? { top: 60, bottom: innerHeight * 0.62 + 20, left: 30, right: 30 } : { top: 60, bottom: 60, left: 450, right: 60 }, duration: 600 });
}

// ---------- Tabs & sheet ----------
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
  if (b.dataset.tab === 'vehicle') renderVehicle();
  if (b.dataset.tab === 'settings') renderSettings();
}));
const panel = $('#panel');
let sheet: 'collapsed' | 'mid' | 'expanded' = 'mid';
const setSheet = (s: typeof sheet) => { sheet = s; panel.classList.toggle('collapsed', s === 'collapsed'); panel.classList.toggle('expanded', s === 'expanded'); };
$('#grabber').addEventListener('click', () => setSheet(sheet === 'collapsed' ? 'mid' : sheet === 'mid' ? 'expanded' : 'collapsed'));
let touchY = 0;
$('#grabber').addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
$('#grabber').addEventListener('touchend', (e) => {
  const dy = e.changedTouches[0].clientY - touchY;
  if (dy < -30) setSheet(sheet === 'collapsed' ? 'mid' : 'expanded');
  else if (dy > 30) setSheet(sheet === 'expanded' ? 'mid' : 'collapsed');
});

// ---------- Autocomplete ----------
function setupAutocomplete(input: HTMLInputElement, which: 'from' | 'to') {
  const list = input.parentElement!.querySelector('.suggest') as HTMLUListElement;
  let timer = 0, ctl: AbortController | undefined, items: Place[] = [], sel = -1;
  input.value = places[which] ? `${places[which]!.name}, ${places[which]!.detail.split(',')[0]}` : '';
  const close = () => { list.classList.remove('open'); sel = -1; };
  const choose = (p: Place) => { places[which] = p; input.value = [p.name, p.detail.split(',')[0]].filter(Boolean).join(', '); close(); };
  const render = () => {
    list.innerHTML = items.map((p, i) => `<li class="${i === sel ? 'sel' : ''}" data-i="${i}">${esc(p.name)}<small>${esc(p.detail)}</small></li>`).join('');
    list.classList.toggle('open', items.length > 0);
  };
  input.addEventListener('input', () => {
    places[which] = undefined;
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      ctl?.abort(); ctl = new AbortController();
      try { const c = map.getCenter(); items = await searchPlaces(input.value, { lat: c.lat, lon: c.lng }, ctl.signal); render(); } catch { /* aborted */ }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (!list.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[Math.max(sel, 0)]) { choose(items[Math.max(sel, 0)]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => { const li = (e.target as HTMLElement).closest('li'); if (li) { e.preventDefault(); choose(items[+li.dataset.i!]); } });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
setupAutocomplete($('#from'), 'from');
setupAutocomplete($('#to'), 'to');

async function resolve(which: 'from' | 'to'): Promise<Place> {
  if (places[which]) return places[which]!;
  const v = ($(`#${which}`) as HTMLInputElement).value;
  const r = await searchPlaces(v);
  if (!r.length) throw new Error(`Couldn't find "${v}".`);
  places[which] = r[0];
  return r[0];
}

// ---------- Planning ----------
const status = $('#status');
function setStatus(msg: string, kind: 'busy' | 'error' | 'info' = 'info') {
  status.hidden = !msg;
  status.className = `status ${kind === 'error' ? 'error' : ''}`;
  status.innerHTML = kind === 'busy' ? `<span class="spinner"></span>${esc(msg)}` : esc(msg);
}

function model(): EnergyModel {
  return new EnergyModel(vehicle(), {
    correction: settings.correction, drivetrainEfficiency: 0.9, regenEfficiency: 0.65, useWeather: settings.useWeather,
    speedFactor: settings.speedFactor, referenceSpeedKmh: settings.referenceSpeedMph * MPH, maxSpeedKmh: settings.maxSpeedMph * MPH,
  });
}

const num = (id: string) => parseFloat(($(`#${id}`) as HTMLInputElement).value);

async function runPlan() {
  const btn = $('#planBtn') as HTMLButtonElement;
  btn.disabled = true;
  $('#result').innerHTML = '';
  try {
    setStatus('Finding places…', 'busy');
    const [from, to] = await Promise.all([resolve('from'), resolve('to')]);
    setStatus('Routing…', 'busy');
    let route = await fetchRoute(from, to);
    setStatus('Adding terrain, weather and speed limits…', 'busy');
    const [elev, wx, lim] = await Promise.all([
      settings.useElevation ? addElevation(route) : Promise.resolve(route),
      settings.useWeather ? addWeather(route) : Promise.resolve(route),
      settings.useSpeedLimits ? addSpeedLimits(route) : Promise.resolve(route),
    ]);
    route = {
      ...route,
      points: route.points.map((p, i) => ({ ...p, elevationM: elev.points[i].elevationM, windMs: wx.points[i].windMs, windFromDeg: wx.points[i].windFromDeg, temperatureC: wx.points[i].temperatureC, speedLimitKmh: lim.points[i].speedLimitKmh })),
      hasElevation: elev.hasElevation, hasWeather: wx.hasWeather, hasSpeedLimits: lim.hasSpeedLimits,
    };
    setStatus('Finding DC fast chargers…', 'busy');
    const chargers = await fetchChargers(route, settings.nrelKey || 'DEMO_KEY', settings.corridorMiles);
    const pricing = new LayeredPricingProvider([
      new DCFCTrackerProxyPricingProvider(settings.dcfcProxyUrl || undefined),
      new ListingPricingProvider(settings.teslaMember),
      new EstimatePricingProvider(settings.teslaMember),
    ]);
    const prices = await pricing.prices(chargers);
    chargers.forEach((c) => (c.price = prices.get(c.id)));
    lastChargers = chargers;
    setStatus('Planning stops…', 'busy');
    await new Promise((r) => setTimeout(r, 0));
    const p = plan({
      route, chargers, model: model(), startSoC: num('startSoC'), targetArrivalSoC: num('arriveSoC'), minChargerArrivalSoC: num('minSoC'),
      valueOfTimePerHour: settings.valueOfTime, teslaMember: settings.teslaMember,
    });
    lastPlan = p;
    const notes = [!route.hasWeather && settings.useWeather ? 'weather' : '', !route.hasSpeedLimits && settings.useSpeedLimits ? 'speed limits' : '', !route.hasElevation && settings.useElevation ? 'elevation' : ''].filter(Boolean);
    setStatus(notes.length ? `Planned without ${notes.join(', ')} (service unavailable). ${chargers.length} chargers found.` : `${chargers.length} DC fast chargers along the route.`);
    renderPlan(p, from, to);
    drawPlan(p);
    document.body.dataset.planned = '1';
  } catch (e) {
    setStatus((e as Error).message || 'Something went wrong.', 'error');
  } finally {
    btn.disabled = false;
  }
}
$('#planBtn').addEventListener('click', runPlan);

function navButtons(to: LatLon, name: string): string {
  const a = `<a class="ghost" target="_blank" rel="noopener" href="${appleMapsUrl(to, name)}"> Apple Maps</a>`;
  const g = `<a class="ghost" target="_blank" rel="noopener" href="${googleMapsUrl(to)}">Google Maps</a>`;
  return settings.navApp === 'apple' ? a : settings.navApp === 'google' ? g : a + g;
}

function legLine(w: ReturnType<TripPlan['energy']['weather']> | undefined, speed: number, km: number, minutes: number): string {
  const parts = [`${fmtMi(km)}`, fmtDuration(minutes), `avg ${fmtMph(speed)}`];
  if (w) parts.push(fmtWind(w.headwindMs), fmtF(w.temperatureC), `${weatherPercent(w) >= 0 ? '+' : ''}${Math.round(weatherPercent(w))}% energy`);
  return `<div class="leg">${parts.map((x) => `<span>${esc(x)}</span>`).join('<span>·</span>')}</div>`;
}

function renderPlan(p: TripPlan, from: Place, to: Place) {
  const depart = new Date();
  let clock = depart.getTime();
  const w = p.weather;
  const wxLine = w
    ? `<div class="wx"><span>🌬 ${fmtWind(w.headwindMs)}</span><span>🌡 ${fmtF(w.temperatureC)}</span><span>${weatherPercent(w) >= 0 ? '+' : ''}${Math.round(weatherPercent(w))}% energy from weather</span></div>`
    : `<div class="wx"><span>Weather off or unavailable</span></div>`;
  const tripUrl = googleTripUrl(from, to, p.stops.map((s) => s.charger));
  let html = `<div class="card">
    <div class="summary">
      <div class="metric"><span>Total</span><b>${fmtDuration(p.totalMinutes)}</b></div>
      <div class="metric"><span>Charging</span><b>${fmtDuration(p.chargeMinutes)}</b></div>
      <div class="metric"><span>Cost</span><b>${fmtMoney(p.totalCost)}</b></div>
      <div class="metric"><span>Distance</span><b>${fmtMi(p.totalKm)}</b></div>
      <div class="metric"><span>Stops</span><b>${p.stops.length}</b></div>
      <div class="metric"><span>Arrive</span><b>${fmtPct(p.arrivalSoC)}</b></div>
    </div>
    ${wxLine}
    <div class="cta"><a class="primary" id="startTrip" target="_blank" rel="noopener" href="${tripUrl}">Start trip in Google Maps</a></div>
    <p class="poc" style="margin-top:10px">Proof of concept: consumption is modeled, not measured.</p>
  </div><div class="card timeline">`;
  html += `<div class="tl"><div class="dot start">A</div><div><h4>${esc(from.name)}</h4><div class="addr">Depart ${fmtClock(depart)} · ${fmtPct(num('startSoC'))}</div></div></div>`;
  p.stops.forEach((s, i) => {
    clock += s.driveMinutesFromPrevious * 60000;
    const arrive = new Date(clock);
    clock += (s.chargeMinutes + 4) * 60000;
    const prevKm = i ? p.stops[i - 1].routeKm : 0;
    html += `<div class="tl"><div class="dot stop">${i + 1}</div><div>
      ${legLine(s.legWeather, s.legSpeedKmh, s.routeKm - prevKm, s.driveMinutesFromPrevious)}
      <h4>${esc(s.charger.name)}</h4>
      <div class="addr">${esc(s.charger.network)} · ${esc(s.charger.address)}</div>
      <div class="chips">
        <span class="chip soc">${fmtPct(s.arriveSoC)} → ${fmtPct(s.departSoC)}</span>
        <span class="chip">${fmtDuration(s.chargeMinutes)}</span>
        <span class="chip">avg ${Math.round(s.chargeMinutes > 0 ? s.energyKWh / (s.chargeMinutes / 60) : 0)} kW · ${Math.round(s.charger.powerKW)} kW max</span>
        <span class="chip price">${fmtMoney(s.cost)} · $${s.pricePerKWh.toFixed(2)}/kWh<em>${esc(s.priceNote ?? '')}</em></span>
      </div>
      <div class="socbar"><i style="left:${s.arriveSoC}%;width:${s.departSoC - s.arriveSoC}%"></i></div>
      <div class="addr" style="margin:6px 0">Arrive ${fmtClock(arrive)} · leave ${fmtClock(new Date(clock))}</div>
      <div class="btns">${navButtons(s.charger, s.charger.name)}</div>
    </div></div>`;
  });
  clock += (p.driveMinutes - p.stops.reduce((a, s) => a + s.driveMinutesFromPrevious, 0)) * 60000;
  const lastKm = p.stops.at(-1)?.routeKm ?? 0;
  html += `<div class="tl"><div class="dot end">B</div><div>
    ${legLine(p.finalLegWeather, p.finalLegSpeedKmh, p.totalKm - lastKm, p.driveMinutes - p.stops.reduce((a, s) => a + s.driveMinutesFromPrevious, 0))}
    <h4>${esc(to.name)}</h4><div class="addr">Arrive ${fmtClock(new Date(clock))} · ${fmtPct(p.arrivalSoC)}</div>
    <div class="btns" style="margin-top:6px">${navButtons(to, to.name)}</div></div></div></div>`;
  $('#result').innerHTML = html;
}

// ---------- Vehicle editor ----------
function curveSvg(v: VehicleProfile): string {
  const W = 360, H = 170, L = 34, B = 22, T = 10, R = 8;
  const maxKw = Math.max(50, Math.ceil(Math.max(...v.curve.map((c) => c.kw)) / 50) * 50);
  const x = (s: number) => L + (s / 100) * (W - L - R), y = (k: number) => T + (1 - k / maxKw) * (H - T - B);
  const pts: string[] = [];
  for (let s = 0; s <= 100; s += 1) pts.push(`${x(s).toFixed(1)},${y(chargePowerKW(v, s)).toFixed(1)}`);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(maxKw * f)}" y2="${y(maxKw * f)}" stroke="currentColor" opacity=".12"/><text x="${L - 6}" y="${y(maxKw * f) + 4}" text-anchor="end" font-size="10" fill="currentColor" opacity=".6">${Math.round(maxKw * f)}</text>`).join('');
  const xs = [0, 20, 40, 60, 80, 100].map((s) => `<text x="${x(s)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">${s}%</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Charging curve"><defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#10b981" stop-opacity=".45"/><stop offset="1" stop-color="#10b981" stop-opacity="0"/></linearGradient></defs>${grid}${xs}
    <polygon points="${x(0)},${y(0)} ${pts.join(' ')} ${x(100)},${y(0)}" fill="url(#cg)"/><polyline points="${pts.join(' ')}" fill="none" stroke="#10b981" stroke-width="2.5"/>
    ${v.curve.map((c) => `<circle cx="${x(c.soc)}" cy="${y(c.kw)}" r="3" fill="#0ea5e9"/>`).join('')}</svg>`;
}

function renderVehicle() {
  const v = vehicle();
  const t10 = (() => { let m = 0; for (let s = 10; s < 80; s += 0.5) m += (0.5 / 100) * v.usableKWh / Math.max(1, Math.min(chargePowerKW(v, s + 0.25), 350 * 0.95)) * 60; return m; })();
  $('#vehiclePane').innerHTML = `
    <div class="card"><h3>Your car</h3><div class="vehicle-pick">${vehicles.map((x) => `<div class="vcard ${x.id === v.id ? 'sel' : ''}" data-id="${x.id}"><div><b>${esc(x.name)}</b><small>${esc(x.trim)}</small></div><small>${x.usableKWh} kWh</small></div>`).join('')}</div></div>
    <div class="card"><h3>Charging curve</h3><div class="curve">${curveSvg(v)}</div>
      <p class="muted small">10→80% on a 350 kW charger: about ${Math.round(t10)} min</p>
      <table class="curve-table"><tbody>${v.curve.map((c, i) => `<tr><td><div class="unit"><input data-ci="${i}" data-k="soc" type="number" value="${c.soc}"><i>%</i></div></td><td><div class="unit"><input data-ci="${i}" data-k="kw" type="number" value="${c.kw}"><i>kW</i></div></td></tr>`).join('')}</tbody></table>
    </div>
    <div class="card settings"><h3>Consumption model</h3>
      <div class="row2">
        <label class="field"><span>Usable battery</span><div class="unit"><input data-f="usableKWh" type="number" step="0.5" value="${v.usableKWh}"><i>kWh</i></div></label>
        <label class="field"><span>Reference @ 62 mph</span><div class="unit"><input data-f="refWhMi" type="number" value="${Math.round(v.referenceWhPerKm * 1.609344)}"><i>Wh/mi</i></div></label>
        <label class="field"><span>Curb weight</span><div class="unit"><input data-f="curbLb" type="number" value="${Math.round(v.curbMassKg * 2.20462)}"><i>lb</i></div></label>
        <label class="field"><span>Extra load</span><div class="unit"><input data-f="extraLb" type="number" value="${Math.round(v.extraWeightKg * 2.20462)}"><i>lb</i></div></label>
        <label class="field"><span>CdA (drag area)</span><div class="unit"><input data-f="cdA" type="number" step="0.01" value="${v.cdA.toFixed(3)}"><i>m²</i></div></label>
        <label class="field"><span>Max charge power</span><div class="unit"><input data-f="maxChargeKW" type="number" value="${v.maxChargeKW}"><i>kW</i></div></label>
      </div>
      <div class="toggle"><div>Can use Tesla Superchargers<small>NACS port or adapter</small></div><input class="switch" type="checkbox" data-f="acceptsTesla" ${v.acceptsTesla ? 'checked' : ''}></div>
      <div class="btns" style="margin-top:10px"><button class="ghost" id="resetVehicle">Reset to defaults</button></div>
    </div>`;
  $$('.vcard').forEach((el) => el.addEventListener('click', () => { settings.vehicleId = el.dataset.id!; saveSettings(settings); updateLabel(); renderVehicle(); }));
  $$<HTMLInputElement>('#vehiclePane input[data-ci]').forEach((inp) => inp.addEventListener('change', () => {
    const c = v.curve[+inp.dataset.ci!];
    (c as any)[inp.dataset.k!] = parseFloat(inp.value) || 0;
    v.curve.sort((a, b) => a.soc - b.soc);
    saveVehicles(vehicles); renderVehicle();
  }));
  $$<HTMLInputElement>('#vehiclePane input[data-f]').forEach((inp) => inp.addEventListener('change', () => {
    const f = inp.dataset.f!, val = parseFloat(inp.value);
    if (f === 'acceptsTesla') v.acceptsTesla = inp.checked;
    else if (f === 'refWhMi') v.referenceWhPerKm = val / 1.609344;
    else if (f === 'curbLb') v.curbMassKg = val / 2.20462;
    else if (f === 'extraLb') v.extraWeightKg = val / 2.20462;
    else if (!Number.isNaN(val)) (v as any)[f] = val;
    saveVehicles(vehicles); renderVehicle();
  }));
  $('#resetVehicle').addEventListener('click', () => { localStorage.removeItem('evp.vehicles.v1'); vehicles = loadVehicles(); renderVehicle(); });
}

// ---------- Settings ----------
function renderSettings() {
  const s = settings;
  const tog = (k: keyof Settings, title: string, sub: string) => `<div class="toggle"><div>${title}<small>${sub}</small></div><input class="switch" type="checkbox" data-s="${k}" ${s[k] ? 'checked' : ''}></div>`;
  $('#settingsPane').innerHTML = `
    <div class="card settings"><h3>Driving</h3>
      <div class="row2">
        <label class="field"><span>Reference speed</span><div class="unit"><input data-s="referenceSpeedMph" type="number" value="${s.referenceSpeedMph}"><i>mph</i></div></label>
        <label class="field"><span>Max speed</span><div class="unit"><input data-s="maxSpeedMph" type="number" value="${s.maxSpeedMph}"><i>mph</i></div></label>
        <label class="field"><span>Speed vs. limit</span><div class="unit"><input data-s="speedFactor" type="number" step="0.01" value="${s.speedFactor}"><i>×</i></div></label>
        <label class="field"><span>Consumption adj.</span><div class="unit"><input data-s="correction" type="number" step="0.01" value="${s.correction}"><i>×</i></div></label>
      </div>
      ${tog('useSpeedLimits', 'Speed limits', 'OpenStreetMap limits per road segment')}
      ${tog('useWeather', 'Wind &amp; temperature', 'Open-Meteo forecast at the time you pass')}
      ${tog('useElevation', 'Elevation', 'Climbing and regen on descents')}
    </div>
    <div class="card settings"><h3>Charging &amp; price</h3>
      ${tog('teslaMember', 'Tesla Supercharging membership', 'Off: non-member price ($0.58/kWh est.)')}
      <div class="row2" style="margin-top:10px">
        <label class="field"><span>Value of your time</span><div class="unit"><input data-s="valueOfTime" type="number" value="${s.valueOfTime}"><i>$/h</i></div></label>
        <label class="field"><span>Charger corridor</span><div class="unit"><input data-s="corridorMiles" type="number" step="0.5" value="${s.corridorMiles}"><i>mi</i></div></label>
      </div>
      <label class="field"><span>DCFC Tracker price proxy URL (optional)</span><input data-s="dcfcProxyUrl" type="url" placeholder="https://your-proxy.example.com" value="${esc(s.dcfcProxyUrl)}"></label>
    </div>
    <div class="card settings"><h3>Map &amp; navigation</h3>
      <label class="field"><span>Color route by</span><select data-s="colorBy"><option value="consumption" ${s.colorBy === 'consumption' ? 'selected' : ''}>Consumption</option><option value="speed" ${s.colorBy === 'speed' ? 'selected' : ''}>Speed</option></select></label>
      <label class="field"><span>Navigate with</span><select data-s="navApp"><option value="ask" ${s.navApp === 'ask' ? 'selected' : ''}>Show both</option><option value="apple" ${s.navApp === 'apple' ? 'selected' : ''}>Apple Maps</option><option value="google" ${s.navApp === 'google' ? 'selected' : ''}>Google Maps</option></select></label>
    </div>
    <div class="card settings"><h3>NREL API key</h3>
      <label class="field"><span>Stored only in this browser</span><input data-s="nrelKey" autocomplete="off" spellcheck="false" value="${esc(s.nrelKey)}"></label>
      <p class="muted small">DEMO_KEY works for a few plans per hour. Get a free key at <a href="https://developer.nlr.gov/signup/" target="_blank" rel="noopener">developer.nlr.gov/signup</a>.</p>
      <button class="ghost" id="resetSettings">Reset all settings</button>
    </div>`;
  $$<HTMLInputElement>('#settingsPane [data-s]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.s as keyof Settings;
    const cur = DEFAULTS[k];
    (settings as any)[k] = typeof cur === 'boolean' ? el.checked : typeof cur === 'number' ? parseFloat(el.value) || cur : el.value.trim();
    if (k === 'nrelKey' && !settings.nrelKey) settings.nrelKey = 'DEMO_KEY';
    saveSettings(settings);
    if (k === 'colorBy' && lastPlan) drawPlan(lastPlan);
  }));
  $('#resetSettings').addEventListener('click', () => { settings = { ...DEFAULTS }; saveSettings(settings); renderSettings(); });
}

function updateLabel() { const v = vehicle(); $('#vehicleLabel').textContent = `${v.name} · ${v.trim}`; }
updateLabel();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (new URLSearchParams(location.search).has('demo')) runPlan();
