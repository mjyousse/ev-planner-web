import { describe, expect, it } from 'vitest';
import { directionsUrl, laneArrow, mapboxTransformUrl, parseMapboxRoutes, trafficDelayMinutes, trafficRuns } from '../src/services/mapbox';
import { routeCacheKey } from '../src/services/routing';

const response = {
  code: 'Ok',
  routes: [{
    duration: 3600, duration_typical: 3000, distance: 90000,
    geometry: { type: 'LineString', coordinates: [[-97.74, 30.27], [-97.6, 30.5], [-97.4, 30.8], [-97.2, 31.0]] },
    legs: [{
      annotation: { congestion: ['low', 'heavy', 'heavy'] },
      steps: [
        { name: 'Congress Ave', distance: 500, duration: 60, maneuver: { instruction: 'Head north on Congress Ave' },
          intersections: [{ lanes: [{ valid: false, indications: ['left'] }, { valid: true, active: true, indications: ['straight', 'right'] }] }] },
        { name: 'Interstate 35', ref: 'I 35', distance: 89000, duration: 3500, maneuver: { instruction: 'Turn right onto I 35' }, intersections: [{}] },
        { name: '', distance: 0, duration: 0, maneuver: { instruction: 'You have arrived' }, intersections: [{}] },
      ],
    }],
  }],
};

describe('mapbox directions', () => {
  it('builds a driving-traffic request with congestion', () => {
    const u = directionsUrl({ lat: 30.27, lon: -97.74 }, { lat: 32.78, lon: -96.8 }, 'pk.test');
    expect(u).toContain('/mapbox/driving-traffic/-97.74000,30.27000;-96.80000,32.78000?');
    expect(u).toContain('annotations=congestion%2Cduration');
    expect(u).toContain('overview=full');
  });

  it('parses routes, steps, lanes and traffic', () => {
    const [c] = parseMapboxRoutes(response);
    expect(c.name).toBe('I 35');
    expect(c.trafficMinutes).toBe(60);
    expect(c.typicalMinutes).toBe(50);
    expect(trafficDelayMinutes(c)).toBe(10);
    expect(c.steps!.map((s) => s.instruction)).toEqual(['Head north on Congress Ave', 'Turn right onto I 35', 'You have arrived']);
    expect(c.steps![0].lanes).toEqual([]);
    expect(c.steps![1].lanes.map(laneArrow)).toEqual(['←', '↑→']);
    expect(c.steps![1].lanes.map((l) => l.active)).toEqual([false, true]);
    expect(c.traffic!.map((r) => [r.level, r.coords.length])).toEqual([['low', 2], ['heavy', 3]]);
    expect(parseMapboxRoutes({ code: 'NoRoute' })).toEqual([]);
  });

  it('groups congestion runs', () => {
    expect(trafficRuns([[0, 0], [1, 1]], [])[0].level).toBe('unknown');
  });

  it('rewrites mapbox:// URLs for MapLibre', () => {
    expect(mapboxTransformUrl('mapbox://sprites/mapbox/streets-v12@2x.json', 't')).toBe('https://api.mapbox.com/styles/v1/mapbox/streets-v12/sprite@2x.json?access_token=t');
    expect(mapboxTransformUrl('mapbox://fonts/mapbox/DIN Pro Medium/0-255.pbf', 't')).toBe('https://api.mapbox.com/fonts/v1/mapbox/DIN Pro Medium/0-255.pbf?access_token=t');
    expect(mapboxTransformUrl('mapbox://mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2', 't')).toBe('https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2.json?secure&access_token=t');
    expect(mapboxTransformUrl('https://example.com/a.png', 't')).toBe('https://example.com/a.png');
  });

  it('caches routes by rounded endpoints', () => {
    expect(routeCacheKey({ lat: 30.26721, lon: -97.74309 }, { lat: 32.7767, lon: -96.797 }, 'mapbox'))
      .toBe(routeCacheKey({ lat: 30.26718, lon: -97.74311 }, { lat: 32.77671, lon: -96.79701 }, 'mapbox'));
  });
});
