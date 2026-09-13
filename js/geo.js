import { NEARBY_ZIP_LIMIT, discoveryMiles, meshId } from "./config.js";

/** Miles of bbox padding when choosing which state polygon shards to fetch. */
const SHARD_PAD_MILES = 10;

let rowsPromise = null;
let statesPromise = null;
const shardCache = new Map();

function zipId(row) {
  return String(row[0]);
}

function zipLat(row) {
  return row[1];
}

function zipLng(row) {
  return row[2];
}

export function loadZips() {
  if (!rowsPromise) {
    rowsPromise = fetch("data/us-zips.json").then((res) => {
      if (!res.ok) throw new Error("Could not load US ZIP data.");
      return res.json();
    });
  }
  return rowsPromise;
}

export function loadStateIndex() {
  if (!statesPromise) {
    statesPromise = fetch("data/us-states.json").then((res) => {
      if (!res.ok) throw new Error("Could not load ZIP region index.");
      return res.json();
    });
  }
  return statesPromise;
}

export function loadZctaShard(fips) {
  const id = String(fips).padStart(2, "0");
  if (!shardCache.has(id)) {
    shardCache.set(
      id,
      fetch(`data/zcta/${id}.json`).then((res) => {
        if (!res.ok) throw new Error("Could not load ZIP polygons.");
        return res.json();
      }).catch((err) => {
        shardCache.delete(id);
        throw err;
      })
    );
  }
  return shardCache.get(id);
}

export function haversineMiles(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** GPS others receive when Geo location is shared. */
export function publishedLoc(loc) {
  if (!loc || loc.lat == null || loc.lng == null) return null;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lng, lat, rings) {
  if (!rings?.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h += 1) {
    if (pointInRing(lng, lat, rings[h])) return false;
  }
  return true;
}

export function zipInShard(lat, lng, shard) {
  if (!shard?.length) return null;
  for (const rec of shard) {
    const zip = rec[0];
    const minLng = rec[1];
    const minLat = rec[2];
    const maxLng = rec[3];
    const maxLat = rec[4];
    const polygons = rec[5];
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    for (const rings of polygons) {
      if (pointInPolygon(lng, lat, rings)) return String(zip);
    }
  }
  return null;
}

function boxesOverlap(minLng, minLat, maxLng, maxLat, padMinLng, padMinLat, padMaxLng, padMaxLat) {
  return minLng <= padMaxLng && maxLng >= padMinLng && minLat <= padMaxLat && maxLat >= padMinLat;
}

export function shardsForPoint(lat, lng, states, padMiles = SHARD_PAD_MILES) {
  if (!states?.length) return [];
  const latPad = padMiles / 69;
  const lngPad = padMiles / Math.max(0.01, 69 * Math.cos((lat * Math.PI) / 180));
  const padMinLat = lat - latPad;
  const padMaxLat = lat + latPad;
  const padMinLng = lng - lngPad;
  const padMaxLng = lng + lngPad;
  const hits = [];
  for (const row of states) {
    const fips = String(row[0]).padStart(2, "0");
    if (boxesOverlap(row[1], row[2], row[3], row[4], padMinLng, padMinLat, padMaxLng, padMaxLat)) {
      hits.push(fips);
    }
  }
  if (hits.length) return hits;
  let best = null;
  let bestD = Infinity;
  for (const row of states) {
    const cx = (row[1] + row[3]) / 2;
    const cy = (row[2] + row[4]) / 2;
    const dLat = lat - cy;
    const dLng = lng - cx;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = String(row[0]).padStart(2, "0");
    }
  }
  return best ? [best] : [];
}

export function nearestZip(lat, lng, rows) {
  let best = null;
  let bestD = Infinity;
  for (const row of rows) {
    const dLat = lat - zipLat(row);
    const dLng = lng - zipLng(row);
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = row;
    }
  }
  if (!best) return null;
  return {
    zip: zipId(best),
    lat: zipLat(best),
    lng: zipLng(best),
  };
}

function zipFromRows(zip, rows) {
  const id = String(zip);
  for (const row of rows) {
    if (zipId(row) === id) {
      return { zip: id, lat: zipLat(row), lng: zipLng(row) };
    }
  }
  return { zip: id, lat: null, lng: null };
}

