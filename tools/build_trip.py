#!/usr/bin/env python3
"""Build site/data/trip.json from photo EXIF, Tesla charging CSV, and hotel info.

Pipeline:
  1. Media: exif.json (exiftool dump) -> timestamped, geotagged media items.
  2. Charges: Tesla CSV -> charge stops; coords refined from media taken during the session.
  3. Hotels: known stays; arrival/departure refined from media clusters at the hotel.
  4. Anchors: ordered (time, coord) points = start + charges + hotels + thinned en-route media.
  5. Route: OSRM /route through anchors -> road geometry; time interpolated by distance.
  6. Future: OSRM through remaining itinerary cities -> dashed preview line.

Privacy: coordinates within HOME_RADIUS_KM of home snap to Mountain View city center.
"""
import json, csv, math, sys, time, urllib.request, datetime, os, glob, subprocess

ROOT = "/Users/chrisoh/Code/Cross-Country-Road-Trip"
EXIF_JSON = os.path.join(ROOT, "build", "exif.json")
OUT = os.path.join(ROOT, "site", "data", "trip.json")

# newest charging export wins — just drop the new CSV into tesla-super-charger/
CHARGE_CSV = max(glob.glob(os.path.join(ROOT, "tesla-super-charger", "*.csv")), key=os.path.getmtime)
print(f"charging csv: {os.path.basename(CHARGE_CSV)}")

# refresh the EXIF dump if photos/ changed since the last run
os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
photos_mtime = max(os.path.getmtime(p) for p in glob.glob(os.path.join(ROOT, "photos", "*")))
if not os.path.exists(EXIF_JSON) or os.path.getmtime(EXIF_JSON) < photos_mtime:
    print("running exiftool over photos/ ...")
    with open(EXIF_JSON, "w") as f:
        subprocess.run(["exiftool", "-json", "-q", "-DateTimeOriginal", "-OffsetTimeOriginal",
                        "-CreateDate", "-CreationDate", "-GPSLatitude#", "-GPSLongitude#",
                        "-Duration#", "-ImageWidth", "-ImageHeight", "-Rotation", "-Orientation#",
                        "-MIMEType", os.path.join(ROOT, "photos")],
                       stdout=f, check=True, env={**os.environ, "PATH": "/opt/homebrew/bin:" + os.environ.get("PATH", "")})

HOME = (37.3722, -122.0575)          # actual start vicinity (kept private)
MTV_CENTER = (37.3861, -122.0839)    # public stand-in: Mountain View, CA
HOME_RADIUS_KM = 3.0
TRIP_START_UTC = datetime.datetime(2026, 7, 6, 13, 0, tzinfo=datetime.timezone.utc)  # 6:00 AM PT gate

def hav(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(h))

def parse_dt(s):
    # "2026:07:06 07:09:32-07:00" or "2026:07:06 07:09:32"
    if len(s) > 19:
        return datetime.datetime.strptime(s, "%Y:%m:%d %H:%M:%S%z")
    return datetime.datetime.strptime(s + "+00:00", "%Y:%m:%d %H:%M:%S%z")

# ---------- 1. media ----------
media = []
for x in json.load(open(EXIF_JSON)):
    name = os.path.basename(x["SourceFile"])
    t = tzoff = None
    if "CreationDate" in x:                     # videos: local time with offset
        dt = parse_dt(x["CreationDate"])
        t, tzoff = dt.timestamp(), dt.utcoffset().total_seconds()/3600
    elif "DateTimeOriginal" in x and "OffsetTimeOriginal" in x:  # photos
        dt = parse_dt(x["DateTimeOriginal"] + x["OffsetTimeOriginal"])
        t, tzoff = dt.timestamp(), dt.utcoffset().total_seconds()/3600
    elif "CreateDate" in x:                     # assume UTC
        dt = parse_dt(x["CreateDate"])
        t, tzoff = dt.timestamp(), None
    if t is None or t < TRIP_START_UTC.timestamp() - 3600:
        continue
    lat, lon = x.get("GPSLatitude"), x.get("GPSLongitude")
    if lat is not None and hav((lat, lon), HOME) < HOME_RADIUS_KM:
        lat, lon = MTV_CENTER
    base = os.path.splitext(name)[0].replace(" ", "_")
    is_vid = x.get("MIMEType", "").startswith("video")
    media.append({
        "id": base,
        "src": f"media/{base}.mp4" if is_vid else f"media/{base}.jpg",
        "poster": f"media/{base}_poster.jpg" if is_vid else None,
        "type": "video" if is_vid else "photo",
        "t": t, "tz": tzoff,
        "lat": lat, "lon": lon,
        "dur": x.get("Duration"),
        "w": x.get("ImageWidth"), "h": x.get("ImageHeight"),
    })
