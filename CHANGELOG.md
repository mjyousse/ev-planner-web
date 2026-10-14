# Changelog

## 0.3.0 — 2026-10-13

- Stops slider from Fewest stops to Fastest arrival, plus Most efficient. Cheapest and Balanced are gone; old settings fall back to Fastest.
- Charger filters: networks, max $/kWh and minimum kW. If no route fits, limits are relaxed one at a time (price, then speed, then both, then networks) and the trip says what changed.
- Home and Work shortcuts, recent destinations and saved trips, stored in the browser.
- Share link: copies a URL that opens and plans the same trip.
- Live re-plan when battery targets or planning settings change.
- Elevation profile for the planned route.
- 13 more vehicles with charging curves. EV9 shows 99.8 kWh gross / 96 kWh usable; planning uses usable.
- Faster first load: map library split into its own chunk and early connections to the map, search and routing hosts.

## 0.2.0 — 2026-10-13

- Route preference (Fastest, Balanced, Cheapest, Most efficient) replaces the value-of-time field. Most efficient picks the route that uses the least energy after hills, wind, temperature and speed.
- Up to three OSRM routes are planned side by side with time, distance, cost, energy and arrival battery; pick one to switch.
- Arrival battery shown as a range across routes, or ±10% energy with one route.
- Average energy use for the trip; click to switch between mi/kWh, kWh/100 mi, Wh/mi, km/kWh and kWh/100 km.
- Click Cost to see how each stop's cost is calculated.
- Units: miles or kilometers, and °F or °C.

## 0.1.0 — 2026-10-13

First tracked release.

- Web trip planner for EVs with charging stops chosen by price, charging speed and arrival battery.
- Energy model using elevation, speed limits, and wind and temperature forecasts.
- Per-station prices from the EV Price Feed, including fees and time-of-day rates; Tesla-only sites excluded.
- "Price updated · Refreshed" dates for each stop and the feed's last refresh time.
- One-click hand-off of the whole trip to Google Maps.
- Version shown in the footer.
