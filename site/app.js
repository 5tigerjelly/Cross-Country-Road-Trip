/* Cross-Country Road Trip — interactive time-travel map */
(async function () {
  // data/trip.js (script tag) sets window.TRIP_DATA so file:// works; fetch is the fallback
  const data = window.TRIP_DATA || await fetch("data/trip.json").then(r => r.json());
  window.addEventListener("unhandledrejection", e => { window._appError = String(e.reason && e.reason.stack || e.reason); });
  window.addEventListener("error", e => { window._appError = String(e.message); });
  const track = data.track;           // [t, lat, lon]
  const stops = data.stops;
  const media = data.media.filter(m => m.t >= data.meta.t0 && m.t <= data.meta.t1);
  const T0 = data.meta.t0, T1 = data.meta.t1;

  // ---------- track helpers ----------
  const N = track.length;
  const Ts = new Float64Array(N), La = new Float64Array(N), Lo = new Float64Array(N), Cum = new Float64Array(N);
  const CumM = new Float64Array(N); // mercator-plane length — matches MapLibre's line-progress metric
  const R = 6371, rad = Math.PI / 180;
  const hav = (a1, o1, a2, o2) => {
    const h = Math.sin((a2 - a1) * rad / 2) ** 2 + Math.cos(a1 * rad) * Math.cos(a2 * rad) * Math.sin((o2 - o1) * rad / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * rad / 2));
  for (let i = 0; i < N; i++) {
    Ts[i] = track[i][0]; La[i] = track[i][1]; Lo[i] = track[i][2];
    Cum[i] = i ? Cum[i - 1] + hav(La[i - 1], Lo[i - 1], La[i], Lo[i]) : 0;
    CumM[i] = i ? CumM[i - 1] + Math.hypot((Lo[i] - Lo[i - 1]) * rad, mercY(La[i]) - mercY(La[i - 1])) : 0;
  }
  const TOTAL_KM = Cum[N - 1], TOTAL_M = CumM[N - 1];
  const bisect = (arr, x) => { // last index with arr[i] <= x
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; arr[mid] <= x ? lo = mid : hi = mid - 1; }
    return lo;
  };
  function posAt(t) {
    if (t <= Ts[0]) return { lat: La[0], lon: Lo[0], i: 0, km: 0, frac: 0 };
    if (t >= Ts[N - 1]) return { lat: La[N - 1], lon: Lo[N - 1], i: N - 1, km: TOTAL_KM, frac: 1 };
    const i = bisect(Ts, t);
    const j = Math.min(i + 1, N - 1);
    const f = Ts[j] > Ts[i] ? (t - Ts[i]) / (Ts[j] - Ts[i]) : 0;
    return {
      lat: La[i] + (La[j] - La[i]) * f,
      lon: Lo[i] + (Lo[j] - Lo[i]) * f,
      i, km: Cum[i] + (Cum[j] - Cum[i]) * f,
      frac: (CumM[i] + (CumM[j] - CumM[i]) * f) / TOTAL_M,
    };
  }

  // ---------- playback mapping (compress dwells) ----------
  const DRIVE = 812;        // trip-seconds per play-second at 1× while driving (+25% over 650)
  const DWELL_PLAY = 3.2;   // play-seconds per stop dwell at 1×
  const dwells = stops
    .map(s => ({ a: s.arrive, d: s.depart == null ? T1 : s.depart, s }))
    .filter(w => w.d - w.a > 300 && w.a < T1)
    .sort((x, y) => x.a - y.a);
  const segs = []; // {t0,t1,p0,p1}
  let cursor = T0, pcum = 0;
  const pushSeg = (t0, t1, dur) => { if (t1 > t0) { segs.push({ t0, t1, p0: pcum, p1: pcum + dur }); pcum += dur; } };
  for (const w of dwells) {
    pushSeg(cursor, w.a, (w.a - cursor) / DRIVE);
    pushSeg(w.a, w.d, Math.min((w.d - w.a) / DRIVE, DWELL_PLAY));
    cursor = w.d;
  }
  pushSeg(cursor, T1, (T1 - cursor) / DRIVE);
  const PLAY_TOTAL = pcum;
  const play2trip = p => {
    p = Math.max(0, Math.min(PLAY_TOTAL, p));
    for (const s of segs) if (p <= s.p1) return s.t0 + (s.t1 - s.t0) * ((p - s.p0) / (s.p1 - s.p0 || 1));
    return T1;
  };
  const trip2play = t => {
    t = Math.max(T0, Math.min(T1, t));
    for (const s of segs) if (t <= s.t1) return s.p0 + (s.p1 - s.p0) * ((t - s.t0) / (s.t1 - s.t0 || 1));
    return PLAY_TOTAL;
  };

  // ---------- time / phase helpers ----------
  const tzAt = t => { let z = data.tz[0][1]; for (const [tt, off] of data.tz) if (t >= tt) z = off; return z; };
  const TZ_NAME = { "-7": "PT", "-6": "MT", "-5": "CT", "-4": "ET" };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function localParts(t) {
    const z = tzAt(t);
    const d = new Date((t + z * 3600) * 1000);
    let h = d.getUTCHours(); const m = d.getUTCMinutes();
    const ampm = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return {
      time: `${h}:${String(m).padStart(2, "0")} ${ampm}`,
      day: `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`,
      date: d.getUTCDate(), tzName: TZ_NAME[z] || "",
    };
  }
  const localDayIndex = t => Math.floor((t + tzAt(t) * 3600) / 86400);
  const dayNumAt = t => localDayIndex(t) - localDayIndex(T0) + 1;

  // phases (dwell + drive labels)
  const phases = [];
  {
    const sorted = [...stops].sort((a, b) => a.arrive - b.arrive);
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i], dep = s.depart == null ? T1 : s.depart;
      if (s.type === "charge") phases.push({ t0: s.arrive, t1: dep, icon: "⚡", text: `Supercharging · ${s.label}`, sub: `${s.kwh} kWh`, dwell: true });
      else if (s.type === "hotel") phases.push({ t0: s.arrive, t1: dep, icon: "🌙", text: `Overnight · ${s.label}`, sub: s.name, dwell: true });
      const nxt = sorted[i + 1];
      if (nxt && nxt.arrive > dep) phases.push({ t0: dep, t1: nxt.arrive, icon: "🛣", text: `En route → ${nxt.label}`, dwell: false });
    }
  }
  const phaseAt = t => phases.find(p => t >= p.t0 && t < p.t1) || phases[phases.length - 1];

  // ---------- media helpers ----------
  const mTs = media.map(m => m.t);
  // Card shows a thinned set: at higher speed a burst of shots taken seconds apart
  // would flash past unreadably, so we drop any media that lands within MIN_CARD_GAP
  // play-seconds of the previously shown one. (Dropped ones still appear as map dots
  // and in the total count — they're just skipped on the card.)
  const MIN_CARD_GAP = 0.7;
  const cardIndices = [];
  { let lastP = -Infinity;
    for (let i = 0; i < media.length; i++) {
      const p = trip2play(media[i].t);
      if (p - lastP >= MIN_CARD_GAP) { cardIndices.push(i); lastP = p; }
    } }
  const cardTs = cardIndices.map(i => media[i].t);
  const cardMediaIdxAt = t => { if (!cardTs.length || t < cardTs[0]) return -1; return cardIndices[bisect(cardTs, t)]; };

  // ---------- day chapters (scrubber segments + intro day picker) ----------
  const D0 = dayNumAt(T0), DN = dayNumAt(T1);
  function dayStartTrip(d) {            // smallest trip-time whose local day >= d
    if (d <= D0) return T0;
    let lo = T0, hi = T1;
    while (hi - lo > 1) { const mid = (lo + hi) / 2; if (dayNumAt(mid) >= d) hi = mid; else lo = mid; }
    return hi;
  }
  const chapters = [];
  for (let d = D0; d <= DN; d++) {
    const t0 = dayStartTrip(d), t1 = d < DN ? dayStartTrip(d + 1) : T1;
    chapters.push({ d, t0, t1, p0: trip2play(t0), p1: trip2play(t1) });
  }

  // ---------- map ----------
  const map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    center: [-104, 40], zoom: 4,
    attributionControl: { compact: true },
  });
  const routeCoords = track.map(p => [p[2], p[1]]);
  const fullBounds = routeCoords.concat(data.future.line).reduce(
    (b, c) => b.extend(c), new maplibregl.LngLatBounds(routeCoords[0], routeCoords[0]));

  await new Promise(res => map.on("load", res));
  map.fitBounds(fullBounds, { padding: 60, duration: 0 });
  map.touchPitch.disable();
  // mobile: media card owns the top half, so pad the camera to keep the car
  // centered in the lower half; desktop: just clear the bottom dock
  const setPad = () => map.setPadding(innerWidth < 760
    ? { top: Math.round(innerHeight * 0.52), bottom: Math.min(160, Math.round(innerHeight * 0.2)), left: 0, right: 0 }
    : { top: 40, bottom: Math.min(150, Math.round(innerHeight * 0.18)), left: 0, right: 0 });
  setPad();
  addEventListener("resize", setPad);

  map.addSource("future", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: data.future.line } } });
  map.addSource("route", { type: "geojson", lineMetrics: true, data: { type: "Feature", geometry: { type: "LineString", coordinates: routeCoords } } });
  map.addSource("photodots", {
    type: "geojson",
    data: { type: "FeatureCollection", features: media.filter(m => m.lat != null).map((m, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: [m.lon, m.lat] }, properties: { t: m.t } })) },
  });
  map.addSource("planned", {
    type: "geojson",
    data: { type: "FeatureCollection", features: data.future.stops.map(s => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { label: s.label, kind: s.kind } })) },
  });

  map.addLayer({ id: "future-line", type: "line", source: "future", layout: { "line-cap": "round" }, paint: { "line-color": "#7dd3fc", "line-opacity": 0.35, "line-width": 2, "line-dasharray": [0.6, 2.4] } });
  map.addLayer({ id: "route-dim", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#38bdf8", "line-opacity": 0.22, "line-width": 3 } });
  map.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 11, "line-blur": 6, "line-opacity": 0.55 } });
  map.addLayer({ id: "route-core", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 3.5 } });
  map.addLayer({
    id: "photo-passed", type: "circle", source: "photodots",
    paint: { "circle-radius": 2.6, "circle-color": "#fbbf24", "circle-opacity": 0.75, "circle-stroke-width": 0 },
    filter: ["<=", ["get", "t"], 0],
  });
  map.addLayer({
    id: "planned-dots", type: "circle", source: "planned",
    paint: {
      "circle-radius": ["match", ["get", "kind"], "night", 5, "finish", 6, 3],
      "circle-color": ["match", ["get", "kind"], "night", "#c084fc", "finish", "#4ade80", "#64748b"],
      "circle-opacity": 0.55, "circle-stroke-width": 1, "circle-stroke-color": "rgba(255,255,255,.3)",
    },
  });
  map.addLayer({
    id: "planned-labels", type: "symbol", source: "planned", minzoom: 5,
    layout: { "text-field": ["get", "label"], "text-size": 10, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Montserrat Regular", "Open Sans Regular"] },
    paint: { "text-color": "#94a3b8", "text-halo-color": "#0b0f1a", "text-halo-width": 1.2 },
  });

  const setReveal = f => {
    f = Math.max(0.002, Math.min(0.9999, f));
    const grad = c => ["interpolate", ["linear"], ["line-progress"], 0, "#0ea5e9", Math.max(0.001, f - 0.001), c, f, "rgba(0,0,0,0)", 1, "rgba(0,0,0,0)"];
    map.setPaintProperty("route-core", "line-gradient", grad("#22d3ee"));
    map.setPaintProperty("route-glow", "line-gradient", grad("#22d3ee"));
  };

  // animate future dash (marching ants, subtle)
  const dashSeq = [[0.6, 2.4], [1.2, 2.4, 0.0001, 0.0001], [2.4, 2.4, 0.0001, 0.0001]];
  let dashI = 0;
  setInterval(() => { map.setPaintProperty("future-line", "line-dasharray", dashSeq[(dashI = (dashI + 1) % dashSeq.length)]); }, 400);

  // ---------- markers ----------
  const carEl = document.createElement("div");
  carEl.className = "car-marker";
  carEl.innerHTML = '<div class="car-pulse"></div><div class="car-body"><div class="car-arrow"></div></div>';
  const carBody = carEl.querySelector(".car-body");
  const carMarker = new maplibregl.Marker({ element: carEl }).setLngLat(routeCoords[0]).addTo(map);

  const stopMarkers = stops.map(s => {
    // outer div is positioned by MapLibre (inline transform) — never style/animate it;
    // all scaling, transitions, and pop animations live on the inner element
    const root = document.createElement("div");
    root.className = "stop-root";
    const el = document.createElement("div");
    const icon = s.type === "charge" ? "⚡" : s.type === "hotel" ? "🛏" : "🏁";
    el.className = `stop-marker ${s.type}`;
    el.textContent = icon;
    root.appendChild(el);
    const p = localParts(s.arrive);
    const html = s.type === "charge"
      ? `<div class="popup-title">⚡ ${s.label}</div><div class="popup-line"><b>${s.kwh} kWh</b> · $${(s.cost || "").trim()}</div><div class="popup-line">${p.day} · ${p.time} ${p.tzName}</div>`
      : s.type === "hotel"
        ? `<div class="popup-title">🛏 ${s.name}</div><div class="popup-line">${s.label}</div><div class="popup-line">Night of ${s.night}</div>`
        : `<div class="popup-title">🏁 ${s.label}</div><div class="popup-line">The journey begins · ${p.day}</div>`;
    const mk = new maplibregl.Marker({ element: root })
      .setLngLat([s.lon, s.lat])
      .setPopup(new maplibregl.Popup({ offset: 18, closeButton: false }).setHTML(html))
      .addTo(map);
    return { s, el, mk, lit: false };
  });

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const clockTime = $("clock-time"), clockDay = $("clock-day"), phaseLabel = $("phase-label");
  const statMiles = $("stat-miles"), statCharges = $("stat-charges"), statKwh = $("stat-kwh");
  const mediaCard = $("media-card"), mediaImg = $("media-img"), mediaVideo = $("media-video"), mediaTime = $("media-time");
  const toast = $("phase-toast"), toastIcon = $("phase-icon"), toastText = $("phase-text");
  const playBtn = $("play-btn"), iconPlay = $("icon-play"), iconPause = $("icon-pause");
  const speedBtn = $("speed-btn"), followBtn = $("follow-btn");
  const scrubber = $("scrubber"), scrubFill = $("scrub-fill"), scrubHandle = $("scrub-handle"), scrubTicks = $("scrub-ticks");

  // scrubber ticks
  for (const s of stops) {
    if (s.type === "start") continue;
    const el = document.createElement("div");
    el.className = "tick";
    el.textContent = s.type === "charge" ? "⚡" : "🛏";
    el.style.left = `${(trip2play(s.arrive) / PLAY_TOTAL) * 100}%`;
    scrubTicks.appendChild(el);
  }
  // day chapters (YouTube-style): a divider at each day boundary + a clickable
  // "Day N" label centered in its span that jumps to / watches that day
  const dayLabels = [];
  for (const c of chapters) {
    if (c.d > D0) {
      const dv = document.createElement("div");
      dv.className = "tick day";
      dv.style.left = `${(c.p0 / PLAY_TOTAL) * 100}%`;
      scrubTicks.appendChild(dv);
    }
    const lab = document.createElement("div");
    lab.className = "day-label";
    lab.textContent = `Day ${c.d}`;
    lab.style.left = `${((c.p0 + c.p1) / 2 / PLAY_TOTAL) * 100}%`;
    lab.addEventListener("pointerdown", e => {
      e.stopPropagation();
      segStart = c.p0; segEnd = c.p1; playP = c.p0; finaleShown = false;
      render(play2trip(playP));
      if (!playing) setPlaying(true);
    });
    scrubTicks.appendChild(lab);
    dayLabels.push({ c, el: lab });
  }

  // ---------- state ----------
  let playP = 0;                // play-domain position (seconds)
  let segStart = 0, segEnd = PLAY_TOTAL; // active playback window (whole trip, or one day)
  let playing = false;
  let speed = 1;
  const SPEEDS = [1, 2, 4, 0.5];
  let follow = true;
  const DEFAULT_FOLLOW_ZOOM = 6.8; // wide enough to see state lines + nearby cities
  let followZoom = DEFAULT_FOLLOW_ZOOM; // follow-cam owns the zoom; user zoom breaks follow
  let pendingFollow = false;
  let curMediaIdx = -2;
  let lastFrame = null;
  let scrubbing = false;
  let finaleShown = false;

  // ---------- media card ----------
  // WebP variants generated by tools/gen_webp.sh; fall back to the base jpg if absent
  const webp = (m, size) => `media/${size}/${m.id}.webp`;
  const posterSrc = m => `media/sm/${m.id}_poster.webp`;
  mediaImg.onerror = () => {
    if (curMediaIdx < 0 || mediaImg.dataset.fb) return;
    mediaImg.dataset.fb = "1";
    mediaImg.src = media[curMediaIdx].src;
  };
  let lastMediaChange = -1e9;
  function showMedia(idx) {
    if (idx === curMediaIdx) return;
    curMediaIdx = idx;
    if (idx >= 0) lastMediaChange = performance.now();
    if (idx < 0) { mediaCard.classList.add("hidden"); mediaVideo.pause(); return; }
    const m = media[idx];
    mediaCard.classList.remove("hidden");
    const frame = mediaCard.querySelector(".media-frame");
    frame.style.animation = "none"; void frame.offsetWidth; frame.style.animation = "";
    if (m.type === "video") {
      mediaImg.classList.add("hidden");
      mediaVideo.classList.remove("hidden");
      mediaVideo.poster = posterSrc(m);
      mediaVideo.src = m.src;
      if (!scrubbing) mediaVideo.play().catch(() => {});
    } else {
      mediaVideo.pause(); mediaVideo.removeAttribute("src");
      mediaVideo.classList.add("hidden");
      mediaImg.classList.remove("hidden");
      delete mediaImg.dataset.fb;
      mediaImg.src = webp(m, "sm");
      // preload next few thumbnails
      for (let k = idx + 1; k < Math.min(idx + 5, media.length); k++)
        if (media[k].type === "photo") { const im = new Image(); im.src = webp(media[k], "sm"); }
    }
    const p = localParts(m.t);
    mediaTime.textContent = `${m.type === "video" ? "▶" : "📷"} ${p.day} · ${p.time} ${p.tzName}`;
  }

  // ---------- render ----------
  let frameCount = 0;
  function render(t) {
    const pos = posAt(t);
    carMarker.setLngLat([pos.lon, pos.lat]);
    // bearing from a point slightly ahead
    const ahead = posAt(t + 90);
    if (ahead.lat !== pos.lat || ahead.lon !== pos.lon) {
      const y = Math.sin((ahead.lon - pos.lon) * rad) * Math.cos(ahead.lat * rad);
      const x = Math.cos(pos.lat * rad) * Math.sin(ahead.lat * rad) - Math.sin(pos.lat * rad) * Math.cos(ahead.lat * rad) * Math.cos((ahead.lon - pos.lon) * rad);
      carBody.style.transform = `rotate(${Math.atan2(y, x) / rad}deg)`;
    }
    if ((frameCount++ & 1) === 0) setReveal(pos.frac);
    if (follow && playing && !scrubbing) map.jumpTo({ center: [pos.lon, pos.lat], zoom: followZoom });

    // clock + phase
    const lp = localParts(t);
    clockTime.textContent = `${lp.time} ${lp.tzName}`;
    clockDay.textContent = `Day ${dayNumAt(t)} · ${lp.day}`;
    const ph = phaseAt(t);
    phaseLabel.textContent = ph ? `${ph.icon} ${ph.text}` : "";
    if (ph && ph.dwell && t < ph.t1 - 1) {
      toast.classList.remove("hidden");
      toastIcon.textContent = ph.icon;
      toastText.textContent = ph.sub ? `${ph.text} — ${ph.sub}` : ph.text;
    } else toast.classList.add("hidden");

    // stats
    statMiles.textContent = Math.round(pos.km * 0.621371).toLocaleString();
    let ch = 0, kwh = 0;
    for (const s of stops) if (s.type === "charge" && s.arrive <= t) { ch++; kwh += s.kwh; }
    statCharges.textContent = ch;
    statKwh.textContent = Math.round(kwh);

    // stop markers lit state
    for (const sm of stopMarkers) {
      const lit = sm.s.arrive <= t + 1;
      if (lit !== sm.lit) {
        sm.lit = lit;
        sm.el.classList.toggle("lit", lit);
        if (lit && playing) { sm.el.classList.add("pop"); setTimeout(() => sm.el.classList.remove("pop"), 600); }
      }
    }

    // photo dots filter (throttled)
    if ((frameCount & 15) === 0) map.setFilter("photo-passed", ["<=", ["get", "t"], t]);

    // media
    showMedia(cardMediaIdxAt(t));

    // scrubber
    const frac = playP / PLAY_TOTAL;
    scrubFill.style.width = `${frac * 100}%`;
    scrubHandle.style.left = `${frac * 100}%`;
    const curD = dayNumAt(t);
    for (const dl of dayLabels) dl.el.classList.toggle("current", dl.c.d === curD);
  }

  // ---------- playback loop ----------
  function tick(now) {
    requestAnimationFrame(tick);
    if (!playing || scrubbing) { lastFrame = now; return; }
    // clamp dt so a backgrounded tab doesn't fast-forward the trip on refocus
    const dt = lastFrame == null ? 0 : Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    // linger when a fresh photo/video just appeared so it can actually be seen
    const linger = now - lastMediaChange < 1800 ? 0.35 : 1;
    playP = Math.min(segEnd, playP + dt * speed * linger);
    render(play2trip(playP));
    if (playP >= segEnd) { setPlaying(false); showFinale(); }
  }
  requestAnimationFrame(tick);

  function setPlaying(v) {
    playing = v;
    iconPlay.classList.toggle("hidden", v);
    iconPause.classList.toggle("hidden", !v);
    if (!v) mediaVideo.pause();
    else if (curMediaIdx >= 0 && media[curMediaIdx].type === "video") mediaVideo.play().catch(() => {});
  }

  const wholeTrip = () => segStart <= 0.5 && segEnd >= PLAY_TOTAL - 0.5;
  function showFinale() {
    if (finaleShown) return;
    finaleShown = true;
    const fin = $("finale");
    const tEnd = play2trip(segEnd);
    const nDay = dayNumAt(tEnd);
    let lastStop = stops[0];
    for (const s of stops) if (s.arrive <= tEnd + 1) lastStop = s;
    const miles = Math.round(posAt(tEnd).km * 0.621371).toLocaleString();
    fin.querySelector(".intro-kicker").textContent = wholeTrip() ? `END OF DAY ${nDay}` : `DAY ${nDay}`;
    $("finale-title").textContent = lastStop.label;
    $("finale-body").textContent = wholeTrip()
      ? `${miles} miles, ${stops.filter(s => s.type === "charge").length} supercharges and ${media.length} memories in ${nDay} days. Still to come: the dashed line to New York.`
      : `That wraps Day ${nDay} — into ${lastStop.label}. Replay it, or pick another day.`;
    $("replay-btn").innerHTML = wholeTrip() ? "↺&nbsp; Replay the trip" : `↺&nbsp; Replay Day ${nDay}`;
    fin.classList.remove("hidden", "fade");
    map.flyTo({ center: fullBounds.getCenter(), zoom: 4.2, duration: 2500 });
  }
  $("replay-btn").addEventListener("click", () => {
    $("finale").classList.add("fade");
    finaleShown = false;
    playP = segStart; follow = true; followBtn.classList.add("hidden");
    followZoom = DEFAULT_FOLLOW_ZOOM;
    const pos = posAt(play2trip(playP));
    map.flyTo({ center: [pos.lon, pos.lat], zoom: DEFAULT_FOLLOW_ZOOM, duration: 1800 });
    map.once("moveend", () => setPlaying(true));
  });
  $("finale-more").addEventListener("click", () => {
    $("finale").classList.add("fade");
    setPlaying(false);
    finaleShown = false;
    started = false;
    intro.classList.remove("fade", "hidden");
  });
  $("finale").addEventListener("click", e => { if (e.target.id === "finale") $("finale").classList.add("fade"); });

  // ---------- controls ----------
  playBtn.addEventListener("click", () => {
    if (playP >= segEnd) playP = segStart;
    setPlaying(!playing);
  });
  speedBtn.addEventListener("click", () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    speedBtn.textContent = `${speed}×`;
  });
  followBtn.addEventListener("click", () => {
    followBtn.classList.add("hidden");
    followZoom = Math.max(map.getZoom(), 6);
    const pos = posAt(play2trip(playP));
    pendingFollow = true;
    map.easeTo({ center: [pos.lon, pos.lat], zoom: followZoom, duration: 800 });
    map.once("moveend", () => { if (pendingFollow) { pendingFollow = false; follow = true; } });
  });
  // scale stop markers with zoom so overview stays clean
  const scaleMarkers = () => {
    const s = Math.max(0.45, Math.min(1, (map.getZoom() - 3) / 5.5));
    for (const sm of stopMarkers) sm.el.style.setProperty("--mscale", s.toFixed(2));
  };
  map.on("zoom", scaleMarkers);
  scaleMarkers();

  const breakFollow = () => { pendingFollow = false; if (follow) { follow = false; followBtn.classList.remove("hidden"); } };
  map.on("dragstart", breakFollow);
  map.on("wheel", breakFollow);
  map.on("touchmove", e => { if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 1) breakFollow(); });

  // scrubber interaction
  function scrubTo(clientX) {
    const r = scrubber.querySelector("#scrub-track").getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    playP = frac * PLAY_TOTAL;
    render(play2trip(playP));
  }
  scrubber.addEventListener("pointerdown", e => {
    scrubbing = true;
    scrubber.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  });
  scrubber.addEventListener("pointermove", e => { if (scrubbing) scrubTo(e.clientX); });
  scrubber.addEventListener("pointerup", () => {
    scrubbing = false;
    finaleShown = playP >= PLAY_TOTAL ? finaleShown : false;
    if (playing && curMediaIdx >= 0 && media[curMediaIdx].type === "video") mediaVideo.play().catch(() => {});
  });

  // lightbox
  const lightbox = $("lightbox"), lbImg = $("lightbox-img"), lbVid = $("lightbox-video");
  mediaCard.addEventListener("click", () => {
    if (curMediaIdx < 0) return;
    const m = media[curMediaIdx];
    setPlaying(false);
    lightbox.classList.remove("hidden");
    if (m.type === "video") {
      lbImg.classList.add("hidden"); lbVid.classList.remove("hidden");
      lbVid.src = m.src; lbVid.muted = false; lbVid.play().catch(() => {});
    } else {
      lbVid.classList.add("hidden"); lbImg.classList.remove("hidden");
      delete lbImg.dataset.fb;
      lbImg.srcset = `${webp(m, "md")} 1024w, ${webp(m, "lg")} 1600w`;
      lbImg.sizes = "96vw";
      lbImg.src = webp(m, "lg");
    }
    const p = localParts(m.t);
    $("lightbox-caption").textContent = `${p.day} · ${p.time} ${p.tzName}`;
  });
  lbImg.onerror = () => {
    if (curMediaIdx < 0 || lbImg.dataset.fb) return;
    lbImg.dataset.fb = "1";
    lbImg.removeAttribute("srcset");
    lbImg.src = media[curMediaIdx].src;
  };
  const closeLb = () => { lightbox.classList.add("hidden"); lbVid.pause(); lbVid.removeAttribute("src"); };
  $("lightbox-close").addEventListener("click", closeLb);
  lightbox.addEventListener("click", e => { if (e.target === lightbox) closeLb(); });

  // keyboard
  document.addEventListener("keydown", e => {
    if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
    if (e.code === "ArrowRight") { playP = Math.min(PLAY_TOTAL, playP + 2); render(play2trip(playP)); }
    if (e.code === "ArrowLeft") { playP = Math.max(0, playP - 2); render(play2trip(playP)); }
    if (e.code === "Escape") closeLb();
  });

  // ---------- intro ----------
  render(T0);
  setReveal(0.002);
  const intro = $("intro");
  intro.querySelector("p").innerHTML =
    `2,900 miles · one Tesla · five days<br>Follow the trail so far — ${dayNumAt(T1)} days in.`;
  // day picker (most recent first): each chip plays just that day
  const introDays = $("intro-days");
  const stateOf = s => (s.split(",").pop() || "").trim();
  for (let k = chapters.length - 1; k >= 0; k--) {
    const c = chapters[k], day = data.meta.days[c.d - 1];
    const btn = document.createElement("button");
    btn.className = "day-chip";
    btn.innerHTML = `<b>Day ${c.d}</b><span>${day ? `${stateOf(day.from)} → ${stateOf(day.to)}` : ""}</span>`;
    btn.addEventListener("click", () => begin(c.p0, c.p1));
    introDays.appendChild(btn);
  }
  let started = false;
  function begin(pStart, pEnd) {
    if (started) return;
    started = true;
    segStart = pStart == null ? 0 : pStart;
    segEnd = pEnd == null ? PLAY_TOTAL : pEnd;
    playP = segStart;
    finaleShown = false;
    intro.classList.add("fade");
    const pos = posAt(play2trip(playP));
    map.flyTo({ center: [pos.lon, pos.lat], zoom: DEFAULT_FOLLOW_ZOOM, duration: 2600, essential: true });
    map.once("moveend", () => setPlaying(true));
  }
  $("start-btn").addEventListener("click", () => begin(0, PLAY_TOTAL));
  const autoplayTimer = setTimeout(() => begin(0, PLAY_TOTAL), 9000); // autoplay whole trip if the user just watches
  // don't let the autoplay hijack a deliberate day choice: cancel it once the
  // pointer is over the day picker
  introDays.addEventListener("pointerenter", () => clearTimeout(autoplayTimer));
})();
