export type PriceSource = 'feed' | 'live' | 'listing' | 'estimate';

export interface TimeOfDayRate { start: string; end: string; price_per_kwh: number | null; label?: string | null }

export interface PriceInfo {
  perKWh: number;
  source: PriceSource;
  note?: string;
  memberPrice?: number;
  perMinute?: number;
  sessionFee?: number;
  idleFee?: number;
  timeOfDay?: TimeOfDayRate[];
  /** Where the feed got the price, e.g. "DCFC Tracker". */
  sourceName?: string;
  sourceUrl?: string;
  updated?: string;
}

/** Session cost: energy at $/kWh plus per-minute and session fees. */
export const sessionCost = (p: PriceInfo, kWh: number, minutes: number) =>
  kWh * p.perKWh + (p.perMinute ?? 0) * minutes + (p.sessionFee ?? 0);

export const rateText = (p: Pick<PriceInfo, 'perKWh' | 'perMinute'>) =>
  p.perKWh === 0 && p.perMinute != null ? `$${p.perMinute.toFixed(2)}/min` : `$${p.perKWh.toFixed(2)}/kWh`;

export function feesText(p: PriceInfo): string | undefined {
  const parts: string[] = [];
  if (p.perMinute != null && p.perKWh > 0) parts.push(`$${p.perMinute.toFixed(2)}/min`);
  if (p.sessionFee != null) parts.push(`$${p.sessionFee.toFixed(2)} session`);
  if (p.idleFee != null) parts.push(`$${p.idleFee.toFixed(2)}/min idle`);
  return parts.length ? parts.join(' · ') : undefined;
}

export interface Charger {
  id: number;
  name: string;
  network: string;
  address: string;
  lat: number;
  lon: number;
  dcPorts: number;
  powerKW: number;
  powerIsEstimated: boolean;
  connectors: string[];
  pricingText?: string;
  state?: string;
  /** From the price feed: false = Tesla-only site, undefined = unknown. */
  openToNonTesla?: boolean | null;
  price?: PriceInfo;
  routeKm: number;
  detourKm: number;
}

export const isTeslaOnly = (c: Pick<Charger, 'network'> & { openToNonTesla?: boolean | null }) => {
  if (c.openToNonTesla != null) return !c.openToNonTesla;
  const n = c.network.toLowerCase();
  return n.includes('tesla') && !n.includes('destination');
};

/** Typical max per-stall power by network when the listing has none. */
export function networkPowerKW(network: string): number {
  const n = network.toLowerCase();
  if (n.includes('tesla')) return 250;
  if (n.includes('electrify america')) return 350;
  if (n.includes('ionna')) return 400;
  if (n.includes('rivian')) return 220;
  if (n.includes('evgo')) return 150;
  if (n.includes('chargepoint')) return 125;
  if (n.includes('bp') || n.includes('pulse')) return 150;
  if (n.includes('shell')) return 150;
  if (n.includes('circle k') || n.includes('couche')) return 150;
  if (n.includes('walmart')) return 350;
  return 100;
}

/** Typical guest (non-member) $/kWh. Tesla is the non-owner rate unless membership is on. */
export function networkPricePerKWh(network: string, teslaMember = false): number {
  const n = network.toLowerCase();
  if (n.includes('tesla')) return teslaMember ? 0.43 : 0.58;
  if (n.includes('electrify america')) return 0.56;
  if (n.includes('ionna')) return 0.55;
  if (n.includes('evgo')) return 0.62;
  if (n.includes('chargepoint')) return 0.49;
  if (n.includes('rivian')) return 0.53;
  if (n.includes('bp') || n.includes('pulse')) return 0.59;
  if (n.includes('shell')) return 0.55;
  return 0.52;
}

export function priceNote(network: string, teslaMember = false): string {
  if (network.toLowerCase().includes('tesla')) return teslaMember ? 'member est.' : 'non-member est.';
  return 'guest est.';
}

