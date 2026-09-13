const YT_VIDEO_ID_RE = /^[\w-]{11}$/;
const YT_PLAYLIST_RE = /^(PL[\w-]{10,64}|OLAK5uy_[\w-]{20,64}|RDCLAK5uy_[\w-]{20,64})$/;
const YT_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

export function parseYoutubeVideoId(value) {
  const id = String(value || "");
  return YT_VIDEO_ID_RE.test(id) ? id : "";
}

export function parseYoutubePlaylistId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (YT_PLAYLIST_RE.test(raw)) return raw;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (!YT_HOSTS.has(host)) return "";
  const list = url.searchParams.get("list") || "";
  return YT_PLAYLIST_RE.test(list) ? list : "";
}

export function youtubeVideoEmbedUrl(videoId) {
  const id = parseYoutubeVideoId(videoId);
  return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : "";
}

export function youtubeVideoThumbUrl(videoId) {
  const id = parseYoutubeVideoId(videoId);
  return id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : "";
}

export function youtubeVideoWatchUrl(videoId) {
  const id = parseYoutubeVideoId(videoId);
  return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : "";
}

export function youtubePlaylistUrl(playlistId) {
  const id = parseYoutubePlaylistId(playlistId);
  return id ? `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}` : "";
}

export function youtubePlaylistEmbedUrl(playlistId) {
  const id = parseYoutubePlaylistId(playlistId);
  return id
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(id)}`
    : "";
}

export function sanitizeYoutubePlaylistThumb(value) {
  return parseYoutubeVideoId(value);
}

let iframeApi = null;

function loadIframeApi() {
  if (globalThis.YT?.Player) return Promise.resolve();
  if (iframeApi) return iframeApi;
  iframeApi = new Promise((resolve, reject) => {
    const prev = globalThis.onYouTubeIframeAPIReady;
    const done = () => {
      try { prev?.(); } catch { /* ignore */ }
      resolve();
    };
    globalThis.onYouTubeIframeAPIReady = done;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => reject(new Error("Could not load YouTube."));
    document.head.append(script);
    setTimeout(() => {
      if (globalThis.YT?.Player) done();
      else reject(new Error("YouTube timed out."));
    }, 20000);
  });
  return iframeApi;
}

function playlistIdsFromChannel(channelId) {
  const id = String(channelId || "");
  if (!id.startsWith("UC") || id.length !== 24) return "";
  return `UU${id.slice(2)}`;
}

function readPlaylist(player) {
  try {
    return (player.getPlaylist() || []).filter((id) => YT_VIDEO_ID_RE.test(String(id)));
  } catch {
    return [];
  }
}

function loadPlaylistIds(list, failMessage) {
  if (!list) return Promise.reject(new Error(failMessage));
  return new Promise((resolve, reject) => {
    const host = document.createElement("div");
    host.id = `yt-catalog-${Math.random().toString(36).slice(2, 10)}`;
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);";
    document.body.append(host);
    let settled = false;
    let player = null;
    const finish = (ids, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      try { player?.stopVideo?.(); } catch { /* ignore */ }
      try { player?.destroy?.(); } catch { /* ignore */ }
      host.remove();
      if (err) reject(err);
      else resolve(ids);
    };
    const timer = setTimeout(() => {
      const ids = player ? readPlaylist(player) : [];
      if (ids.length) finish(ids);
      else finish([], new Error(failMessage));
    }, 25000);
    let poll = 0;
    player = new globalThis.YT.Player(host.id, {
      width: 1,
      height: 1,
      playerVars: {
        listType: "playlist",
        list,
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
      },
      events: {
        onReady(event) {
          const take = () => {
            const ids = readPlaylist(event.target);
            if (ids.length) finish(ids);
            return ids.length > 0;
          };
          if (take()) return;
          poll = setInterval(() => {
            if (take()) clearInterval(poll);
          }, 300);
        },
        onError() {
          finish([], new Error(failMessage));
        },
      },
    });
  });
}

async function fillTitles(videos) {
  const pending = [...videos];
  const workers = Array.from({ length: 6 }, async () => {
    while (pending.length) {
      const video = pending.shift();
      if (!video) return;
      try {
        const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeVideoWatchUrl(video.id))}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        video.title = String(data.title || "");
      } catch {
        /* keep the id as the label */
      }
    }
  });
  await Promise.all(workers);
}

async function videosFromList(list, failMessage, onIds) {
  await loadIframeApi();
  const ids = await loadPlaylistIds(list, failMessage);
  const videos = ids.map((id) => ({ id, title: "", duration: "" }));
  onIds?.(videos);
  await fillTitles(videos);
  return { videos, token: "" };
}

export async function fetchChannelVideos(channelId, onIds) {
  const list = playlistIdsFromChannel(channelId);
  if (!list) return Promise.reject(new Error("Need a channel ID."));
  return videosFromList(list, "Could not load that channel's videos.", onIds);
}

export async function fetchPlaylistVideos(playlistId, onIds) {
  const list = parseYoutubePlaylistId(playlistId);
  if (!list) return Promise.reject(new Error("Need a YouTube Music playlist URL."));
  return videosFromList(list, "Could not load that playlist. It may be private, or a generated mix.", onIds);
}
