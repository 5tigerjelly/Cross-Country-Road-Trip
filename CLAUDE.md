# Cross-Country Road Trip — Agent Handoff Guide

Chris is driving a 2026 Tesla Model 3 RWD from **Mountain View, CA to Long Island
City, NY, July 6–10, 2026** (itinerary in [README.md](README.md)). We built an
interactive "time-travel" replay map of the trip. As of the end of July 7 (Day 2),
the data covers Mountain View → Sterling, CO. **Each evening, Chris adds that day's
photos + charging CSV and asks for the map to be updated — that's the most likely
task you're here for. See "Daily update procedure" below.**

## What exists

```
photos/                      # ORIGINALS (HEIC/MOV from iPhone 17 Pro) — never modify
tesla-super-charger/         # Tesla charging-history CSV exports (newest file wins)
hotels/                      # Booking voucher PDFs (check-in/out info)
build/exif.json              # cached exiftool dump (auto-refreshed by pipeline)
site/                        # THE DELIVERABLE — fully static web app, no build step
  index.html / app.js / style.css
  data/trip.json             # generated timeline (see schema below)
  data/trip.js               # same data as `window.TRIP_DATA = {...}` so file:// works
  media/*.jpg, *.mp4         # web-converted media (1600px JPEG, 960px H.264)
  media/sm|md|lg/*.webp      # 480/1024/1600px photo variants + sm video posters
tools/
  update_trip.sh             # ONE-SHOT daily update — runs the three below in order
  build_trip.py              # EXIF+CSV+hotels → OSRM routing → site/data/trip.json+.js
  convert_media.sh           # HEIC→JPEG (sips), MOV→MP4 (ffmpeg h264_videotoolbox)
  gen_webp.sh                # JPEG → sm/md/lg WebP (cwebp)
.claude/launch.json          # preview server: python3 -m http.server 8642 --dir site
```

All three conversion/generation scripts are **idempotent** (skip existing outputs),
so re-running the whole pipeline after adding files only processes what's new.

## The app (site/)

Mobile-first map replay: MapLibre GL (CDN) + Carto dark-matter style. A scrubbable /
auto-playing timeline moves a car marker along the road-snapped route; the traveled
line "reveals" with a glow, photos/videos appear at the moment they were taken
(tap → fullscreen lightbox), superchargers (⚡) and hotels (🛏) light up as they're
passed, live stats (miles/charges/kWh) tick up, and the remaining itinerary is a
dashed line with faint planned-stop dots. Intro overlay ("The Great Crossing"),
finale card at the end, follow-cam with a ⌖ re-center button.

Layout (Chris's requested design): on **mobile** (<760px) the screen is split — the
media card fills the top half (below the stats row, down to 50vh) and the map's
follow-cam keeps the car centered in the lower half via asymmetric `map.setPadding`
(top ≈52% of viewport height; see `setPad` in app.js). The map canvas itself is
still full-screen underneath. On **desktop** the card is a compact 300px box at the
bottom-right and padding is just enough to clear the dock.

Playback model (app.js): trip time is compressed — driving plays at `DRIVE = 650`
trip-seconds per real second (1×), each stop dwell compresses to ≤3.2s, and playback
slows to 35% for ~1.8s whenever a new photo/video appears ("linger"). The scrubber
operates in this compressed "play domain" via the `segs` piecewise mapping, so the
overnight hotel stay doesn't eat scrubber width. Intro/finale text, day numbers, and
the finale summary are all **computed from the data** — adding Day 3 requires no
app-code edits.

## trip.json schema (generated — don't hand-edit)

- `meta`: `t0`/`t1` (epoch-sec bounds of the traveled timeline), titles, day list
- `tz`: `[[epoch, utcOffsetHours], ...]` transitions (derived from media EXIF offsets)
- `track`: `[[t, lat, lon], ...]` road-snapped, time-interpolated; dwells appear as
  two identical coords at arrive/depart times. Monotonic in t.
- `stops`: start/charge/hotel events with `arrive`/`depart` (epoch), `lat/lon`,
  `label` ("City, ST"), `kwh`, `cost`, `tz`, hotel `name`/`night`
- `media`: `{id, src, poster, type: photo|video, t, tz, lat, lon, dur, w, h}` —
  lat/lon null for ~7 items (position is implied by `t` on the track). WebP paths are
  NOT stored; app.js derives `media/{sm,md,lg}/{id}.webp` from `id` and falls back to
  `src` (jpg) on error.
- `future`: `line` (dashed route coords, `[lon,lat]`) + `stops` (planned cities,
  `kind: charge|night|finish`)

## Daily update procedure (Day 3+)

1. Chris drops new photos/videos into `photos/` and a fresh charging CSV export into
   `tesla-super-charger/` (build_trip.py auto-picks the newest CSV by mtime).
2. **Manual edits in `tools/build_trip.py`** (the only non-automated part):
   - Give the previous hotel its departure: it currently has `depart=None` (= end of
     timeline). Follow the existing `hotel_cluster()` pattern — it derives coords +
     arrive/depart from geotagged media near the hotel during a local-time window.
   - Add the new night's hotel to the `hotels` list (voucher PDF in `hotels/` has
     name/address/dates; extract text with pdfplumber — install into a venv, system
     pip is PEP-668-locked).
   - Trim traveled cities off the front of the `FUTURE` list so the dashed line
     starts at the newest overnight stop (e.g. after Day 3, drop Sterling→Coralville
     and start FUTURE at Coralville).
   - If a new supercharger city isn't in the `FALLBACK` dict, add approximate coords
     (media taken during the charge usually pins it automatically; fallback is only
     a safety net — it warns and skips a charge with no coords at all).
