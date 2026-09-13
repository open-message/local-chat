export const GITHUB_REPO_MAX = 12;
const LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const RESERVED = new Set([
  "about", "account", "apps", "blog", "business", "codespaces", "collections",
  "contact", "copilot", "customer-stories", "dashboard", "dev", "docs",
  "enterprise", "events", "explore", "features", "files", "gist", "gists",
  "integrations", "issues", "join", "login", "logout", "marketplace", "new",
  "notifications", "organizations", "orgs", "pricing", "pull", "pulls",
  "readme", "search", "security", "settings", "solutions", "sponsor",
  "sponsors", "stars", "topics", "trending", "users",
]);

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function githubHost(host) {
  const h = String(host || "").replace(/^www\./i, "").toLowerCase();
  return h === "github.com";
}

export function emptyGithub() {
  return {
    login: "",
    name: "",
    bio: "",
    avatar: "",
    repos: [],
    selected: [],
  };
}

export function parseGithubLogin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (LOGIN_RE.test(raw) && !RESERVED.has(raw.toLowerCase())) return raw;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  if (!githubHost(url.hostname)) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) return "";
  const first = decodeURIComponent(parts[0] || "");
  if (first.toLowerCase() === "users" && parts[1]) {
    const nested = decodeURIComponent(parts[1]);
    return LOGIN_RE.test(nested) && !RESERVED.has(nested.toLowerCase()) ? nested : "";
  }
  if (!LOGIN_RE.test(first) || RESERVED.has(first.toLowerCase())) return "";
  return first;
}

export function githubProfileUrl(login) {
  const id = parseGithubLogin(login);
  return id ? `https://github.com/${encodeURIComponent(id)}` : "";
}

export function githubRepoUrl(login, name) {
  const user = parseGithubLogin(login);
  const repo = REPO_RE.test(String(name || "")) ? String(name) : "";
  return user && repo ? `https://github.com/${encodeURIComponent(user)}/${encodeURIComponent(repo)}` : "";
}

function githubPagesHost(login) {
  const user = parseGithubLogin(login);
  return user ? `${user.toLowerCase()}.github.io` : "";
}

function githubPagesUrl(login, name) {
  const user = parseGithubLogin(login);
  const repo = REPO_RE.test(String(name || "")) ? String(name) : "";
  const host = githubPagesHost(user);
  if (!user || !repo || !host) return "";
  if (repo.toLowerCase() === host) return `https://${host}/`;
  return `https://${host}/${encodeURIComponent(repo)}/`;
}

function sanitizeGithubPageUrl(url, login, name) {
  const canonical = githubRepoUrl(login, name);
  if (canonical) return canonical;
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return "";
    if (!githubHost(u.hostname)) return "";
    return u.href.slice(0, 300);
  } catch {
    return "";
  }
}

function sanitizeGithubDemoUrl(url, login) {
  const host = githubPagesHost(login);
  if (!host) return "";
  try {
    const raw = String(url || "").trim();
    if (!raw) return "";
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol === "http:") u.protocol = "https:";
    if (u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    const h = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (h !== host) return "";
    u.hash = "";
    u.search = "";
    if (!u.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(u.pathname)) u.pathname += "/";
    return u.href.slice(0, 300);
  } catch {
    return "";
  }
}

function githubDemoUrl(raw, login, name) {
  const fromHome = sanitizeGithubDemoUrl(raw?.demo || raw?.homepage, login);
  if (fromHome) return fromHome;
  return raw?.has_pages || raw?.pages ? githubPagesUrl(login, name) : "";
}

export function sanitizeGithubAvatar(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return "";
    if (u.hostname.toLowerCase() !== "avatars.githubusercontent.com") return "";
    return u.href.slice(0, 300);
  } catch {
    return "";
  }
}

const README_FILES = ["README.md", "readme.md", "Readme.md", "README.markdown"];
const IMAGE_CACHE = new Map();
const IMAGE_INFLIGHT = new Map();
const BADGE_RE = /shields\.io|badgen\.net|badge\.fury|travis-ci|circleci\.com|codecov\.io|coveralls\.io|snyk\.io|sonarcloud|appveyor|david-dm\.org|isitmaintained|forthebadge|contrib\.rocks|contribs\.rocks|repobeats|producthunt\.com|ko-fi\.com|buymeacoffee|discord(?:app)?\.com\/api\/guilds|github\.com\/[^/]+\/[^/]+\/(?:actions\/)?workflows\//i;

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function imageCacheKey(login, name) {
  return `${parseGithubLogin(login)}/${String(name || "").toLowerCase()}`;
}

