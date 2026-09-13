export const SOUNDCLOUD_ITEM_MAX = 8;
const ITEM_ID_RE = /^[a-z][a-z0-9]{5,15}$/;
const RESERVED = new Set([
  "discover", "feed", "you", "stream", "search", "upload", "pages", "pro",
  "settings", "mobile", "imprint", "terms", "privacy", "signin", "signup",
  "logout", "messages", "notifications", "charts", "jobs", "creators",
]);

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function soundcloudHost(host) {
  const h = String(host || "").replace(/^www\./i, "").toLowerCase();
  return h === "soundcloud.com" || h === "m.soundcloud.com" || h === "on.soundcloud.com";
}

function newItemId() {
  let rest = Math.random().toString(36).slice(2);
  while (rest.length < 7) rest += Math.random().toString(36).slice(2);
  return `s${rest.slice(0, 7)}`;
}

export function emptySoundCloud() {
  return { items: [], selected: [] };
}

export function parseSoundCloudUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (!soundcloudHost(url.hostname)) return "";
  url.protocol = "https:";
  url.hash = "";
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  url.hostname = host === "m.soundcloud.com" ? "soundcloud.com" : host;
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "soundcloud.com") {
    if (!parts.length) return "";
    const first = decodeURIComponent(parts[0] || "").toLowerCase();
    if (RESERVED.has(first)) return "";
  }
  url.search = "";
  return url.href.slice(0, 300);
}

export function soundcloudKind(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.hostname === "on.soundcloud.com") return "link";
    if (parts.length >= 3 && parts[1].toLowerCase() === "sets") return "playlist";
    if (parts.length >= 2) return "track";
    if (parts.length === 1) return "user";
  } catch {
    /* ignore */
  }
  return "link";
}

export function soundcloudEmbedUrl(url) {
  const href = parseSoundCloudUrl(url);
  if (!href) return "";
  const params = new URLSearchParams({
    url: href,
    color: "6b8f71",
    auto_play: "false",
    hide_related: "true",
    show_comments: "false",
    show_user: "true",
    show_reposts: "false",
    show_teaser: "false",
    visual: soundcloudKind(href) === "track" ? "false" : "true",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

export function soundcloudEmbedHeight(kind) {
  if (kind === "track") return 166;
  return 320;
}

export function sanitizeSoundCloudThumb(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    if (!host.endsWith("sndcdn.com") && host !== "i1.sndcdn.com") return "";
    return u.href.slice(0, 400);
  } catch {
    return "";
  }
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = parseSoundCloudUrl(raw.url);
  if (!url) return null;
  const id = String(raw.id || "");
  if (!ITEM_ID_RE.test(id)) return null;
  const kind = ["track", "playlist", "user", "link"].includes(raw.kind) ? raw.kind : soundcloudKind(url);
  return {
    id,
    url,
    title: clip(raw.title, 120) || "SoundCloud",
    author: clip(raw.author, 80),
    thumbnail: sanitizeSoundCloudThumb(raw.thumbnail),
    kind,
  };
}

export function sanitizeSoundCloud(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const items = [];
  const seen = new Set();
  for (const row of Array.isArray(src.items) ? src.items : []) {
    const item = sanitizeItem(row);
    if (!item || seen.has(item.id) || seen.has(item.url)) continue;
    seen.add(item.id);
    seen.add(item.url);
    items.push(item);
    if (items.length >= SOUNDCLOUD_ITEM_MAX) break;
  }
  const allowed = new Set(items.map((item) => item.id));
  const selected = [];
  const selectedSeen = new Set();
  for (const id of Array.isArray(src.selected) ? src.selected : []) {
    const key = String(id || "");
    if (!allowed.has(key) || selectedSeen.has(key)) continue;
    selectedSeen.add(key);
    selected.push(key);
  }
  return { items, selected };
}

export function shareSoundCloud(raw) {
  const src = sanitizeSoundCloud(raw);
  const selected = new Set(src.selected);
  const items = src.items.filter((item) => selected.has(item.id));
  if (!items.length) return emptySoundCloud();
  return { items, selected: items.map((item) => item.id) };
}

export function soundcloudIsShown(raw) {
  return shareSoundCloud(raw).items.length > 0;
}

export async function fetchSoundCloudEmbed(value) {
  const url = parseSoundCloudUrl(value);
  if (!url) throw new Error("Need a SoundCloud track, playlist, or profile URL.");
  const endpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("Could not load that SoundCloud link. It may be private.");
  const data = await res.json();
  const title = clip(data.title, 120);
  const author = clip(data.author_name, 80);
  return {
    url,
    title: title || "SoundCloud",
    author,
    thumbnail: sanitizeSoundCloudThumb(data.thumbnail_url),
    kind: soundcloudKind(url),
  };
}

export async function addSoundCloudItem(raw, value) {
  const src = sanitizeSoundCloud(raw);
  if (src.items.length >= SOUNDCLOUD_ITEM_MAX) {
    throw new Error(`Up to ${SOUNDCLOUD_ITEM_MAX} SoundCloud links on this profile.`);
  }
  const parsed = await fetchSoundCloudEmbed(value);
  if (src.items.some((item) => item.url === parsed.url)) return src;
  const item = { id: newItemId(), ...parsed };
  return {
    items: [...src.items, item],
    selected: [...src.selected, item.id],
  };
}

export function removeSoundCloudItem(raw, id) {
  const src = sanitizeSoundCloud(raw);
  return {
    items: src.items.filter((item) => item.id !== id),
    selected: src.selected.filter((key) => key !== id),
  };
}
