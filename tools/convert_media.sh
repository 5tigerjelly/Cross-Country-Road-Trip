#!/bin/zsh
# Convert trip media to web-friendly formats.
# HEIC/JPG -> resized JPEG, MOV/MP4 -> H.264 MP4 (libx264 CRF) + poster JPEG.
set -u
SRC="/Users/chrisoh/Code/Cross-Country-Road-Trip/photos"
OUT="/Users/chrisoh/Code/Cross-Country-Road-Trip/site/media"
mkdir -p "$OUT"

cd "$SRC"

# Photos
for f in *.HEIC *.jpg *.JPEG; do
  [ -e "$f" ] || continue
  base="${f:r}"
  dest="$OUT/${base// /_}.jpg"
  [ -s "$dest" ] && continue
  sips -Z 1600 -s format jpeg -s formatOptions 72 "$f" --out "$dest" >/dev/null 2>&1 || echo "FAIL photo: $f"
done

# Videos -> H.264 High/yuv420p/faststart, max 960px wide, libx264 CRF 27 (much
# smaller than the old 2200k hardware encode at equal quality, universally
# mobile-web friendly). -map_metadata -1 drops all tags incl. GPS.
#
# HDR sources (HLG/PQ, 10-bit bt2020) must be tone-mapped to SDR bt709 or browsers
# apply an eye-searing EDR boost. That's done on the GPU via scale_vt, then the
# frame is downloaded to the CPU for libx264. The hwdownload sw format must match
# the surface bit depth (10-bit HDR -> p010le). SDR sources (already bt709) skip
# the whole VT path — a plain sw scale+encode, which also avoids a hwdownload
# format mismatch seen on full-range (yuvj420p) SDR clips.
# NOTE: run from a normal foreground shell — VT sessions are flaky from sandboxed
# background tasks (silent no-convert / -22 errors).
for f in *.MOV *.mov *.MP4; do
  [ -e "$f" ] || continue
  base="${f:r}"
  dest="$OUT/${base// /_}.mp4"
  poster="$OUT/${base// /_}_poster.jpg"
  # -s (not -e): a 0-byte stub from a failed run counts as "not done" so it retries
  if [ ! -s "$dest" ]; then
    tr=$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer -of default=nk=1:nw=1 "$f")
    if [ "$tr" = "arib-std-b67" ] || [ "$tr" = "smpte2084" ]; then
      # HDR: GPU tone-map to bt709, download 10-bit surface, encode
      # -map 0:v:0 -map "0:a:0?" : take only the first video + first audio track;
      # some iPhone clips carry extra "unknown"-codec audio/data streams that
      # ffmpeg's auto-map tries (and fails) to decode. The ? keeps silent clips ok.
      ffmpeg -hide_banner -loglevel error -init_hw_device videotoolbox=vt -filter_hw_device vt -i "$f" \
        -map 0:v:0 -map "0:a:0?" \
        -vf "scale='min(960,iw)':-2,hwupload,scale_vt=color_matrix=bt709:color_primaries=bt709:color_transfer=bt709,hwdownload,format=p010le,format=yuv420p" \
        -c:v libx264 -preset medium -crf 27 -profile:v high -level 4.0 \
        -c:a aac -b:a 96k -movflags +faststart -map_metadata -1 -y "$dest" \
        || { echo "FAIL video: $f"; rm -f "$dest"; }
    else
      # SDR (already bt709): plain sw scale + encode
      ffmpeg -hide_banner -loglevel error -i "$f" \
        -map 0:v:0 -map "0:a:0?" \
        -vf "scale='min(960,iw)':-2,format=yuv420p" \
        -c:v libx264 -preset medium -crf 27 -profile:v high -level 4.0 \
        -c:a aac -b:a 96k -movflags +faststart -map_metadata -1 -y "$dest" \
        || { echo "FAIL video: $f"; rm -f "$dest"; }
    fi
  fi
  if [ ! -s "$poster" ] && [ -s "$dest" ]; then
    ffmpeg -hide_banner -loglevel error -i "$dest" -frames:v 1 -q:v 5 -y "$poster" || echo "FAIL poster: $f"
  fi
done

# Privacy: sips preserves EXIF GPS on the converted JPEGs — strip all location
# tags from shipped photos so exact coordinates (incl. home) never leave the box.
# Videos already carry no GPS (encoded with -map_metadata -1). Idempotent.
exiftool -q -gps:all= -overwrite_original -ext jpg -ext jpeg -r "$OUT" >/dev/null 2>&1 || true

# safety net: flag any output that is still HDR (tone-map silently skipped)
bad=0
for m in "$OUT"/*.mp4; do
  ct=$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer -of csv=p=0 "$m" 2>/dev/null | tr -d ',')
  if [ "$ct" != "bt709" ] && [ "$ct" != "unknown" ] && [ -n "$ct" ]; then
    echo "STILL-HDR: ${m:t} ($ct)"; bad=$((bad+1))
  fi
done
[ $bad -gt 0 ] && echo "WARNING: $bad videos are still HDR — delete them and re-run in a GPU-capable (foreground) shell"
echo "DONE. $(ls "$OUT" | wc -l) files in $OUT"
