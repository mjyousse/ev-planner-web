export type PriceSource = 'live' | 'listing' | 'estimate';

export interface PriceInfo { perKWh: number; source: PriceSource; note?: string }

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
  price?: PriceInfo;
  routeKm: number;
  detourKm: number;
}

export const isTeslaOnly = (c: Pick<Charger, 'network'>) => {
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