function isBadgeImage(href) {
  const url = String(href || "").toLowerCase();
  if (!url) return true;
  if (BADGE_RE.test(url)) return true;
  if (/\.svg(?:$|\?)/i.test(url)) return true;
  if (/\.(?:mp4|webm|mov|m4v)(?:$|\?)/i.test(url)) return true;
  return false;
}

function githubBlobToRaw(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return "";
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "github.com") return u.href;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "user-attachments") return u.href.slice(0, 500);
    if ((parts[2] === "blob" || parts[2] === "raw") && parts.length >= 5) {
      const [owner, repo, , ref, ...rest] = parts;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join("/")}`;
    }
    return u.href;
  } catch {
    return "";
  }
}

export function sanitizeGithubImage(url) {
  try {
    const raw = githubBlobToRaw(url) || String(url || "");
    const u = new URL(raw);
    if (u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    u.hash = "";
    if (isBadgeImage(u.href)) return "";
    return u.href.slice(0, 500);
  } catch {
    return "";
  }
}

function resolveReadmeImage(src, login, name) {
  const trimmed = decodeEntities(String(src || "").trim()).replace(/^<|>$/g, "");
  if (!trimmed || trimmed.startsWith("#") || /^data:/i.test(trimmed)) return "";
  const user = parseGithubLogin(login);
  const repo = REPO_RE.test(String(name || "")) ? String(name) : "";
  if (!user || !repo) return "";
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/HEAD/`;
  try {
    const absolute = trimmed.startsWith("/") && !trimmed.startsWith("//")
      ? new URL(trimmed.slice(1), base)
      : new URL(trimmed, base);
    return sanitizeGithubImage(absolute.href);
  } catch {
    return "";
  }
}

function stripReadmeNoise(markdown) {
  return String(markdown || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .slice(0, 200000);
}

function readmeRefs(markdown) {
  const refs = new Map();
  const re = /^[ \t]*\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm;
  let match;
  while ((match = re.exec(markdown))) {
    refs.set(match[1].trim().toLowerCase(), match[2]);
  }
  return refs;
}

function imgSrcFromTag(tag) {
  const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(String(tag || ""));
  return match ? (match[1] || match[2] || match[3] || "") : "";
}

function markdownImageSrc(token, refs) {
  const inline = /^!\[(?:[^\]]*)\]\(\s*<?([^)\s>]+)>?/.exec(token);
  if (inline) return inline[1];
  const ref = /^!\[([^\]]*)\]\[([^\]]*)\]$/.exec(token);
  if (!ref) return "";
  const key = (ref[2] || ref[1] || "").trim().toLowerCase();
  return refs.get(key) || "";
}

export function firstReadmeImage(markdown, login, name) {
  const text = stripReadmeNoise(markdown);
  const refs = readmeRefs(text);
  const tokenRe = /<img\b[^>]*>|!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]/gi;
  let match;
  while ((match = tokenRe.exec(text))) {
    const token = match[0];
    const src = /^<img/i.test(token) ? imgSrcFromTag(token) : markdownImageSrc(token, refs);
    const image = resolveReadmeImage(src, login, name);
    if (image) return image;
  }
  return "";
}

export function rememberGithubRepoImage(login, name, image) {
  const url = sanitizeGithubImage(image);
  const key = imageCacheKey(login, name);
  if (!url || IMAGE_CACHE.has(key)) return url;
  IMAGE_CACHE.set(key, url);
  return url;
}

export function peekGithubRepoImage(login, name) {
  const key = imageCacheKey(login, name);
  return IMAGE_CACHE.has(key) ? IMAGE_CACHE.get(key) : null;
}

