const CACHE = "localchat-shell-v54";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./manifest.json",
  "./img/icon-192.png",
  "./img/icon-512.png",
  "./js/main.js",
  "./js/config.js",
  "./js/analytics.js",
  "./js/store.js",
  "./js/identity.js",
  "./js/subtle.js",
  "./js/chat.js",
  "./js/geo.js",
  "./js/rooms.js",
  "./js/match.js",
  "./js/filters.js",
  "./js/photo.js",
  "./js/dom.js",
  "./js/profile.js",
  "./js/youtube.js",
  "./js/github.js",
  "./js/bandcamp.js",
  "./js/soundcloud.js",
  "./js/linkedin.js",
  "./js/device.js",
  "./js/vault-net.js",
  "./js/share.js",
  "./js/qr.js",
  "./js/vendor/qrcode-generator.js",
  "./js/vendor/noble-p256.js",
  "./js/ui/app.js",
  "./data/tags.json",
  "./data/questionnaire.json",
  "./data/us-zips.json",
  "./data/us-states.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of SHELL) {
        try {
          await cache.add(url);
        } catch {
          /* keep install going if one asset is missing */
        }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (
    url.hostname.includes("google-analytics.com") ||
    url.hostname.includes("googletagmanager.com") ||
    url.hostname.includes("peerjs.com") ||
    url.hostname.includes("unpkg.com") ||
    url.hostname.includes("jsdelivr.net") ||
    url.hostname.includes("youtube.com") ||
    url.hostname.includes("youtube-nocookie.com") ||
    url.hostname.includes("youtu.be") ||
    url.hostname.includes("ytimg.com") ||
    url.hostname.includes("googlevideo.com") ||
    url.hostname.includes("gstatic.com") ||
    url.hostname.includes("ggpht.com") ||
    url.hostname.includes("linkedin.com") ||
    url.hostname.includes("licdn.com") ||
    url.hostname.includes("licdn-ei.com") ||
    url.hostname.includes("github.com") ||
    url.hostname.includes("githubusercontent.com") ||
    url.hostname.includes("soundcloud.com") ||
    url.hostname.includes("sndcdn.com") ||
    url.hostname.includes("bandcamp.com") ||
    url.hostname.includes("bcbits.com")
  ) {
    return;
  }
  if (event.request.method !== "GET") return;
  if (
    url.pathname.endsWith("/desktop-hub.html")
    || url.pathname.endsWith("/js/desktop-hub.js")
    || url.pathname.endsWith("/js/vault-net.js")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      });
    })
  );
});
