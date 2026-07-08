#!/bin/zsh
# Convert trip media to web-friendly formats.
# HEIC/JPG -> resized JPEG, MOV/MP4 -> H.264 MP4 (hardware encode) + poster JPEG.
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
  [ -e "$dest" ] && continue
  sips -Z 1600 -s format jpeg -s formatOptions 72 "$f" --out "$dest" >/dev/null 2>&1 || echo "FAIL photo: $f"
done

# Videos: full-GPU pipeline — hw decode, explicit rotation (hw frames ignore the
# rotation tag), tone-map HDR (HLG/bt2020) down to SDR bt709 so browsers don't
# apply the eye-searing EDR boost, hw H.264 encode. Max 960px wide, no upscaling.
for f in *.MOV *.mov *.MP4; do
  [ -e "$f" ] || continue
  base="${f:r}"
  dest="$OUT/${base// /_}.mp4"
  poster="$OUT/${base// /_}_poster.jpg"
  if [ ! -e "$dest" ]; then
    probe=$(ffprobe -v error -select_streams v:0 \
      -show_entries stream=width,height -show_entries side_data=rotation \
      -of default=nw=1 "$f" 2>/dev/null)
    w=$(echo "$probe" | awk -F= '/^width/{print $2; exit}')
    h=$(echo "$probe" | awk -F= '/^height/{print $2; exit}')
    rot=$(echo "$probe" | awk -F= '/^rotation/{print $2; exit}')
    pre=""
    dispw=$w
    case "$rot" in
      -180|180) pre="transpose_vt=reversal," ;;
      -90)      pre="transpose_vt=clock,"  && dispw=$h ;;
      90)       pre="transpose_vt=cclock," && dispw=$h ;;
    esac
    tw=$(( dispw < 960 ? dispw : 960 ))
    ffmpeg -hide_banner -loglevel error \
      -hwaccel videotoolbox -hwaccel_output_format videotoolbox_vld -i "$f" \
      -vf "${pre}scale_vt=w=$tw:h=-2:color_matrix=bt709:color_primaries=bt709:color_transfer=bt709" \
      -c:v h264_videotoolbox -b:v 2200k \
      -c:a aac -b:a 96k -movflags +faststart -map_metadata -1 -y "$dest" \
      || { echo "hw path failed, sw fallback: $f";
           ffmpeg -hide_banner -loglevel error -i "$f" \
             -vf "scale='min(960,iw)':-2" -c:v h264_videotoolbox -b:v 2200k \
             -c:a aac -b:a 96k -movflags +faststart -map_metadata -1 -y "$dest" \
             || echo "FAIL video: $f"; }
  fi
  if [ ! -e "$poster" ]; then
    ffmpeg -hide_banner -loglevel error -i "$dest" -frames:v 1 -q:v 5 -y "$poster" || echo "FAIL poster: $f"
  fi
done

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
