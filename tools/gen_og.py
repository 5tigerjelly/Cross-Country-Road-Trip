#!/usr/bin/env python3
"""Generate site/og-image.jpg — the social share card (1200x630).
Draws the real route from trip.json as a glowing line under the trip title."""
import json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = "/Users/chrisoh/Code/Cross-Country-Road-Trip"
W, H = 1200, 630
d = json.load(open(f"{ROOT}/site/data/trip.json"))
track = d["track"]
lons = [p[2] for p in track]; lats = [p[1] for p in track]
lo0, lo1, la0, la1 = min(lons), max(lons), min(lats), max(lats)
PADX, TOP, BOT = 90, 280, 520
X = lambda lon: PADX + (lon - lo0) / (lo1 - lo0) * (W - 2 * PADX)
Y = lambda lat: BOT - (lat - la0) / (la1 - la0) * (BOT - TOP)
pts = [(X(p[2]), Y(p[1])) for p in track[::15]]

# vertical gradient background
grad = Image.new("RGB", (1, H))
for y in range(H):
    t = y / H
    grad.putpixel((0, y), (int(11 + t * 7), int(15 + t * 10), int(26 + t * 22)))
img = grad.resize((W, H))
draw = ImageDraw.Draw(img, "RGBA")

# route glow (blurred) then crisp core
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).line(pts, fill=(34, 211, 238, 170), width=11, joint="curve")
glow = glow.filter(ImageFilter.GaussianBlur(9))
img.paste(glow, (0, 0), glow)
draw.line(pts, fill=(125, 211, 252, 255), width=3, joint="curve")
for (x, y), c in [(pts[0], (56, 189, 248)), (pts[-1], (74, 222, 128))]:
    draw.ellipse([x - 9, y - 9, x + 9, y + 9], fill=c + (255,))
    draw.ellipse([x - 15, y - 15, x + 15, y + 15], outline=c + (130,), width=2)

def font(sz, bold=True):
    cands = (["/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/HelveticaNeue.ttc"] if bold else
             ["/System/Library/Fonts/Supplemental/Arial.ttf",
              "/System/Library/Fonts/HelveticaNeue.ttc"])
    for p in cands:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default()

def center(txt, y, fnt, fill, tracking=0):
    if tracking:
        total = sum(draw.textlength(ch, font=fnt) + tracking for ch in txt) - tracking
        x = (W - total) / 2
        for ch in txt:
            draw.text((x, y), ch, font=fnt, fill=fill)
            x += draw.textlength(ch, font=fnt) + tracking
    else:
        draw.text(((W - draw.textlength(txt, font=fnt)) / 2, y), txt, font=fnt, fill=fill)

center("CROSS-COUNTRY  ·  JULY 2026", 66, font(22), (34, 211, 238, 255), tracking=6)
center("The Great Crossing", 100, font(78), (238, 242, 255, 255))
center("Mountain View, CA   →   Manhattan, NY", 208, font(30, False), (147, 160, 189, 255))
center("3,197 MILES      5 DAYS      ONE TESLA      33 SUPERCHARGERS", 578, font(21), (160, 172, 200, 255), tracking=2)

img.save(f"{ROOT}/site/og-image.jpg", quality=88)
print("wrote site/og-image.jpg", os.path.getsize(f"{ROOT}/site/og-image.jpg") // 1024, "KB")
