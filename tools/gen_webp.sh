#!/bin/zsh
# Generate small/medium/large WebP variants of every JPEG in site/media/.
# Originals (photos/ and site/media/*.jpg) are left untouched.
#   sm  480px wide  -> media card thumbnail + video posters
#   md 1024px wide  -> lightbox on small screens
#   lg 1600px wide  -> lightbox full view
# Idempotent: skips variants that already exist. Requires: brew install webp
set -u
export PATH="/opt/homebrew/bin:$PATH"
MEDIA="/Users/chrisoh/Code/Cross-Country-Road-Trip/site/media"
mkdir -p "$MEDIA/sm" "$MEDIA/md" "$MEDIA/lg"

typeset -A WIDTH QUALITY
WIDTH=(sm 480 md 1024 lg 1600)
QUALITY=(sm 72 md 74 lg 78)

n=0
for f in "$MEDIA"/*.jpg; do
  [ -e "$f" ] || continue
  base="${${f:t}:r}"
  iw=$(sips -g pixelWidth "$f" 2>/dev/null | awk '/pixelWidth/{print $2}')
  [ -z "$iw" ] && { echo "SKIP (no width): $base"; continue; }
  for size in sm md lg; do
    # posters only need the small size (they back the video thumbnail)
    if [[ "$base" == *_poster && "$size" != "sm" ]]; then continue; fi
    dest="$MEDIA/$size/$base.webp"
    [ -e "$dest" ] && continue
    tw=${WIDTH[$size]}
    if [ "$iw" -le "$tw" ]; then
      cwebp -quiet -q ${QUALITY[$size]} "$f" -o "$dest" || echo "FAIL: $base ($size)"
    else
      cwebp -quiet -q ${QUALITY[$size]} -resize $tw 0 "$f" -o "$dest" || echo "FAIL: $base ($size)"
    fi
    [ -e "$dest" ] && n=$((n+1))
  done
done
echo "DONE. generated $n new webp files"
du -sh "$MEDIA/sm" "$MEDIA/md" "$MEDIA/lg"