3. Run `tools/update_trip.sh`. Takes a few minutes (exiftool ~1min, OSRM routing
   ~2min with 1.2s sleeps between batched requests, media conversion depends on
   volume). It prints stop timings — sanity-check them against the charging CSV.
4. Verify in the browser (`.claude/launch.json` has a `trip-map` preview server, or
   `python3 -m http.server 8642 --directory site`): play through the new day, check
   the new hotel marker, the shortened dashed line, and that the finale now says
   "END OF DAY 3".

Timezone note: the route crosses into Central (Nebraska, ~-101.4° on I-80) on Day 3
and Eastern (Indiana) on Day 4. Nothing to configure — tz transitions come from media
EXIF offsets — but if the clock looks wrong near a border, that's where to look
(`tz_steps` from anchors in build_trip.py).

## Hard-won environment facts

- **exiftool is the only trustworthy metadata source.** macOS `mdls` misinterprets
  HEIC local times using the Mac's current timezone. Photos: `DateTimeOriginal` +
  `OffsetTimeOriginal`; videos: `CreationDate` (has offset); `CreateDate` is UTC.
- iPhone videos are HEVC (`hvc1`) → must transcode for Chrome. `h264_videotoolbox`
  (hardware) is fast; ffmpeg's default autorotate handles Rotation 90/180 metadata —
  do NOT pass `-noautorotate`.
- The Homebrew ffmpeg build here has **no libwebp encoder** and sips can't write
  WebP → use `cwebp` (installed via `brew install webp` + `libtiff`). exiftool,
  ffmpeg, cwebp are all installed already.
- System pip is locked (PEP 668); use a venv for Python deps (pdfplumber etc.).
- OSRM public server (`router.project-osrm.org`) is free, no key; batch ≤20 coords
  per request, sleep ~1.2s between calls, retry on failure (build_trip.py does all
  this).
- No git repo here (as of Day 2). Don't commit anything without asking.

## App gotchas (learned by breaking them)

- **MapLibre DOM markers:** never put CSS `transform`, `transition`, `position`, or
  keyframe animations on the marker root element — MapLibre positions it with inline
  `position:absolute` + `transform`. Style only child elements (see `.stop-root` /
  `.stop-marker` split).
- **Route reveal alignment:** `line-progress` in MapLibre measures *Mercator-plane*
  distance. The car's progress fraction must use the same metric (`CumM` array in
  app.js), NOT real kilometers, or the glow head drifts ~7% from the car.
- **Follow-cam owns its zoom** (`followZoom`, enforced via `jumpTo` each frame while
  playing). Don't rely on a `flyTo` completing — scrubbing mid-flight interrupts it.
  User drag/wheel breaks follow and shows the ⌖ button.
- `dt` in the rAF loop is clamped to 0.1s so a backgrounded tab doesn't fast-forward
  on refocus.
- **Browser-preview quirk:** the preview tab freezes `requestAnimationFrame` when
  backgrounded — the map won't finish loading and clicks appear to do nothing until
  a screenshot "wakes" the tab. Take a screenshot first, then interact; don't
  misdiagnose this as an app bug. Also: JS `eval` right after `location.reload()`
  runs before app listeners attach — wait a beat or re-click.

## Constraints from Chris

- **Privacy (firm):** never publish exact home coordinates. Anything within 3km of
  home snaps to Mountain View city center (37.3861,-122.0839); stops display as
  city + state only. Preserve this if you touch build_trip.py.
- Originals in `photos/` are never modified or deleted; the site serves converted
  copies only.
- Mobile view first, desktop second (breakpoint 760px). Keep the vibe "cool and
  sleek" — dark map, cyan glow, playful but not cluttered. Chris iterates by
  feedback, so build → show → adjust.
- Playback speed history: started ~13 min/s, felt fast→slowed to 8.7, then "25%
  faster" → current DRIVE=650 (~10.8 min/s). He may tune again after watching Day 3.
- Sharing plan: static hosting (Netlify/Vercel — largest file is a 44MB mp4, so
  Cloudflare Pages' 25MB cap is out). `site/README.md` has user-facing instructions.