async function loadReadmeImage(login, name) {
  for (const file of README_FILES) {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(login)}/${encodeURIComponent(name)}/HEAD/${file}`;
    let res;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (res.status === 404) continue;
    if (!res.ok) continue;
    const text = await res.text();
    return firstReadmeImage(text, login, name);
  }
  return "";
}

export async function fetchGithubReadmeImage(login, name) {
  const user = parseGithubLogin(login);
  const repo = REPO_RE.test(String(name || "")) ? String(name) : "";
  if (!user || !repo) return "";
  const key = imageCacheKey(user, repo);
  if (IMAGE_CACHE.has(key)) return IMAGE_CACHE.get(key);
  if (IMAGE_INFLIGHT.has(key)) return IMAGE_INFLIGHT.get(key);
  const pending = loadReadmeImage(user, repo).then((url) => {
    IMAGE_CACHE.set(key, url);
    IMAGE_INFLIGHT.delete(key);
    return url;
  }, () => {
    IMAGE_INFLIGHT.delete(key);
    return "";
  });
  IMAGE_INFLIGHT.set(key, pending);
  return pending;
}

export async function fillGithubRepoImages(login, repos, { concurrency = 3, onProgress } = {}) {
  const user = parseGithubLogin(login);
  const list = (Array.isArray(repos) ? repos : []).filter((repo) => repo && REPO_RE.test(String(repo.name || "")));
  if (!user || !list.length) return;
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const repo = list[i];
      i += 1;
      const image = await fetchGithubReadmeImage(user, repo.name);
      onProgress?.(repo.name, image);
    }
  };
  const n = Math.max(1, Math.min(concurrency, list.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

function sanitizeRepo(raw, login) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "");
  if (!REPO_RE.test(name)) return null;
  const url = sanitizeGithubPageUrl(raw.url, login, name);
  if (!url) return null;
  const stars = Math.max(0, Math.min(10000000, Math.round(Number(raw.stars) || 0)));
  return {
    name,
    description: clip(raw.description, 180),
    language: clip(raw.language, 40),
    stars,
    fork: Boolean(raw.fork),
    url,
    demo: githubDemoUrl(raw, login, name),
    image: sanitizeGithubImage(raw.image),
  };
}

export function sanitizeGithubRepos(list, login) {
  const user = parseGithubLogin(login);
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const repo = sanitizeRepo(raw, user);
    if (!repo || seen.has(repo.name.toLowerCase())) continue;
    seen.add(repo.name.toLowerCase());
    out.push(repo);
    if (out.length >= 100) break;
  }
  return out;
}

export function sanitizeGithubSelected(ids, repos) {
  const allowed = new Set((repos || []).map((repo) => repo.name));
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const name = String(raw || "");
    if (!allowed.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= GITHUB_REPO_MAX) break;
  }
  return out;
}

export function sanitizeGithub(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const draft = clip(src.login, 80);
  const login = parseGithubLogin(draft);
  const repos = sanitizeGithubRepos(src.repos, login || draft);
  const next = {
    login: login || draft,
    name: clip(src.name, 80),
    bio: clip(src.bio, 180),
    avatar: sanitizeGithubAvatar(src.avatar),
    repos,
    selected: [],
  };
  next.selected = sanitizeGithubSelected(src.selected, next.repos);
  return next;
}

export function shareGithub(raw) {
  const src = sanitizeGithub(raw);
  const login = parseGithubLogin(src.login);
  const selected = new Set(src.selected);
  const repos = src.repos.filter((repo) => selected.has(repo.name)).slice(0, GITHUB_REPO_MAX);
  if (!login || !repos.length) return emptyGithub();
  return {
    login,
    name: src.name,
    bio: src.bio,
    avatar: src.avatar,
    repos,
    selected: repos.map((repo) => repo.name),
  };
}

export function githubIsShown(raw) {
  const s = shareGithub(raw);
  return Boolean(s.login && s.repos.length);
}

export async function fetchGithubProfile(login) {
  const user = parseGithubLogin(login);
  if (!user) return Promise.reject(new Error("Need a GitHub username, or paste github.com/name."));
  const headers = { Accept: "application/vnd.github+json" };
  const userRes = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}`, { headers });
  if (userRes.status === 404) throw new Error("No GitHub user with that name.");
  if (userRes.status === 403) throw new Error("GitHub rate limit. Try again in a bit.");
  if (!userRes.ok) throw new Error("Could not load GitHub.");
  const data = await userRes.json();
  const loginName = parseGithubLogin(data.login) || user;
  const repos = [];
  for (let page = 1; page <= 2; page += 1) {
    const repoRes = await fetch(
      `https://api.github.com/users/${encodeURIComponent(loginName)}/repos?sort=updated&per_page=100&page=${page}&type=owner`,
      { headers }
    );
    if (repoRes.status === 403) throw new Error("GitHub rate limit. Try again in a bit.");
    if (!repoRes.ok) throw new Error("Could not load GitHub repos.");
    const batch = await repoRes.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const row of batch) {
      if (row?.private) continue;
      const repo = sanitizeRepo({
        name: row.name,
        description: row.description,
        language: row.language,
        stars: row.stargazers_count,
        fork: row.fork,
        homepage: row.homepage,
        has_pages: row.has_pages,
      }, loginName);
      if (repo) repos.push(repo);
    }
    if (batch.length < 100) break;
  }
  repos.sort((a, b) => {
    if (Boolean(a.fork) !== Boolean(b.fork)) return a.fork ? 1 : -1;
    return (b.stars || 0) - (a.stars || 0);
  });
  return {
    login: loginName,
    name: clip(data.name, 80),
    bio: clip(data.bio, 180),
    avatar: sanitizeGithubAvatar(data.avatar_url),
    repos: sanitizeGithubRepos(repos, loginName),
  };
}
