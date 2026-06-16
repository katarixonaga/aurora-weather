'use strict';
/* Aurora Weather — fully client-side. Live forecast + air quality (Open-Meteo) and 10y
   ERA5 archive for climatology, anomaly/percentile analysis and extreme-weather alerting.
   PWA: installable, offline shell, and local extreme-weather notifications. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const DEFAULT_LOC = { name: 'Berlin', admin1: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.405 };
  const LS = { loc: 'aurora.loc', units: 'aurora.units', theme: 'aurora.theme', arch: (la, lo) => `aurora.arch.${la.toFixed(3)},${lo.toFixed(3)}` };
  const LOCALE = () => state.lang === 'de' ? 'de-DE' : 'en-GB';
  function tr(k, p) { const dict = window.AURORA_I18N[state.lang] || window.AURORA_I18N.en; let v = (k in dict) ? dict[k] : window.AURORA_I18N.en[k]; if (v == null) v = k; return typeof v === 'function' ? v(p || {}) : v; }
  function wmoText(c) { const m = window.AURORA_WMO[state.lang] || window.AURORA_WMO.en; return m[c] || window.AURORA_WMO.en[c] || '—'; }
  function applyStaticI18n() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = tr(el.getAttribute('data-i18n-html')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', tr(el.getAttribute('data-i18n-ph'))); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', tr(el.getAttribute('data-i18n-title'))); });
    const lb = $('#langBtn'); if (lb) lb.textContent = state.lang === 'de' ? 'EN' : 'DE';
    const cs = $('#countrySel'); if (cs) { cs.setAttribute('aria-label', tr('aria_country')); cs.innerHTML = COUNTRIES.map(c => `<option value="${c.code}"${c.code === state.map.country ? ' selected' : ''}>${esc(countryName(c))}</option>`).join(''); }
  }

  let state = {
    loc: loadLoc(), units: localStorage.getItem(LS.units) || 'c', lang: localStorage.getItem('aurora.lang') || ((navigator.language || 'en').toLowerCase().indexOf('de') === 0 ? 'de' : 'en'),
    forecast: null, air: null, clim: null, analysis: null, capeByDay: {}, capeByDate: {}, nowcast: null, longData: null, stripesLoc: null,
    alerts: [], hourlyMetric: 'temp', faves: loadFaves(), timer: null,
    map: { inited: false, leaflet: null, baseLayer: null, radarLayer: null, markers: [], center: null, circle: null, scope: 'near', radius: 50, country: 'DE', radarOn: false, frames: [], radarHost: '', radarIdx: 0, radarTimer: null }
  };
  window.__aurora = state;

  /* ---------------- helpers ---------------- */
  function loadLoc() { try { return JSON.parse(localStorage.getItem(LS.loc)) || DEFAULT_LOC; } catch (e) { return DEFAULT_LOC; } }
  function mean(a) { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
  function sum(a) { return a.filter(x => x != null).reduce((s, x) => s + x, 0); }
  function pctl(arr, v) { if (!arr.length) return null; let c = 0; for (const x of arr) if (x <= v) c++; return c / arr.length * 100; }
  function round(v, d = 0) { const m = Math.pow(10, d); return Math.round(v * m) / m; }
  function nf(v, d) { return (v == null || isNaN(v)) ? '–' : Number(v).toLocaleString(LOCALE(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pm(v, d = 0) { const r = round(v, d); return (r > 0 ? '+' : '') + (d > 0 ? nf(r, d) : r); }
  function convT(c) { return state.units === 'f' ? c * 9 / 5 + 32 : c; }
  function fmtT(c) { if (c == null || isNaN(c)) return '–'; return Math.round(convT(c)) + '°'; }
  function convW(k) { return state.units === 'f' ? k * 0.621371 : k; }
  function windU() { return state.units === 'f' ? 'mph' : 'km/h'; }
  function fmtW(k) { if (k == null) return '–'; return Math.round(convW(k)) + ' ' + windU(); }
  function convP(mm) { return state.units === 'f' ? mm / 25.4 : mm; }
  function precU() { return state.units === 'f' ? 'in' : 'mm'; }
  function fmtP(mm) { if (mm == null) return '–'; const v = convP(mm); return (state.units === 'f' ? nf(v, 2) : nf(v, 1)) + ' ' + precU(); }
  function tempDeg(c) { return state.units === 'f' ? Math.round(c * 9 / 5 + 32) + '°F' : Math.round(c) + '°C'; }
  function dnum(ds) { return new Date(ds + 'T12:00:00'); }
  function fmtDay(ds) { return dnum(ds).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtWD(ds) { const d = dnum(ds); if (d.toDateString() === new Date().toDateString()) return tr('today'); return d.toLocaleDateString(LOCALE(), { weekday: 'short' }); }
  function shortWD(ds) { return dnum(ds).toLocaleDateString(LOCALE(), { weekday: 'short' }); }
  function mdShort(ds) { return dnum(ds).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' }); }
  function doy(ds) { const d = new Date(ds + 'T00:00:00Z'); return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5); }
  function compass(deg) { const en = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'], de = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']; return (state.lang === 'de' ? de : en)[Math.round(deg / 22.5) % 16]; }
  function tColor(t) { if (t >= 36) return '#e23b3b'; if (t >= 33) return '#ff7a45'; if (t >= 30) return '#ff9f3e'; if (t >= 26) return '#ffc24a'; if (t >= 22) return '#7bd88f'; if (t >= 17) return '#3fc1c9'; if (t >= 10) return '#56a0e8'; if (t >= 2) return '#5a82d8'; return '#7d6bdc'; }
  function uvWord(u) { return u == null ? '–' : u < 3 ? tr('uv_low') : u < 6 ? tr('uv_mod') : u < 8 ? tr('uv_high') : u < 11 ? tr('uv_vhigh') : tr('uv_extreme'); }
  function hhmm(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function keyLoc() { return '.' + state.loc.lat.toFixed(2) + ',' + state.loc.lon.toFixed(2); }

  /* ---------------- favorites ---------------- */
  function loadFaves() { try { return JSON.parse(localStorage.getItem('aurora.faves')) || []; } catch (e) { return []; } }
  function saveFaves() { localStorage.setItem('aurora.faves', JSON.stringify(state.faves)); }
  function faveKey(l) { return l.lat.toFixed(3) + ',' + l.lon.toFixed(3); }
  function isFave(l) { return state.faves.some(f => faveKey(f) === faveKey(l)); }
  function starSvg() { return '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 17.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z"/></svg>'; }
  function toggleFave() {
    const k = faveKey(state.loc);
    if (state.faves.some(f => faveKey(f) === k)) { state.faves = state.faves.filter(f => faveKey(f) !== k); toast(tr('t_removed', { name: state.loc.name })); }
    else { state.faves.push({ name: state.loc.name, admin1: state.loc.admin1, country: state.loc.country, lat: state.loc.lat, lon: state.loc.lon }); toast(tr('t_bookmarked', { name: state.loc.name })); }
    saveFaves(); renderFaves(); const st = $('#faveStar'); if (st) st.classList.toggle('on', isFave(state.loc));
  }
  function renderFaves() {
    const el = $('#faves'); if (!el) return;
    if (!state.faves.length) { el.innerHTML = ''; return; }
    const cur = faveKey(state.loc);
    el.innerHTML = '<div class="faves-row">' + state.faves.map((f, i) => `<span class="fave-chip ${faveKey(f) === cur ? 'active' : ''}"><button class="fc-go" data-i="${i}">${esc(f.name)}</button><button class="fc-rm" data-i="${i}" title="Remove bookmark" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('') + '</div>';
  }

  /* ---------------- weather icons ---------------- */
  function codeCat(code) {
    if (code === 0) return 'clear'; if (code <= 2) return 'partly'; if (code === 3) return 'cloud';
    if (code <= 48) return 'fog'; if (code <= 57) return 'drizzle'; if (code <= 65) return 'rain';
    if (code <= 67) return 'sleet'; if (code <= 77) return 'snow'; if (code <= 82) return 'rain';
    if (code <= 86) return 'snow'; return 'storm';
  }
  const CLOUD = '<path d="M19 45h26a10 10 0 0 0 1.6-19.9A14 14 0 0 0 20 21a10.5 10.5 0 0 0-1 24z" fill="#aab6c9"/>';
  const CLOUDd = '<path d="M19 45h26a10 10 0 0 0 1.6-19.9A14 14 0 0 0 20 21a10.5 10.5 0 0 0-1 24z" fill="#8e9bb0"/>';
  function sun(anim) { let r = ''; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, x1 = 32 + Math.cos(a) * 17, y1 = 32 + Math.sin(a) * 17, x2 = 32 + Math.cos(a) * 24, y2 = 32 + Math.sin(a) * 24; r += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; } return `<g class="${anim ? 'spin-slow' : ''}" stroke="#FDB813" stroke-width="3.4" stroke-linecap="round">${r}</g><circle cx="32" cy="32" r="12.5" fill="#FDB813"/>`; }
  const MOON = '<path d="M42 14a20 20 0 1 0 9 35 24 24 0 0 1-9-35z" fill="#dfe7f3"/>';
  function icon(code, isDay, anim) {
    const cat = codeCat(code), A = anim ? 'float' : '';
    let inner;
    if (cat === 'clear') inner = isDay ? sun(anim) : MOON;
    else if (cat === 'partly') inner = `<g class="${A}">${isDay ? '<g class="' + (anim ? 'spin-slow' : '') + '" stroke="#FDB813" stroke-width="3" stroke-linecap="round"><line x1="22" y1="9" x2="22" y2="3"/><line x1="9" y1="22" x2="3" y2="22"/><line x1="12" y1="12" x2="8" y2="8"/><line x1="32" y1="12" x2="36" y2="8"/></g><circle cx="22" cy="22" r="9" fill="#FDB813"/>' : '<path d="M26 12a13 13 0 0 0 10 20 15 15 0 0 1-10 4z" fill="#dfe7f3"/>'}${CLOUD}</g>`;
    else if (cat === 'cloud') inner = `<g class="${A}">${CLOUDd}</g>`;
    else if (cat === 'fog') inner = `${CLOUD}<g stroke="#aab6c9" stroke-width="3" stroke-linecap="round"><line x1="14" y1="52" x2="46" y2="52"/><line x1="20" y1="58" x2="52" y2="58"/></g>`;
    else if (cat === 'drizzle' || cat === 'rain') inner = `${CLOUD}<g stroke="#56b6f0" stroke-width="3.2" stroke-linecap="round">${rainDrops(cat === 'rain', anim)}</g>`;
    else if (cat === 'snow') inner = `${CLOUD}<g fill="#cfe8ff">${snowDots(anim)}</g>`;
    else if (cat === 'sleet') inner = `${CLOUD}<line x1="24" y1="50" x2="22" y2="57" stroke="#56b6f0" stroke-width="3" stroke-linecap="round"/><circle cx="38" cy="54" r="2.5" fill="#cfe8ff"/>`;
    else inner = `${CLOUDd}<path class="${anim ? 'flash' : ''}" d="M33 46l-8 11h6l-3 9 11-13h-6l4-7z" fill="#ffd23e"/>`;
    return `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">${inner}</svg>`;
  }
  function rainDrops(h, a) { return (h ? [22, 32, 42] : [26, 38]).map((x, i) => `<line class="${a ? 'drop' : ''}" style="animation-delay:${i * .3}s" x1="${x}" y1="49" x2="${x - 2}" y2="57"/>`).join(''); }
  function snowDots(a) { return [24, 33, 42].map((x, i) => `<circle class="${a ? 'drop' : ''}" style="animation-delay:${i * .35}s" cx="${x}" cy="53" r="2.6"/>`).join(''); }

  /* ---------------- background ---------------- */
  function setBg(code, isDay, temp) {
    const cat = codeCat(code); let g;
    if (cat === 'storm') g = isDay ? 'linear-gradient(160deg,#3b4a64,#283349 55%,#1a2030)' : 'linear-gradient(160deg,#232b40,#161a2b 60%,#0c0e18)';
    else if (cat === 'snow') g = isDay ? 'linear-gradient(160deg,#9fb1cc,#7d92b2 60%,#566980)' : 'linear-gradient(160deg,#2b3654,#1d2742 60%,#11172a)';
    else if (cat === 'rain' || cat === 'drizzle' || cat === 'sleet') g = isDay ? 'linear-gradient(160deg,#5d7693,#41566f 60%,#2c3a50)' : 'linear-gradient(160deg,#232f48,#171f33 60%,#0d121f)';
    else if (cat === 'fog' || cat === 'cloud') g = isDay ? 'linear-gradient(160deg,#7e93b0,#5f7591 60%,#45576f)' : 'linear-gradient(160deg,#262f47,#1a2238 60%,#0f1525)';
    else if (isDay) { g = temp >= 32 ? 'linear-gradient(160deg,#ff9a52,#ff6f43 45%,#e0496c)' : temp >= 24 ? 'linear-gradient(160deg,#4ea6ff,#3577d8 55%,#2b58ad)' : temp >= 12 ? 'linear-gradient(160deg,#56bdf0,#3f8fd0 55%,#3a64ac)' : 'linear-gradient(160deg,#7fc4e8,#5a92d4 55%,#5566c8)'; }
    else g = 'linear-gradient(160deg,#1d2a5a,#152043 55%,#0b1026)';
    $('#bg').style.background = g;
    const tm = document.querySelector('meta[name=theme-color]'); if (tm) tm.content = (isDay && (cat === 'clear' || cat === 'partly') && temp >= 24) ? '#11203a' : '#0b1220';
  }

  /* ---------------- data ---------------- */
  async function getForecast(loc) {
    const p = new URLSearchParams({
      latitude: loc.lat, longitude: loc.lon,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index',
      hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m,is_day,cape',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,snowfall_sum',
      timezone: 'auto', forecast_days: 16, wind_speed_unit: 'kmh'
    });
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + p);
    if (!r.ok) throw new Error('forecast ' + r.status);
    return r.json();
  }
  async function getAir(loc) {
    const p = new URLSearchParams({ latitude: loc.lat, longitude: loc.lon, current: 'european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen', timezone: 'auto' });
    const r = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?' + p);
    if (!r.ok) throw new Error('air ' + r.status);
    return r.json();
  }
  async function getArchive(loc) {
    const key = LS.arch(loc.lat, loc.lon);
    try { const c = JSON.parse(localStorage.getItem(key)); if (c && Date.now() - c.ts < 864e5) return c.data; } catch (e) {}
    const end = new Date(Date.now() - 6 * 864e5), start = new Date(end); start.setFullYear(start.getFullYear() - 10);
    const iso = d => d.toISOString().slice(0, 10);
    const p = new URLSearchParams({ latitude: loc.lat, longitude: loc.lon, start_date: iso(start), end_date: iso(end), daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum', timezone: 'auto' });
    const r = await fetch('https://archive-api.open-meteo.com/v1/archive?' + p);
    if (!r.ok) throw new Error('archive ' + r.status);
    const data = await r.json();
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
    return data;
  }
  async function geocode(q) {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=6&language=en&format=json');
    if (!r.ok) return []; const d = await r.json(); return d.results || [];
  }

  /* ---------------- climatology ---------------- */
  function buildClim(arc) {
    const t = arc.daily.time, mx = arc.daily.temperature_2m_max, mn = arc.daily.temperature_2m_min, pr = arc.daily.precipitation_sum, n = t.length, D = t.map(doy);
    let rec = { hi: { v: -1e9 }, lo: { v: 1e9 }, rain: { v: -1 } };
    for (let i = 0; i < n; i++) {
      if (mx[i] != null && mx[i] > rec.hi.v) rec.hi = { v: mx[i], date: t[i] };
      if (mn[i] != null && mn[i] < rec.lo.v) rec.lo = { v: mn[i], date: t[i] };
      if (pr[i] != null && pr[i] > rec.rain.v) rec.rain = { v: pr[i], date: t[i] };
    }
    const mo = Array.from({ length: 12 }, () => ({ pr: [] })), yrs = new Set(t.map(s => s.slice(0, 4)));
    for (let i = 0; i < n; i++) { const m = +t[i].slice(5, 7) - 1; if (pr[i] != null) mo[m].pr.push(pr[i]); }
    const monthly = mo.map((o, m) => ({ month: m, pr: sum(o.pr) / yrs.size }));
    return { t, mx, mn, pr, D, rec, monthly, years: yrs.size };
  }
  function windowVals(clim, ds, src, win = 7) {
    const tgt = doy(ds), out = [], a = clim[src];
    if (!a) return out;
    for (let i = 0; i < clim.D.length; i++) { let d = Math.abs(clim.D[i] - tgt); d = Math.min(d, 366 - d); if (d <= win && a[i] != null) out.push(a[i]); }
    return out;
  }
  function analyze(fc, clim) {
    const d = fc.daily;
    return d.time.map((date, i) => {
      const hiArr = windowVals(clim, date, 'mx'), loArr = windowVals(clim, date, 'mn');
      const nHi = mean(hiArr), nLo = mean(loArr), hi = d.temperature_2m_max[i], lo = d.temperature_2m_min[i];
      return {
        date, i, code: d.weather_code[i], hi, lo, nHi, nLo, appMax: d.apparent_temperature_max[i],
        anomHi: nHi == null ? 0 : hi - nHi, anomLo: nLo == null ? 0 : lo - nLo, pctHi: pctl(hiArr, hi),
        rain: d.precipitation_sum[i], prob: d.precipitation_probability_max[i], gust: d.wind_gusts_10m_max[i],
        snow: d.snowfall_sum[i], uv: d.uv_index_max[i], sunrise: d.sunrise[i], sunset: d.sunset[i],
        nearRec: clim.rec && hi >= clim.rec.hi.v - 1, overRec: clim.rec && hi >= clim.rec.hi.v
      };
    });
  }

  /* ---------------- alerts ---------------- */
  function rangeStr(days) { return days.length === 1 ? fmtDay(days[0].date) : fmtWD(days[0].date) + '–' + fmtDay(days[days.length - 1].date); }
  function buildAlerts(an, clim, cape) {
    const A = [], rec = clim.rec || { hi: { v: 99 }, rain: { v: 99 } };
    const heat = an.filter(a => a.hi >= 30 && (a.hi >= 32 || a.anomHi >= 8));
    if (heat.length) {
      const pk = heat.reduce((p, c) => c.hi > p.hi ? c : p), sev = pk.overRec || pk.hi >= 37 ? 'severe' : pk.hi >= 35 ? 'high' : 'moderate';
      const extra = pk.overRec ? tr('al_heat_break', { rec: tempDeg(rec.hi.v) }) : pk.nearRec ? tr('al_heat_near', { rec: tempDeg(rec.hi.v) }) : pk.pctHi >= 97 ? tr('al_heat_pct', { pct: Math.round(pk.pctHi) }) : '';
      A.push({ type: 'heat', sev, title: heat.length > 1 ? tr('al_heatwave') : tr('al_extremeheat'), when: rangeStr(heat), desc: tr('al_heat_desc', { t: tempDeg(pk.hi), day: fmtDay(pk.date), anom: pm(pk.anomHi), norm: tempDeg(pk.nHi), extra }), ic: icon(0, true, false) });
    }
    const storm = an.filter(a => a.code >= 95 || (cape[a.date] || 0) >= 1500);
    if (storm.length) {
      const pk = storm.reduce((p, c) => (cape[c.date] || 0) > (cape[p.date] || 0) ? c : p), cp = Math.round(cape[pk.date] || 0), sev = pk.code >= 96 || cp >= 2500 ? 'severe' : cp >= 2000 ? 'high' : 'moderate';
      const extra = cp ? tr('al_storm_cape', { cape: cp, fuel: cp >= 2000 ? tr('al_storm_fuel') : '' }) : '';
      A.push({ type: 'storm', sev, title: tr('al_storms'), when: rangeStr(storm), desc: tr('al_storm_desc', { day: fmtDay(pk.date), extra }), ic: icon(95, true, false) });
    }
    const wet = an.filter(a => a.rain >= 25);
    if (wet.length) {
      const pk = wet.reduce((p, c) => c.rain > p.rain ? c : p), near = pk.rain >= rec.rain.v * 0.6 ? tr('al_rain_near', { rec: fmtP(rec.rain.v) }) : '';
      A.push({ type: 'rain', sev: pk.rain >= 40 ? 'severe' : 'high', title: tr('al_rain'), when: rangeStr(wet), desc: tr('al_rain_desc', { mm: fmtP(pk.rain), day: fmtDay(pk.date), extra: near }), ic: icon(63, true, false) });
    }
    const windy = an.filter(a => a.gust >= 75);
    if (windy.length) { const pk = windy.reduce((p, c) => c.gust > p.gust ? c : p); A.push({ type: 'wind', sev: pk.gust >= 95 ? 'severe' : 'high', title: tr('al_wind'), when: rangeStr(windy), desc: tr('al_wind_desc', { g: fmtW(pk.gust), day: fmtDay(pk.date) }), ic: icon(3, true, false) }); }
    const cold = an.filter(a => a.lo <= -8 || a.anomLo <= -9);
    if (cold.length) { const pk = cold.reduce((p, c) => c.lo < p.lo ? c : p); A.push({ type: 'cold', sev: pk.lo <= -12 ? 'high' : 'moderate', title: tr('al_frost'), when: rangeStr(cold), desc: tr('al_cold_desc', { t: tempDeg(pk.lo), day: fmtDay(pk.date), anom: pm(pk.anomLo) }), ic: icon(71, true, false) }); }
    const snow = an.filter(a => a.snow >= 5);
    if (snow.length) { const pk = snow.reduce((p, c) => c.snow > p.snow ? c : p); A.push({ type: 'snow', sev: pk.snow >= 15 ? 'high' : 'moderate', title: tr('al_snow'), when: rangeStr(snow), desc: tr('al_snow_desc', { cm: round(pk.snow, 1), day: fmtDay(pk.date) }), ic: icon(75, true, false) }); }
    const order = { severe: 0, high: 1, moderate: 2 };
    return A.sort((a, b) => order[a.sev] - order[b.sev]);
  }

  /* ---------------- render ---------------- */
  function renderHero(fc, an) {
    const c = fc.current, today = an[0];
    setBg(c.weather_code, c.is_day === 1, c.temperature_2m);
    const l = state.loc, place = l.name + (l.admin1 && l.admin1 !== l.name ? ', ' + l.admin1 : '') + (l.country ? ' · ' + l.country : '');
    let narr = wmoText(c.weather_code) + '. ';
    if (today && Math.abs(today.anomHi) >= 4) narr += tr('narr_anom', { anom: pm(today.anomHi), word: today.anomHi > 0 ? tr('narr_warmer') : tr('narr_cooler') });
    if (today && today.overRec) narr += tr('narr_record');
    else if (today && today.pctHi != null && today.pctHi >= 95) narr += tr('narr_pct', { pct: Math.round(100 - today.pctHi) || 1 });
    $('#hero').innerHTML =
      `<div class="hero-loc"><span class="dot"></span><span class="hloc-name">${esc(place)}</span><button class="fave-star ${isFave(state.loc) ? 'on' : ''}" id="faveStar" title="Bookmark this place" aria-label="Bookmark this place">${starSvg()}</button></div>
       <div class="hero-main"><div class="hero-ic float">${icon(c.weather_code, c.is_day === 1, true)}</div><div class="hero-temp">${fmtT(c.temperature_2m)}</div>
       <div class="hero-right"><div class="hero-cond">${wmoText(c.weather_code)}</div><div class="hero-feels">${tr('feels_like')} ${fmtT(c.apparent_temperature)}</div>
       <div class="hero-hl"><span>${tr('hilo_high')} <b>${fmtT(today && today.hi)}</b></span><span>${tr('hilo_low')} <b>${fmtT(today && today.lo)}</b></span></div></div></div>
       <div class="hero-narr">${esc(narr)}</div>`;
  }
  function metric(lbl, val, sub) { return `<div class="metric"><div class="m-lbl">${lbl}</div><div class="m-val">${val}</div><div class="m-sub">${sub || ''}</div></div>`; }
  function renderDetails(fc, an) {
    const c = fc.current, t = an[0], rise = t ? hhmm(t.sunrise) : '–', set = t ? hhmm(t.sunset) : '–';
    $('#details').innerHTML =
      metric(tr('feels_like'), fmtT(c.apparent_temperature), t ? tr('feels_sub', { t: fmtT(t.appMax != null ? t.appMax : t.hi) }) : '') +
      metric(tr('wind'), fmtW(c.wind_speed_10m), tr('gusts') + ' ' + fmtW(c.wind_gusts_10m) + ' · ' + compass(c.wind_direction_10m)) +
      metric(tr('humidity'), Math.round(c.relative_humidity_2m) + '%', tr('cloud') + ' ' + Math.round(c.cloud_cover) + '%') +
      metric(tr('uv'), c.uv_index == null ? '–' : round(c.uv_index, 1), uvWord(c.uv_index)) +
      metric(tr('pressure'), Math.round(c.pressure_msl) + ' hPa', '') +
      metric(tr('sunrise'), rise, tr('sunset_pre') + set);
  }
  function renderHourly(fc) {
    const h = fc.hourly, now = fc.current.time; let s = 0; for (let i = 0; i < h.time.length; i++) if (h.time[i] >= now) { s = i; break; }
    let html = '';
    for (let i = s; i < s + 24 && i < h.time.length; i++) {
      const hr = new Date(h.time[i]).getHours(), lbl = i === s ? tr('now') : (hr === 0 ? '0' : hr) + ':00', pop = h.precipitation_probability[i];
      html += `<div class="hour ${i === s ? 'now' : ''}"><div class="h-t">${lbl}</div><div class="h-ic">${icon(h.weather_code[i], h.is_day[i] === 1, false)}</div><div class="h-temp">${fmtT(h.temperature_2m[i])}</div><div class="h-pop">${pop >= 20 ? rainGlyph() + ' ' + pop + '%' : ''}</div></div>`;
    }
    $('#hourly').innerHTML = `<div class="hourly-row">${html}</div>`;
  }
  let hourlyChart = null;
  function renderHourlyChart() {
    const fc = state.forecast; if (!fc || !window.Chart || !$('#hourlyChart')) return;
    const m = state.hourlyMetric, h = fc.hourly, now = fc.current.time; let s = 0; for (let i = 0; i < h.time.length; i++) if (h.time[i] >= now) { s = i; break; }
    const idx = []; for (let i = s; i < s + 48 && i < h.time.length; i++) idx.push(i);
    const dark = document.documentElement.getAttribute('data-theme') !== 'light', grid = dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)', tick = dark ? 'rgba(235,240,250,.65)' : 'rgba(20,30,50,.6)';
    const labels = idx.map((i, j) => { const d = new Date(h.time[i]), hr = d.getHours(); return j === 0 ? tr('now') : hr === 0 ? mdShort(h.time[i].slice(0, 10)) : (hr < 10 ? '0' + hr : hr); });
    let type = 'line', ds, yfmt;
    if (m === 'temp') { ds = { data: idx.map(i => round(convT(h.temperature_2m[i]), 1)), borderColor: '#ff7a45', borderWidth: 2.4, tension: .4, pointRadius: 0, fill: true, backgroundColor: dark ? 'rgba(255,122,69,.14)' : 'rgba(255,122,69,.10)' }; yfmt = v => Math.round(v) + '°'; }
    else if (m === 'rain') { type = 'bar'; ds = { data: idx.map(i => round(convP(h.precipitation[i]), 2)), backgroundColor: '#4ea6e8', borderRadius: 3, maxBarThickness: 9 }; yfmt = v => v; }
    else { ds = { data: idx.map(i => Math.round(convW(h.wind_gusts_10m[i]))), borderColor: '#9fb0c4', borderWidth: 2, tension: .4, pointRadius: 0, fill: true, backgroundColor: dark ? 'rgba(159,176,196,.12)' : 'rgba(120,140,170,.10)' }; yfmt = v => Math.round(v); }
    if (hourlyChart) hourlyChart.destroy();
    hourlyChart = new Chart($('#hourlyChart'), {
      type, data: { labels, datasets: [Object.assign({ label: m }, ds)] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => { const i = idx[items[0].dataIndex]; const d = new Date(h.time[i]); return d.toLocaleDateString(LOCALE(), { weekday: 'short' }) + ' ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':00'; }, label: c => { const v = c.parsed.y, i = idx[c.dataIndex], pop = h.precipitation_probability[i]; return m === 'temp' ? Math.round(v) + (state.units === 'f' ? '°F' : '°C') : m === 'rain' ? round(v, 1) + ' ' + precU() + (pop != null ? '  ·  ' + pop + '%' : '') : Math.round(v) + ' ' + windU() + ' ' + tr('gusts'); } } } },
        scales: { y: { grid: { color: grid }, ticks: { color: tick, callback: yfmt }, beginAtZero: m !== 'temp' }, x: { grid: { display: false }, ticks: { color: tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } } }
      }
    });
  }

  function badge(svg, title) { return `<span class="bg-ic" title="${title}">${svg}</span>`; }
  function renderDaily(an, cape) {
    const days = an.slice(0, 14), lo = Math.floor(Math.min(...days.map(d => d.lo))), hi = Math.ceil(Math.max(...days.map(d => d.hi))), span = Math.max(1, hi - lo);
    let html = '';
    days.forEach(d => {
      const left = (d.lo - lo) / span * 100, w = (d.hi - d.lo) / span * 100; let b = '';
      if (d.hi >= 32) b += badge(flame(d.hi >= 36 ? '#e23b3b' : '#ff7a45'), d.hi >= 36 ? tr('severe_heat') : tr('hot_day'));
      if (d.code >= 95 || (cape[d.date] || 0) >= 1500) b += badge(bolt(), tr('tstorm_risk'));
      if (d.gust >= 60) b += badge(wind(), tr('strong_gusts', { g: fmtW(d.gust) }));
      const pop = d.prob >= 20 ? `<div class="d-pop">${rainGlyph()} ${d.prob}%</div>` : '';
      html += `<div class="dwrap"><div class="drow" data-i="${d.i}" role="button" tabindex="0" aria-expanded="false">
        <div class="d-day"><span class="d-wd">${fmtWD(d.date)}</span><span class="d-dt">${mdShort(d.date)}</span></div>
        <div class="d-ic">${icon(d.code, true, false)}${pop}</div>
        <div class="d-temp"><span class="d-lo">${fmtT(d.lo)}</span><div class="d-track"><div class="d-seg" style="left:${left}%;width:${w}%;background:linear-gradient(90deg,${tColor(d.lo)},${tColor(d.hi)})"></div></div><span class="d-hi">${fmtT(d.hi)}</span></div>
        <div class="d-badges">${b}<svg class="d-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>
        <div class="dexp" id="dexp-${d.i}" hidden></div></div>`;
    });
    $('#daily').innerHTML = html;
  }
  function dItem(l, v) { return `<div class="dexp-item"><div class="di-l">${l}</div><div class="di-v">${v}</div></div>`; }
  function toggleDay(i, row) {
    const exp = document.getElementById('dexp-' + i); if (!exp) return;
    if (!exp.hasAttribute('hidden')) { exp.setAttribute('hidden', ''); row.classList.remove('open'); row.setAttribute('aria-expanded', 'false'); return; }
    const a = state.analysis[i]; if (!a) return;
    exp.innerHTML = `<div class="dexp-grid">
      ${dItem(tr('d_hilo'), fmtT(a.hi) + ' / ' + fmtT(a.lo))}
      ${dItem(tr('d_feels'), fmtT(a.appMax))}
      ${dItem(tr('d_rain'), fmtP(a.rain) + (a.prob != null ? ' · ' + a.prob + '%' : ''))}
      ${dItem(tr('d_maxgust'), fmtW(a.gust))}
      ${dItem(tr('d_uv'), (a.uv == null ? '–' : round(a.uv, 1)) + ' · ' + uvWord(a.uv))}
      ${dItem(tr('d_sun'), a.sunrise ? hhmm(a.sunrise) + ' – ' + hhmm(a.sunset) : '–')}
      ${dItem(tr('d_vsnormal'), a.nHi == null ? '–' : tr('d_norm', { v: pm(a.anomHi) + '°', n: fmtT(a.nHi) }))}
      ${dItem(tr('d_rarity'), a.pctHi == null ? '–' : tr('d_warmer', { pct: Math.round(a.pctHi) }))}
    </div>`;
    exp.removeAttribute('hidden'); row.classList.add('open'); row.setAttribute('aria-expanded', 'true');
  }
  function flame(c) { return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1-.5-2-1-3 2 1 4 3 4 6a6 6 0 0 1-12 0c0-5 5-7 6-12z" fill="${c}"/></svg>`; }
  function bolt() { return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M13 2L4 14h6l-2 8 9-12h-6l2-8z" fill="#a98bff"/></svg>`; }
  function wind() { return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3" fill="none" stroke="#9fb0c4" stroke-width="2" stroke-linecap="round"/></svg>`; }
  function rainGlyph() { return `<svg viewBox="0 0 24 24" width="10" height="10" style="vertical-align:-1px"><path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" fill="#56b6f0"/></svg>`; }

  /* ---------------- air quality ---------------- */
  function aqiInfo(v) { if (v == null) return { t: '–', c: '#8090a6' }; if (v <= 20) return { t: tr('aq_good'), c: '#3fc1a3' }; if (v <= 40) return { t: tr('aq_fair'), c: '#9bcf3a' }; if (v <= 60) return { t: tr('aq_moderate'), c: '#ffce3a' }; if (v <= 80) return { t: tr('aq_poor'), c: '#ff9f3e' }; if (v <= 100) return { t: tr('aq_vpoor'), c: '#e23b3b' }; return { t: tr('aq_epoor'), c: '#a8326b' }; }
  function pollenLvl(v) { if (v == null) return null; if (v <= 10) return { t: tr('pl_low'), c: '#3fc1a3' }; if (v <= 30) return { t: tr('pl_mod'), c: '#ffce3a' }; if (v <= 80) return { t: tr('pl_high'), c: '#ff9f3e' }; return { t: tr('pl_vhigh'), c: '#e23b3b' }; }
  function renderAir(air) {
    if (!air || !air.current) { $('#air').innerHTML = '<div class="metric"><div class="m-sub">' + esc(tr('aq_unavail')) + '</div></div>'; return; }
    const c = air.current, a = aqiInfo(c.european_aqi);
    const chips = [['pm2_5', 'PM2.5'], ['pm10', 'PM10'], ['ozone', tr('o3')], ['nitrogen_dioxide', 'NO₂']].map(([k, l]) => `<div class="metric"><div class="m-lbl">${l}</div><div class="m-val">${c[k] == null ? '–' : Math.round(c[k])}</div><div class="m-sub">µg/m³</div></div>`).join('');
    const types = [['grass_pollen', tr('p_grass')], ['birch_pollen', tr('p_birch')], ['alder_pollen', tr('p_alder')], ['mugwort_pollen', tr('p_mugwort')], ['ragweed_pollen', tr('p_ragweed')], ['olive_pollen', tr('p_olive')]].map(([k, l]) => ({ l, v: c[k] })).filter(p => p.v != null);
    let pollen;
    if (!types.length) pollen = '<div class="m-sub" style="padding:2px 2px">' + esc(tr('pollen_unavail')) + '</div>';
    else pollen = types.map(p => { const lv = pollenLvl(p.v); return `<div class="pollen-row"><span class="pl-name">${esc(p.l)}</span><span class="pl-bar"><span style="width:${Math.min(100, p.v / 2)}%;background:${lv.c}"></span></span><span class="pl-lvl" style="color:${lv.c}">${lv.t}</span></div>`; }).join('');
    $('#air').innerHTML =
      `<div class="aqi-card" style="border-color:${a.c}66">
        <div class="aqi-num" style="color:${a.c}">${c.european_aqi == null ? '–' : Math.round(c.european_aqi)}</div>
        <div class="aqi-meta"><div class="aqi-cat" style="color:${a.c}">${a.t}</div><div class="aqi-sub">${tr('aq_index')}</div></div></div>
      <div class="poll-chips">${chips}</div>
      <div class="pollen-card"><div class="pollen-title">${tr('pollen')} <span class="m-sub">${tr('pollen_unit')}</span></div>${pollen}</div>`;
  }

  /* ---------------- history ---------------- */
  function renderHistory(fc, an, clim) {
    const next7 = an.slice(0, 7), avgHi = mean(next7.map(d => d.hi)), avgNorm = mean(next7.map(d => d.nHi)), anom = avgHi - avgNorm;
    const peak = an.slice(0, 14).reduce((p, c) => c.hi > p.hi ? c : p), rain7 = sum(next7.map(d => d.rain)), normRain7 = mean(clim.monthly.map(m => m.pr)) / 30 * 7;
    let cards = '';
    cards += insightCard(anom >= 0 ? 'accent-hot' : 'accent-cool', sunSmall(), tr('ins_week'), pm(anom, 1) + '°', tr('ins_week_desc', { dir: anom >= 0 ? tr('dir_above') : tr('dir_below'), norm: tempDeg(avgNorm) }));
    cards += insightCard(peak.overRec ? 'accent-rec' : 'accent-hot', flame('#ff7a45'), tr('ins_peak'), tempDeg(peak.hi), `${fmtWD(peak.date)} ${peak.date.slice(8)}. ${peak.overRec ? tr('ins_peak_break') : peak.nearRec ? tr('ins_peak_near', { rec: tempDeg(clim.rec.hi.v) }) : tr('ins_peak_rec', { rec: tempDeg(clim.rec.hi.v) })}`);
    if (peak.pctHi != null) cards += insightCard('accent-hot', chartGlyph(), tr('ins_rarity'), tr('top_pct', { pct: Math.round(100 - peak.pctHi) || 1 }), tr('ins_rarity_desc'));
    cards += insightCard(rain7 >= normRain7 ? 'accent-cool' : '', rainGlyphBig(), tr('ins_rain7'), fmtP(rain7), tr('ins_rain7_desc', { v: fmtP(normRain7) }));
    $('#history').innerHTML =
      `<div class="insights">${cards}</div>
       <div class="chart-card"><div class="chart-legend">
         <span><span class="lg-sq" style="background:rgba(150,170,200,.35)"></span>${tr('legend_normal')}</span>
         <span><span class="lg-ln" style="border-top:2px solid #ff7a45"></span>${tr('legend_fhigh')}</span>
         <span><span class="lg-ln" style="border-top:2px solid #56a0e8"></span>${tr('legend_flow')}</span></div>
         <div class="chart-wrap"><canvas id="histChart" role="img" aria-label="Forecast vs 10-year normal"></canvas></div></div>
       <div class="records">
         ${recCard(flame('#ff7a45'), tr('rec_hottest'), tempDeg(clim.rec.hi.v), clim.rec.hi.date)}
         ${recCard(snowflake(), tr('rec_coldest'), tempDeg(clim.rec.lo.v), clim.rec.lo.date)}
         ${recCard(rainGlyphBig(), tr('rec_wettest'), fmtP(clim.rec.rain.v), clim.rec.rain.date)}</div>`;
    drawChart(an.slice(0, 14));
  }
  function insightCard(cls, ic, top, big, desc) { return `<div class="insight ${cls}"><div class="i-top">${ic}${top}</div><div class="i-big">${big}</div><div class="i-desc">${esc(desc)}</div></div>`; }
  function recCard(ic, lbl, val, date) { return `<div class="rec"><div class="r-lbl">${ic}${lbl}</div><div class="r-val">${val}</div><div class="r-dt">${date ? fmtDay(date) + ' ' + date.slice(0, 4) : ''}</div></div>`; }
  function sunSmall() { return `<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="5" fill="#FDB813"/></svg>`; }
  function snowflake() { return `<svg viewBox="0 0 24 24" width="16" height="16"><g stroke="#9cc7f0" stroke-width="2" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="4" y1="7" x2="20" y2="17"/><line x1="20" y1="7" x2="4" y2="17"/></g></svg>`; }
  function chartGlyph() { return `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="#ff9f3e" stroke-width="2" stroke-linecap="round"/></svg>`; }
  function rainGlyphBig() { return `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" fill="#56b6f0"/></svg>`; }
  let chart = null;
  function drawChart(days) {
    const ctx = $('#histChart'); if (!ctx || !window.Chart) return;
    const dark = document.documentElement.getAttribute('data-theme') !== 'light', grid = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)', tick = dark ? 'rgba(235,240,250,.7)' : 'rgba(20,30,50,.65)';
    const labels = days.map(d => dnum(d.date).toDateString() === new Date().toDateString() ? tr('now') : shortWD(d.date)), conv = v => v == null ? null : (state.units === 'f' ? v * 9 / 5 + 32 : v);
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels, datasets: [
          { label: 'nLo', data: days.map(d => conv(d.nLo)), borderWidth: 0, pointRadius: 0, fill: false },
          { label: 'Normal range', data: days.map(d => conv(d.nHi)), borderWidth: 0, pointRadius: 0, backgroundColor: dark ? 'rgba(150,170,200,.20)' : 'rgba(120,140,170,.18)', fill: '-1' },
          { label: tr('legend_flow'), data: days.map(d => conv(d.lo)), borderColor: '#56a0e8', borderWidth: 2, tension: .4, pointRadius: 0, fill: false },
          { label: tr('legend_fhigh'), data: days.map(d => conv(d.hi)), borderColor: '#ff7a45', borderWidth: 2.4, tension: .4, pointRadius: 3, pointBackgroundColor: days.map(d => tColor(d.hi)), pointBorderColor: days.map(d => tColor(d.hi)), fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.datasetIndex >= 2 ? c.dataset.label + ': ' + Math.round(c.parsed.y) + '°' : null }, filter: i => i.datasetIndex >= 2 } },
        scales: { y: { grid: { color: grid }, ticks: { color: tick, callback: v => Math.round(v) + '°' } }, x: { grid: { display: false }, ticks: { color: tick, autoSkip: false, maxRotation: 0 } } }
      }
    });
  }

  /* ---------------- rain nowcast (minutely) ---------------- */
  async function getNowcast(loc) {
    const p = new URLSearchParams({ latitude: loc.lat, longitude: loc.lon, minutely_15: 'precipitation', forecast_days: 1, timezone: 'auto' });
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + p); if (!r.ok) throw new Error('nowcast ' + r.status); return r.json();
  }
  function renderNowcast(nc) {
    const el = $('#nowcast'); if (!el) return;
    if (!nc || !nc.minutely_15 || !nc.minutely_15.precipitation) { el.style.display = 'none'; return; }
    const m = nc.minutely_15, now = Date.now(); let s = 0;
    for (let i = 0; i < m.time.length; i++) { if (new Date(m.time[i]).getTime() >= now) { s = i; break; } }
    const win = []; for (let i = s; i < s + 8 && i < m.precipitation.length; i++) win.push({ t: m.time[i], p: m.precipitation[i] == null ? 0 : m.precipitation[i] });
    if (win.length < 2) { el.style.display = 'none'; return; }
    const thr = 0.1, raining = win[0].p >= thr; let msg;
    if (raining) { let stop = -1; for (let i = 1; i < win.length; i++) if (win[i].p < thr) { stop = i; break; } msg = stop === -1 ? tr('nc_continue') : tr('nc_easing', { t: hhmm(win[stop].t), min: stop * 15 }); }
    else { let st = -1; for (let i = 0; i < win.length; i++) if (win[i].p >= thr) { st = i; break; } msg = st === -1 ? tr('nc_norain') : tr('nc_start', { t: hhmm(win[st].t), min: st * 15 || 15 }); }
    const maxP = Math.max(0.5, ...win.map(w => w.p));
    const bars = win.map(w => { const h = Math.max(4, Math.round(w.p / maxP * 100)), col = w.p < thr ? 'rgba(128,144,170,.28)' : w.p < 0.5 ? '#7fc4ee' : w.p < 2 ? '#2f9be0' : '#1f5fa8'; return `<div class="nc-bar"><div class="nc-fill" style="height:${h}%;background:${col}" title="${hhmm(w.t)} · ${fmtP(w.p)}"></div></div>`; }).join('');
    el.style.display = '';
    el.innerHTML = `<div class="nc-head">${raining ? rainGlyphBig() : sunSmall()}<span class="nc-msg">${esc(msg)}</span></div><div class="nc-bars">${bars}</div><div class="nc-ticks"><span>now</span><span>+1 h</span><span>+2 h</span></div>`;
  }

  /* ---------------- warming stripes + climate history ---------------- */
  async function getLongArchive(loc) {
    const key = 'aurora.long.' + loc.lat.toFixed(2) + ',' + loc.lon.toFixed(2);
    try { const c = JSON.parse(localStorage.getItem(key)); if (c && Date.now() - c.ts < 30 * 864e5) return c.data; } catch (e) {}
    const ey = new Date(Date.now() - 6 * 864e5).getFullYear() - 1;
    const p = new URLSearchParams({ latitude: loc.lat, longitude: loc.lon, start_date: '1985-01-01', end_date: ey + '-12-31', daily: 'temperature_2m_mean', timezone: 'auto' });
    const r = await fetch('https://archive-api.open-meteo.com/v1/archive?' + p); if (!r.ok) throw new Error('long ' + r.status);
    const d = await r.json(); try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: d })); } catch (e) {} return d;
  }
  function stripeColor(t) { const st = [[33, 102, 172], [247, 247, 247], [178, 24, 43]], seg = t < 0.5 ? 0 : 1, lt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5, a = st[seg], b = st[seg + 1]; return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * lt) + ',' + Math.round(a[1] + (b[1] - a[1]) * lt) + ',' + Math.round(a[2] + (b[2] - a[2]) * lt) + ')'; }
  function renderStripes(data) {
    const el = $('#stripes'); if (!el || !data || !data.daily) return;
    const t = data.daily.time, mean = data.daily.temperature_2m_mean, byYear = {};
    for (let i = 0; i < t.length; i++) { if (mean[i] == null) continue; const y = t[i].slice(0, 4); (byYear[y] = byYear[y] || []).push(mean[i]); }
    const ann = Object.keys(byYear).sort().map(y => ({ y: +y, m: byYear[y].reduce((s, x) => s + x, 0) / byYear[y].length, n: byYear[y].length })).filter(a => a.n >= 350);
    if (ann.length < 5) { el.innerHTML = ''; return; }
    const lo = Math.min(...ann.map(a => a.m)), hi = Math.max(...ann.map(a => a.m));
    const stripes = ann.map(a => `<div class="stripe" style="background:${stripeColor((a.m - lo) / (hi - lo || 1))}" title="${a.y}: ${tempDeg(a.m)} avg"></div>`).join('');
    const first = ann.slice(0, 10), last = ann.slice(-10), fA = first.reduce((s, a) => s + a.m, 0) / first.length, lA = last.reduce((s, a) => s + a.m, 0) / last.length, warm = lA - fA;
    el.innerHTML = `<div class="stripes-row">${stripes}</div><div class="stripes-axis"><span>${ann[0].y}</span><span>${ann[ann.length - 1].y}</span></div><div class="stripes-cap">${tr('stripes_cap', { warm: pm(warm, 1), trend: warm > 0.7 ? tr('trend_strong') : warm > 0.2 ? tr('trend_warm') : tr('trend_stable') })}</div>`;
  }
  function onThisDay() {
    const c = state.clim; if (!c || !c.t) return '';
    const d = new Date(), md = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let hot = { v: -999 }, wet = { v: -1 };
    for (let i = 0; i < c.t.length; i++) if (c.t[i].slice(5) === md) { if (c.mx[i] != null && c.mx[i] > hot.v) hot = { v: c.mx[i], y: c.t[i].slice(0, 4) }; if (c.pr[i] != null && c.pr[i] > wet.v) wet = { v: c.pr[i], y: c.t[i].slice(0, 4) }; }
    if (hot.v < -900) return '';
    return tr('onthisday', { years: c.years, hot: tempDeg(hot.v), hy: hot.y, wet: fmtP(wet.v), wy: wet.y });
  }
  async function ensureStripes() {
    const el = $('#stripes'); if (!el) return;
    const k = state.loc.lat.toFixed(2) + ',' + state.loc.lon.toFixed(2);
    if (state.stripesLoc === k && el.querySelector('.stripes-row')) return;
    el.innerHTML = '<div class="stripes-loading">' + esc(tr('stripes_loading')) + '</div>';
    try { const d = await getLongArchive(state.loc); state.longData = d; renderStripes(d); const o = $('#onthisday'); if (o) o.textContent = onThisDay(); state.stripesLoc = k; }
    catch (e) { console.warn('stripes failed', e); el.innerHTML = '<div class="stripes-loading">' + esc(tr('stripes_unavail')) + '</div>'; }
  }

  function renderAlerts(alerts) {
    if (!alerts.length) { $('#alerts').innerHTML = `<div class="alert sev-ok"><div class="a-ic"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 13l4 4 10-10" fill="none" stroke="#7bd88f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="a-body"><div class="a-top"><span class="a-title">${tr('no_extremes')}</span></div><div class="a-desc">${tr('no_extremes_desc')}</div></div></div>`; return; }
    $('#alerts').innerHTML = alerts.map(a => `<div class="alert sev-${a.sev}"><div class="a-ic">${a.ic}</div><div class="a-body"><div class="a-top"><span class="a-title">${esc(a.title)}</span><span class="pill">${tr('sev_' + a.sev)}</span><span class="a-when">${a.when}</span></div><div class="a-desc">${esc(a.desc)}</div></div></div>`).join('');
  }

  /* ---------------- notifications ---------------- */
  function notifSig(al) { return al.filter(a => a.sev === 'severe' || a.sev === 'high').map(a => a.type + a.sev + a.when).join('|'); }
  function maybeNotify() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const sig = notifSig(state.alerts); if (!sig) return;
    const k = 'aurora.notified' + keyLoc(); if (localStorage.getItem(k) === sig) return;
    localStorage.setItem(k, sig);
    const top = state.alerts.find(a => a.sev === 'severe') || state.alerts.find(a => a.sev === 'high'); if (!top) return;
    try { const n = new Notification(tr('notif_title', { title: top.title, name: state.loc.name }), { body: top.when + ' — ' + top.desc, tag: 'aurora-' + top.type }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) {}
  }
  function setBell() { const on = ('Notification' in window) && Notification.permission === 'granted'; const b = $('#bellBtn'); if (b) { b.classList.toggle('on', on); b.title = on ? tr('title_bell_on') : tr('title_bell'); } }

  /* ---------------- radar / extreme-weather map ---------------- */
  const COUNTRIES = [
    { code: 'DE', en: 'Germany', de: 'Deutschland', bbox: [47.27, 5.87, 55.06, 15.04] },
    { code: 'AT', en: 'Austria', de: 'Österreich', bbox: [46.37, 9.53, 49.02, 17.16] },
    { code: 'CH', en: 'Switzerland', de: 'Schweiz', bbox: [45.82, 5.96, 47.81, 10.49] },
    { code: 'FR', en: 'France', de: 'Frankreich', bbox: [41.33, -5.14, 51.09, 9.56] },
    { code: 'NL', en: 'Netherlands', de: 'Niederlande', bbox: [50.75, 3.36, 53.55, 7.23] },
    { code: 'BE', en: 'Belgium', de: 'Belgien', bbox: [49.5, 2.55, 51.5, 6.41] },
    { code: 'GB', en: 'United Kingdom', de: 'Vereinigtes Königreich', bbox: [49.9, -8.65, 58.7, 1.76] },
    { code: 'IT', en: 'Italy', de: 'Italien', bbox: [36.6, 6.6, 47.1, 18.5] },
    { code: 'ES', en: 'Spain', de: 'Spanien', bbox: [36.0, -9.3, 43.8, 3.32] },
    { code: 'PL', en: 'Poland', de: 'Polen', bbox: [49.0, 14.12, 54.84, 24.15] },
    { code: 'US', en: 'United States', de: 'USA', bbox: [24.5, -125, 49.4, -66.9] }
  ];
  function countryName(c) { return state.lang === 'de' ? c.de : c.en; }
  const MAPCOLORS = { heat: '#ff6a3d', storm: '#9b7bf2', wind: '#8b97ab', rain: '#2f9be0', snow: '#84c4ff' };
  const MAPORDER = ['heat', 'storm', 'wind', 'rain', 'snow'];

  function distBearing(la1, lo1, la2, lo2) {
    const R = 6371, toR = x => x * Math.PI / 180, dLat = toR(la2 - la1), dLon = toR(lo2 - lo1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLon / 2) ** 2;
    const km = Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
    const y = Math.sin(dLon) * Math.cos(toR(la2)), x = Math.cos(toR(la1)) * Math.sin(toR(la2)) - Math.sin(toR(la1)) * Math.cos(toR(la2)) * Math.cos(dLon);
    const dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(y, x) * 180 / Math.PI + 360) % 360) / 45) % 8];
    return { km, dir };
  }
  function gridNear(la, lo, R) { const step = R / 4, latD = step / 111, lonD = step / (111 * Math.cos(la * Math.PI / 180)), pts = []; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const a = la + dy * latD, b = lo + dx * lonD; if (distBearing(la, lo, a, b).km <= R) pts.push([a, b]); } return pts; }
  function gridCountry(b) { const ny = 11, nx = 13, pts = []; for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) pts.push([b[0] + (b[2] - b[0]) * (i + .5) / ny, b[1] + (b[3] - b[1]) * (j + .5) / nx]); return pts; }
  function radiusZoom(R) { return R <= 25 ? 10 : R <= 50 ? 9 : 8; }
  function baseUrl(dark) { return 'https://{s}.basemaps.cartocdn.com/' + (dark ? 'dark_all' : 'light_all') + '/{z}/{x}/{y}{r}.png'; }
  function addBase() { const dark = document.documentElement.getAttribute('data-theme') !== 'light'; if (state.map.baseLayer) state.map.leaflet.removeLayer(state.map.baseLayer); state.map.baseLayer = L.tileLayer(baseUrl(dark), { attribution: '© OpenStreetMap, © CARTO', subdomains: 'abcd', maxZoom: 18 }).addTo(state.map.leaflet); state.map.baseLayer.bringToBack(); }
  function setMapStatus(t) { const e = $('#mapStatus'); if (e) e.textContent = t; }
  function clearMarkers() { state.map.markers.forEach(m => state.map.leaflet.removeLayer(m)); state.map.markers = []; }
  function clearCenter() { if (state.map.circle) { state.map.leaflet.removeLayer(state.map.circle); state.map.circle = null; } if (state.map.center) { state.map.leaflet.removeLayer(state.map.center); state.map.center = null; } }
  function drawCenter(c, R) { clearCenter(); state.map.circle = L.circle(c, { radius: R * 1000, color: '#86a8ff', weight: 1, fillColor: '#86a8ff', fillOpacity: .05 }).addTo(state.map.leaflet); state.map.center = L.circleMarker(c, { radius: 5, color: '#fff', weight: 2, fillColor: '#86a8ff', fillOpacity: 1 }).addTo(state.map.leaflet).bindPopup(esc(tr('you_here', { name: state.loc.name }))); }
  function detectExtreme(it) {
    if (!it || !it.daily) return null;
    const d = it.daily, c = it.current || {}, mx = a => { const v = a.filter(x => x != null); return v.length ? Math.max(...v) : -Infinity; };
    const tmax = mx([d.temperature_2m_max[0], d.temperature_2m_max[1]]), gust = mx([d.wind_gusts_10m_max[0], d.wind_gusts_10m_max[1], c.wind_gusts_10m]);
    const rain = mx([d.precipitation_sum[0], d.precipitation_sum[1]]), snow = mx([d.snowfall_sum[0], d.snowfall_sum[1]]);
    const codes = [c.weather_code, d.weather_code[0], d.weather_code[1]].filter(x => x != null), cand = [];
    if (codes.some(x => x >= 95)) cand.push({ type: 'storm', sev: codes.some(x => x >= 96) ? 'severe' : 'high', v: 0, rank: 5 });
    if (tmax >= 32) cand.push({ type: 'heat', sev: tmax >= 37 ? 'severe' : tmax >= 35 ? 'high' : 'moderate', v: tmax, rank: 4 });
    if (gust >= 60) cand.push({ type: 'wind', sev: gust >= 90 ? 'severe' : gust >= 75 ? 'high' : 'moderate', v: gust, rank: 3 });
    if (rain >= 25) cand.push({ type: 'rain', sev: rain >= 40 ? 'severe' : 'high', v: rain, rank: 2 });
    if (snow >= 5) cand.push({ type: 'snow', sev: snow >= 15 ? 'high' : 'moderate', v: snow, rank: 1 });
    if (!cand.length) return null;
    const so = { severe: 3, high: 2, moderate: 1 };
    cand.sort((a, b) => so[b.sev] - so[a.sev] || b.rank - a.rank);
    return cand[0];
  }
  async function fetchScan(points) {
    const chunks = []; for (let i = 0; i < points.length; i += 100) chunks.push(points.slice(i, i + 100));
    const all = [];
    await Promise.all(chunks.map(async ch => {
      const lats = ch.map(p => p[0].toFixed(4)).join(','), lons = ch.map(p => p[1].toFixed(4)).join(',');
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats + '&longitude=' + lons + '&current=weather_code,temperature_2m,wind_gusts_10m,precipitation&daily=weather_code,temperature_2m_max,wind_gusts_10m_max,precipitation_sum,snowfall_sum&forecast_days=2&timezone=auto&wind_speed_unit=kmh';
      const r = await fetch(url); if (!r.ok) throw new Error('scan ' + r.status);
      const d = await r.json(), arr = Array.isArray(d) ? d : [d];
      arr.forEach((item, i) => { if (ch[i]) all.push({ lat: ch[i][0], lon: ch[i][1], data: item }); });
    }));
    return all;
  }
  function eventLabel(e) {
    if (e.type === 'storm') return tr('v_storm');
    if (e.type === 'heat') return Math.round(e.v) + '° ' + tr('v_heat');
    if (e.type === 'wind') return Math.round(e.v) + ' km/h ' + tr('v_gusts');
    if (e.type === 'rain') return Math.round(e.v) + ' mm ' + tr('v_rain');
    if (e.type === 'snow') return Math.round(e.v) + ' cm ' + tr('v_snow');
    return '';
  }
  function renderPins(events, center) {
    clearMarkers();
    events.forEach(e => {
      const m = L.circleMarker([e.lat, e.lon], { radius: e.sev === 'severe' ? 9 : e.sev === 'high' ? 7 : 6, color: '#fff', weight: 1, fillColor: MAPCOLORS[e.type] || '#fff', fillOpacity: .92 });
      let pop = '<b>' + eventLabel(e) + '</b><br>' + tr('mc_' + e.type) + ' · ' + tr('sev_' + e.sev);
      if (center) { const db = distBearing(center[0], center[1], e.lat, e.lon); pop += '<br>' + db.km + ' km ' + db.dir; }
      m.bindPopup(pop); m.addTo(state.map.leaflet); state.map.markers.push(m);
    });
    const counts = {}; events.forEach(e => counts[e.type] = (counts[e.type] || 0) + 1);
    const el = $('#mapLegend'); if (el) el.innerHTML = MAPORDER.filter(k => counts[k]).map(k => `<span><span class="dot" style="background:${MAPCOLORS[k]}"></span>${tr('mc_' + k)} (${counts[k]})</span>`).join('');
  }
  async function scanArea() {
    if (!state.map.inited) return;
    setMapStatus(tr('map_scanning'));
    let points, center = null;
    if (state.map.scope === 'near') { center = [state.loc.lat, state.loc.lon]; points = gridNear(center[0], center[1], state.map.radius); drawCenter(center, state.map.radius); state.map.leaflet.setView(center, radiusZoom(state.map.radius)); }
    else { const c = COUNTRIES.find(x => x.code === state.map.country) || COUNTRIES[0]; points = gridCountry(c.bbox); clearCenter(); state.map.leaflet.fitBounds([[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]]); }
    try {
      const results = await fetchScan(points), events = [];
      results.forEach(r => { const e = detectExtreme(r.data); if (e) events.push(Object.assign(e, { lat: r.lat, lon: r.lon })); });
      renderPins(events, center);
      const area = state.map.scope === 'near' ? tr('map_area_near', { r: state.map.radius, name: state.loc.name }) : countryName(COUNTRIES.find(x => x.code === state.map.country) || COUNTRIES[0]);
      setMapStatus(events.length ? tr('map_found', { n: events.length, area }) : tr('map_clear', { area }));
    } catch (e) { console.warn('scan failed', e); setMapStatus(tr('map_failed')); }
  }
  async function loadRadar() { if (state.map.frames.length) return true; try { const r = await fetch('https://api.rainviewer.com/public/weather-maps.json'), d = await r.json(); state.map.radarHost = d.host; state.map.frames = [...(d.radar && d.radar.past || []), ...(d.radar && d.radar.nowcast || [])]; return state.map.frames.length > 0; } catch (e) { return false; } }
  function showFrame(i) { const f = state.map.frames[i]; if (!f) return; if (state.map.radarLayer) state.map.leaflet.removeLayer(state.map.radarLayer); state.map.radarLayer = L.tileLayer(state.map.radarHost + f.path + '/256/{z}/{x}/{y}/2/1_1.png', { opacity: .65, zIndex: 400, maxNativeZoom: 8, maxZoom: 18 }).addTo(state.map.leaflet); state.map.radarIdx = i; const el = $('#radarTime'); if (el) el.textContent = 'Radar ' + new Date(f.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  async function toggleRadar() {
    if (!state.map.inited) initMap();
    state.map.radarOn = !state.map.radarOn; $('#radarToggle').classList.toggle('on', state.map.radarOn);
    if (state.map.radarOn) { const ok = await loadRadar(); if (!ok) { toast(tr('t_radarna')); state.map.radarOn = false; $('#radarToggle').classList.remove('on'); return; } showFrame(state.map.frames.length - 1); $('#radarPlay').style.display = ''; }
    else { if (state.map.radarLayer) { state.map.leaflet.removeLayer(state.map.radarLayer); state.map.radarLayer = null; } stopRadar(); $('#radarPlay').style.display = 'none'; const el = $('#radarTime'); if (el) el.textContent = ''; }
  }
  function playRadar() { if (state.map.radarTimer) { stopRadar(); return; } const p = $('#radarPlay'); if (p) p.textContent = '⏸'; state.map.radarTimer = setInterval(() => showFrame((state.map.radarIdx + 1) % state.map.frames.length), 700); }
  function stopRadar() { if (state.map.radarTimer) { clearInterval(state.map.radarTimer); state.map.radarTimer = null; } const p = $('#radarPlay'); if (p) p.textContent = '▶'; }
  function initMap() { if (state.map.inited || !window.L) return; const m = L.map('map', { scrollWheelZoom: false, zoomControl: true, attributionControl: true }); state.map.leaflet = m; addBase(); m.setView([state.loc.lat, state.loc.lon], 9); state.map.inited = true; setTimeout(() => m.invalidateSize(), 150); scanArea(); }

  /* ---------------- clock + on-this-day fact ---------------- */
  function startClock() {
    const el = $('#clock'); if (!el) return;
    const upd = () => { const n = new Date(); el.textContent = n.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + n.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    upd(); setInterval(upd, 1000);
  }
  async function loadFact() {
    const el = $('#factText'), banner = $('#factBanner'); if (!el) return;
    const wlang = state.lang === 'de' ? 'de' : 'en';
    const now = new Date(), mm = String(now.getMonth() + 1).padStart(2, '0'), dd = String(now.getDate()).padStart(2, '0');
    const dayKey = 'aurora.fact.' + wlang + '.' + now.getFullYear() + '-' + mm + '-' + dd;
    let fact = null;
    try { const c = JSON.parse(localStorage.getItem(dayKey)); if (c && c.text) fact = c; } catch (e) {}
    if (!fact) {
      const pick = arr => arr[(now.getDate() + now.getMonth()) % arr.length];
      try { const r = await fetch('https://' + wlang + '.wikipedia.org/api/rest_v1/feed/onthisday/selected/' + mm + '/' + dd); if (r.ok) { const d = await r.json(); const evs = (d.selected || []).filter(e => e.text && e.year); if (evs.length) { const e = pick(evs); const pg = e.pages && e.pages[0] && e.pages[0].content_urls && e.pages[0].content_urls.desktop && e.pages[0].content_urls.desktop.page; fact = { year: e.year, text: e.text, url: pg || '' }; } } } catch (e) {}
      if (!fact && wlang === 'en') { try { const r = await fetch('https://history.muffinlabs.com/date/' + (now.getMonth() + 1) + '/' + now.getDate()); if (r.ok) { const d = await r.json(); const evs = ((d.data || {}).Events || []).filter(e => e.text && e.year); if (evs.length) { const e = pick(evs); const pg = e.links && e.links[0] && e.links[0].link; fact = { year: e.year, text: e.text, url: pg || '' }; } } } catch (e) {} }
      if (fact) { try { localStorage.setItem(dayKey, JSON.stringify(fact)); } catch (e) {} }
    }
    if (!fact) { if (banner) banner.style.display = 'none'; return; }
    if (banner) banner.style.display = '';
    const link = fact.url ? ' <a href="' + fact.url + '" target="_blank" rel="noopener" class="fact-more">' + tr('fact_more') + '</a>' : '';
    el.innerHTML = '<b>' + tr('fact_pre', { year: fact.year }) + '</b>' + esc(fact.text.replace(/\s*\(pictured\)/gi, '')) + link;
  }

  /* ---------------- orchestration ---------------- */
  function setUpdated() { $('#updated').textContent = tr('updated', { t: new Date().toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' }) }); }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800); }
  function showLoading(on) { $('#loading').classList.toggle('hide', !on); }

  async function load(full = true) {
    try {
      if (full) showLoading(true);
      const fc = await getForecast(state.loc); state.forecast = fc;
      state.capeByDay = {}; const h = fc.hourly;
      for (let i = 0; i < h.time.length; i++) { const d = h.time[i].slice(0, 10), c = h.cape ? h.cape[i] : null; if (c != null && (!(d in state.capeByDay) || c > state.capeByDay[d])) state.capeByDay[d] = c; }
      if (!state.clim) { try { state.clim = buildClim(await getArchive(state.loc)); } catch (e) { console.warn('archive failed', e); state.clim = null; } }
      const fallback = { mx: null, mn: null, pr: null, D: [], rec: { hi: { v: 99 }, lo: { v: -99 }, rain: { v: 99 } }, monthly: Array.from({ length: 12 }, (_, m) => ({ month: m, pr: 0 })), years: 0 };
      state.analysis = analyze(fc, state.clim || fallback);
      const cape = {}; state.analysis.forEach(a => cape[a.date] = state.capeByDay[a.date] || 0); state.capeByDate = cape;
      const [air, nc] = await Promise.all([getAir(state.loc).catch(() => null), getNowcast(state.loc).catch(() => null)]);
      state.air = air; state.nowcast = nc;

      renderHero(fc, state.analysis);
      renderDetails(fc, state.analysis);
      renderNowcast(state.nowcast);
      renderHourly(fc); renderHourlyChart();
      renderAir(state.air);
      renderDaily(state.analysis, cape);
      if (state.clim) renderHistory(fc, state.analysis, state.clim); else $('#history').innerHTML = '<div class="chart-card">Historical data unavailable for this location.</div>';
      ensureStripes();
      state.alerts = buildAlerts(state.analysis, state.clim || fallback, cape);
      renderAlerts(state.alerts);
      renderFaves();
      maybeNotify();
      setUpdated(); showLoading(false);
    } catch (e) {
      console.error(e); showLoading(false); toast(tr('t_loadfail'));
      $('#hero').innerHTML = `<div style="padding:10px"><div class="hero-cond">${tr('err_loaded')}</div><div class="hero-feels">${esc(e.message)} — <a href="#" id="retry">retry</a></div></div>`;
      const r = $('#retry'); if (r) r.onclick = ev => { ev.preventDefault(); load(true); };
    }
  }
  function setLocation(loc) { state.loc = loc; localStorage.setItem(LS.loc, JSON.stringify(loc)); state.clim = null; closeSearch(); $('#searchInput').value = ''; load(true); if (state.map.inited && state.map.scope === 'near') scanArea(); }
  function reRender() { if (!state.forecast) return; renderHero(state.forecast, state.analysis); renderDetails(state.forecast, state.analysis); renderNowcast(state.nowcast); renderHourly(state.forecast); renderHourlyChart(); renderAir(state.air); renderDaily(state.analysis, state.capeByDate); if (state.clim) renderHistory(state.forecast, state.analysis, state.clim); if (state.longData) { renderStripes(state.longData); const o = $('#onthisday'); if (o) o.textContent = onThisDay(); } state.alerts = buildAlerts(state.analysis, state.clim || { rec: { hi: { v: 99 }, lo: { v: -99 }, rain: { v: 99 } } }, state.capeByDate); renderAlerts(state.alerts); }

  /* ---------------- events ---------------- */
  let searchT = null, results = [];
  function closeSearch() { $('#searchResults').classList.remove('open'); }
  $('#searchInput').addEventListener('input', e => {
    const q = e.target.value.trim(); clearTimeout(searchT);
    if (q.length < 2) { closeSearch(); return; }
    searchT = setTimeout(async () => {
      results = await geocode(q); const box = $('#searchResults');
      if (!results.length) { box.innerHTML = '<div class="sr-item">' + tr('no_matches') + '</div>'; box.classList.add('open'); return; }
      box.innerHTML = results.map((r, i) => `<div class="sr-item" data-i="${i}"><span class="sr-name">${esc(r.name)}</span><span class="sr-meta">${esc([r.admin1, r.country].filter(Boolean).join(', '))}</span></div>`).join('');
      box.classList.add('open');
      box.querySelectorAll('.sr-item').forEach(el => el.addEventListener('click', () => { const r = results[+el.dataset.i]; setLocation({ name: r.name, admin1: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude }); }));
    }, 280);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) closeSearch(); });
  $('#daily').addEventListener('click', e => { const row = e.target.closest('.drow'); if (row) toggleDay(+row.dataset.i, row); });
  $('#daily').addEventListener('keydown', e => { const row = e.target.closest('.drow'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleDay(+row.dataset.i, row); } });
  $('#hourlyToggle').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (!b) return; state.hourlyMetric = b.dataset.m; [...$('#hourlyToggle').children].forEach(x => x.classList.toggle('active', x === b)); renderHourlyChart(); });
  $('#faves').addEventListener('click', e => {
    const rm = e.target.closest('.fc-rm');
    if (rm) { state.faves.splice(+rm.dataset.i, 1); saveFaves(); renderFaves(); const st = $('#faveStar'); if (st) st.classList.toggle('on', isFave(state.loc)); return; }
    const go = e.target.closest('.fc-go');
    if (go) { const f = state.faves[+go.dataset.i]; if (f) setLocation({ name: f.name, admin1: f.admin1, country: f.country, lat: f.lat, lon: f.lon }); }
  });
  $('#hero').addEventListener('click', e => { if (e.target.closest('#faveStar')) toggleFave(); });
  $('#scopeToggle').addEventListener('click', e => { const b = e.target.closest('button[data-scope]'); if (!b) return; state.map.scope = b.dataset.scope; [...$('#scopeToggle').children].forEach(x => x.classList.toggle('active', x === b)); $('#radiusChips').style.display = state.map.scope === 'near' ? '' : 'none'; $('#countrySel').style.display = state.map.scope === 'country' ? '' : 'none'; state.map.inited ? scanArea() : initMap(); });
  $('#radiusChips').addEventListener('click', e => { const b = e.target.closest('button[data-r]'); if (!b) return; state.map.radius = +b.dataset.r; [...$('#radiusChips').children].forEach(x => x.classList.toggle('active', x === b)); state.map.inited ? scanArea() : initMap(); });
  $('#countrySel').addEventListener('change', e => { state.map.country = e.target.value; state.map.inited ? scanArea() : initMap(); });
  $('#radarToggle').addEventListener('click', toggleRadar);
  $('#radarPlay').addEventListener('click', playRadar);

  $('#geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { toast(tr('t_geona')); return; } toast(tr('t_locating'));
    navigator.geolocation.getCurrentPosition(p => setLocation({ name: state.lang === 'de' ? 'Mein Standort' : 'My location', admin1: '', country: '', lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }), () => toast(tr('t_geodenied')));
  });
  $('#unitBtn').addEventListener('click', () => { state.units = state.units === 'c' ? 'f' : 'c'; localStorage.setItem(LS.units, state.units); $('#unitBtn').textContent = state.units === 'c' ? '°C' : '°F'; reRender(); });
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t); localStorage.setItem(LS.theme, t);
    $('#themeIcon').innerHTML = t === 'light' ? '<circle cx="12" cy="12" r="5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="6.5" y2="6.5"/><line x1="17.5" y1="17.5" x2="19" y2="19"/><line x1="5" y1="19" x2="6.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="19" y2="5"/></g>' : '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor"/>';
    if (state.forecast) { renderHourlyChart(); if (state.clim) drawChart(state.analysis.slice(0, 14)); }
    if (state.map.inited) addBase();
  }
  $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
  $('#refreshBtn').addEventListener('click', () => { toast(tr('t_refreshing')); load(false); });
  $('#langBtn').addEventListener('click', () => { state.lang = state.lang === 'de' ? 'en' : 'de'; localStorage.setItem('aurora.lang', state.lang); applyStaticI18n(); reRender(); loadFact(); setBell(); setUpdated(); if (state.map.inited) scanArea(); });
  $('#bellBtn').addEventListener('click', async () => {
    if (!('Notification' in window)) { toast('Notifications not supported here'); return; }
    if (Notification.permission === 'denied') { toast('Alerts are blocked in your browser settings'); return; }
    if (Notification.permission === 'granted') { toast('Extreme-weather alerts are on'); localStorage.removeItem('aurora.notified' + keyLoc()); maybeNotify(); setBell(); return; }
    const p = await Notification.requestPermission(); setBell();
    if (p === 'granted') { toast('Extreme-weather alerts enabled'); localStorage.removeItem('aurora.notified' + keyLoc()); maybeNotify(); } else toast('Notification permission not granted');
  });

  /* ---------------- init ---------------- */
  (function init() {
    applyTheme(localStorage.getItem(LS.theme) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
    applyStaticI18n();
    $('#unitBtn').textContent = state.units === 'c' ? '°C' : '°F';
    setBell();
    renderFaves();
    startClock();
    loadFact();
    load(true);
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => load(false), 15 * 60 * 1000);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
    const mapEl = $('#map');
    if (mapEl) {
      if (window.IntersectionObserver) { const mo = new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting) { initMap(); mo.disconnect(); } }); }, { rootMargin: '300px' }); mo.observe(mapEl); }
      window.addEventListener('scroll', () => initMap(), { once: true, passive: true });
      window.addEventListener('resize', () => { if (state.map.leaflet) state.map.leaflet.invalidateSize(); });
    }
  })();
})();