export function displayNetwork(nrel: string): string {
  const map: Record<string, string> = {
    Tesla: 'Tesla Supercharger', 'Electrify America': 'Electrify America', 'eVgo Network': 'EVgo',
    'ChargePoint Network': 'ChargePoint', 'Non-Networked': 'Independent', BP_PULSE: 'bp pulse',
    SHELL_RECHARGE: 'Shell Recharge', IONNA: 'IONNA', RIVIAN_ADVENTURE: 'Rivian Adventure', CIRCLE_K: 'Circle K', Walmart: 'Walmart',
  };
  if (map[nrel]) return map[nrel];
  return nrel.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

/** A source of per-station prices. The first provider that knows a price wins. */
export interface PricingProvider {
  prices(chargers: Charger[]): Promise<Map<number, PriceInfo>>;
}

/** Network-average fallback so every stop has a cost. */
export class EstimatePricingProvider implements PricingProvider {
  constructor(private teslaMember = false) {}
  async prices(chargers: Charger[]) {
    return new Map(chargers.map((c) => [c.id, { perKWh: networkPricePerKWh(c.network, this.teslaMember), source: 'estimate' as const, note: priceNote(c.network, this.teslaMember) }]));
  }
}

/** Reads a $/kWh figure from NREL's free-text `ev_pricing` (skips Tesla, which lists owner prices). */
export class ListingPricingProvider implements PricingProvider {
  constructor(private teslaMember = false) {}
  static parse(text: string): number | undefined {
    const m = /\$\s?(\d+(?:\.\d+)?)\s*(?:\/|per)\s*kwh/i.exec(text);
    const v = m ? parseFloat(m[1]) : NaN;
    return v > 0.05 && v < 2 ? v : undefined;
  }
  async prices(chargers: Charger[]) {
    const out = new Map<number, PriceInfo>();
    for (const c of chargers) {
      if (!this.teslaMember && c.network.toLowerCase().includes('tesla')) continue;
      const v = c.pricingText ? ListingPricingProvider.parse(c.pricingText) : undefined;
      if (v !== undefined) out.set(c.id, { perKWh: v, source: 'listing', note: 'station listing' });
    }
    return out;
  }
}

/**
 * Hook for a future DCFC Tracker Pro integration. Their terms require the API key to stay
 * server-side, so this talks to a small private proxy you host:
 *   POST {baseUrl}/v1/prices  {"nrel_ids":[123]}  ->  [{"nrel_id":123,"price_per_kwh":0.48,"note":"..."}]
 */
export class DCFCTrackerProxyPricingProvider implements PricingProvider {
  constructor(private baseUrl?: string) {}
  async prices(chargers: Charger[]) {
    const out = new Map<number, PriceInfo>();
    if (!this.baseUrl || !chargers.length) return out;
    try {
      const r = await fetch(this.baseUrl.replace(/\/$/, '') + '/v1/prices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nrel_ids: chargers.map((c) => c.id) }),
      });
      if (!r.ok) return out;
      for (const row of (await r.json()) as { nrel_id: number; price_per_kwh: number; note?: string }[]) {
        out.set(row.nrel_id, { perKWh: row.price_per_kwh, source: 'live', note: row.note ?? 'DCFC Tracker' });
      }
    } catch { /* fall through to the next provider */ }
    return out;
  }
}

/** One station record from the EV Price Feed (fields used here). */
export interface FeedStation {
  nrel_id: number | null;
  state?: string;
  open_to_non_tesla?: boolean | null;
  price_per_kwh?: number | null;
  member_price?: number | null;
  per_minute?: number | null;
  session_fee?: number | null;
  idle_fee?: number | null;
  time_of_day?: TimeOfDayRate[];
  free?: boolean;
  price_source?: string;
  price_note?: string | null;
  source_url?: string | null;
  verified_on?: string | null;
}

