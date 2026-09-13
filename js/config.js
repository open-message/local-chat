export const APP_NAME = "Local Chat";
export const APP_VERSION = "1";
export const PROTOCOL = "lc1";
/** Live GitHub Pages host. Other origins get a separate PeerJS ZIP-room prefix. */
export const CANONICAL_HOST = "open-message.github.io";

function pageHost() {
  try {
    return String(location.hostname || "").toLowerCase();
  } catch {
    return "";
  }
}

function hostSlug(host) {
  return String(host || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
}

export function isCanonicalMesh() {
  return pageHost() === CANONICAL_HOST;
}

/**
 * PeerJS cloud IDs are global. ZIP rooms must be origin-scoped so localhost
 * and forks do not join or host the live site's rooms.
 */
export function meshId() {
  const host = pageHost();
  const proto = typeof location !== "undefined" ? location.protocol : "";
  if (
    proto === "file:" ||
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return `${PROTOCOL}dev`;
  }
  if (host !== CANONICAL_HOST) return `${PROTOCOL}x${hostSlug(host)}`;
  return PROTOCOL;
}

/** Paste a GA4 Measurement ID (G-XXXXXXXX) to enable analytics. Leave empty to skip gtag. */
export const GA_MEASUREMENT_ID = "G-JX0GHRY0H1";

export const PEERJS_CDN = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";

export const DISTANCE_OPTIONS = [0.25, 0.5, 1, 2, 3, 4, 5, 10, 25, 50, "all"];
export const PEOPLE_FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "connected", label: "Show connects only" },
  { id: "friends", label: "Show friends only" },
];
export const DEFAULT_DISTANCE_MILES = 25;
/** Join ZIP rooms whose centroids are within this radius when distance is "all". */
export const NEARBY_ZIP_MILES = 50;
/** Cap ZIP rooms so dense metros do not open dozens of PeerJS connects. */
export const NEARBY_ZIP_LIMIT = 20;

export function discoveryMiles(distance) {
  if (distance === "all") return NEARBY_ZIP_MILES;
  const n = Number(distance);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DISTANCE_MILES;
  return n;
}

export function distanceOptionLabel(d) {
  if (d === "all") return "Any nearby";
  const n = Number(d);
  if (n === 1) return "1 mile";
  return `${n} miles`;
}

export function distanceOptionIndex(d) {
  const exact = DISTANCE_OPTIONS.findIndex((opt) => String(opt) === String(d));
  if (exact >= 0) return exact;
  const n = d === "all" ? NEARBY_ZIP_MILES : Number(d);
  if (!Number.isFinite(n)) {
    return Math.max(0, DISTANCE_OPTIONS.indexOf(DEFAULT_DISTANCE_MILES));
  }
  let best = 0;
  let bestDiff = Infinity;
  DISTANCE_OPTIONS.forEach((opt, i) => {
    const miles = opt === "all" ? NEARBY_ZIP_MILES : Number(opt);
    const diff = Math.abs(miles - n);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  });
  return best;
}

export const HEARTBEAT_MS = 10_000;
export const PEER_TIMEOUT_MS = 30_000;
export const PHOTO_MAX_PX = 512;
export const PHOTO_MAX_BYTES = 200_000;
export const CHAT_TEXT_MAX = 1000;
export const CHAT_HISTORY_MAX = 200;
export const DEFAULT_CHAT_RETENTION = "session";
const HOUR_MS = 60 * 60 * 1000;
export const CHAT_RETENTION_OPTIONS = [
  { id: "session", label: "End of session", ms: 0 },
  { id: "1h", label: "1 hour", ms: HOUR_MS },
  { id: "6h", label: "6 hours", ms: 6 * HOUR_MS },
  { id: "24h", label: "24 hours", ms: 24 * HOUR_MS },
  { id: "1w", label: "1 week", ms: 7 * 24 * HOUR_MS },
  { id: "1m", label: "1 month", ms: 30 * 24 * HOUR_MS },
  { id: "never", label: "Never", ms: null },
];
export const MIN_AGE = 18;
export const MAX_AGE = 99;

export const GENDERS = [
  { id: "woman", label: "Woman" },
  { id: "man", label: "Man" },
  { id: "nonbinary", label: "Non-binary" },
  { id: "self", label: "Self-describe" },
];

export const GENDER_SEEK_OPTIONS = [
  ...GENDERS,
  { id: "everyone", label: "Everyone" },
];

export const NETWORKING_INTENTS = [
  { id: "general", label: "General" },
  { id: "hiring", label: "Hiring" },
  { id: "job-seeking", label: "Job seeking" },
  { id: "opportunities", label: "New opportunities" },
];

export const MUSIC_GENRES = [
  { id: "rock", label: "Rock" },
  { id: "pop", label: "Pop" },
  { id: "hip-hop", label: "Hip hop" },
  { id: "rnb", label: "R&B" },
  { id: "jazz", label: "Jazz" },
  { id: "blues", label: "Blues" },
  { id: "country", label: "Country" },
  { id: "folk", label: "Folk" },
  { id: "indie", label: "Indie" },
  { id: "alternative", label: "Alternative" },
  { id: "metal", label: "Metal" },
  { id: "punk", label: "Punk" },
  { id: "electronic", label: "Electronic" },
  { id: "edm", label: "EDM" },
  { id: "classical", label: "Classical" },
  { id: "reggae", label: "Reggae" },
  { id: "latin", label: "Latin" },
  { id: "funk", label: "Funk" },
  { id: "soul", label: "Soul" },
  { id: "gospel", label: "Gospel" },
  { id: "americana", label: "Americana" },
  { id: "singer-songwriter", label: "Singer-songwriter" },
];

export const MUSIC_INSTRUMENTS = [
  { id: "vocals", label: "Vocals" },
  { id: "guitar", label: "Guitar" },
  { id: "bass", label: "Bass" },
  { id: "drums", label: "Drums" },
  { id: "keys", label: "Keys" },
  { id: "piano", label: "Piano" },
  { id: "violin", label: "Violin" },
  { id: "cello", label: "Cello" },
  { id: "saxophone", label: "Saxophone" },
  { id: "trumpet", label: "Trumpet" },
  { id: "trombone", label: "Trombone" },
  { id: "flute", label: "Flute" },
  { id: "harmonica", label: "Harmonica" },
  { id: "banjo", label: "Banjo" },
  { id: "ukulele", label: "Ukulele" },
  { id: "synth", label: "Synth" },
  { id: "percussion", label: "Percussion" },
  { id: "dj", label: "DJ" },
  { id: "producer", label: "Producer" },
];

export const LOOKING_FOR_OPTIONS = [
  { id: "relationships", label: "Relationships" },
  { id: "friendships", label: "Friendships" },
  { id: "networking", label: "Networking" },
  { id: "musician-seeking-band", label: "Join a band" },
  { id: "band-seeking-musician", label: "Find musicians" },
];

export const STORAGE_PREFIX = "localchat";
export const STORE_VERSION = 1;
export const DEVICE_ID_PREFIX = `${PROTOCOL}c-`;
export const VAULT_HUB_PREFIX = `${PROTOCOL}v-`;
