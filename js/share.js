import { PROTOCOL } from "./config.js";
import { isDevicePeerId, isVaultHubId } from "./device.js";
import { subtle } from "./subtle.js";

const USER_ID_RE = new RegExp(`^${PROTOCOL}u-[0-9a-f]{32}$`, "i");
const roomCache = new Map();
let lanHost = "";
let lanHttpsPort = "";

export function isUserPeerId(id) {
  return USER_ID_RE.test(String(id || ""));
}

export { isDevicePeerId, isVaultHubId };

export function isLoopbackHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/** mDNS name other devices on the LAN can use, e.g. my-laptop.local */
export function lanHostname(raw) {
  let name = String(raw || "").trim().toLowerCase();
  if (name.endsWith(".local")) name = name.slice(0, -6);
  const short = name.split(".")[0].replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!short || short === "localhost") return "";
  return `${short}.local`;
}

export function setLanHost(raw) {
  lanHost = lanHostname(raw);
  return lanHost;
}

function withLanHost(href) {
  const url = new URL(href);
  if (isLoopbackHost(url.hostname) && lanHost) {
    url.hostname = lanHost;
    url.protocol = "https:";
    if (lanHttpsPort) url.port = String(lanHttpsPort);
  }
  return url;
}

function desktopBridge() {
  try {
    return typeof window !== "undefined" ? window.localChatDesktop || null : null;
  } catch {
    return null;
  }
}

/** When the page is localhost, learn this computer's .local name for QR links. */
export async function loadLanHost() {
  if (typeof location === "undefined" || !isLoopbackHost(location.hostname)) return lanHost;
  const desktop = desktopBridge();
  if (desktop?.getLanHost) {
    try {
      const host = await desktop.getLanHost();
      if (host && setLanHost(host)) return lanHost;
    } catch {
      /* try lan.json */
    }
  }
  try {
    const res = await fetch(new URL("lan.json", location.href), { cache: "no-store" });
    if (!res.ok) return lanHost;
    const data = await res.json();
    if (data?.host) setLanHost(data.host);
    if (data?.httpsPort) lanHttpsPort = String(data.httpsPort);
  } catch {
    /* stay on localhost */
  }
  return lanHost;
}

export function shareUrl(peerId, href = location.href) {
  const url = withLanHost(href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("u", peerId);
  return url.toString();
}

export function parseSharePeerId(search = location.search) {
  const u = new URLSearchParams(search).get("u");
  return isUserPeerId(u) ? u : "";
}

export function stripShareParam(href = location.href) {
  const url = new URL(href);
  if (!url.searchParams.has("u")) return url.href;
  url.searchParams.delete("u");
  return url.href;
}

export function linkUrl(hubId, nonce, href = location.href) {
  const url = withLanHost(href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("link", hubId);
  if (nonce) url.searchParams.set("n", nonce);
  return url.toString();
}

export function parseLinkParams(search = location.search) {
  const params = new URLSearchParams(search);
  const hubId = params.get("link");
  const nonce = params.get("n") || "";
  if (!isVaultHubId(hubId)) return null;
  return { hubId, nonce };
}

export function stripLinkParams(href = location.href) {
  const url = new URL(href);
  let changed = false;
  if (url.searchParams.has("link")) {
    url.searchParams.delete("link");
    changed = true;
  }
  if (url.searchParams.has("n")) {
    url.searchParams.delete("n");
    changed = true;
  }
  return changed ? url.href : href;
}

/** Deterministic 1:1 chat room id from both user ids, order-independent. */
export async function chatRoomId(a, b) {
  const key = [String(a), String(b)].sort().join("|");
  if (roomCache.has(key)) return roomCache.get(key);
  const buf = await subtle().digest("SHA-256", new TextEncoder().encode(key));
  const hex = [...new Uint8Array(buf)]
    .slice(0, 8)
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const id = `${PROTOCOL}p-${hex}`;
  roomCache.set(key, id);
  return id;
}
