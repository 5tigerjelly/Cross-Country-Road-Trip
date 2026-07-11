#!/usr/bin/env python3
"""Generate site/og-image.jpg — the social share card (1200x630).
A subtle continental-US silhouette with the real route from trip.json glowing
across it, start/end dots labelled, under the trip title + stats."""
import json, os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = "/Users/chrisoh/Code/Cross-Country-Road-Trip"
W, H = 1200, 630

# --- coarse continental-US outline (lon,lat), clockwise from the NW coast ---
US = [
 (-124.6,48.3),(-124.1,46.2),(-124.0,43.8),(-124.2,40.8),(-122.4,37.8),(-121.0,35.4),
 (-118.5,34.0),(-117.2,32.7),(-115.0,32.7),(-114.7,32.7),(-111.1,31.3),(-108.2,31.8),
 (-106.5,31.8),(-104.9,29.9),(-103.0,29.0),(-101.5,29.8),(-99.8,27.7),(-97.5,25.9),
 (-96.5,28.4),(-94.8,29.3),(-93.8,29.7),(-91.5,29.5),(-90.0,29.2),(-89.2,29.3),
 (-88.4,30.3),(-87.5,30.3),(-85.6,29.7),(-84.0,30.1),(-83.0,29.1),(-82.8,27.9),
 (-82.0,26.7),(-81.1,25.2),(-80.4,25.4),(-80.1,26.6),(-80.6,28.4),(-81.3,29.8),
 (-81.4,30.7),(-80.9,32.0),(-79.2,33.9),(-77.9,34.2),(-75.9,35.6),(-75.5,37.0),
 (-75.9,37.9),(-74.5,39.4),(-74.0,40.5),(-72.9,41.0),(-71.1,41.5),(-70.3,41.7),
 (-70.0,42.7),(-70.8,43.3),(-69.1,44.0),(-67.2,44.7),(-67.0,45.7),(-68.0,47.4),
 (-69.2,47.5),(-71.5,45.1),(-74.7,45.0),(-76.9,43.8),(-79.0,43.3),(-79.1,42.9),
 (-81.0,42.3),(-82.5,41.7),(-83.1,42.0),(-82.5,43.6),(-82.6,45.0),(-84.4,46.0),
 (-84.7,45.8),(-87.6,46.9),(-90.4,46.7),(-92.3,46.7),(-94.6,49.0),(-95.2,49.0),
 (-104.0,49.0),(-114.0,49.0),(-122.8,49.0),(-124.6,48.3),
]
LON0, LON1, LAT0, LAT1 = -125.0, -66.0, 23.5, 49.6
LATM = math.cos(math.radians((LAT0 + LAT1) / 2))
# fit the map to the card width with uniform scale (preserve geographic aspect)
PADX = 62
s = (W - 2 * PADX) / ((LON1 - LON0) * LATM)
mapH = (LAT1 - LAT0) * s
Y0 = (H - mapH) / 2 + 6
X = lambda lon: PADX + (lon - LON0) * LATM * s
Y = lambda lat: Y0 + (LAT1 - lat) * s

d = json.load(open(f"{ROOT}/site/data/trip.json"))
route = [(X(p[2]), Y(p[1])) for p in d["track"][::12]]
us = [(X(lo), Y(la)) for lo, la in US]

# --- background gradient ---
grad = Image.new("RGB", (1, H))
for y in range(H):
    t = y / H
    grad.putpixel((0, y), (int(11 + t * 7), int(15 + t * 10), int(26 + t * 22)))
img = grad.resize((W, H))

# --- US silhouette: soft fill + thin stroke on its own layer ---
land = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ld = ImageDraw.Draw(land)
ld.polygon(us, fill=(41, 55, 82, 150))
img.paste(land, (0, 0), land.filter(ImageFilter.GaussianBlur(0.6)))
draw = ImageDraw.Draw(img, "RGBA")
draw.line(us + [us[0]], fill=(90, 110, 150, 150), width=2, joint="curve")

# --- route: blurred glow then crisp core ---
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).line(route, fill=(34, 211, 238, 200), width=10, joint="curve")
img.paste(glow.filter(ImageFilter.GaussianBlur(7)), (0, 0), glow.filter(ImageFilter.GaussianBlur(7)))
draw.line(route, fill=(150, 224, 255, 255), width=4, joint="curve")

def dot(pt, c):
    x, y = pt
    draw.ellipse([x - 9, y - 9, x + 9, y + 9], fill=c + (255,))
    draw.ellipse([x - 15, y - 15, x + 15, y + 15], outline=c + (140,), width=2)
dot(route[0], (56, 189, 248))
dot(route[-1], (74, 222, 128))

def fnt(sz, bold=True):
    for p in (["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/HelveticaNeue.ttc"]
              if bold else ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/HelveticaNeue.ttc"]):
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default()

def text(xy, txt, f, fill, anchor=None, track=0):
    if track:
        x, y = xy
        if anchor and "m" in anchor:
            tot = sum(draw.textlength(c, font=f) + track for c in txt) - track
            x -= tot / 2
        for c in txt:
            draw.text((x, y), c, font=f, fill=fill); x += draw.textlength(c, font=f) + track
    else:
        draw.text(xy, txt, font=f, fill=fill, anchor=anchor)

# endpoint labels (kept clear of the title band up top)
text((route[0][0], route[0][1] + 16), "MOUNTAIN VIEW, CA", fnt(17), (150, 205, 240, 255), anchor="ma", track=1)
text((route[-1][0] - 4, route[-1][1] + 16), "MANHATTAN, NY", fnt(17), (150, 230, 180, 255), anchor="ma", track=1)

# --- top scrim so the title reads over the map, then title ---
scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(scrim)
for y in range(230):
    sd.line([(0, y), (W, y)], fill=(11, 15, 26, int(215 * (1 - y / 230))))
img.paste(scrim, (0, 0), scrim)
draw = ImageDraw.Draw(img, "RGBA")
text((W / 2, 40), "CROSS-COUNTRY  ·  JULY 2026", fnt(21), (34, 211, 238, 255), anchor="ma", track=6)
text((W / 2, 74), "The Great Crossing", fnt(74), (238, 242, 255, 255), anchor="ma")

# --- bottom stats with a soft scrim ---
bs = Image.new("RGBA", (W, H), (0, 0, 0, 0))
bd = ImageDraw.Draw(bs)
for y in range(H - 70, H):
    bd.line([(0, y), (W, y)], fill=(11, 15, 26, int(210 * ((y - (H - 70)) / 70))))
img.paste(bs, (0, 0), bs)
ImageDraw.Draw(img, "RGBA")
text((W / 2, H - 42), "3,197 MILES      5 DAYS      ONE TESLA      33 SUPERCHARGERS",
     fnt(21), (170, 182, 210, 255), anchor="ma", track=2)

img.save(f"{ROOT}/site/og-image.jpg", quality=88)
print("wrote site/og-image.jpg", os.path.getsize(f"{ROOT}/site/og-image.jpg") // 1024, "KB")