export const FEED_URL = 'https://mjyousse.github.io/ev-price-feed/';

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Guest $/kWh at a local minute of day, using time-of-day windows when published. */
export function feedPriceAt(f: FeedStation, minuteOfDay?: number): number | undefined {
  if (f.free) return 0;
  if (minuteOfDay != null) for (const w of f.time_of_day ?? []) {
    const a = toMin(w.start), b = toMin(w.end);
    const inside = a === b || (a < b ? minuteOfDay >= a && minuteOfDay < b : minuteOfDay >= a || minuteOfDay < b);
    if (inside && w.price_per_kwh != null) return w.price_per_kwh;
  }
  return f.price_per_kwh ?? undefined;
}

const SOURCE_NAMES: Record<string, string> = { dcfctracker: 'DCFC Tracker', published: 'Network published rate', network_site: 'Network website', nrel: 'NREL AFDC' };

export function feedPriceInfo(f: FeedStation, network: string, teslaMember = false, minuteOfDay?: number): PriceInfo | undefined {
  if (f.price_source === 'none' || !(f.free || f.price_per_kwh != null || f.per_minute != null)) return undefined;
  const tesla = network.toLowerCase().includes('tesla');
  const useMember = teslaMember && tesla && f.member_price != null;
  return {
    perKWh: useMember ? f.member_price! : feedPriceAt(f, minuteOfDay) ?? 0,
    source: 'feed',
    note: useMember ? 'member' : tesla ? 'non-member' : f.price_note ?? undefined,
    memberPrice: f.member_price ?? undefined, perMinute: f.per_minute ?? undefined, sessionFee: f.session_fee ?? undefined,
    idleFee: f.idle_fee ?? undefined, timeOfDay: f.time_of_day?.length ? f.time_of_day : undefined,
    sourceName: SOURCE_NAMES[f.price_source ?? ''] ?? 'EV Price Feed', sourceUrl: f.source_url ?? undefined, updated: f.verified_on ?? undefined,
  };
}

const shardCache = new Map<string, Promise<Map<number, FeedStation>>>();

/** Loads the feed's per-state shards for the given states, keyed by NREL id. Missing shards are skipped. */
export async function loadFeed(states: string[], fetcher: typeof fetch = fetch, base = FEED_URL): Promise<Map<number, FeedStation>> {
  const out = new Map<number, FeedStation>();
  const maps = await Promise.all([...new Set(states.filter(Boolean))].map((st) => {
    if (!shardCache.has(st)) {
      shardCache.set(st, fetcher(`${base}states/${st}.json`).then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const m = new Map<number, FeedStation>();
        for (const s of ((await r.json()).stations ?? []) as FeedStation[]) if (s.nrel_id != null) m.set(s.nrel_id, s);
        return m;
      }).catch(() => { shardCache.delete(st); return new Map<number, FeedStation>(); }));
    }
    return shardCache.get(st)!;
  }));
  for (const m of maps) for (const [k, v] of m) out.set(k, v);
  return out;
}

/** Per-station prices from the EV Price Feed. Tesla uses the non-member price unless membership is on. */
export class FeedPricingProvider implements PricingProvider {
  constructor(private feed: Map<number, FeedStation>, private teslaMember = false, private now = new Date()) {}
  async prices(chargers: Charger[]) {
    const minute = this.now.getHours() * 60 + this.now.getMinutes();
    const out = new Map<number, PriceInfo>();
    for (const c of chargers) {
      const f = this.feed.get(c.id);
      const info = f && feedPriceInfo(f, c.network, this.teslaMember, minute);
      if (info) out.set(c.id, info);
    }
    return out;
  }
}

export class LayeredPricingProvider implements PricingProvider {
  constructor(private providers: PricingProvider[]) {}
  async prices(chargers: Charger[]) {
    const out = new Map<number, PriceInfo>();
    for (const p of this.providers) {
      const missing = chargers.filter((c) => !out.has(c.id));
      if (!missing.length) break;
      for (const [k, v] of await p.prices(missing)) if (!out.has(k)) out.set(k, v);
    }
    return out;
  }
}
