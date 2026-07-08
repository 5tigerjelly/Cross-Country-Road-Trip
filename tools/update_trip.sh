#!/bin/zsh
# One-shot update after adding a new day of trip data.
#
# Before running:
#   1. Copy the day's photos/videos into photos/
#   2. Export a fresh Tesla charging CSV into tesla-super-charger/ (newest file wins)
#   3. If a new hotel was booked, add it to the `hotels` list in tools/build_trip.py
#      (and extend the FUTURE route list / hotel PDFs as needed)
#
# Then: tools/update_trip.sh
set -e
export PATH="/opt/homebrew/bin:$PATH"
ROOT="/Users/chrisoh/Code/Cross-Country-Road-Trip"

echo "=== 1/3 rebuilding trip timeline (EXIF + charging CSV + OSRM routing) ==="
python3 "$ROOT/tools/build_trip.py"

echo "=== 2/3 converting new media (HEIC->JPEG, MOV->MP4) ==="
"$ROOT/tools/convert_media.sh"

echo "=== 3/3 generating WebP variants ==="
"$ROOT/tools/gen_webp.sh"

echo ""
echo "All done — open site/index.html to review."
echo "Reminder: if you stayed at a new hotel, make sure it's in tools/build_trip.py (hotels list)."
