export const BANDCAMP_ITEM_MAX = 8;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const ITEM_ID_RE = /^[a-z][a-z0-9]{5,15}$/;
const EMBED_ID_RE = /^\d{5,12}$/;

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function bandcampHost(host) {
  const h = String(host || "").replace(/^www\./i, "").toLowerCase();
  return h === "bandcamp.com" || h.endsWith(".bandcamp.com");
}

function artistFromHost(host) {
  const h = String(host || "").replace(/^www\./i, "").toLowerCase();
  if (!h.endsWith(".bandcamp.com")) return "";
  return h.slice(0, -".bandcamp.com".length);
}

function titleFromSlug(slug) {
  return clip(String(slug || "").replace(/-/g, " "), 80);
}

function newItemId() {
  let rest = Math.random().toString(36).slice(2);
  while (rest.length < 7) rest += Math.random().toString(36).slice(2);
  return `b${rest.slice(0, 7)}`;
}

export function emptyBandcamp() {
  return { items: [], selected: [] };
}

function parseEmbedIds(raw) {
  const text = String(raw || "");
  const album = text.match(/(?:EmbeddedPlayer\/(?:[\w=/-]*?)|[&?/])album=(\d{5,12})/i);
  const track = text.match(/(?:EmbeddedPlayer\/(?:[\w=/-]*?)|[&?/])track=(\d{5,12})/i);
  return {
    album: album && EMBED_ID_RE.test(album[1]) ? album[1] : "",
    track: track && EMBED_ID_RE.test(track[1]) ? track[1] : "",
  };
}

export function parseBandcampInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const embed = parseEmbedIds(raw);
  let url;
  try {
    const maybe = raw.match(/https?:\/\/[^\s"'<>]+/i)?.[0] || raw;
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(maybe) ? maybe : `https://${maybe}`);
  } catch {
    if (embed.album || embed.track) {
      const kind = embed.album ? "album" : "track";
      const embedId = embed.album || embed.track;
      return {
        url: `https://bandcamp.com/EmbeddedPlayer/${kind}=${embedId}/`,
        artist: "",
        title: kind === "album" ? "Album" : "Track",
        kind,
        embedId,
      };
    }
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!bandcampHost(url.hostname)) {
    if (embed.album || embed.track) {
      const kind = embed.album ? "album" : "track";
      const embedId = embed.album || embed.track;
      return {
        url: `https://bandcamp.com/EmbeddedPlayer/${kind}=${embedId}/`,
        artist: "",
        title: kind === "album" ? "Album" : "Track",
        kind,
        embedId,
      };
    }
    return null;
  }
  url.protocol = "https:";
  const artist = artistFromHost(url.hostname);
  const parts = url.pathname.split("/").filter(Boolean);
  const kindIndex = parts.findIndex((p) => p === "album" || p === "track");
  const kind = kindIndex >= 0 ? parts[kindIndex] : (embed.album ? "album" : embed.track ? "track" : "");
  const slug = kindIndex >= 0 ? decodeURIComponent(parts[kindIndex + 1] || "") : "";
  const embedId = kind === "album" ? embed.album : kind === "track" ? embed.track : (embed.album || embed.track);
  if (!kind) return null;
  if (slug && !SLUG_RE.test(slug) && !embedId) return null;
  if (!slug && !embedId) return null;
  const page = new URL(url.href);
  page.hash = "";
  page.search = "";
  if (kindIndex >= 0 && slug) page.pathname = `/${kind}/${slug}`;
  return {
    url: page.href.slice(0, 300),
    artist: clip(artist.replace(/-/g, " "), 80),
    title: titleFromSlug(slug) || (kind === "album" ? "Album" : "Track"),
    kind,
    embedId: embedId || "",
  };
}

export function bandcampEmbedUrl(item) {
  const id = EMBED_ID_RE.test(String(item?.embedId || "")) ? String(item.embedId) : "";
  const kind = item?.kind === "track" ? "track" : item?.kind === "album" ? "album" : "";
  if (!id || !kind) return "";
  return `https://bandcamp.com/EmbeddedPlayer/${kind}=${id}/size=large/bgcol=ffffff/linkcol=6b8f71/artwork=small/transparent=true/`;
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const parsed = parseBandcampInput(raw.url) || (
    EMBED_ID_RE.test(String(raw.embedId || "")) && (raw.kind === "album" || raw.kind === "track")
      ? {
        url: String(raw.url || "").slice(0, 300),
        artist: clip(raw.artist, 80),
        title: clip(raw.title, 80),
        kind: raw.kind,
        embedId: String(raw.embedId),
      }
      : null
  );
  if (!parsed) return null;
  const id = String(raw.id || "");
  if (!ITEM_ID_RE.test(id)) return null;
  return {
    id,
    url: parsed.url,
    artist: clip(raw.artist, 80) || parsed.artist,
    title: clip(raw.title, 80) || parsed.title,
    kind: parsed.kind,
    embedId: parsed.embedId,
  };
}

export function sanitizeBandcamp(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const items = [];
  const seen = new Set();
  for (const row of Array.isArray(src.items) ? src.items : []) {
    const item = sanitizeItem(row);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= BANDCAMP_ITEM_MAX) break;
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

export function shareBandcamp(raw) {
  const src = sanitizeBandcamp(raw);
  const selected = new Set(src.selected);
  const items = src.items.filter((item) => selected.has(item.id));
  if (!items.length) return emptyBandcamp();
  return { items, selected: items.map((item) => item.id) };
}

export function bandcampIsShown(raw) {
  return shareBandcamp(raw).items.length > 0;
}

export function addBandcampItem(raw, value) {
  const src = sanitizeBandcamp(raw);
  if (src.items.length >= BANDCAMP_ITEM_MAX) {
    throw new Error(`Up to ${BANDCAMP_ITEM_MAX} Bandcamp links on this profile.`);
  }
  const parsed = parseBandcampInput(value);
  if (!parsed) throw new Error("Need a Bandcamp album or track URL, or paste the embed code from Share.");
  if (src.items.some((item) => item.url === parsed.url && item.embedId === parsed.embedId)) {
    return src;
  }
  const item = { id: newItemId(), ...parsed };
  return {
    items: [...src.items, item],
    selected: [...src.selected, item.id],
  };
}

export function removeBandcampItem(raw, id) {
  const src = sanitizeBandcamp(raw);
  return {
    items: src.items.filter((item) => item.id !== id),
    selected: src.selected.filter((key) => key !== id),
  };
}
