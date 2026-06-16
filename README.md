# Aurora Weather

A modern, fully client-side weather app — live forecasts, extreme-weather alerts judged against
10 years of local climate, a storm radar, a minute-by-minute rain nowcast, 40-year warming stripes,
and a daily "on this day" history fact. **Bilingual (English / German)**, installable as an app, and
it all runs in your browser: no build step, no API key, no backend, no tracking.

**Live:** <https://katarixonaga.github.io/aurora-weather/>

## Run it

**Quickest:** double-click `index.html` (opens via `file://` and fetches live data fine).

**As an installable app (enables notifications + "Install"):**
```
cd "C:\Projects Work\weather_app"
node serve.js
```
then open <http://localhost:4173>. `localhost` is a secure context, so the service worker, install,
and notifications all work there.

## Features

**Live & autonomous**
- Current conditions, 48-hour and 16-day forecasts on load, auto-refreshing every 15 minutes.
- Default location Berlin; search any city/town or use your device location. **Bookmark** cities with the ★ and switch between them via the chips bar.

**Extreme-weather alerts + notifications**
- Heat, thunderstorms (with CAPE instability), heavy rain, strong wind, hard frost and snow — thresholds partly relative to local climate, so they travel to any location.
- Click 🔔 to get a browser notification when a new severe/high alert appears (fires while the app is open or installed).

**Storm & extreme-weather radar** (interactive map)
- **Near me:** pick a radius (25 / 50 / 100 km); it grid-scans the area and pins extreme spots with distance + direction.
- **Country:** scan a whole country and map every extreme spot, with a colour legend.
- **Live radar:** overlay real precipitation radar (RainViewer) and animate the recent frames.

**Rain nowcast**
- "Rain starting around 14:45 (~30 min)" / "easing…" / "none expected" for your exact spot, with a 2-hour intensity timeline.

**Learning from the past** (10-year climatology)
- Each forecast day scored by anomaly, percentile and record-watch; chart overlays the forecast on the historical normal range; all-time hottest / coldest / wettest records.

**Climate history**
- The iconic **warming stripes** (≈40 years of annual temperature, blue→red) with the decade-vs-1980s trend, plus an "on this date" record line.

**More**
- Air quality & pollen (European AQI, PM2.5/PM10/O₃/NO₂, live pollen levels).
- Interactive hourly chart (temperature / precipitation / wind toggle).
- Tap any day in the 14-day list for full details.
- Live clock + a daily **"on this day" history fact** (Wikipedia).
- Modern glass UI, sky-coloured dynamic background, **dark/light** themes, **°C/°F**, fully responsive, **installable PWA** with offline shell.

## Languages

Fully **English / German** with a hand-written native translation (not machine-translated). The
language button in the top bar flips everything — labels, weather descriptions, alerts, the radar,
nowcast and climate text — plus locale-correct dates (`16. Juni`, `Mi`/`Do`), German compass points
(`O` for Ost) and a decimal comma (`28,9 mm`). The "on this day" fact even switches to German
Wikipedia. Your choice is remembered, and it auto-starts in German if your browser is German.
Translations live in `i18n.js` — adding another language is one more block there.

## Data & credits

- [Open-Meteo](https://open-meteo.com) — forecast, air quality, historical archive (ERA5 reanalysis), geocoding.
- [RainViewer](https://www.rainviewer.com) — live precipitation radar tiles.
- [Leaflet](https://leafletjs.com) + [OpenStreetMap](https://www.openstreetmap.org) / [CARTO](https://carto.com) — interactive map and base tiles.
- [Wikipedia "On this day"](https://www.wikipedia.org) (EN + DE), with history.muffinlabs.com as fallback.
- [Chart.js](https://www.chartjs.org) — charts.

Historical figures are gridded estimates (~9 km), not a physical station — treat extremes as close estimates.

## Privacy

Everything runs in your browser. There is no backend and no analytics. Your location, bookmarks,
language, theme and units are stored only in your own browser's `localStorage`.

## Notifications: what works, what doesn't

While the app is open or installed, each 15-minute refresh checks for new severe/high alerts and
notifies you once per change. **True background push** (when the app is fully closed) needs a push
server + hosting — not included.

## Customise

- **Default location:** `DEFAULT_LOC` near the top of `app.js`.
- **Alert thresholds:** `buildAlerts()` in `app.js`.
- **Translations / new language:** `i18n.js`.

## Install / host

It's deployed on **GitHub Pages** (see the live link above). To update it: edit files, then
`git commit -am "…"` and `git push` — Pages redeploys automatically in ~1 minute, and the
network-first service worker means visitors get the new version immediately.

For a fresh deploy elsewhere, drop the folder on any static host (Netlify, Cloudflare Pages, etc.) —
it works as-is over HTTPS, which also unlocks reliable install.

## File structure

```
index.html      app shell + section containers
styles.css      glass UI, themes, responsive layout
app.js          all logic: data, climatology, alerts, map, charts, i18n wiring
i18n.js         English/German dictionary
sw.js           service worker (offline shell, network-first)
manifest.json   PWA manifest
icon.svg        app icon
serve.js        tiny local static server (node serve.js)
```
