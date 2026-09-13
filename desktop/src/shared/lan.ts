function osHostname() {
  try {
    return (require("os") as { hostname: () => string }).hostname();
  } catch {
    return "";
  }
}

export function isLoopbackHost(host: string) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/** mDNS name other devices on the LAN can use, e.g. my-laptop.local */
export function lanHostname(raw = osHostname()) {
  let name = String(raw || "").trim().toLowerCase();
  if (name.endsWith(".local")) name = name.slice(0, -6);
  const short = name.split(".")[0].replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!short || short === "localhost") return "";
  return `${short}.local`;
}

export function isLanHost(host: string) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return isLoopbackHost(h) || h.endsWith(".local");
}

export function lanShareOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const host = isLoopbackHost(url.hostname)
      ? lanHostname()
      : (url.hostname.toLowerCase().endsWith(".local") ? url.hostname : "");
    if (!host) return origin;
    if (url.protocol === "https:") {
      url.hostname = host;
      return url.toString();
    }
    const httpPort = Number(url.port || "80") || 80;
    url.hostname = host;
    url.protocol = "https:";
    url.port = String(httpPort + 1);
    return url.toString();
  } catch {
    return origin;
  }
}
