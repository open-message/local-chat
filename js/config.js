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
/** Distances below this need Precise location; otherwise the slider snaps up. */
export const COARSE_MIN_DISTANCE_MILES = 2;
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

export function distanceRequiresPrecise(d) {
  if (d === "all") return false;
  const n = Number(d);
  return Number.isFinite(n) && n > 0 && n < COARSE_MIN_DISTANCE_MILES;
}

export function availableDistanceOptions(precise) {
  if (precise) return DISTANCE_OPTIONS;
  return DISTANCE_OPTIONS.filter((opt) => !distanceRequiresPrecise(opt));
}

export function clampDistanceOption(d, precise) {
  const options = availableDistanceOptions(precise);
  const exact = options.findIndex((opt) => String(opt) === String(d));
  if (exact >= 0) return options[exact];
  const snapped = DISTANCE_OPTIONS[distanceOptionIndex(d)];
  if (!precise && distanceRequiresPrecise(snapped)) return COARSE_MIN_DISTANCE_MILES;
  const fallback = options.findIndex((opt) => String(opt) === String(snapped));
  return fallback >= 0 ? options[fallback] : options[0];
}

export function distanceOptionIndex(d, options = DISTANCE_OPTIONS) {
  const exact = options.findIndex((opt) => String(opt) === String(d));
  if (exact >= 0) return exact;
  const n = d === "all" ? NEARBY_ZIP_MILES : Number(d);
  if (!Number.isFinite(n)) {
    const def = options.findIndex((opt) => String(opt) === String(DEFAULT_DISTANCE_MILES));
    return Math.max(0, def);
  }
  let best = 0;
  let bestDiff = Infinity;
  options.forEach((opt, i) => {
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
export const DEFAULT_CHAT_RETENTION = "6h";
export const GROUP_MEMBER_MAX = 12;
export const GROUP_NAME_MAX = 40;
export const GROUP_ID_PREFIX = `${PROTOCOL}g-`;
export const GROUP_INVITE_POLICIES = [
  { id: "creator", label: "Private", hint: "Only you can invite friends. The group is never listed on Online." },
  { id: "members", label: "Public", hint: "Any member can invite their friends. Still not listed on Online." },
];
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
  { id: "acid-jazz", label: "Acid jazz" },
  { id: "afrobeat", label: "Afrobeat" },
  { id: "afrobeats", label: "Afrobeats" },
  { id: "alt-country", label: "Alt-country" },
  { id: "alternative", label: "Alternative" },
  { id: "amapiano", label: "Amapiano" },
  { id: "ambient", label: "Ambient" },
  { id: "americana", label: "Americana" },
  { id: "bachata", label: "Bachata" },
  { id: "bluegrass", label: "Bluegrass" },
  { id: "blues", label: "Blues" },
  { id: "bossa-nova", label: "Bossa nova" },
  { id: "celtic", label: "Celtic" },
  { id: "chamber", label: "Chamber" },
  { id: "choral", label: "Choral" },
  { id: "christian", label: "Christian" },
  { id: "classic-rock", label: "Classic rock" },
  { id: "classical", label: "Classical" },
  { id: "comedy", label: "Comedy" },
  { id: "country", label: "Country" },
  { id: "cumbia", label: "Cumbia" },
  { id: "dance-pop", label: "Dance-pop" },
  { id: "dancehall", label: "Dancehall" },
  { id: "death-metal", label: "Death metal" },
  { id: "disco", label: "Disco" },
  { id: "doom-metal", label: "Doom metal" },
  { id: "dream-pop", label: "Dream pop" },
  { id: "drill", label: "Drill" },
  { id: "drum-and-bass", label: "Drum and bass" },
  { id: "dub", label: "Dub" },
  { id: "dubstep", label: "Dubstep" },
  { id: "edm", label: "EDM" },
  { id: "electro", label: "Electro" },
  { id: "electronic", label: "Electronic" },
  { id: "emo", label: "Emo" },
  { id: "experimental", label: "Experimental" },
  { id: "fado", label: "Fado" },
  { id: "flamenco", label: "Flamenco" },
  { id: "folk", label: "Folk" },
  { id: "folk-rock", label: "Folk rock" },
  { id: "funk", label: "Funk" },
  { id: "garage-rock", label: "Garage rock" },
  { id: "gospel", label: "Gospel" },
  { id: "grime", label: "Grime" },
  { id: "grunge", label: "Grunge" },
  { id: "hard-rock", label: "Hard rock" },
  { id: "hardcore", label: "Hardcore" },
  { id: "heavy-metal", label: "Heavy metal" },
  { id: "hip-hop", label: "Hip hop" },
  { id: "house", label: "House" },
  { id: "indie", label: "Indie" },
  { id: "indie-folk", label: "Indie folk" },
  { id: "indie-pop", label: "Indie pop" },
  { id: "indie-rock", label: "Indie rock" },
  { id: "industrial", label: "Industrial" },
  { id: "j-pop", label: "J-pop" },
  { id: "jazz", label: "Jazz" },
  { id: "jazz-fusion", label: "Jazz fusion" },
  { id: "k-pop", label: "K-pop" },
  { id: "krautrock", label: "Krautrock" },
  { id: "latin", label: "Latin" },
  { id: "latin-pop", label: "Latin pop" },
  { id: "lo-fi", label: "Lo-fi" },
  { id: "mariachi", label: "Mariachi" },
  { id: "math-rock", label: "Math rock" },
  { id: "merengue", label: "Merengue" },
  { id: "metal", label: "Metal" },
  { id: "metalcore", label: "Metalcore" },
  { id: "motown", label: "Motown" },
  { id: "new-age", label: "New age" },
  { id: "new-wave", label: "New wave" },
  { id: "noise", label: "Noise" },
  { id: "opera", label: "Opera" },
  { id: "pop", label: "Pop" },
  { id: "pop-punk", label: "Pop punk" },
  { id: "post-punk", label: "Post-punk" },
  { id: "post-rock", label: "Post-rock" },
  { id: "power-pop", label: "Power pop" },
  { id: "prog-rock", label: "Prog rock" },
  { id: "psychedelic", label: "Psychedelic" },
  { id: "punk", label: "Punk" },
  { id: "rnb", label: "R&B" },
  { id: "rap", label: "Rap" },
  { id: "reggae", label: "Reggae" },
  { id: "reggaeton", label: "Reggaeton" },
  { id: "regional-mexican", label: "Regional Mexican" },
  { id: "rock", label: "Rock" },
  { id: "rockabilly", label: "Rockabilly" },
  { id: "salsa", label: "Salsa" },
  { id: "samba", label: "Samba" },
  { id: "shoegaze", label: "Shoegaze" },
  { id: "singer-songwriter", label: "Singer-songwriter" },
  { id: "ska", label: "Ska" },
  { id: "soul", label: "Soul" },
  { id: "soundtrack", label: "Soundtrack" },
  { id: "surf", label: "Surf" },
  { id: "synth-pop", label: "Synth-pop" },
  { id: "techno", label: "Techno" },
  { id: "thrash", label: "Thrash" },
  { id: "trance", label: "Trance" },
  { id: "trap", label: "Trap" },
  { id: "trip-hop", label: "Trip-hop" },
  { id: "world", label: "World" },
];

export const MUSIC_INSTRUMENTS = [
  { id: "accordion", label: "Accordion" },
  { id: "acoustic-guitar", label: "Acoustic guitar" },
  { id: "alto-sax", label: "Alto sax" },
  { id: "autoharp", label: "Autoharp" },
  { id: "backing-vocals", label: "Backing vocals" },
  { id: "bagpipes", label: "Bagpipes" },
  { id: "banjo", label: "Banjo" },
  { id: "baritone-sax", label: "Baritone sax" },
  { id: "bass", label: "Bass" },
  { id: "bass-clarinet", label: "Bass clarinet" },
  { id: "bassoon", label: "Bassoon" },
  { id: "beatbox", label: "Beatbox" },
  { id: "bongos", label: "Bongos" },
  { id: "cajon", label: "Cajón" },
  { id: "cello", label: "Cello" },
  { id: "clarinet", label: "Clarinet" },
  { id: "classical-guitar", label: "Classical guitar" },
  { id: "congas", label: "Congas" },
  { id: "cornet", label: "Cornet" },
  { id: "didgeridoo", label: "Didgeridoo" },
  { id: "djembe", label: "Djembe" },
  { id: "dj", label: "DJ" },
  { id: "double-bass", label: "Double bass" },
  { id: "drum-machine", label: "Drum machine" },
  { id: "drums", label: "Drums" },
  { id: "electric-guitar", label: "Electric guitar" },
  { id: "electronic-drums", label: "Electronic drums" },
  { id: "erhu", label: "Erhu" },
  { id: "euphonium", label: "Euphonium" },
  { id: "fiddle", label: "Fiddle" },
  { id: "flugelhorn", label: "Flugelhorn" },
  { id: "flute", label: "Flute" },
  { id: "french-horn", label: "French horn" },
  { id: "guitar", label: "Guitar" },
  { id: "harmonica", label: "Harmonica" },
  { id: "harp", label: "Harp" },
  { id: "kalimba", label: "Kalimba" },
  { id: "keys", label: "Keys" },
  { id: "koto", label: "Koto" },
  { id: "lap-steel", label: "Lap steel" },
  { id: "looping", label: "Looping" },
  { id: "mandolin", label: "Mandolin" },
  { id: "marimba", label: "Marimba" },
  { id: "mc", label: "MC" },
  { id: "melodica", label: "Melodica" },
  { id: "oboe", label: "Oboe" },
  { id: "organ", label: "Organ" },
  { id: "pedal-steel", label: "Pedal steel" },
  { id: "percussion", label: "Percussion" },
  { id: "piano", label: "Piano" },
  { id: "piccolo", label: "Piccolo" },
  { id: "producer", label: "Producer" },
  { id: "rap-vocals", label: "Rap vocals" },
  { id: "recorder", label: "Recorder" },
  { id: "sampler", label: "Sampler" },
  { id: "saxophone", label: "Saxophone" },
  { id: "sitar", label: "Sitar" },
  { id: "sousaphone", label: "Sousaphone" },
  { id: "steel-pan", label: "Steel pan" },
  { id: "synth", label: "Synth" },
  { id: "tabla", label: "Tabla" },
  { id: "tenor-sax", label: "Tenor sax" },
  { id: "theremin", label: "Theremin" },
  { id: "timbales", label: "Timbales" },
  { id: "trombone", label: "Trombone" },
  { id: "trumpet", label: "Trumpet" },
  { id: "tuba", label: "Tuba" },
  { id: "turntables", label: "Turntables" },
  { id: "ukulele", label: "Ukulele" },
  { id: "upright-bass", label: "Upright bass" },
  { id: "vibraphone", label: "Vibraphone" },
  { id: "viola", label: "Viola" },
  { id: "violin", label: "Violin" },
  { id: "vocals", label: "Vocals" },
  { id: "xylophone", label: "Xylophone" },
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
