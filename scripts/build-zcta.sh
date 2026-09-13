#!/usr/bin/env bash
# Rebuild ZIP point + per-state polygon shards from Census ZCTA boundaries.
# The app itself has no build step; run this only when refreshing data/.
#
# Source: Census cartographic ZCTA 5: 1:500,000 (generalized TIGER) plus
# 20m state outlines used only to shard files. Further simplified with mapshaper.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/scripts/.cache"
SPLIT="$CACHE/zcta-split"
OUT_ZCTA="$ROOT/data/zcta"

ZCTA_URL="https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip"
STATE_URL="https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_20m.zip"
ZCTA_ZIP="$CACHE/cb_2020_us_zcta520_500k.zip"
STATE_ZIP="$CACHE/cb_2024_us_state_20m.zip"
ZCTA_SHP="$CACHE/cb_2020_us_zcta520_500k.shp"
STATE_SHP="$CACHE/cb_2024_us_state_20m.shp"

mkdir -p "$CACHE" "$SPLIT" "$OUT_ZCTA"

download() {
  local url="$1" dest="$2"
  if [[ -s "$dest" ]]; then
    echo "Using cached $(basename "$dest")"
    return
  fi
  echo "Downloading $url"
  curl -L --fail --retry 3 --retry-delay 2 -o "$dest.partial" "$url"
  mv "$dest.partial" "$dest"
}

download "$ZCTA_URL" "$ZCTA_ZIP"
download "$STATE_URL" "$STATE_ZIP"

if [[ ! -f "$ZCTA_SHP" ]]; then
  echo "Unzipping ZCTA shapefile"
  unzip -o -d "$CACHE" "$ZCTA_ZIP"
fi
if [[ ! -f "$STATE_SHP" ]]; then
  echo "Unzipping state shapefile"
  unzip -o -d "$CACHE" "$STATE_ZIP"
fi

rm -rf "$SPLIT"
mkdir -p "$SPLIT"

echo "Simplifying ZCTAs and splitting by state (mapshaper)"
npx --yes mapshaper -i "$ZCTA_SHP" \
  -simplify 4% keep-shapes \
  -join "$STATE_SHP" fields=STATEFP largest-overlap \
  -filter "STATEFP != null" \
  -filter-fields ZCTA5CE20,STATEFP \
  -rename-fields zip=ZCTA5CE20 \
  -split STATEFP \
  -o "$SPLIT" format=geojson precision=0.00001

echo "Packing compact shards"
node "$ROOT/scripts/pack-zcta.mjs" "$SPLIT" "$OUT_ZCTA" "$ROOT/data/us-zips.json" "$ROOT/data/us-states.json"

echo "Done."
echo "Points: $(wc -c < "$ROOT/data/us-zips.json") bytes"
echo "States: $(wc -c < "$ROOT/data/us-states.json") bytes"
echo "Shards: $(ls -1 "$OUT_ZCTA" | wc -l) files"
