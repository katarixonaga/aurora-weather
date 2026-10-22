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
    forecast: null, air: null, aurora: null, water: null, clim: null, analysis: null, stormByDay: {}, stormByDate: {}, nowcast: null, longData: null, stripesLoc: null,
    ens: null, dwd: null, meteoH: 48, tab: 'today',
    alerts: [], hourlyMetric: 'temp', faves: loadFaves(), timer: null, lastGood: null,
    map: { inited: false, leaflet: null, baseLayer: null, radarLayer: null, markers: [], center: null, circle: null, scope: 'near', radius: 50, country: 'DE', radarOn: false, frames: [], radarHost: '', radarIdx: 0, radarTimer: null }
  };
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') window.__aurora = state;

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
  function fmtW(k) { if (k == null || isNaN(k)) return '–'; return Math.round(convW(k)) + ' ' + windU(); }
  function convP(mm) { return state.units === 'f' ? mm / 25.4 : mm; }
  function precU() { return state.units === 'f' ? 'in' : 'mm'; }
  function fmtP(mm) { if (mm == null || isNaN(mm)) return '–'; const v = convP(mm); return (state.units === 'f' ? nf(v, 2) : nf(v, 1)) + ' ' + precU(); }
  function tempDeg(c) { if (c == null || isNaN(c)) return '–'; return state.units === 'f' ? Math.round(c * 9 / 5 + 32) + '°F' : Math.round(c) + '°C'; }
  function pct01(v) { return (v == null || isNaN(v)) ? '–' : Math.max(0, Math.min(100, Math.round(v))) + '%'; }
  function iUnit(v, u) { return (v == null || isNaN(v)) ? '–' : Math.round(v) + u; }
  function dnum(ds) { return new Date(ds + 'T12:00:00'); }
  function fmtDay(ds) { return dnum(ds).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtWD(ds) { const d = dnum(ds); if (d.toDateString() === new Date().toDateString()) return tr('today'); return d.toLocaleDateString(LOCALE(), { weekday: 'short' }); }
  function shortWD(ds) { return dnum(ds).toLocaleDateString(LOCALE(), { weekday: 'short' }); }
  function mdShort(ds) { return dnum(ds).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' }); }
  function doy(ds) { const d = new Date(ds + 'T00:00:00Z'); return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5); }
  function compass(deg) { if (deg == null || isNaN(deg)) return '–'; const en = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'], de = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']; return (state.lang === 'de' ? de : en)[Math.round(deg / 22.5) % 16]; }
  function tColor(t) { if (t >= 36) return '#e23b3b'; if (t >= 33) return '#ff7a45'; if (t >= 30) return '#ff9f3e'; if (t >= 26) return '#ffc24a'; if (t >= 22) return '#7bd88f'; if (t >= 17) return '#3fc1c9'; if (t >= 10) return '#56a0e8'; if (t >= 2) return '#5a82d8'; return '#7d6bdc'; }
  function uvWord(u) { return u == null ? '–' : u < 3 ? tr('uv_low') : u < 6 ? tr('uv_mod') : u < 8 ? tr('uv_high') : u < 11 ? tr('uv_vhigh') : tr('uv_extreme'); }
  function dispCode(code, temp) { if (temp != null && temp > 4 && ((code >= 71 && code <= 77) || code === 85 || code === 86 || code === 66 || code === 67 || code === 56 || code === 57)) return 61; return code; }
  function clampGust(g, w) { return (g != null && w != null && g < w) ? w : g; }
  function saneFeel(app, temp) { return (app != null && temp != null && Math.abs(app - temp) > 25) ? null : app; }
  function hhmm(iso) { if (!iso) return '–'; const d = new Date(iso); return isNaN(d.getTime()) ? '–' : d.toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' }); }
  function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function safeHttpUrl(u) { try { const p = new URL(u); return (p.protocol === 'https:' || p.protocol === 'http:') ? u : ''; } catch (e) { return ''; } }
  function keyLoc() { return '.' + state.loc.lat.toFixed(2) + ',' + state.loc.lon.toFixed(2); }
  function bulkShear(s10, d10, s500, d500) { const R = Math.PI / 180, a = (s10 || 0) / 3.6, b = (s500 || 0) / 3.6, u1 = -a * Math.sin((d10 || 0) * R), v1 = -a * Math.cos((d10 || 0) * R), u2 = -b * Math.sin((d500 || 0) * R), v2 = -b * Math.cos((d500 || 0) * R); return Math.sqrt((u2 - u1) ** 2 + (v2 - v1) ** 2); }
  function geomagLat(lat, lon) { const R = Math.PI / 180, pl = 80.65 * R, po = -72.68 * R, la = lat * R, lo = lon * R, s = Math.sin(la) * Math.sin(pl) + Math.cos(la) * Math.cos(pl) * Math.cos(lo - po); return Math.asin(Math.max(-1, Math.min(1, s))) / R; }
  function sunAltDeg(lat, lon, when) {
    const rad = Math.PI / 180, jd = (when ? when.getTime() : Date.now()) / 86400000 + 2440587.5, n = jd - 2451545.0;
    const L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad, lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, eps = 23.439 * rad;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam)), ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    const gmst = (18.697374558 + 24.06570982441908 * n) % 24, lst = ((gmst * 15 + lon) % 360) * rad, ha = lst - ra;
    return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
  }
  function localHM(ms, off) { return new Date(ms + off * 1000).toISOString().slice(11, 16); }
  function findAlt(lat, lon, fromMs, dir, target, below) { for (let m = 1; m <= 720; m++) { const t = fromMs + dir * m * 60000, alt = sunAltDeg(lat, lon, new Date(t)); if (below ? alt <= target : alt >= target) return t; } return null; }
  function moonPhase(when) { const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14, 0) / 86400000, now = (when ? when.getTime() : Date.now()) / 86400000; let age = (now - ref) % syn; if (age < 0) age += syn; const frac = age / syn; return { frac, illum: (1 - Math.cos(2 * Math.PI * frac)) / 2 }; }

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
  function skyGradient(code, isDay, temp) {
    const cat = codeCat(code); let g;
    if (cat === 'storm') g = isDay ? 'linear-gradient(160deg,#3b4a64,#283349 55%,#1a2030)' : 'linear-gradient(160deg,#232b40,#161a2b 60%,#0c0e18)';
    else if (cat === 'snow') g = isDay ? 'linear-gradient(160deg,#9fb1cc,#7d92b2 60%,#566980)' : 'linear-gradient(160deg,#2b3654,#1d2742 60%,#11172a)';
    else if (cat === 'rain' || cat === 'drizzle' || cat === 'sleet') g = isDay ? 'linear-gradient(160deg,#5d7693,#41566f 60%,#2c3a50)' : 'linear-gradient(160deg,#232f48,#171f33 60%,#0d121f)';
    else if (cat === 'fog' || cat === 'cloud') g = isDay ? 'linear-gradient(160deg,#7e93b0,#5f7591 60%,#45576f)' : 'linear-gradient(160deg,#262f47,#1a2238 60%,#0f1525)';
    else if (isDay) { g = temp >= 32 ? 'linear-gradient(160deg,#ff9a52,#ff6f43 45%,#e0496c)' : temp >= 24 ? 'linear-gradient(160deg,#4ea6ff,#3577d8 55%,#2b58ad)' : temp >= 12 ? 'linear-gradient(160deg,#56bdf0,#3f8fd0 55%,#3a64ac)' : 'linear-gradient(160deg,#7fc4e8,#5a92d4 55%,#5566c8)'; }
    else g = 'linear-gradient(160deg,#1d2a5a,#152043 55%,#0b1026)';
    return g;
  }
  function setBg(code, isDay, temp) {
    $('#bg').style.background = skyGradient(code, isDay, temp);
    const cat = codeCat(code), tm = document.querySelector('meta[name=theme-color]'); if (tm) tm.content = (isDay && (cat === 'clear' || cat === 'partly') && temp >= 24) ? '#11203a' : '#0b1220';
  }
  const sky = { canvas: null, ctx: null, raf: null, w: 0, h: 0, dpr: 1, parts: [], aurora: false, t: 0 };
  function skyResize() { const c = sky.canvas; if (!c) return; let w = c.clientWidth, h = c.clientHeight; if ((w < 40 || h < 40) && c.parentElement) { w = c.parentElement.clientWidth || w; h = c.parentElement.clientHeight || h; } sky.dpr = Math.min(2, window.devicePixelRatio || 1); sky.w = w; sky.h = h; c.width = Math.max(1, Math.round(w * sky.dpr)); c.height = Math.max(1, Math.round(h * sky.dpr)); sky.ctx.setTransform(sky.dpr, 0, 0, sky.dpr, 0, 0); }
  function skyBuild(cat, isDay) {
    const W = sky.w || 600, H = sky.h || 220, P = [], rnd = (a, b) => a + Math.random() * (b - a);
    if ((cat === 'clear' || cat === 'partly') && !isDay) for (let i = 0; i < 46; i++) P.push({ k: 'star', x: rnd(0, W), y: rnd(0, H * 0.75), r: rnd(.5, 1.5), tw: rnd(0, 6.28) });
    if (cat === 'cloud' || cat === 'fog' || cat === 'partly' || cat === 'rain' || cat === 'drizzle' || cat === 'snow' || cat === 'sleet' || cat === 'storm') { const n = cat === 'partly' ? 2 : 4; for (let i = 0; i < n; i++) P.push({ k: 'cloud', x: rnd(0, W), y: rnd(8, H * 0.5), s: rnd(.7, 1.4), v: rnd(3, 9) / 100 }); }
    if (cat === 'rain' || cat === 'drizzle' || cat === 'storm' || cat === 'sleet') { const n = cat === 'drizzle' ? 38 : 68; for (let i = 0; i < n; i++) P.push({ k: 'rain', x: rnd(0, W), y: rnd(0, H), len: rnd(7, 14), v: rnd(3.2, 6) }); }
    if (cat === 'snow' || cat === 'sleet') for (let i = 0; i < 38; i++) P.push({ k: 'snow', x: rnd(0, W), y: rnd(0, H), r: rnd(1, 2.6), v: rnd(.4, 1.1), dr: rnd(-.3, .3) });
    sky.parts = P;
  }
  function skyCloud(ctx, x, y, s) { ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.beginPath(); ctx.ellipse(x, y, 40 * s, 16 * s, 0, 0, 6.28); ctx.fill(); ctx.beginPath(); ctx.ellipse(x + 24 * s, y + 5 * s, 27 * s, 12 * s, 0, 0, 6.28); ctx.fill(); ctx.beginPath(); ctx.ellipse(x - 24 * s, y + 5 * s, 25 * s, 11 * s, 0, 0, 6.28); ctx.fill(); }
  function skyAurora(ctx, W, H, t) { ctx.save(); ctx.globalCompositeOperation = 'screen'; for (let b = 0; b < 3; b++) { const hue = b === 0 ? '94,242,176' : b === 1 ? '110,200,255' : '160,120,255', grad = ctx.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(' + hue + ',0)'); grad.addColorStop(.5, 'rgba(' + hue + ',' + (0.2 - b * 0.04).toFixed(2) + ')'); grad.addColorStop(1, 'rgba(' + hue + ',0)'); ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x <= W; x += 12) { const y = H * 0.22 + Math.sin(x * 0.015 + t * 0.6 + b * 1.7) * 16 + Math.sin(x * 0.006 + t * 0.3) * 22 + b * 12; ctx.lineTo(x, y); } ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); } ctx.restore(); }
  function skyDraw(ts) {
    const ctx = sky.ctx, W = sky.w, H = sky.h; if (!ctx) return; ctx.clearRect(0, 0, W, H); sky.t = ts / 1000;
    if (sky.aurora) skyAurora(ctx, W, H, sky.t);
    for (const p of sky.parts) {
      if (p.k === 'star') { const a = .35 + .55 * Math.abs(Math.sin(sky.t * 1.4 + p.tw)); ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); }
      else if (p.k === 'cloud') { p.x += p.v; if (p.x - 70 * p.s > W) p.x = -70 * p.s; skyCloud(ctx, p.x, p.y, p.s); }
      else if (p.k === 'rain') { p.y += p.v; p.x -= p.v * .28; if (p.y > H) { p.y = -p.len; p.x = Math.random() * W; } ctx.strokeStyle = 'rgba(160,195,235,.5)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.v * .28, p.y + p.len); ctx.stroke(); }
      else if (p.k === 'snow') { p.y += p.v; p.x += Math.sin(sky.t + p.y * .05) * p.dr; if (p.y > H) { p.y = -3; p.x = Math.random() * W; } ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); }
    }
  }
  function skyInit(cat, isDay, auroraOn) {
    const c = $('#skyHero'); if (!c || !c.getContext) return; sky.canvas = c; sky.ctx = c.getContext('2d'); sky.aurora = auroraOn; sky.cat = cat; sky.isDay = isDay;
    if (sky.raf) { cancelAnimationFrame(sky.raf); sky.raf = null; }
    const setup = () => { skyResize(); skyBuild(cat, isDay); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { requestAnimationFrame(() => { setup(); skyDraw(0); }); return; }
    let ready = false;
    const loop = ts => { sky.raf = requestAnimationFrame(loop); if (document.hidden) return; if (!ready) { setup(); ready = true; } skyDraw(ts); };
    sky.raf = requestAnimationFrame(loop);
  }

  /* ---------------- data ---------------- */
  async function getForecast(loc) {
    const p = new URLSearchParams({
      latitude: loc.lat, longitude: loc.lon,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index',
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_gusts_10m,is_day,cape,convective_inhibition,wind_speed_10m,wind_direction_10m,wind_speed_500hPa,wind_direction_500hPa,uv_index,shortwave_radiation,dew_point_2m,visibility',
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
  async function getAurora(loc) {
    const r = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json');
    if (!r.ok) throw new Error('kp ' + r.status);
    const a = await r.json(); if (!Array.isArray(a)) throw new Error('kp shape');
    let obs = null, maxPred = null;
    for (const row of a) { if (!row || row.kp == null) continue; const kp = +row.kp; if (row.observed === 'observed') obs = { kp, t: row.time_tag }; else if (row.observed === 'predicted' && (maxPred == null || kp > maxPred)) maxPred = kp; }
    return { kpNow: obs ? obs.kp : null, kpTime: obs ? obs.t : null, kpMax: maxPred };
  }
  async function getWater(loc) {
    const out = { wave: null, wavePeriod: null, river: null, riverPct: null };
    const [m, f] = await Promise.allSettled([
      fetch('https://marine-api.open-meteo.com/v1/marine?' + new URLSearchParams({ latitude: loc.lat, longitude: loc.lon, current: 'wave_height,wave_period' })).then(r => r.ok ? r.json() : null),
      fetch('https://flood-api.open-meteo.com/v1/flood?' + new URLSearchParams({ latitude: loc.lat, longitude: loc.lon, daily: 'river_discharge', past_days: 30, forecast_days: 1 })).then(r => r.ok ? r.json() : null)
    ]);
    if (m.status === 'fulfilled' && m.value && m.value.current) { const wv = m.value.current.wave_height; if (wv != null && wv > 0) { out.wave = wv; out.wavePeriod = m.value.current.wave_period; } }
    if (f.status === 'fulfilled' && f.value && f.value.daily && f.value.daily.river_discharge) { const arr = f.value.daily.river_discharge.filter(x => x != null); if (arr.length >= 10) { const cur = arr[arr.length - 1]; out.river = cur; out.riverPct = Math.round(pctl(arr, cur)); } }
    return out;
  }
  async function getDwd(loc) {
    try {
      const r = await fetch('https://api.brightsky.dev/alerts?' + new URLSearchParams({ lat: loc.lat, lon: loc.lon }));
      if (!r.ok) return { covered: false };
      const d = await r.json();
      return { covered: true, alerts: (d.alerts || []), place: d.location || null };
    } catch (e) { return null; }
  }
  function ensPct(a, p) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); }
  async function getEnsemble(loc) {
    try {
      const r = await fetch('https://ensemble-api.open-meteo.com/v1/ensemble?' + new URLSearchParams({ latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: 14, daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum', models: 'icon_seamless,ecmwf_ifs025,gfs_seamless' }));
      if (!r.ok) return null;
      const d = await r.json(); if (!d.daily || !d.daily.time) return null;
      const ks = pfx => Object.keys(d.daily).filter(x => x.indexOf(pfx) === 0), hk = ks('temperature_2m_max'), lk = ks('temperature_2m_min'), pk = ks('precipitation_sum');
      const by = {};
      d.daily.time.forEach((t, i) => {
        const hv = hk.map(k => d.daily[k][i]).filter(v => v != null), lv = lk.map(k => d.daily[k][i]).filter(v => v != null), pv = pk.map(k => d.daily[k][i]).filter(v => v != null);
        if (hv.length < 6) return;
        by[t] = { hi10: ensPct(hv, .1), hi50: ensPct(hv, .5), hi90: ensPct(hv, .9), lo10: ensPct(lv, .1), lo50: ensPct(lv, .5), lo90: ensPct(lv, .9), wet: Math.round(100 * pv.filter(v => v >= 1).length / (pv.length || 1)), n: hv.length };
      });
      return { by, members: hk.length };
    } catch (e) { return null; }
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
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=8&language=' + (state.lang === 'de' ? 'de' : 'en') + '&format=json');
    if (!r.ok) return []; const d = await r.json(); return (d.results || []).sort((a, b) => (b.population || 0) - (a.population || 0));
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
    if (rec.hi.v === -1e9) rec.hi = null; if (rec.lo.v === 1e9) rec.lo = null; if (rec.rain.v === -1) rec.rain = null;
    const mo = Array.from({ length: 12 }, () => ({ pr: [] })), yrs = new Set(t.map(s => s.slice(0, 4)));
    for (let i = 0; i < n; i++) { const m = +t[i].slice(5, 7) - 1; if (pr[i] != null) mo[m].pr.push(pr[i]); }
    const monthly = mo.map((o, m) => ({ month: m, pr: sum(o.pr) / yrs.size }));
    const nHi = mx.filter(x => x != null).length, nLo = mn.filter(x => x != null).length, nRain = pr.filter(x => x != null).length, thin = yrs.size < 8 || nHi < 3000;
    return { t, mx, mn, pr, D, rec, monthly, years: yrs.size, nHi, nLo, nRain, thin };
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
        anomHi: nHi == null ? 0 : hi - nHi, anomLo: nLo == null ? 0 : lo - nLo, pctHi: hiArr.length >= 30 ? pctl(hiArr, hi) : null,
        rain: d.precipitation_sum[i], prob: d.precipitation_probability_max[i], gust: d.wind_gusts_10m_max[i],
        snow: d.snowfall_sum[i], uv: d.uv_index_max[i], sunrise: d.sunrise[i], sunset: d.sunset[i],
        nearRec: !!(clim.rec && clim.rec.hi && !clim.thin && hi != null && hi >= clim.rec.hi.v - 1), overRec: !!(clim.rec && clim.rec.hi && !clim.thin && hi != null && hi >= clim.rec.hi.v)
      };
    });
  }

  /* ---------------- alerts ---------------- */
  function isContiguous(days) { for (let i = 1; i < days.length; i++) { if (Math.round((dnum(days[i].date) - dnum(days[i - 1].date)) / 864e5) !== 1) return false; } return true; }
  function rangeStr(days, pk) { if (days.length === 1) return fmtDay(days[0].date); if (isContiguous(days)) return fmtDay(days[0].date) + '–' + fmtDay(days[days.length - 1].date); return tr('al_when_days', { n: days.length, day: pk ? fmtDay(pk.date) : fmtDay(days[0].date) }); }
  function stormLevel(cape, cin, shear, code) {
    if (code >= 96) return 'severe';
    if (code >= 95) return 'high';
    if (cape < 500) return null;
    if (cin > 200) return cape >= 2500 ? 'moderate' : null;
    const capped = cin > 75;
    if (cape < 1500 && capped) return null;
    let level = cape >= 2500 ? 'high' : 'moderate';
    const bump = l => l === 'high' ? 'severe' : l === 'moderate' ? 'high' : l, unbump = l => l === 'severe' ? 'high' : l === 'high' ? 'moderate' : l;
    if (shear >= 20 && cape >= 2000 && !capped) level = 'severe';
    else if (shear >= 18 && cape >= 1500) level = bump(level);
    if (capped) level = unbump(level);
    return level;
  }
  function buildAlerts(an, clim, sb) {
    const A = [], rec = clim.rec || { hi: { v: 99 }, rain: { v: 99 } };
    const heat = an.filter(a => a.hi >= 30 && (a.hi >= 32 || a.anomHi >= 8));
    if (heat.length) {
      const pk = heat.reduce((p, c) => c.hi > p.hi ? c : p), sev = pk.overRec || pk.hi >= 37 ? 'severe' : pk.hi >= 35 ? 'high' : 'moderate';
      const extra = pk.overRec ? tr('al_heat_break', { rec: tempDeg(rec.hi.v) }) : pk.nearRec ? tr('al_heat_near', { rec: tempDeg(rec.hi.v) }) : (pk.pctHi != null && pk.pctHi >= 97) ? tr('al_heat_pct', { pct: Math.round(pk.pctHi) }) : '';
      A.push({ type: 'heat', sev, title: heat.length > 1 ? tr('al_heatwave') : tr('al_extremeheat'), when: rangeStr(heat, pk), desc: tr('al_heat_desc', { t: tempDeg(pk.hi), day: fmtDay(pk.date), anom: pm(pk.anomHi), norm: tempDeg(pk.nHi), extra }), ic: icon(0, true, false) });
    }
    const storm = an.filter(a => a.code >= 95 || (sb[a.date] && stormLevel(sb[a.date].cape, sb[a.date].cin, sb[a.date].shear, a.code)));
    if (storm.length) {
      const pk = storm.reduce((p, c) => { const cc = (sb[c.date] && sb[c.date].cape) || 0, cpv = (sb[p.date] && sb[p.date].cape) || 0; return cc !== cpv ? (cc > cpv ? c : p) : ((c.code || 0) > (p.code || 0) ? c : p); });
      const s = sb[pk.date] || { cape: 0, cin: 0, shear: 0 }, cp = Math.round(s.cape), sev = stormLevel(s.cape, s.cin, s.shear, pk.code) || 'moderate';
      let extra = '';
      if (cp >= 300) { const cap = s.cin > 200 ? tr('al_storm_cap_strong') : s.cin > 75 ? tr('al_storm_cap_mod') : tr('al_storm_cap_weak'); const shear = s.shear >= 15 ? tr('al_storm_shear', { s: Math.round(s.shear), org: s.shear >= 18 && s.cape >= 1500 }) : ''; extra = tr('al_storm_cape', { cape: cp, cap, shear, fuel: cp >= 2000 ? tr('al_storm_fuel') : '' }); }
      A.push({ type: 'storm', sev, title: tr('al_storms'), when: rangeStr(storm, pk), desc: tr('al_storm_desc', { day: fmtDay(pk.date), extra }), ic: icon(95, true, false) });
    }
    const wet = an.filter(a => a.rain >= 25);
    if (wet.length) {
      const pk = wet.reduce((p, c) => c.rain > p.rain ? c : p), near = (rec.rain && !clim.thin && pk.rain >= rec.rain.v * 0.6) ? tr('al_rain_near', { rec: fmtP(rec.rain.v) }) : '';
      A.push({ type: 'rain', sev: pk.rain >= 40 ? 'severe' : 'high', title: tr('al_rain'), when: rangeStr(wet, pk), desc: tr('al_rain_desc', { mm: fmtP(pk.rain), day: fmtDay(pk.date), extra: near }), ic: icon(63, true, false) });
    }
    const windy = an.filter(a => a.gust >= 75);
    if (windy.length) { const pk = windy.reduce((p, c) => c.gust > p.gust ? c : p); A.push({ type: 'wind', sev: pk.gust >= 95 ? 'severe' : 'high', title: tr('al_wind'), when: rangeStr(windy, pk), desc: tr('al_wind_desc', { g: fmtW(pk.gust), day: fmtDay(pk.date) }), ic: icon(3, true, false) }); }
    const cold = an.filter(a => a.lo <= -8 || a.anomLo <= -9);
    if (cold.length) { const pk = cold.reduce((p, c) => c.lo < p.lo ? c : p); A.push({ type: 'cold', sev: pk.lo <= -12 ? 'high' : 'moderate', title: tr('al_frost'), when: rangeStr(cold, pk), desc: tr('al_cold_desc', { t: tempDeg(pk.lo), day: fmtDay(pk.date), anom: pm(pk.anomLo) }), ic: icon(71, true, false) }); }
    const snow = an.filter(a => a.snow >= 5);
    if (snow.length) { const pk = snow.reduce((p, c) => c.snow > p.snow ? c : p); A.push({ type: 'snow', sev: pk.snow >= 15 ? 'high' : 'moderate', title: tr('al_snow'), when: rangeStr(snow, pk), desc: tr('al_snow_desc', { cm: round(pk.snow, 1), day: fmtDay(pk.date) }), ic: icon(75, true, false) }); }
    const order = { severe: 0, high: 1, moderate: 2 };
    return A.sort((a, b) => order[a.sev] - order[b.sev]);
  }

  /* ---------------- render ---------------- */
  function heroStrip(fc) {
    const c = fc.current, h = fc.hourly, cells = [];
    const uv = c.uv_index; cells.push({ lbl: tr('uv'), val: nf(uv, 1), tone: uv == null ? '' : uv >= 6 ? 'bad' : uv >= 3 ? 'warn' : 'good' });
    const g = clampGust(c.wind_gusts_10m, c.wind_speed_10m); cells.push({ lbl: tr('wind'), val: fmtW(g), tone: g == null ? '' : g >= 60 ? 'bad' : g >= 35 ? 'warn' : 'good' });
    let hci = 0, pmax = 0; if (h && h.time) { for (let i = 0; i < h.time.length; i++) { if (h.time[i] >= c.time) { hci = i; break; } } for (let i = hci; i < hci + 2 && i < h.precipitation_probability.length; i++) { const p = h.precipitation_probability[i]; if (p != null && p > pmax) pmax = p; } }
    cells.push({ lbl: tr('strip_rain2h'), val: pmax + '%', tone: pmax >= 60 ? 'bad' : pmax >= 30 ? 'warn' : 'good' });
    const aqi = (state.air && state.air.current) ? state.air.current.european_aqi : null; cells.push({ lbl: tr('strip_air'), val: aqi == null ? '–' : Math.round(aqi), tone: aqi == null ? '' : aqi > 60 ? 'bad' : aqi > 40 ? 'warn' : 'good' });
    return '<div class="hero-strip">' + cells.map(x => `<div class="hs-cell ${x.tone}"><div class="hs-lbl">${esc(x.lbl)}</div><div class="hs-val">${esc(String(x.val))}</div></div>`).join('') + '</div>';
  }
  function renderHero(fc, an) {
    const c = fc.current, today = an[0], dc = dispCode(c.weather_code, c.temperature_2m), feels = saneFeel(c.apparent_temperature, c.temperature_2m);
    setBg(dc, c.is_day === 1, c.temperature_2m);
    const l = state.loc, place = l.name + (l.admin1 && l.admin1 !== l.name ? ', ' + l.admin1 : '') + (l.country ? ' · ' + l.country : '');
    let narr = wmoText(dc) + '. ';
    if (today && Math.abs(today.anomHi) >= 4) narr += tr('narr_anom', { anom: pm(today.anomHi), word: today.anomHi > 0 ? tr('narr_warmer') : tr('narr_cooler') });
    if (today && today.overRec) narr += tr('narr_record');
    else if (today && today.pctHi != null && today.pctHi >= 95) narr += tr('narr_pct', { pct: Math.round(100 - today.pctHi) || 1 });
    const am = auroraModel(), auroraOn = !!(am && am.possibleNow && sunAltDeg(state.loc.lat, state.loc.lon) < -6 && !(c.cloud_cover > 80));
    $('#hero').innerHTML =
      `<canvas id="skyHero" class="sky-canvas" aria-hidden="true"></canvas>
       <div class="hero-content">
       <div class="hero-loc"><span class="dot"></span><span class="hloc-name">${esc(place)}</span><button class="fave-star ${isFave(state.loc) ? 'on' : ''}" id="faveStar" title="Bookmark this place" aria-label="Bookmark this place">${starSvg()}</button></div>
       <div class="hero-main"><div class="hero-ic float">${icon(dc, c.is_day === 1, true)}</div><div class="hero-temp">${fmtT(c.temperature_2m)}</div>
       <div class="hero-right"><div class="hero-cond">${esc(wmoText(dc))}</div><div class="hero-feels">${tr('feels_like')} ${fmtT(feels)}</div>
       <div class="hero-hl"><span>${tr('hilo_high')} <b>${fmtT(today && today.hi)}</b></span><span>${tr('hilo_low')} <b>${fmtT(today && today.lo)}</b></span></div></div></div>
       <div class="hero-narr">${esc(narr)}</div>
       ${heroStrip(fc)}
       </div>`;
    $('#hero').style.background = skyGradient(dc, c.is_day === 1, c.temperature_2m);
    skyInit(codeCat(dc), c.is_day === 1, auroraOn);
  }
  function metric(lbl, val, sub) { return `<div class="metric"><div class="m-lbl">${lbl}</div><div class="m-val">${val}</div><div class="m-sub">${sub || ''}</div></div>`; }
  function renderDetails(fc, an) {
    const c = fc.current, t = an[0], rise = t ? hhmm(t.sunrise) : '–', set = t ? hhmm(t.sunset) : '–';
    const h = fc.hourly; let hci = 0; if (h && h.time) { for (let i = 0; i < h.time.length; i++) { if (h.time[i] >= c.time) { hci = i; break; } } }
    const dew = (h && h.dew_point_2m) ? h.dew_point_2m[hci] : null, vis = (h && h.visibility) ? h.visibility[hci] : null;
    $('#details').innerHTML =
      metric(tr('feels_like'), fmtT(saneFeel(c.apparent_temperature, c.temperature_2m)), t ? tr('feels_sub', { t: fmtT(t.appMax != null ? t.appMax : t.hi) }) : '') +
      metric(tr('wind'), fmtW(c.wind_speed_10m), tr('gusts') + ' ' + fmtW(clampGust(c.wind_gusts_10m, c.wind_speed_10m)) + (c.wind_direction_10m != null ? ' · ' + compass(c.wind_direction_10m) : '')) +
      metric(tr('humidity'), pct01(c.relative_humidity_2m), tr('cloud') + ' ' + pct01(c.cloud_cover)) +
      metric(tr('dewpoint'), fmtT(dew), '') +
      metric(tr('uv'), c.uv_index == null ? '–' : nf(c.uv_index, 1), uvWord(c.uv_index)) +
      metric(tr('visibility'), vis == null ? '–' : (vis >= 1000 ? Math.round(vis / 1000) + ' km' : Math.round(vis) + ' m'), '') +
      metric(tr('pressure'), iUnit(c.pressure_msl, ' hPa'), '') +
      metric(tr('sunrise'), rise, tr('sunset_pre') + set);
  }
  function auroraModel() {
    const a = state.aurora; if (!a || a.kpNow == null) return null;
    const gl = Math.abs(geomagLat(state.loc.lat, state.loc.lon));
    const needKp = Math.max(0, Math.min(9, Math.ceil((66 - gl) / 2)));
    const possibleNow = gl >= 66 - 2 * a.kpNow;
    const possibleSoon = !possibleNow && a.kpMax != null && a.kpMax >= needKp;
    return { gl, needKp, kpNow: a.kpNow, kpMax: a.kpMax, kpTime: a.kpTime, possibleNow, possibleSoon };
  }
  function renderAurora() {
    const el = $('#aurora'), title = $('#auroraTitle'); if (!el) return;
    const m = auroraModel();
    if (!m) { el.innerHTML = ''; el.style.display = 'none'; if (title) title.style.display = 'none'; return; }
    el.style.display = ''; if (title) title.style.display = '';
    const c = (state.forecast && state.forecast.current) || {}, cloud = c.cloud_cover;
    const dark = sunAltDeg(state.loc.lat, state.loc.lon) < -6, overcast = cloud != null && cloud > 80;
    let cls, verdict;
    if (m.possibleNow) { cls = 'good'; verdict = tr('aurora_possible', { kp: nf(m.kpNow, 1) }); }
    else if (m.possibleSoon) { cls = 'watch'; verdict = tr('aurora_soon', { kp: nf(m.kpMax, 1) }); }
    else { cls = 'meh'; verdict = tr('aurora_unlikely', { need: m.needKp }); }
    const quals = [];
    if ((m.possibleNow || m.possibleSoon) && !dark) quals.push(tr('aurora_daylight'));
    if (m.possibleNow && overcast) quals.push(tr('aurora_overcast'));
    const verdictFull = [verdict].concat(quals).join('. ') + '.';
    const kpUtc = m.kpTime ? m.kpTime.slice(11, 16) : '–';
    el.innerHTML = `<div class="aurora-card ${cls}">
      <div class="aur-gaugewrap">
        <div class="aur-kp"><span class="aur-kp-lbl">Kp</span><span class="aur-kp-val">${nf(m.kpNow, 1)}</span></div>
        <div class="aur-gauge"><span class="aur-fill" style="width:${Math.min(100, m.kpNow / 9 * 100).toFixed(0)}%"></span><i class="aur-need" style="left:${Math.min(100, m.needKp / 9 * 100).toFixed(0)}%" title="${esc(tr('aurora_needline', { n: m.needKp }))}"></i></div>
        <div class="aur-scale"><span>0</span><span>Kp 9</span></div>
        <div class="aur-sub">${esc(tr('aurora_kp', { kp: nf(m.kpNow, 1), t: kpUtc }))}</div>
      </div>
      <div class="aur-body">
        <div class="aur-verdict">${esc(verdictFull)}</div>
        ${m.kpMax != null ? `<div class="aur-outlook">${esc(tr('aurora_outlook'))}: ${esc(tr('aurora_maxkp', { kp: nf(m.kpMax, 1) }))}</div>` : ''}
      </div>
    </div>`;
  }
  const MOON_KEYS = ['moon_new', 'moon_waxcres', 'moon_first', 'moon_waxgib', 'moon_full', 'moon_wangib', 'moon_last', 'moon_wancres'];
  const MOON_EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  function renderSunMoon() {
    const el = $('#sunmoon'), title = $('#sunmoonTitle'); if (!el) return;
    const fc = state.forecast, d = fc && fc.daily;
    if (!d || !d.sunrise || !d.sunrise[0]) { el.innerHTML = ''; el.style.display = 'none'; if (title) title.style.display = 'none'; return; }
    el.style.display = ''; if (title) title.style.display = '';
    const off = fc.utc_offset_seconds || 0, lat = state.loc.lat, lon = state.loc.lon, sr0 = d.sunrise[0], ss0 = d.sunset[0];
    const lenMin = Math.round((Date.parse(ss0 + 'Z') - Date.parse(sr0 + 'Z')) / 60000);
    const lenStr = (lenMin > 0 && !isNaN(lenMin)) ? Math.floor(lenMin / 60) + ' h ' + (lenMin % 60) + ' min' : '–';
    let deltaStr = '';
    if (d.sunrise[1] && d.sunset[1]) { const len2 = Math.round((Date.parse(d.sunset[1] + 'Z') - Date.parse(d.sunrise[1] + 'Z')) / 60000), dm = len2 - lenMin; if (!isNaN(dm) && Math.abs(dm) >= 1) deltaStr = tr('daylen_delta', { dir: dm >= 0 ? tr('daylen_longer') : tr('daylen_shorter'), min: Math.abs(dm) }); }
    const sunsetMs = Date.parse(ss0 + 'Z') - off * 1000;
    let goldenStr = tr('no_golden'), blueStr = '–';
    if (!isNaN(sunsetMs)) { const gS = findAlt(lat, lon, sunsetMs, -1, 6, false), gE = findAlt(lat, lon, sunsetMs, 1, -4, true), bE = findAlt(lat, lon, sunsetMs, 1, -6, true); if (gS && gE) goldenStr = localHM(gS, off) + '–' + localHM(gE, off); if (gE && bE) blueStr = localHM(gE, off) + '–' + localHM(bE, off); }
    const mp = moonPhase(), idx = Math.round(mp.frac * 8) % 8;
    el.innerHTML =
      metric(tr('sunrise'), hhmm(sr0), '') +
      metric(tr('sunset'), hhmm(ss0), '') +
      metric(tr('daylight'), lenStr, deltaStr) +
      metric(tr('golden_hour'), goldenStr, blueStr !== '–' ? tr('blue_hour') + ' ' + blueStr : '') +
      metric(tr('moon_phase'), MOON_EMOJI[idx] + ' ' + tr(MOON_KEYS[idx]), tr('moon_illum', { pct: Math.round(mp.illum * 100) }));
  }
  function shieldSvg() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/></svg>'; }
  function warnTri() { return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>'; }
  function clockSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#AEBBD0" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>'; }
  function walkSvg() { return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4" r="1.6"/><path d="M11 8l-3 4 3 2 1 6M12 14l3 3 2 2M8 12l-2 2"/></svg>'; }

  /* ---------------- today briefing + best time outside ---------------- */
  function hourFromNow(h, now) { let s = 0; for (let i = 0; i < h.time.length; i++) if (h.time[i] >= now) { s = i; break; } return s; }
  function renderBriefing(fc) {
    const el = $('#briefing'); if (!el) return;
    if (!fc || !fc.hourly) { el.classList.add('skel'); el.innerHTML = ''; return; }
    el.classList.remove('skel'); el.style.display = '';
    const h = fc.hourly, c = fc.current, s = hourFromNow(h, c.time);
    const nxt = n => { const a = []; for (let i = s; i < s + n && i < h.time.length; i++) a.push(i); return a; };
    const hr = +c.time.slice(11, 13), dp = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : hr < 21 ? 'evening' : 'night';
    const cat = codeCat(dispCode(c.weather_code, c.temperature_2m));
    const skyKey = (cat === 'rain' || cat === 'drizzle' || cat === 'storm' || cat === 'sleet') ? 'brief_sky_wet' : cat === 'clear' ? 'brief_sky_clear' : cat === 'partly' ? 'brief_sky_part' : 'brief_sky_grey';
    let s1 = tr(skyKey, { part: tr('dp_' + dp) });
    const gmax = Math.max(0, ...nxt(6).map(i => h.wind_gusts_10m[i] || 0));
    if (gmax >= 25) s1 += ', ' + tr('brief_wind', { g: fmtW(Math.round(gmax)) });
    s1 += '.';
    let rain = null;
    for (const i of nxt(12)) { if ((h.precipitation_probability[i] || 0) >= 45 || (h.precipitation[i] || 0) >= 0.3) { rain = { i, pop: h.precipitation_probability[i] || 0, heavy: (h.precipitation[i] || 0) >= 1 }; break; } }
    const s2 = rain ? (rain.pop >= 60 || rain.heavy ? tr('brief_rain_likely', { t: hhmm(h.time[rain.i]) }) : tr('brief_rain_shower', { t: hhmm(h.time[rain.i]) })) + '.' : tr('brief_norain') + '.';
    const tlo = Math.min(...nxt(18).map(i => h.temperature_2m[i]));
    const s3 = tr('brief_tonight', { lo: fmtT(tlo) }) + '.';
    el.innerHTML = `<div class="brief-lbl">${sunSmall()}${esc(tr('brief_lbl'))}</div><p class="brief-text">${esc(s1 + ' ' + s2 + ' ' + s3)}</p>`;
  }
  function outdoorScore(h, i) {
    const day = h.is_day ? h.is_day[i] : 1; if (!day) return 0;
    const A = h.apparent_temperature ? h.apparent_temperature[i] : h.temperature_2m[i], pop = h.precipitation_probability[i] || 0, mm = h.precipitation[i] || 0, g = h.wind_gusts_10m[i] || 0, uv = h.uv_index ? h.uv_index[i] : 0;
    let sc = 100; sc -= pop * 0.8; sc -= mm * 15; sc -= Math.max(0, g - 30) * 1.5; sc -= Math.max(0, 12 - A) * 3; sc -= Math.max(0, A - 27) * 3; sc -= Math.max(0, uv - 6) * 5;
    return Math.max(0, Math.round(sc));
  }
  function renderBestOutside(fc) {
    const el = $('#bestout'); if (!el) return;
    if (!fc || !fc.hourly) { el.classList.add('skel'); el.innerHTML = ''; return; }
    el.classList.remove('skel'); el.style.display = '';
    const h = fc.hourly, s = hourFromNow(h, fc.current.time), span = [];
    for (let i = s; i < s + 24 && i < h.time.length; i++) span.push(i);
    const sc = span.map(i => outdoorScore(h, i));
    let best = null, run = null;
    span.forEach((i, j) => { if (sc[j] >= 55) { run = run ? { a: run.a, b: j, sum: run.sum + sc[j] } : { a: j, b: j, sum: sc[j] }; } else { if (run && (!best || run.sum > best.sum)) best = run; run = null; } });
    if (run && (!best || run.sum > best.sum)) best = run;
    let whenStr, sub;
    if (best) { const aFull = h.time[span[best.a]], endT = h.time[span[best.b] + 1] || h.time[span[best.b]], tom = aFull.slice(0, 10) !== h.time[span[0]].slice(0, 10); whenStr = tom ? tr('bo_tom', { a: hhmm(aFull), b: hhmm(endT) }) : best.a === 0 ? tr('bo_now', { t: hhmm(endT) }) : tr('bo_window', { a: hhmm(aFull), b: hhmm(endT) }); const avgG = mean(span.slice(best.a, best.b + 1).map(i => h.wind_gusts_10m[i])); sub = tr('bo_sub', { g: fmtW(avgG == null ? null : Math.round(avgG)) }); }
    else { whenStr = tr('bo_none'); sub = tr('bo_none_sub'); }
    const bars = span.map((i, j) => { const day = h.is_day ? h.is_day[i] : 1; let col = '#182033'; if (day) { const v = sc[j]; col = v >= 75 ? '#4FA3FF' : v >= 50 ? 'rgba(79,163,255,.72)' : v >= 25 ? 'rgba(79,163,255,.45)' : 'rgba(120,140,170,.32)'; } return `<span style="background:${col}" title="${esc(hhmm(h.time[i]))} · ${sc[j]}"></span>`; }).join('');
    el.innerHTML = `<div class="brief-lbl">${walkSvg()}${esc(tr('bo_lbl'))}</div><div class="bo-when">${esc(whenStr)}</div><div class="bo-sub">${esc(sub)}</div><div class="bo-bars">${bars}</div><div class="bo-ticks"><span>${esc(hhmm(h.time[span[0]]))}</span><span>+24 h</span></div>`;
  }

  /* ---------------- official warnings (DWD) ---------------- */
  function dwdLevel(sev) { return sev === 'extreme' ? 4 : sev === 'severe' ? 3 : sev === 'moderate' ? 2 : 1; }
  function renderDwd() {
    const el = $('#dwd'); if (!el) return; const d = state.dwd;
    if (!d || !d.covered) { el.innerHTML = ''; return; }
    const now = Date.now();
    const active = (d.alerts || []).filter(a => (a.expires ? Date.parse(a.expires) : Infinity) > now);
    if (!active.length) {
      const name = d.place ? (d.place.name || d.place.name_short || '') : '';
      el.innerHTML = `<div class="dwd-ok"><span class="di">${shieldSvg()}</span><div><b>${esc(tr('dwd_none', { name }))}</b><div class="dsub">${esc(tr('dwd_checked'))}</div></div><span class="dwd-src">DWD</span></div>`;
      return;
    }
    active.sort((a, b) => dwdLevel(b.severity) - dwdLevel(a.severity));
    el.innerHTML = active.map(a => {
      const lv = dwdLevel(a.severity);
      let title = (state.lang === 'de' ? a.event_de : a.event_en) || a.event_en || a.headline_en || '';
      title = esc(title.charAt(0).toUpperCase() + title.slice(1).toLowerCase());
      const desc = esc((((state.lang === 'de' ? a.description_de : a.description_en) || '').split('\n')[0] || '').slice(0, 160));
      const when = (a.onset && a.expires) ? esc(hhmm(a.onset) + ' – ' + hhmm(a.expires)) : '';
      return `<div class="warn lv${lv}"><div class="warn-top"><span class="warn-sev">${warnTri()}${esc(tr('dwd_level', { n: lv }))}</span><span class="dwd-src">${esc(tr('dwd_official'))}</span></div><div class="warn-title">${title}</div>${when ? `<div class="warn-when">${clockSvg()}${when}</div>` : ''}<div class="warn-desc">${desc}</div></div>`;
    }).join('');
  }

  /* ---------------- meteogram ---------------- */
  function renderMeteogram() {
    const el = $('#meteogram'), fc = state.forecast; if (!el) return;
    if (!fc || !fc.hourly) { el.innerHTML = '<div class="skel-box" style="height:360px"></div>'; return; }
    const N = state.meteoH, h = fc.hourly, s = hourFromNow(h, fc.current.time), idx = [];
    for (let i = s; i < s + N && i < h.time.length; i++) idx.push(i);
    if (idx.length < 2) { el.innerHTML = ''; return; }
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    const ink = dark ? '#AEBBD0' : '#3B4B63', faint = dark ? '#7E8CA6' : '#5A6B84';
    const padL = 46, padR = 16, cw = el.clientWidth || 980, minStep = N > 30 ? 17 : 26, Ht = 416;
    const step = Math.max(minStep, Math.floor((cw - padL - padR) / (idx.length - 1))), W = padL + padR + (idx.length - 1) * step;
    const X = j => +(padL + j * step).toFixed(1);
    const T = idx.map(i => h.temperature_2m[i]), A = idx.map(i => { const a = h.apparent_temperature ? h.apparent_temperature[i] : null, sv = saneFeel(a, h.temperature_2m[i]); return sv == null ? h.temperature_2m[i] : sv; });
    const tLo = Math.floor(Math.min(...T, ...A) - 1), tHi = Math.ceil(Math.max(...T, ...A) + 1), tTop = 82, tBot = 224;
    const tY = v => +(tBot - (v - tLo) / Math.max(1, tHi - tLo) * (tBot - tTop)).toFixed(1);
    const gust = idx.map(i => h.wind_gusts_10m[i] || 0), gHi = Math.max(20, Math.ceil(Math.max(...gust) / 10) * 10), gTop = 292, gBot = 350, gY = v => +(gBot - v / gHi * (gBot - gTop)).toFixed(1);
    const P = [];
    // night shading + day dividers
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j], day = h.is_day ? h.is_day[i] : 1, hr = +h.time[i].slice(11, 13);
      if (!day) P.push(`<rect x="${(X(j) - step / 2).toFixed(1)}" y="64" width="${step}" height="322" fill="#05080f" opacity="${dark ? .5 : .13}"/>`);
      if (hr === 0 || j === 0) { P.push(`<line x1="${X(j)}" y1="64" x2="${X(j)}" y2="386" stroke="rgba(150,160,180,.14)"/>`); P.push(`<text x="${X(j) + 5}" y="60" font-family="Inter,sans-serif" font-size="11" font-weight="600" fill="${ink}">${esc((j === 0 ? tr('now') + ' · ' : '') + shortWD(h.time[i].slice(0, 10)))}</text>`); }
    }
    // icons every 3h
    for (let j = 0; j < idx.length; j += 3) { const i = idx[j], day = h.is_day ? h.is_day[i] : 1; P.push(`<svg x="${(X(j) - 11).toFixed(1)}" y="20" width="22" height="22" overflow="visible">${icon(dispCode(h.weather_code[i], T[j]), day === 1, false)}</svg>`); }
    // temp gridlines
    const tstep = (tHi - tLo) > 18 ? 10 : 5;
    for (let v = Math.ceil(tLo / tstep) * tstep; v <= tHi; v += tstep) { P.push(`<line x1="${padL}" y1="${tY(v)}" x2="${W - padR}" y2="${tY(v)}" stroke="rgba(150,160,180,.08)"/>`); P.push(`<text x="${padL - 8}" y="${tY(v) + 4}" text-anchor="end" font-family="var(--mono),monospace" font-size="11" fill="${faint}">${Math.round(convT(v))}°</text>`); }
    const tempPath = T.map((v, j) => (j ? 'L' : 'M') + X(j) + ' ' + tY(v)).join(' ');
    P.push(`<path d="${tempPath} L${X(idx.length - 1)} ${tBot} L${padL} ${tBot} Z" fill="url(#mgTemp)"/>`);
    P.push(`<path d="${A.map((v, j) => (j ? 'L' : 'M') + X(j) + ' ' + tY(v)).join(' ')}" fill="none" stroke="#e8693a" stroke-width="1.5" stroke-dasharray="4 4" opacity=".7"/>`);
    P.push(`<path d="${tempPath}" fill="none" stroke="#e8693a" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`);
    // min/max markers
    const jHi = T.indexOf(Math.max(...T)), jLo = T.indexOf(Math.min(...T));
    [[jHi, Math.max(...T)], [jLo, Math.min(...T)]].forEach(([j, v]) => { P.push(`<circle cx="${X(j)}" cy="${tY(v)}" r="3.5" fill="#e8693a" stroke="${dark ? '#0E1524' : '#fff'}" stroke-width="2"/>`); P.push(`<text x="${X(j)}" y="${tY(v) + (j === jHi ? -9 : 16)}" text-anchor="middle" font-family="var(--mono),monospace" font-size="11.5" font-weight="600" fill="${dark ? '#E9EFFA' : '#0B1524'}">${fmtT(v)}</text>`); });
    P.push(`<line x1="${padL}" y1="68" x2="${padL}" y2="${tBot}" stroke="${dark ? '#E9EFFA' : '#0B1524'}" stroke-opacity=".4"/><circle cx="${padL}" cy="${tY(T[0])}" r="4.5" fill="${dark ? '#E9EFFA' : '#0B1524'}" stroke="${dark ? '#0E1524' : '#fff'}" stroke-width="2"/>`);
    // rain % strip
    P.push(`<text x="4" y="263" font-family="Inter,sans-serif" font-size="10" font-weight="600" fill="${faint}">${esc(tr('mg_rain'))}</text>`);
    P.push(`<rect x="${padL}" y="246" width="${W - padR - padL}" height="22" rx="4" fill="rgba(150,160,180,.05)"/>`);
    idx.forEach((i, j) => { const pop = h.precipitation_probability[i]; if (pop != null && pop >= 10) { P.push(`<rect x="${(X(j) - step / 2 + 1).toFixed(1)}" y="246" width="${(step - 2).toFixed(1)}" height="22" rx="3" fill="#3f8fd4" opacity="${(0.18 + pop / 100 * 0.78).toFixed(2)}"/>`); if (pop >= 40) P.push(`<text x="${X(j)}" y="261" text-anchor="middle" font-family="var(--mono),monospace" font-size="10" font-weight="600" fill="#F6F9FE">${pop}</text>`); } });
    // gust
    P.push(`<text x="4" y="326" font-family="Inter,sans-serif" font-size="10" font-weight="600" fill="${faint}">${esc(tr('mg_gust'))}</text>`);
    [20, 40].forEach(v => { if (v <= gHi) { P.push(`<line x1="${padL}" y1="${gY(v)}" x2="${W - padR}" y2="${gY(v)}" stroke="rgba(150,160,180,.08)"/>`); P.push(`<text x="${padL - 8}" y="${gY(v) + 3}" text-anchor="end" font-family="var(--mono),monospace" font-size="10" fill="${faint}">${Math.round(convW(v))}</text>`); } });
    const gPath = gust.map((v, j) => (j ? 'L' : 'M') + X(j) + ' ' + gY(v)).join(' ');
    P.push(`<path d="${gPath} L${X(idx.length - 1)} ${gBot} L${padL} ${gBot} Z" fill="url(#mgGust)"/>`);
    P.push(`<path d="${gPath}" fill="none" stroke="#9fb0c4" stroke-width="2" stroke-linejoin="round"/>`);
    const jg = gust.indexOf(Math.max(...gust)); P.push(`<circle cx="${X(jg)}" cy="${gY(gust[jg])}" r="3.5" fill="#9fb0c4" stroke="${dark ? '#0E1524' : '#fff'}" stroke-width="2"/><text x="${X(jg)}" y="${gY(gust[jg]) - 8}" text-anchor="middle" font-family="var(--mono),monospace" font-size="11" font-weight="600" fill="${dark ? '#E9EFFA' : '#0B1524'}">${fmtW(gust[jg])}</text>`);
    // UV strip
    P.push(`<text x="4" y="378" font-family="Inter,sans-serif" font-size="10" font-weight="600" fill="${faint}">${esc(tr('mg_uv'))}</text>`);
    idx.forEach((i, j) => { const day = h.is_day ? h.is_day[i] : 1, uv = (day && h.uv_index) ? h.uv_index[i] : 0; if (uv > 0.2) { const col = uv >= 8 ? '#e23b3b' : uv >= 6 ? '#ff7a45' : uv >= 3 ? '#ffce3a' : '#7bd88f'; P.push(`<rect x="${(X(j) - step / 2 + 1).toFixed(1)}" y="366" width="${(step - 2).toFixed(1)}" height="16" rx="3" fill="${col}" opacity="${Math.min(1, 0.25 + uv / 11).toFixed(2)}"/>`); } });
    // hour axis
    for (let j = 0; j < idx.length; j += (N > 30 ? 3 : 2)) { const hr = +h.time[idx[j]].slice(11, 13); P.push(`<text x="${X(j)}" y="402" text-anchor="middle" font-family="var(--mono),monospace" font-size="10" fill="${faint}">${hr < 10 ? '0' + hr : hr}</text>`); }
    // crosshair group (moved by JS)
    P.push(`<g class="mg-cross" style="visibility:hidden"><line y1="64" y2="386" stroke="${dark ? '#E9EFFA' : '#0B1524'}" stroke-opacity=".55" stroke-width="1.2"/><circle class="cT" r="4" fill="#e8693a" stroke="${dark ? '#0E1524' : '#fff'}" stroke-width="2"/><circle class="cG" r="4" fill="#9fb0c4" stroke="${dark ? '#0E1524' : '#fff'}" stroke-width="2"/></g>`);
    P.push(`<rect class="mg-hit" x="${padL}" y="64" width="${W - padR - padL}" height="322" fill="transparent" style="cursor:crosshair"/>`);
    const grad = `<defs><linearGradient id="mgTemp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8693a" stop-opacity=".24"/><stop offset="1" stop-color="#e8693a" stop-opacity="0"/></linearGradient><linearGradient id="mgGust" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fb0c4" stop-opacity=".16"/><stop offset="1" stop-color="#9fb0c4" stop-opacity="0"/></linearGradient></defs>`;
    el.innerHTML =
      `<div class="meteo-legend"><span><i style="width:18px;border-top:2px solid #e8693a"></i>${esc(tr('mg_temp'))}</span><span><i style="width:18px;border-top:2px dashed #e8693a;opacity:.7"></i>${esc(tr('mg_feels'))}</span><span><i style="width:12px;height:12px;border-radius:3px;background:#3f8fd4;display:inline-block"></i>${esc(tr('mg_rain'))}</span><span><i style="width:18px;border-top:2px solid #9fb0c4"></i>${esc(tr('mg_gust'))}</span></div>` +
      `<div class="mg-wrap" style="position:relative"><svg style="width:${W}px" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${esc(tr('mg_aria'))}" preserveAspectRatio="xMidYMid meet">${grad}${P.join('')}</svg><div class="meteo-tip" hidden></div></div>`;
    // hover
    const svg = el.querySelector('svg'), cross = el.querySelector('.mg-cross'), hit = el.querySelector('.mg-hit'), tip = el.querySelector('.meteo-tip');
    if (svg && hit && cross && tip) {
      const move = ev => {
        const r = svg.getBoundingClientRect(), sx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left, ux = sx / r.width * W;
        let j = Math.round((ux - padL) / step); j = Math.max(0, Math.min(idx.length - 1, j));
        cross.style.visibility = 'visible'; cross.querySelector('line').setAttribute('x1', X(j)); cross.querySelector('line').setAttribute('x2', X(j));
        cross.querySelector('.cT').setAttribute('cx', X(j)); cross.querySelector('.cT').setAttribute('cy', tY(T[j]));
        cross.querySelector('.cG').setAttribute('cx', X(j)); cross.querySelector('.cG').setAttribute('cy', gY(gust[j]));
        const i = idx[j], d = new Date(h.time[i]), pop = h.precipitation_probability[i], mm = h.precipitation[i], uv = h.uv_index ? h.uv_index[i] : null;
        tip.hidden = false;
        tip.innerHTML = `<b>${esc(shortWD(h.time[i].slice(0, 10)) + ' ' + h.time[i].slice(11, 16))}</b><span>${fmtT(T[j])} · ${esc(tr('feels_like').toLowerCase())} ${fmtT(A[j])}</span><span>${rainGlyph()} ${pop == null ? '–' : pop + '%'}${mm > 0 ? ' · ' + fmtP(mm) : ''}</span><span>${esc(tr('gusts'))} ${fmtW(gust[j])}${uv ? ' · UV ' + round(uv, 1) : ''}</span>`;
        const px = Math.min(r.width - 150, Math.max(4, X(j) / W * r.width - 70));
        tip.style.left = px + 'px';
      };
      hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
      hit.addEventListener('pointerleave', () => { cross.style.visibility = 'hidden'; tip.hidden = true; });
    }
  }

  function badge(svg, title) { return `<span class="bg-ic" title="${title}">${svg}</span>`; }
  function renderDaily(an, sb) {
    const days = an.slice(0, 14), el = $('#daily'); if (!el) return; if (!days.length) { el.innerHTML = ''; return; }
    const ens = state.ens && state.ens.by;
    const lows = [], highs = [];
    days.forEach(d => { const e = ens && ens[d.date]; if (e) { lows.push(e.lo10); highs.push(e.hi90); } else { if (d.lo != null) lows.push(d.lo); if (d.hi != null) highs.push(d.hi); } });
    const gLo = lows.length ? Math.floor(Math.min(...lows)) : 0, gHi = highs.length ? Math.ceil(Math.max(...highs)) : 1, span = Math.max(1, gHi - gLo), pos = v => (v - gLo) / span * 100;
    let html = '';
    days.forEach(d => {
      const e = ens && ens[d.date], lo = d.lo, hi = d.hi, prob = d.prob;
      let conf = 3; if (e) { const sp = e.hi90 - e.hi10; conf = sp <= 2.5 ? 3 : sp <= 5 ? 2 : 1; }
      const dots = e ? [1, 2, 3].map(k => `<i class="${k <= conf ? 'on' : ''}"></i>`).join('') : '';
      let b = '';
      if (hi != null && hi >= 32) b += badge(flame(hi >= 36 ? '#e23b3b' : '#ff7a45'), hi >= 36 ? tr('severe_heat') : tr('hot_day'));
      if (d.code >= 95 || (sb[d.date] && stormLevel(sb[d.date].cape, sb[d.date].cin, sb[d.date].shear, d.code))) b += badge(bolt(), tr('tstorm_risk'));
      if (d.gust >= 60) b += badge(wind(), tr('strong_gusts', { g: fmtW(d.gust) }));
      let rng = '<div class="track"></div>';
      if (e) rng += `<div class="band" style="left:${pos(e.lo10).toFixed(1)}%;right:${(100 - pos(e.hi90)).toFixed(1)}%"></div>`;
      if (lo != null && hi != null) rng += `<div class="bar" style="left:${pos(lo).toFixed(1)}%;right:${(100 - pos(hi)).toFixed(1)}%;background:linear-gradient(90deg,${tColor(lo)},${tColor(hi)})"></div>`;
      const popTxt = (prob != null && prob >= 20) ? `${rainGlyph()} ${prob}%` : '';
      html += `<div class="dwrap"><div class="drow" data-i="${d.i}" role="button" tabindex="0" aria-expanded="false">
        <div class="d-day"><span class="d-wd">${fmtWD(d.date)}</span><span class="d-dt">${mdShort(d.date)}</span></div>
        <div class="d-ic">${icon(d.code, true, false)}</div>
        <div class="d-pop">${popTxt}</div>
        <div class="d-conf" title="${esc(tr('conf_' + conf))}" aria-label="${esc(tr('conf_' + conf))}">${dots}</div>
        <div class="d-rtemp"><span class="d-rlo">${fmtT(lo)}</span><div class="d-range">${rng}</div><span class="d-rhi">${fmtT(hi)}</span></div>
        <div class="d-badges">${b}<svg class="d-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>
        <div class="dexp" id="dexp-${d.i}" hidden></div></div>`;
    });
    el.innerHTML = html;
    const note = $('#ensNote'); if (note) { if (state.ens && state.ens.members) { note.hidden = false; note.textContent = tr('ens_from', { n: state.ens.members }); } else note.hidden = true; }
  }
  function dItem(l, v) { return `<div class="dexp-item"><div class="di-l">${l}</div><div class="di-v">${v}</div></div>`; }
  function toggleDay(i, row) {
    const exp = document.getElementById('dexp-' + i); if (!exp) return;
    if (!exp.hasAttribute('hidden')) { exp.setAttribute('hidden', ''); row.classList.remove('open'); row.setAttribute('aria-expanded', 'false'); return; }
    const a = state.analysis[i]; if (!a) return;
    exp.innerHTML = `<div class="dexp-grid">
      ${dItem(tr('d_hilo'), fmtT(a.hi) + ' / ' + fmtT(a.lo))}
      ${dItem(tr('d_feels'), fmtT(a.appMax))}
      ${dItem(tr('d_rain'), fmtP(a.rain) + (a.prob != null && !(a.rain > 0 && a.prob === 0) ? ' · ' + a.prob + '%' : ''))}
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
  function renderWater() {
    const el = $('#water'), title = $('#waterTitle'); if (!el) return;
    const w = state.water;
    if (!w || (w.wave == null && w.river == null)) { el.innerHTML = ''; el.style.display = 'none'; if (title) title.style.display = 'none'; return; }
    el.style.display = ''; if (title) title.style.display = '';
    let html = '';
    if (w.wave != null) html += metric(tr('wave_height'), nf(w.wave, 1) + ' m', w.wavePeriod != null ? tr('wave_period') + ' ' + nf(w.wavePeriod, 0) + ' s' : '');
    if (w.river != null) html += metric(tr('river_discharge'), nf(w.river, 0) + ' m³/s', w.riverPct != null ? tr('flood_pctile', { pct: w.riverPct }) : '');
    el.innerHTML = html;
  }

  /* ---------------- history ---------------- */
  function renderHistory(fc, an, clim) {
    const next7 = an.slice(0, 7), avgHi = mean(next7.map(d => d.hi)), avgNorm = mean(next7.map(d => d.nHi)), anom = (avgHi != null && avgNorm != null) ? avgHi - avgNorm : 0;
    const peak = an.slice(0, 14).reduce((p, c) => (c.hi != null && (p.hi == null || c.hi > p.hi)) ? c : p), rain7 = sum(next7.map(d => d.rain)), normRain7 = mean(clim.monthly.map(m => m.pr)) / 30 * 7;
    const rh = clim.rec && clim.rec.hi, rl = clim.rec && clim.rec.lo, rr = clim.rec && clim.rec.rain;
    let cards = '';
    cards += insightCard(anom >= 0 ? 'accent-hot' : 'accent-cool', sunSmall(), tr('ins_week'), pm(anom, 1) + '°', tr('ins_week_desc', { dir: anom >= 0 ? tr('dir_above') : tr('dir_below'), norm: tempDeg(avgNorm) }));
    cards += insightCard(peak.overRec ? 'accent-rec' : 'accent-hot', flame('#ff7a45'), tr('ins_peak'), tempDeg(peak.hi), `${fmtWD(peak.date)} ${peak.date.slice(8)}. ${peak.overRec ? tr('ins_peak_break') : (peak.nearRec && rh) ? tr('ins_peak_near', { rec: tempDeg(rh.v) }) : clim.thin ? tr('ins_partial') : rh ? tr('ins_peak_rec', { rec: tempDeg(rh.v) }) : ''}`);
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
         ${recCard(flame('#ff7a45'), tr('rec_hottest'), rh ? tempDeg(rh.v) : '–', rh && rh.date)}
         ${recCard(snowflake(), tr('rec_coldest'), rl ? tempDeg(rl.v) : '–', rl && rl.date)}
         ${recCard(rainGlyphBig(), tr('rec_wettest'), rr ? fmtP(rr.v) : '–', rr && rr.date)}</div>
       ${clim.thin ? '<div class="rec-note">' + esc(tr('rec_partial')) + '</div>' : ''}`;
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
    el.innerHTML = `<div class="nc-head">${raining ? rainGlyphBig() : sunSmall()}<span class="nc-msg">${esc(msg)}</span></div><div class="nc-bars">${bars}</div><div class="nc-ticks"><span>${tr('now')}</span><span>${tr('nc_plus1')}</span><span>${tr('nc_plus2')}</span></div>`;
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
    const t = data.daily.time, dmean = data.daily.temperature_2m_mean, byYear = {};
    for (let i = 0; i < t.length; i++) { if (dmean[i] == null) continue; const y = t[i].slice(0, 4); (byYear[y] = byYear[y] || []).push(dmean[i]); }
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
    const head = `<div class="outlook-head"><span>${esc(tr('outlook_lbl'))}</span><span class="outlook-sub">${esc(tr('outlook_sub'))}</span></div>`;
    if (!alerts.length) { $('#alerts').innerHTML = head + `<div class="alert sev-ok"><div class="a-ic"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 13l4 4 10-10" fill="none" stroke="#7bd88f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="a-body"><div class="a-top"><span class="a-title">${tr('no_extremes')}</span></div><div class="a-desc">${tr('no_extremes_desc')}</div></div></div>`; return; }
    $('#alerts').innerHTML = head + alerts.map(a => `<div class="alert sev-${a.sev}"><div class="a-ic">${a.ic}</div><div class="a-body"><div class="a-top"><span class="a-title">${esc(a.title)}</span><span class="pill">${tr('sev_' + a.sev)}</span><span class="a-when">${esc(a.when)}</span></div><div class="a-desc">${esc(a.desc)}</div></div></div>`).join('');
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
  const FALLBACK_CLIM = { mx: null, mn: null, pr: null, D: [], rec: { hi: { v: 99 }, lo: { v: -99 }, rain: { v: 99 } }, monthly: Array.from({ length: 12 }, (_, m) => ({ month: m, pr: 0 })), years: 0, thin: true };

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
  function addBase() { const dark = document.documentElement.getAttribute('data-theme') !== 'light'; if (state.map.baseLayer) state.map.leaflet.removeLayer(state.map.baseLayer); state.map.baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', subdomains: 'abc', maxZoom: 19, className: dark ? 'map-dark' : '' }).addTo(state.map.leaflet); state.map.baseLayer.bringToBack(); }
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
    await Promise.allSettled(chunks.map(async ch => {
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
    if (e.type === 'heat') return tempDeg(e.v) + ' ' + tr('v_heat');
    if (e.type === 'wind') return fmtW(e.v) + ' ' + tr('v_gusts');
    if (e.type === 'rain') return fmtP(e.v) + ' ' + tr('v_rain');
    if (e.type === 'snow') return nf(e.v, 0) + ' cm ' + tr('v_snow');
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
  async function loadRadar() { if (state.map.frames.length && state.map.radarTs && Date.now() - state.map.radarTs < 6e5) return true; try { const r = await fetch('https://api.rainviewer.com/public/weather-maps.json'), d = await r.json(); state.map.radarHost = d.host; state.map.frames = [...(d.radar && d.radar.past || []), ...(d.radar && d.radar.nowcast || [])]; state.map.radarTs = Date.now(); return state.map.frames.length > 0; } catch (e) { return false; } }
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
    const upd = () => { const n = new Date(); el.textContent = n.toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + n.toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    upd(); if (state.clockTimer) clearInterval(state.clockTimer); state.clockTimer = setInterval(upd, 1000);
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
    const safeUrl = safeHttpUrl(fact.url);
    const link = safeUrl ? ' <a href="' + esc(safeUrl) + '" target="_blank" rel="noopener noreferrer" class="fact-more">' + tr('fact_more') + '</a>' : '';
    el.innerHTML = '<b>' + tr('fact_pre', { year: esc(String(fact.year)) }) + '</b>' + esc(fact.text.replace(/\s*\(pictured\)/gi, '')) + link;
  }

  /* ---------------- orchestration ---------------- */
  function setUpdated(obsMs, offline) {
    const up = $('#updated'), badge = $('#staleBadge');
    const at = ms => hhmm(new Date(ms).toISOString());
    if (offline) {
      const t = obsMs != null ? at(obsMs) : '–';
      if (up) up.textContent = tr('offline_lastgood', { t });
      if (badge) { badge.hidden = false; badge.className = 'stale-badge amber'; badge.textContent = tr('offline_lastgood', { t }); }
      return;
    }
    const age = obsMs != null ? Math.max(0, Math.round((Date.now() - obsMs) / 60000)) : null;
    if (up) up.textContent = age == null ? tr('updated', { t: at(Date.now()) }) : tr('updated_ago', { min: age });
    if (!badge) return;
    if (age == null || age <= 20) { badge.hidden = true; badge.textContent = ''; }
    else if (age <= 90) { badge.hidden = false; badge.className = 'stale-badge'; badge.textContent = tr('stale_note', { min: age }); }
    else { badge.hidden = false; badge.className = 'stale-badge amber'; badge.textContent = tr('stale_amber', { t: at(obsMs) }); }
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800); }
  function showLoading(on) { const l = $('#loading'); if (l) l.classList.toggle('hide', !on); }

  async function load(full = true) {
    try {
      if (full && !state.forecast) { renderMeteogram(); renderBriefing(null); renderBestOutside(null); }
      const fc = await getForecast(state.loc); state.forecast = fc;
      state.stormByDay = {}; const h = fc.hourly; const peakIdx = {};
      for (let i = 0; i < h.time.length; i++) { const d = h.time[i].slice(0, 10), c = h.cape ? h.cape[i] : null; if (c == null) continue; if (!(d in peakIdx) || c > h.cape[peakIdx[d]]) peakIdx[d] = i; }
      for (const d in peakIdx) { const i = peakIdx[d]; state.stormByDay[d] = { cape: h.cape[i] || 0, cin: h.convective_inhibition ? (h.convective_inhibition[i] || 0) : 0, shear: bulkShear(h.wind_speed_10m && h.wind_speed_10m[i], h.wind_direction_10m && h.wind_direction_10m[i], h.wind_speed_500hPa && h.wind_speed_500hPa[i], h.wind_direction_500hPa && h.wind_direction_500hPa[i]) }; }
      state.analysis = analyze(fc, state.clim || FALLBACK_CLIM);
      const sb = {}; state.analysis.forEach(a => sb[a.date] = state.stormByDay[a.date] || { cape: 0, cin: 0, shear: 0 }); state.stormByDate = sb;
      /* first paint — the weather, immediately, without waiting on archive or side feeds */
      renderHero(fc, state.analysis); renderBriefing(fc); renderBestOutside(fc);
      renderDetails(fc, state.analysis); renderSunMoon(); renderMeteogram();
      renderDaily(state.analysis, sb);
      const off = fc.utc_offset_seconds || 0;
      const obsMs = (fc.current && fc.current.time) ? Date.parse(fc.current.time + 'Z') - off * 1000 : Date.now();
      state.lastGood = { obsMs }; setUpdated(obsMs);
      state.alerts = buildAlerts(state.analysis, state.clim || FALLBACK_CLIM, sb); renderAlerts(state.alerts); renderDwd();
      /* side feeds + archive together in the background */
      const archiveP = state.clim ? null : getArchive(state.loc).catch(() => null);
      const [air, nc, aur, water, dwd, ens] = await Promise.all([getAir(state.loc).catch(() => null), getNowcast(state.loc).catch(() => null), getAurora(state.loc).catch(() => null), getWater(state.loc).catch(() => null), getDwd(state.loc).catch(() => null), getEnsemble(state.loc).catch(() => null)]);
      state.air = air; state.nowcast = nc; state.aurora = aur; state.water = water; state.dwd = dwd; state.ens = ens;
      renderAir(air); renderNowcast(nc); renderAurora(); renderWater(); renderDwd();
      const hs = document.querySelector('.hero-strip'); if (hs) hs.outerHTML = heroStrip(fc);
      renderDaily(state.analysis, sb);
      renderFaves(); maybeNotify();
      /* climate archive — resolves the parallel fetch, fills anomaly chips, records, history */
      if (!state.clim && archiveP) { const arc = await archiveP; if (arc) { try { state.clim = buildClim(arc); } catch (e) { state.clim = null; } } }
      if (state.clim) { state.analysis = analyze(fc, state.clim); renderDetails(fc, state.analysis); renderDaily(state.analysis, sb); renderHistory(fc, state.analysis, state.clim); }
      else { const hi = $('#history'); if (hi) hi.innerHTML = '<div class="chart-card">' + esc(tr('stripes_unavail')) + '</div>'; }
      ensureStripes();
      state.alerts = buildAlerts(state.analysis, state.clim || FALLBACK_CLIM, sb); renderAlerts(state.alerts);
    } catch (e) {
      if (sky.raf) { cancelAnimationFrame(sky.raf); sky.raf = null; }
      console.error(e); toast(tr('t_loadfail')); if (state.lastGood) setUpdated(state.lastGood.obsMs, true);
      $('#hero').innerHTML = `<div class="hero-content" style="padding:24px"><div class="hero-cond">${tr('err_loaded')}</div><div class="hero-feels">${esc(e.message)} — <a href="#" id="retry">retry</a></div></div>`;
      const r = $('#retry'); if (r) r.onclick = ev => { ev.preventDefault(); load(true); };
    }
  }
  function setLocation(loc) { state.loc = loc; localStorage.setItem(LS.loc, JSON.stringify(loc)); state.clim = null; state.ens = null; state.dwd = null; closeSearch(); $('#searchInput').value = ''; load(true); if (state.map.inited && state.map.scope === 'near') scanArea(); }
  function reRender() { if (!state.forecast) return; renderHero(state.forecast, state.analysis); renderBriefing(state.forecast); renderBestOutside(state.forecast); renderDetails(state.forecast, state.analysis); renderAurora(); renderSunMoon(); renderDwd(); renderNowcast(state.nowcast); renderMeteogram(); renderAir(state.air); renderWater(); renderDaily(state.analysis, state.stormByDate); if (state.clim) renderHistory(state.forecast, state.analysis, state.clim); if (state.longData) { renderStripes(state.longData); const o = $('#onthisday'); if (o) o.textContent = onThisDay(); } state.alerts = buildAlerts(state.analysis, state.clim || FALLBACK_CLIM, state.stormByDate); renderAlerts(state.alerts); }

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
  function switchTab(name) {
    state.tab = name;
    document.querySelectorAll('.tabbar [role=tab]').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    document.querySelectorAll('.tab').forEach(p => { const on = p.id === 'tab-' + name; p.hidden = !on; if (on) { p.classList.remove('enter'); void p.offsetWidth; p.classList.add('enter'); } });
    if (name === 'map') { initMap(); if (state.map.inited && state.map.leaflet) setTimeout(() => state.map.leaflet.invalidateSize(), 60); }
    if (name === 'hours') renderMeteogram();
    window.scrollTo(0, 0);
  }
  function syncSettings() {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    [['#unitSeg', 'data-u', state.units], ['#langSeg', 'data-l', state.lang], ['#themeSeg', 'data-t', theme]].forEach(([sel, at, val]) => { const g = $(sel); if (g) [...g.children].forEach(b => b.classList.toggle('active', b.getAttribute(at) === val)); });
    const on = ('Notification' in window) && Notification.permission === 'granted', bell = $('#bellBtn'); if (bell) { bell.classList.toggle('on', on); bell.textContent = on ? tr('alerts_on') : tr('alerts_enable'); }
  }
  function openSheet() { const s = $('#settingsSheet'); if (s) { s.hidden = false; const b = $('#settingsBtn'); if (b) b.setAttribute('aria-expanded', 'true'); syncSettings(); } }
  function closeSheet() { const s = $('#settingsSheet'); if (s) { s.hidden = true; const b = $('#settingsBtn'); if (b) b.setAttribute('aria-expanded', 'false'); } }
  $('#tabbar').addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (b) switchTab(b.dataset.tab); });
  $('#meteoRange').addEventListener('click', e => { const b = e.target.closest('button[data-h]'); if (!b) return; state.meteoH = +b.dataset.h; [...$('#meteoRange').children].forEach(x => x.classList.toggle('active', x === b)); renderMeteogram(); });
  $('#settingsBtn').addEventListener('click', openSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  $('#unitSeg').addEventListener('click', e => { const b = e.target.closest('button[data-u]'); if (!b || b.dataset.u === state.units) return; state.units = b.dataset.u; localStorage.setItem(LS.units, state.units); reRender(); syncSettings(); });
  $('#langSeg').addEventListener('click', e => { const b = e.target.closest('button[data-l]'); if (!b || b.dataset.l === state.lang) return; state.lang = b.dataset.l; localStorage.setItem('aurora.lang', state.lang); applyStaticI18n(); reRender(); loadFact(); setBell(); setUpdated(state.lastGood && state.lastGood.obsMs); if (state.map.inited) scanArea(); syncSettings(); });
  $('#themeSeg').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (!b) return; applyTheme(b.dataset.t); syncSettings(); });
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
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t); localStorage.setItem(LS.theme, t);
    const tm = document.querySelector('meta[name=theme-color]'); if (tm) tm.content = t === 'light' ? '#EAF0F8' : '#080B14';
    if (state.forecast) { renderMeteogram(); renderDaily(state.analysis, state.stormByDate); if (state.clim && state.analysis) drawChart(state.analysis.slice(0, 14)); }
    if (state.map.inited) addBase();
  }
  $('#refreshBtn').addEventListener('click', () => { toast(tr('t_refreshing')); load(false); });
  $('#bellBtn').addEventListener('click', async () => {
    if (!('Notification' in window)) { toast(tr('t_notifns')); return; }
    if (Notification.permission === 'denied') { toast(tr('t_notifblk')); return; }
    if (Notification.permission === 'granted') { toast(tr('t_alertson')); localStorage.removeItem('aurora.notified' + keyLoc()); maybeNotify(); setBell(); syncSettings(); return; }
    const p = await Notification.requestPermission(); setBell(); syncSettings();
    if (p === 'granted') { toast(tr('t_alertsen')); localStorage.removeItem('aurora.notified' + keyLoc()); maybeNotify(); } else toast(tr('t_notifno'));
  });

  /* ---------------- init ---------------- */
  (function init() {
    applyTheme(localStorage.getItem(LS.theme) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
    applyStaticI18n();
    setBell(); syncSettings();
    renderFaves();
    startClock();
    loadFact();
    load(true);
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => load(false), 15 * 60 * 1000);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
    let rsz; window.addEventListener('resize', () => { if (state.map.leaflet) state.map.leaflet.invalidateSize(); if (sky.canvas) { skyResize(); skyBuild(sky.cat, sky.isDay); } clearTimeout(rsz); rsz = setTimeout(() => { if (state.tab === 'hours') renderMeteogram(); }, 180); });
  })();
})();
