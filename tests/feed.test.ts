import { describe, expect, it } from 'vitest';
import { plan } from '../src/engine/planner';
import { FeedPricingProvider, LayeredPricingProvider, EstimatePricingProvider, feedPriceInfo, isTeslaOnly, loadFeed, sessionCost, type FeedStation } from '../src/engine/pricing';
import { EnergyModel, defaultModelOptions } from '../src/engine/energy';
import { EV9_GTLINE } from '../src/engine/vehicles';
import { charger, straightRoute } from './helpers';

const model = () => new EnergyModel(EV9_GTLINE, defaultModelOptions());

describe('EV Price Feed', () => {
  it('uses feed prices with non-member Tesla rate and falls back to estimates', async () => {
    const t = charger(50, 'Tesla Supercharger');
    const e = charger(80);
    const feed = new Map<number, FeedStation>([
      [t.id, { nrel_id: t.id, open_to_non_tesla: true, price_per_kwh: 0.52, member_price: 0.38, price_source: 'dcfctracker', verified_on: '2026-10-12' }],
      [e.id, { nrel_id: e.id, price_source: 'none' }],
    ]);
    const p = await new LayeredPricingProvider([new FeedPricingProvider(feed), new EstimatePricingProvider()]).prices([t, e]);
    expect(p.get(t.id)).toMatchObject({ perKWh: 0.52, source: 'feed', memberPrice: 0.38, sourceName: 'DCFC Tracker', updated: '2026-10-12' });
    expect(p.get(e.id)?.source).toBe('estimate');
    const m = await new FeedPricingProvider(feed, true).prices([t]);
    expect(m.get(t.id)?.perKWh).toBe(0.38);
  });

  it('applies time of day and fees', () => {
    const f: FeedStation = { nrel_id: 1, price_per_kwh: 0.56, session_fee: 1, time_of_day: [{ start: '21:00', end: '08:00', price_per_kwh: 0.23 }], price_source: 'published' };
    expect(feedPriceInfo(f, 'EVgo', false, 23 * 60)?.perKWh).toBe(0.23);
    const day = feedPriceInfo(f, 'EVgo', false, 12 * 60)!;
    expect(day.perKWh).toBe(0.56);
    expect(sessionCost(day, 10, 20)).toBeCloseTo(6.6);
    const pm = feedPriceInfo({ nrel_id: 2, per_minute: 0.3, price_source: 'published' }, 'X')!;
    expect(sessionCost(pm, 30, 20)).toBeCloseTo(6);
  });

  it('marks Tesla-only sites from the feed', () => {
    expect(isTeslaOnly({ network: 'Tesla Supercharger', openToNonTesla: true })).toBe(false);
    expect(isTeslaOnly({ network: 'Tesla Supercharger', openToNonTesla: false })).toBe(true);
    expect(isTeslaOnly({ network: 'Tesla Supercharger' })).toBe(true);
  });

  it('loads state shards and tolerates failures', async () => {
    const fake = (async (url: string) => url.endsWith('TX.json')
      ? new Response(JSON.stringify({ stations: [{ nrel_id: 9, price_per_kwh: 0.4 }] }))
      : new Response('no', { status: 404 })) as unknown as typeof fetch;
    const m = await loadFeed(['TX', 'ZZ', 'TX'], fake, 'https://example.test/');
    expect(m.get(9)?.price_per_kwh).toBe(0.4);
    expect(m.size).toBe(1);
  });

  it('routes through the cheaper real price', () => {
    const cheap = { ...charger(150, 'IONNA'), price: { perKWh: 0.2, source: 'feed' as const } };
    const pricey = { ...charger(152, 'EVgo'), price: { perKWh: 0.7, source: 'feed' as const } };
    const p = plan({ route: straightRoute(450), chargers: [cheap, pricey], model: model(), startSoC: 90, targetArrivalSoC: 10, minChargerArrivalSoC: 10 });
    expect(p.stops.some((s) => s.charger.id === cheap.id)).toBe(true);
    expect(p.stops.every((s) => s.priceSource === 'feed')).toBe(true);
  });
});
