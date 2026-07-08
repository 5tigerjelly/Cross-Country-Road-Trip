# Road Trip Time-Travel Map

An interactive replay of the CA → NY cross-country drive. Scrub through time (or hit
play) and watch the car cross the country, photos/videos popping up at the moment they
were taken, superchargers lighting up as they're used, and hotel nights marked along
the way. The rest of the planned route to Long Island City is drawn as a dashed line.

## Run locally

Just double-click `index.html` — it works straight from disk (trip data is embedded
via `data/trip.js`, so no server is required). Internet is still needed for map tiles.

A local server also works if you prefer:

```bash
cd site
python3 -m http.server 8642
# open http://localhost:8642
```

## Share with friends

The whole folder is a static site (~630 MB, mostly media). Easy options:

- **Netlify**: `npx netlify-cli deploy --dir site --prod` (free tier is fine)
- **Vercel**: `npx vercel site --prod`
- **Tailscale/local**: run the server above and share your tailnet URL

Note: exact home location is never in the published data — the start point and any
media taken near home are snapped to Mountain View city center.

## How it was built

- `../tools/build_trip.py` — turns photo/video EXIF (GPS + timestamps), the Tesla
  charging CSV, and hotel vouchers into `data/trip.json`: a time-indexed road-snapped
  track (via OSRM), charge/hotel stop events, media timeline, and the dashed future
  route. Re-run it if you add more photos or another day of charging history.
- `../tools/convert_media.sh` — converts HEIC → JPEG (1600 px) and MOV → H.264 MP4
  (960 px, hardware-encoded) + poster frames into `media/`. Idempotent: skips files
  that already exist.
- `app.js` — playback engine. Trip time is compressed: driving plays at ~13 min/s,
  stops/nights compress to a couple of seconds. Media, markers, stats, clock, and the
  glowing route reveal all derive from a single scrubbed timestamp.

## Adding day 3+ later

1. Drop the day's photos/videos into `../photos/`.
2. Export a fresh Tesla charging CSV into `../tesla-super-charger/` (newest file wins).
3. Add the new hotel to the `hotels` list in `../tools/build_trip.py`.
4. Run `../tools/update_trip.sh` — it re-extracts EXIF, rebuilds the timeline and
   route, converts new media, and generates WebP variants. All steps are idempotent,
   so only new files get processed.

## Media sizes

Originals stay untouched in `../photos/`. The site serves:

- `media/*.mp4` — 960px H.264 videos (+ `media/sm/*_poster.webp` thumbnails)
- `media/sm|md|lg/*.webp` — 480/1024/1600px photo variants
  (card shows `sm`; the lightbox loads `md`/`lg` only when opened)
- `media/*.jpg` — 1600px JPEG fallbacks if a WebP is missing
