# Aurora Weather

A modern, fully client-side weather app. Live forecasts + air quality + 10 years of historical
climate data drive automatic **extreme-weather alerts** judged against your location's own normals.
No build step, no API key, no backend, no tracking — it all runs in the browser, and it works offline
once loaded.

## Run it

**Quickest:** double-click `index.html` (opens via `file://` and fetches live data fine).

**As an installable app (recommended — enables notifications + install):**
```
cd "C:\Projects Work\weather_app"
node serve.js
```
then open <http://localhost:4173>. `localhost` is a secure context, so the service worker,
"Install app", and notifications all work there.

## Features

- **Live & autonomous** — current conditions, 48-hour and 16-day forecasts on load, auto-refreshing every 15 minutes.
- **Extreme-weather alerts + notifications** — heat, thunderstorms (with CAPE instability), heavy rain, strong wind, hard frost, snow. Click the 🔔 to get a browser notification when a severe/high alert appears (works while the app is open or installed).
- **Learning from the past** — pulls ~10 years of ERA5 reanalysis for the chosen spot, builds day-of-year normals + all-time records, then scores each forecast day by anomaly, percentile and record-watch. The chart overlays the forecast on the historical normal range.
- **Air quality & pollen** — European AQI, PM2.5/PM10/O₃/NO₂, and live pollen levels (Europe).
- **Interactive hourly chart** — 48h of temperature / precipitation / wind gusts, toggle between them.
- **Tap-to-expand days** — click any day in the 14-day list for its full breakdown (feels-like, UV, gusts, rain, sun, and how it compares to normal).
- **Any location** — search any city/town, or use your device location. Default is Berlin (change `DEFAULT_LOC` in `app.js`).
- **Modern UI** — glassmorphism, dynamic sky-coloured background, animated icons, dark/light, °C/°F, responsive.
- **Installable PWA** — "Install app" in Chrome/Edge; works offline (cached shell) afterwards.

## Data

[Open-Meteo](https://open-meteo.com): live forecast, air-quality, and historical archive (ERA5).
Historical figures are gridded estimates (~9 km), not a physical station — treat extremes as close estimates.

## Notifications: what works, what doesn't

The 🔔 uses the browser **Notifications API**: while the app is open (foreground or background tab, or
installed), each 15-minute refresh checks for new severe/high alerts and notifies you once per change.
**True background push** (notifications when the app is fully closed) needs a push server + hosting — ask
Claude to add it if you host this online.

## Customise

- **Default location:** `DEFAULT_LOC` near the top of `app.js`.
- **Alert thresholds:** `buildAlerts()` in `app.js`.

## Host it online (for full PWA + cross-device)

Drop this folder on any static host (GitHub Pages, Netlify, Cloudflare Pages) — it works as-is over HTTPS,
which also unlocks reliable install. Ask Claude to wire up hosting and (optionally) real push notifications.
