#!/usr/bin/env node
/**
 * Compact mapshaper GeoJSON shards into [zip, bbox, polygons] files,
 * ZCTA centroids for us-zips.json, and FIPS bboxes for us-states.json.
 */
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const [splitDir, outDir, zipsPath, statesPath] = process.argv.slice(2);
if (!splitDir || !outDir || !zipsPath || !statesPath) {
  console.error("Usage: pack-zcta.mjs <split-dir> <zcta-out> <us-zips.json> <us-states.json>");
  process.exit(1);
}

function round5(n) {
  return Math.round(Number(n) * 1e5) / 1e5;
}

function compactRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const last = ring.length - 1;
  const closed =
    ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const end = closed ? last : ring.length;
  const out = [];
  let prevX = Infinity;
  let prevY = Infinity;
  for (let i = 0; i < end; i += 1) {
    const x = round5(ring[i][0]);
    const y = round5(ring[i][1]);
    if (x === prevX && y === prevY) continue;
    out.push([x, y]);
    prevX = x;
    prevY = y;
  }
  return out.length >= 3 ? out : null;
}

function compactPolygon(coords) {
  if (!Array.isArray(coords)) return null;
  const rings = [];
  for (const ring of coords) {
    const compact = compactRing(ring);
    if (compact) rings.push(compact);
  }
  return rings.length ? rings : null;
}

function geometryPolygons(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") {
    const poly = compactPolygon(geom.coordinates);
    return poly ? [poly] : [];
  }
  if (geom.type === "MultiPolygon") {
    const polys = [];
    for (const coords of geom.coordinates || []) {
      const poly = compactPolygon(coords);
      if (poly) polys.push(poly);
    }
    return polys;
  }
  return [];
}

function bboxOf(polygons) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [round5(minLng), round5(minLat), round5(maxLng), round5(maxLat)];
}

function ringCentroid(ring) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    twiceArea += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
}

function polygonArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

function featureCentroid(polygons) {
  let best = polygons[0][0];
  let bestA = -1;
  for (const rings of polygons) {
    const a = polygonArea(rings[0]);
    if (a > bestA) {
      bestA = a;
      best = rings[0];
    }
  }
  return ringCentroid(best);
}

function fipsFromName(file) {
  const base = path.basename(file, ".json");
  const m = base.match(/(\d{2})$/);
  return m ? m[1] : null;
}

function zipOf(props) {
  const raw = props?.zip || props?.ZCTA5CE20 || props?.GEOID20 || props?.GEOID || "";
  const zip = String(raw).replace(/\D/g, "").padStart(5, "0").slice(-5);
  return zip.length === 5 ? zip : "";
}

await mkdir(outDir, { recursive: true });
const existing = await readdir(outDir).catch(() => []);
for (const name of existing) {
  if (name.endsWith(".json")) await rm(path.join(outDir, name));
}

const files = (await readdir(splitDir)).filter((n) => n.endsWith(".json")).sort();
if (!files.length) {
  console.error("No GeoJSON shards in", splitDir);
  process.exit(1);
}

const points = new Map();
const stateBoxes = [];

for (const name of files) {
  const raw = JSON.parse(await readFile(path.join(splitDir, name), "utf8"));
  const features = raw.type === "FeatureCollection" ? raw.features : [raw];
  const packed = [];
  let fips = fipsFromName(name);
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const feat of features || []) {
    if (!fips) fips = String(feat?.properties?.STATEFP || "").padStart(2, "0");
    const zip = zipOf(feat?.properties || {});
    const polygons = geometryPolygons(feat?.geometry);
    if (!zip || !polygons.length) continue;
    const bbox = bboxOf(polygons);
    packed.push([zip, bbox[0], bbox[1], bbox[2], bbox[3], polygons]);
    if (bbox[0] < minLng) minLng = bbox[0];
    if (bbox[1] < minLat) minLat = bbox[1];
    if (bbox[2] > maxLng) maxLng = bbox[2];
    if (bbox[3] > maxLat) maxLat = bbox[3];
    if (!points.has(zip)) {
      const [lng, lat] = featureCentroid(polygons);
      points.set(zip, [zip, round5(lat), round5(lng)]);
    }
  }

  if (!packed.length || !fips || fips === "00") continue;
  packed.sort((a, b) => a[0].localeCompare(b[0]));
  const shardPath = path.join(outDir, `${fips}.json`);
  await writeFile(shardPath, JSON.stringify(packed));
  stateBoxes.push([fips, round5(minLng), round5(minLat), round5(maxLng), round5(maxLat)]);
  const bytes = (await readFile(shardPath)).length;
  console.log(`${fips}  ${packed.length} zips  ${(bytes / 1024).toFixed(1)} KB`);
}

stateBoxes.sort((a, b) => a[0].localeCompare(b[0]));
const zipRows = [...points.values()].sort((a, b) => a[0].localeCompare(b[0]));
await writeFile(zipsPath, JSON.stringify(zipRows));
await writeFile(statesPath, JSON.stringify(stateBoxes));
console.log(`us-zips.json  ${zipRows.length} rows`);
console.log(`us-states.json  ${stateBoxes.length} shards`);