media.sort(key=lambda m: m["t"])
print(f"media: {len(media)} (geotagged {sum(1 for m in media if m['lat'] is not None)})")

# fill missing tz from nearest geotagged/tagged neighbor
for i, m in enumerate(media):
    if m["tz"] is None:
        for j in list(range(i-1, -1, -1)) + list(range(i+1, len(media))):
            if media[j]["tz"] is not None:
                m["tz"] = media[j]["tz"]; break

# ---------- 2. charges ----------
FALLBACK = {
    "Sunnyvale, CA - S Bernardo Ave": (37.3536, -122.0355),
    "Loomis, CA": (38.8177, -121.1908),
    "Truckee, CA - Deerfield Drive": (39.3270, -120.2070),
    "Lovelock, NV": (40.1832, -118.4712),
    "Winnemucca, NV": (40.9645, -117.7247),
    "Battle Mountain, NV": (40.6412, -116.9410),
    "Elko, NV": (40.8360, -115.7800),
    "Wells, NV": (41.1013, -114.9567),
    "Park City, UT": (40.7237, -111.5433),
    "Evanston, WY": (41.2615, -110.9633),
    "Rock Springs, WY": (41.5896, -109.2480),
    "Rawlins, WY": (41.7861, -107.2311),
    "Laramie, WY": (41.3092, -105.5850),
    "Cheyenne, WY": (41.1360, -104.8200),
    "Johnstown, CO": (40.3372, -104.9847),
}
charges = []
for row in csv.DictReader(open(CHARGE_CSV)):
    dt = datetime.datetime.fromisoformat(row["ChargeStartDateTime"])
    if dt.timestamp() < TRIP_START_UTC.timestamp() - 3600:
        continue
    kwh = float(row["QuantityBase"].split()[0])
    site = row["SiteLocationName"]
    city = site.split(" - ")[0]
    # duration heuristic: ~1.2 kWh/min average session rate, clamped
    dur_min = max(6, min(32, kwh / 1.2))
    # refine coords from media taken during the session
    win = [m for m in media if m["lat"] is not None and dt.timestamp() - 300 <= m["t"] <= dt.timestamp() + dur_min*60 + 900]
    fb = FALLBACK.get(site)
    coord = None
    if win:
        lats = sorted(m["lat"] for m in win); lons = sorted(m["lon"] for m in win)
        cand = (lats[len(lats)//2], lons[len(lons)//2])
        if fb is None or hav(cand, fb) < 15:
            coord = cand
    if coord is None:
        coord = fb
    if coord is None:
        print(f"  !! no coords for {site}, skipping"); continue
    charges.append({
        "type": "charge", "label": city, "site": site,
        "lat": coord[0], "lon": coord[1],
        "arrive": dt.timestamp(), "depart": dt.timestamp() + dur_min*60,
        "tz": dt.utcoffset().total_seconds()/3600,
        "kwh": round(kwh, 1), "cost": row["Total Inc. VAT"],
    })
charges.sort(key=lambda c: c["arrive"])
print(f"charges: {len(charges)}")

# snap Sunnyvale (near home) charge to public coord? it's ~4km from home, keep
# ---------- 3. hotels ----------
def hotel_cluster(center_guess, night_lo, night_hi):
    """Return (coord, arrive_t, depart_t) from media near a hotel during [lo,hi] utc epochs."""
    pts = [m for m in media if m["lat"] is not None and night_lo <= m["t"] <= night_hi
           and hav((m["lat"], m["lon"]), center_guess) < 1.5]
    if not pts:
        return center_guess, None, None
    lats = sorted(m["lat"] for m in pts); lons = sorted(m["lon"] for m in pts)
    return (lats[len(lats)//2], lons[len(lons)//2]), pts[0]["t"], pts[-1]["t"]

MT = datetime.timezone(datetime.timedelta(hours=-6))
wend_lo = datetime.datetime(2026, 7, 6, 19, 0, tzinfo=MT).timestamp()
wend_hi = datetime.datetime(2026, 7, 7, 6, 30, tzinfo=MT).timestamp()
wend_coord, wend_arr, wend_dep = hotel_cluster((40.7371, -114.0399), wend_lo, wend_hi)

ster_lo = datetime.datetime(2026, 7, 7, 18, 30, tzinfo=MT).timestamp()
ster_hi = datetime.datetime(2026, 7, 8, 6, 0, tzinfo=MT).timestamp()
ster_coord, ster_arr, ster_dep = hotel_cluster((40.6181, -103.1819), ster_lo, ster_hi)

hotels = [
    {"type": "hotel", "label": "West Wendover, NV", "name": "Quality Inn Stateline",
     "lat": wend_coord[0], "lon": wend_coord[1],
     "arrive": wend_arr or datetime.datetime(2026,7,6,20,25,tzinfo=MT).timestamp(),
     "depart": wend_dep or datetime.datetime(2026,7,7,6,20,tzinfo=MT).timestamp(),
     "tz": -6, "night": "Mon, Jul 6"},
    {"type": "hotel", "label": "Sterling, CO", "name": "Best Western Sundowner",
     "lat": ster_coord[0], "lon": ster_coord[1],
     "arrive": ster_arr or datetime.datetime(2026,7,7,19,45,tzinfo=MT).timestamp(),
     "depart": None,  # still there — end of timeline
     "tz": -6, "night": "Tue, Jul 7"},
]
print("wendover:", wend_coord, wend_arr, wend_dep)
print("sterling:", ster_coord, ster_arr, ster_dep)

# ---------- 4. anchors ----------
start_t = media[0]["t"] - 120 if media else TRIP_START_UTC.timestamp()
stops = [{"type": "start", "label": "Mountain View, CA", "lat": MTV_CENTER[0], "lon": MTV_CENTER[1],
          "arrive": start_t, "depart": start_t, "tz": -7}] + charges + hotels
stops.sort(key=lambda s: s["arrive"])

end_t = media[-1]["t"] + 300

# dwell windows to exclude media from being route vias
dwells = [(s["arrive"] - 240, (s["depart"] or end_t) + 240, (s["lat"], s["lon"])) for s in stops]

def in_dwell(m):
    for lo, hi, c in dwells:
        if lo <= m["t"] <= hi or (m["lat"] is not None and hav((m["lat"], m["lon"]), c) < 1.0):
            return True
    return False

anchors = []
for s in stops:
    anchors.append({"t": s["arrive"], "t2": s["depart"] or end_t, "lat": s["lat"], "lon": s["lon"],
                    "tz": s["tz"], "stop": s})
via = []
last = None
for m in media:
    if m["lat"] is None or in_dwell(m):
        continue
    if last and (m["t"] - last["t"] < 420 or hav((m["lat"], m["lon"]), (last["lat"], last["lon"])) < 5):
        continue
    via.append({"t": m["t"], "t2": m["t"], "lat": m["lat"], "lon": m["lon"], "tz": m["tz"], "stop": None})
    last = m
anchors += via
anchors.sort(key=lambda a: a["t"])
# drop anchors that go backwards in time vs previous depart
clean = []
for a in anchors:
    if clean and a["t"] < clean[-1]["t2"] - 60:
        continue
    clean.append(a)
anchors = clean
print(f"anchors: {len(anchors)} ({len(via)} media vias)")

# ---------- 5. OSRM route ----------
def osrm(coords):
    """coords: [(lat,lon),...] -> list of legs, each leg = [(lon,lat),...]"""
    locs = ";".join(f"{lo:.5f},{la:.5f}" for la, lo in coords)
    url = f"https://router.project-osrm.org/route/v1/driving/{locs}?overview=full&geometries=geojson&steps=false&continue_straight=false"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                data = json.load(r)
            if data.get("code") == "Ok":
                geom = data["routes"][0]["geometry"]["coordinates"]
                legs = data["routes"][0]["legs"]
                # split geometry into legs via waypoint snap points
                wps = [tuple(w["location"]) for w in data["waypoints"]]
                out, gi = [], 0
                for li in range(len(legs)):
                    # find end index: nearest geometry point to next waypoint, searching forward
                    target = wps[li+1]
                    best, bi = 1e18, gi
                    for k in range(gi, len(geom)):
                        d = (geom[k][0]-target[0])**2 + (geom[k][1]-target[1])**2
                        if d < best:
                            best, bi = d, k
                    out.append(geom[gi:bi+1] if bi > gi else [geom[gi], geom[min(bi, len(geom)-1)]])
                    gi = bi
                return out
        except Exception as e:
            print(f"  osrm retry {attempt}: {e}")
            time.sleep(3 + attempt*3)
    raise RuntimeError("OSRM failed for " + locs[:80])

# batch anchors in chunks of 20 coords (sharing boundary)
legs = []           # legs[i] = geometry between anchor i and i+1
i = 0
while i < len(anchors) - 1:
    chunk = anchors[i:i+20]
    got = osrm([(a["lat"], a["lon"]) for a in chunk])
    legs.extend(got)
    i += len(chunk) - 1
    time.sleep(1.2)
print(f"legs: {len(legs)}")

# assemble track: [t, lat, lon] — dwell holds + distance-interpolated legs
track = []
def push(t, la, lo):
    if track and abs(track[-1][0]-t) < 1 and abs(track[-1][1]-la) < 1e-6:
        return
    track.append([round(t), round(la, 5), round(lo, 5)])

for idx in range(len(anchors) - 1):
    a, b = anchors[idx], anchors[idx+1]
    push(a["t"], a["lat"], a["lon"])
    if a["t2"] > a["t"]:
        push(a["t2"], a["lat"], a["lon"])
    geom = legs[idx]
    t0, t1 = a["t2"], b["t"]
    if t1 <= t0:
        continue
    dists = [0.0]
    for k in range(1, len(geom)):
        dists.append(dists[-1] + hav((geom[k-1][1], geom[k-1][0]), (geom[k][1], geom[k][0])))
    total = dists[-1] or 1.0
    for k in range(1, len(geom) - 1):
        push(t0 + (t1 - t0) * dists[k] / total, geom[k][1], geom[k][0])
last_a = anchors[-1]
push(last_a["t"], last_a["lat"], last_a["lon"])
if last_a["t2"] > last_a["t"]:
    push(last_a["t2"], last_a["lat"], last_a["lon"])
print(f"track points: {len(track)}")

# thin track if huge (keep every point where displacement small)
if len(track) > 9000:
    keep = [track[0]]
    for p in track[1:-1]:
        if hav((keep[-1][1], keep[-1][2]), (p[1], p[2])) > 0.15 or p[0] - keep[-1][0] > 120:
            keep.append(p)
    keep.append(track[-1])
    track = keep
    print(f"thinned: {len(track)}")

# tz transitions from anchors
tz_steps = []
for a in anchors:
    if a["tz"] is None: continue
    if not tz_steps or tz_steps[-1][1] != a["tz"]:
        tz_steps.append([round(a["t"]), a["tz"]])

# ---------- 6. future route ----------
FUTURE = [
    ("Sterling, CO", ster_coord), ("Ogallala, NE", (41.1281,-101.7196)),
    ("North Platte, NE", (41.1403,-100.7601)), ("Kearney, NE", (40.7000,-99.0815)),
    ("York, NE", (40.8681,-97.5920)), ("Lincoln, NE", (40.8136,-96.7026)),
    ("Gretna, NE", (41.1408,-96.2397)), ("Des Moines, IA", (41.5910,-93.6037)),
    ("Williamsburg, IA", (41.6614,-92.0074)), ("Coralville, IA", (41.6764,-91.5805)),
    ("Davenport, IA", (41.5236,-90.5776)), ("Peru, IL", (41.3275,-89.1290)),
    ("Joliet, IL", (41.5250,-88.0817)), ("Mishawaka, IN", (41.6620,-86.1586)),
    ("Angola, IN", (41.6345,-84.9997)), ("Maumee, OH", (41.5628,-83.6538)),
    ("Avon, OH", (41.4517,-82.0354)), ("Austintown, OH", (41.1012,-80.7645)),
    ("DuBois, PA", (41.1192,-78.7600)), ("Lamar, PA", (41.0037,-77.5372)),
    ("Bloomsburg, PA", (41.0037,-76.4549)), ("Rockaway, NJ", (40.9012,-74.5140)),
    ("Long Island City, NY", (40.7447,-73.9485)),
]
fut_legs = []
i = 0
coords = [c for _, c in FUTURE]
while i < len(coords) - 1:
    chunk = coords[i:i+20]
    fut_legs.extend(osrm(chunk))
    i += len(chunk) - 1
    time.sleep(1.2)
future_line = []
for leg in fut_legs:
    for p in leg:
        if not future_line or (abs(future_line[-1][0]-p[0]) > 1e-4 or abs(future_line[-1][1]-p[1]) > 1e-4):
            future_line.append([round(p[0], 4), round(p[1], 4)])
print(f"future line: {len(future_line)} pts")

# planned future stops (day 3-5 charge/overnight cities, skip Sterling)
PLAN = {"Coralville, IA": "night", "Avon, OH": "night", "Long Island City, NY": "finish"}
future_stops = [{"label": n, "lat": c[0], "lon": c[1], "kind": PLAN.get(n, "charge")}
                for n, c in FUTURE[1:]]

# ---------- write ----------
out = {
    "meta": {
        "title": "CA → NY Cross-Country",
        "start": "Mountain View, CA", "finish": "Long Island City, NY",
        "t0": round(track[0][0]), "t1": round(track[-1][0]),
        "days": [
            {"label": "Day 1", "date": "Mon Jul 6", "from": "Mountain View, CA", "to": "West Wendover, NV"},
            {"label": "Day 2", "date": "Tue Jul 7", "from": "West Wendover, NV", "to": "Sterling, CO"},
        ],
    },
    "tz": tz_steps,
    "track": track,
    "stops": [{k: v for k, v in s.items() if k != "site"} for s in stops],
    "media": [m for m in media if m["t"] <= end_t],
    "future": {"line": future_line, "stops": future_stops},
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, "w"))
print(f"wrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
# JS twin so the site also works when index.html is opened directly via file://
js_out = OUT.replace(".json", ".js")
with open(js_out, "w") as f:
    f.write("window.TRIP_DATA = ")
    json.dump(out, f)
    f.write(";")
print(f"wrote {js_out}")