export async function containingZip(lat, lng, rows) {
  try {
    const states = await loadStateIndex();
    const fipsList = shardsForPoint(lat, lng, states);
    const shards = await Promise.all(
      fipsList.map((fips) => loadZctaShard(fips).catch(() => null))
    );
    for (const shard of shards) {
      const zip = zipInShard(lat, lng, shard);
      if (zip) return zipFromRows(zip, rows);
    }
  } catch {
    /* fall through to centroid */
  }
  return nearestZip(lat, lng, rows);
}

export function zipRoomId(zip) {
  return `${meshId()}z-${zip}`;
}

export function nearbyZips(lat, lng, rows, { miles, limit = NEARBY_ZIP_LIMIT, excludeZip } = {}) {
  const radius = discoveryMiles(miles);
  const latPad = radius / 69;
  const lngPad = radius / Math.max(0.01, 69 * Math.cos((lat * Math.PI) / 180));
  const minLat = lat - latPad;
  const maxLat = lat + latPad;
  const minLng = lng - lngPad;
  const maxLng = lng + lngPad;
  const skip = excludeZip == null ? "" : String(excludeZip);
  const found = [];
  for (const row of rows) {
    const zip = zipId(row);
    if (zip === skip) continue;
    const zLat = zipLat(row);
    const zLng = zipLng(row);
    if (zLat < minLat || zLat > maxLat || zLng < minLng || zLng > maxLng) continue;
    const d = haversineMiles(lat, lng, zLat, zLng);
    if (d > radius) continue;
    found.push({ zip, miles: d });
  }
  found.sort((a, b) => a.miles - b.miles);
  return found.slice(0, limit);
}

export async function discoveryRooms(loc, rows, { miles, limit = NEARBY_ZIP_LIMIT, homeZip } = {}) {
  if (!loc || !rows) return [];
  const home = homeZip || await containingZip(loc.lat, loc.lng, rows);
  if (!home) return [];
  const nearby = nearbyZips(loc.lat, loc.lng, rows, {
    miles,
    limit,
    excludeZip: home.zip,
  });
  return [
    { level: "zip", roomId: zipRoomId(home.zip), label: home.zip, role: "host" },
    ...nearby.map((z) => ({
      level: "zip",
      roomId: zipRoomId(z.zip),
      label: z.zip,
      role: "client",
    })),
  ];
}

/** Desktop windows usually have no GPS; fail faster than a phone permission prompt. */
export const GPS_TIMEOUT_MS = 8_000;
export const GPS_TIMEOUT_DESKTOP_MS = 4_000;

export function gpsTimeoutMs() {
  return typeof window !== "undefined" && window.localChatDesktop
    ? GPS_TIMEOUT_DESKTOP_MS
    : GPS_TIMEOUT_MS;
}

export function locateErrorMessage(err) {
  const code = err && err.code;
  if (err && err.name === "AbortError") return "Location lookup cancelled.";
  if (code === 1) return "Location permission was denied.";
  if (code === 2) return "This device could not determine a location.";
  if (code === 3) {
    return "Location timed out. Use a GPS-enabled browser and allow location access.";
  }
  return (err && err.message) || "Location was denied or failed.";
}

function abortError() {
  try {
    return new DOMException("Location lookup cancelled.", "AbortError");
  } catch {
    const err = new Error("Location lookup cancelled.");
    err.name = "AbortError";
    return err;
  }
}

function timeoutError() {
  const err = new Error("Timeout expired");
  err.code = 3;
  return err;
}

function getPosition({ signal, timeoutMs, enableHighAccuracy }) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser cannot share location. Use a GPS-enabled browser."));
      return;
    }
    let settled = false;
    let timer = 0;
    const finish = (cb, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      cb(value);
    };
    const onAbort = () => finish(reject, abortError());
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    timer = setTimeout(() => finish(reject, timeoutError()), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => finish(resolve, pos),
      (err) => finish(reject, err),
      { enableHighAccuracy, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

export async function locate({ signal } = {}) {
  const desktop = typeof window !== "undefined" && window.localChatDesktop;
  let position;
  try {
    position = await getPosition({
      signal,
      timeoutMs: gpsTimeoutMs(),
      enableHighAccuracy: !desktop,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    throw new Error(locateErrorMessage(err));
  }
  const rawLat = position.coords.latitude;
  const rawLng = position.coords.longitude;
  const rows = await loadZips();
  const home = await containingZip(rawLat, rawLng, rows);
  if (!home) throw new Error("Could not match that location to a US ZIP code.");
  const raw = { lat: rawLat, lng: rawLng };
  return {
    loc: raw,
    zip: home.zip,
    raw,
  };
}
