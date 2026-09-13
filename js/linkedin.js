const HANDLE_RE = /^[a-zA-Z0-9-]{2,100}$/;
const ITEM_ID_RE = /^[a-z][a-z0-9]{5,15}$/;
const SELECT_KEYS = new Set(["handle", "photo", "name", "headline"]);
export const LINKEDIN_ITEM_MAX = 12;
const TEXT = {
  name: 80,
  headline: 180,
  title: 80,
  org: 80,
  dates: 40,
  school: 80,
  degree: 80,
  project: 80,
  summary: 240,
  handle: 160,
};

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function linkedInHost(host) {
  const h = String(host || "").replace(/^www\./i, "").toLowerCase();
  return h === "linkedin.com" || h === "linkedin.cn" || h.endsWith(".linkedin.com");
}

export function emptyLinkedIn() {
  return {
    handle: "",
    name: "",
    headline: "",
    photo: "",
    experience: [],
    education: [],
    projects: [],
    selected: [],
  };
}

export function parseLinkedInHandle(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (HANDLE_RE.test(raw)) return raw.toLowerCase();
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  if (!linkedInHost(url.hostname)) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase() === "in");
  const handle = i >= 0 ? decodeURIComponent(parts[i + 1] || "") : "";
  return HANDLE_RE.test(handle) ? handle.toLowerCase() : "";
}

export function linkedInProfileUrl(handle) {
  const id = parseLinkedInHandle(handle);
  return id ? `https://www.linkedin.com/in/${encodeURIComponent(id)}` : "";
}

export function newLinkedInItemId(prefix) {
  const p = /^[a-z]/.test(String(prefix || "")) ? String(prefix).slice(0, 1) : "x";
  let rest = Math.random().toString(36).slice(2);
  while (rest.length < 7) rest += Math.random().toString(36).slice(2);
  return `${p}${rest.slice(0, 7)}`;
}

export function sanitizeLinkedInPhoto(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    if (!host.endsWith("licdn.com") && !host.endsWith("licdn-ei.com")) return "";
    if (/logo/i.test(u.pathname)) return "";
    return u.href.slice(0, 500);
  } catch {
    return "";
  }
}

function sanitizeExperience(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "");
    if (!ITEM_ID_RE.test(id) || seen.has(id)) continue;
    const title = clip(raw.title, TEXT.title);
    const org = clip(raw.org, TEXT.org);
    const dates = clip(raw.dates, TEXT.dates);
    if (!title && !org) continue;
    seen.add(id);
    out.push({ id, title, org, dates });
    if (out.length >= LINKEDIN_ITEM_MAX) break;
  }
  return out;
}

function sanitizeEducation(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "");
    if (!ITEM_ID_RE.test(id) || seen.has(id)) continue;
    const school = clip(raw.school, TEXT.school);
    const degree = clip(raw.degree, TEXT.degree);
    const dates = clip(raw.dates, TEXT.dates);
    if (!school && !degree) continue;
    seen.add(id);
    out.push({ id, school, degree, dates });
    if (out.length >= LINKEDIN_ITEM_MAX) break;
  }
  return out;
}

function sanitizeProjects(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "");
    if (!ITEM_ID_RE.test(id) || seen.has(id)) continue;
    const name = clip(raw.name, TEXT.project);
    const summary = clip(raw.summary, TEXT.summary);
    if (!name && !summary) continue;
    seen.add(id);
    out.push({ id, name, summary });
    if (out.length >= LINKEDIN_ITEM_MAX) break;
  }
  return out;
}

function allowedSelectedKeys(src) {
  const keys = new Set(SELECT_KEYS);
  for (const item of src.experience) keys.add(`exp:${item.id}`);
  for (const item of src.education) keys.add(`edu:${item.id}`);
  for (const item of src.projects) keys.add(`proj:${item.id}`);
  return keys;
}

export function sanitizeLinkedInSelected(ids, src) {
  const allowed = allowedSelectedKeys(src);
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw || "");
    if (!allowed.has(id) || seen.has(id)) continue;
    if (id === "photo" && !src.photo) continue;
    if (id === "name" && !src.name) continue;
    if (id === "headline" && !src.headline) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function sanitizeLinkedIn(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const draft = clip(src.handle, TEXT.handle);
  const parsed = parseLinkedInHandle(draft);
  const next = {
    handle: parsed || draft,
    name: clip(src.name, TEXT.name),
    headline: clip(src.headline, TEXT.headline),
    photo: sanitizeLinkedInPhoto(src.photo),
    experience: sanitizeExperience(src.experience),
    education: sanitizeEducation(src.education),
    projects: sanitizeProjects(src.projects),
    selected: [],
  };
  next.selected = sanitizeLinkedInSelected(src.selected, next);
  return next;
}

export function shareLinkedIn(raw) {
  const src = sanitizeLinkedIn(raw);
  const selected = new Set(src.selected);
  if (!parseLinkedInHandle(src.handle) || !selected.size) return emptyLinkedIn();
  return {
    handle: parseLinkedInHandle(src.handle),
    name: selected.has("name") ? src.name : "",
    headline: selected.has("headline") ? src.headline : "",
    photo: selected.has("photo") ? src.photo : "",
    experience: src.experience.filter((item) => selected.has(`exp:${item.id}`)),
    education: src.education.filter((item) => selected.has(`edu:${item.id}`)),
    projects: src.projects.filter((item) => selected.has(`proj:${item.id}`)),
    selected: sanitizeLinkedInSelected(src.selected, src),
  };
}

export function linkedInIsShown(raw) {
  const s = shareLinkedIn(raw);
  return Boolean(
    s.handle && (
      s.selected.includes("handle")
      || s.name
      || s.headline
      || s.photo
      || s.experience.length
      || s.education.length
      || s.projects.length
    )
  );
}

export function parseLinkedInBadgeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const nameEl = doc.querySelector(".profile-badge__content-profile-name, .profile-badge__name, h3");
  const headlineEl = doc.querySelector(".profile-badge__content-profile-headline, .profile-badge__headline, h4");
  let photo = "";
  for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
    const cls = String(img.className || "");
    const alt = String(img.getAttribute("alt") || "");
    if (/logo/i.test(cls) || /logo/i.test(src) || /^linkedin$/i.test(alt.trim())) continue;
    const next = sanitizeLinkedInPhoto(src);
    if (!next) continue;
    if (/profile-image|profile-badge__content-profile-image/i.test(cls) || src.includes("media.licdn")) {
      photo = next;
      break;
    }
    if (!photo) photo = next;
  }
  return {
    name: clip(nameEl?.textContent, TEXT.name),
    headline: clip(headlineEl?.textContent, TEXT.headline),
    photo,
  };
}

export function fetchLinkedInBadge(vanity) {
  const handle = parseLinkedInHandle(vanity);
  if (!handle) return Promise.reject(new Error("Need a LinkedIn profile URL or handle."));
  return new Promise((resolve, reject) => {
    const uid = Math.round(1000000 * Math.random());
    const prev = globalThis.LIBadgeCallback;
    let settled = false;
    const script = document.createElement("script");
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (globalThis.LIBadgeCallback === callback) {
        if (typeof prev === "function") globalThis.LIBadgeCallback = prev;
        else delete globalThis.LIBadgeCallback;
      }
      script.remove();
      if (err) reject(err);
      else resolve(data);
    };
    const callback = (html, badgeUid) => {
      if (Number(badgeUid) !== uid) {
        try { prev?.(html, badgeUid); } catch { /* ignore */ }
        return;
      }
      const parsed = parseLinkedInBadgeHtml(html);
      if (!parsed.name && !parsed.headline && !parsed.photo) {
        finish(new Error("LinkedIn did not return a public badge for that profile."));
        return;
      }
      finish(null, parsed);
    };
    globalThis.LIBadgeCallback = callback;
    const timer = setTimeout(() => {
      finish(new Error("LinkedIn timed out. It may be blocking this page."));
    }, 8000);
    script.src = `https://badges.linkedin.com/profile?locale=en_US&badgetype=VERTICAL&badgetheme=light&uid=${uid}&version=v1&maxsize=medium&trk=profile-badge&vanityname=${encodeURIComponent(handle)}`;
    script.onerror = () => finish(new Error("Could not load LinkedIn."));
    document.body.append(script);
  });
}

export const LINKEDIN_DATA_DOWNLOAD_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";
const ZIP_MAX_BYTES = 40 * 1024 * 1024;
const CSV_MAX_BYTES = 2 * 1024 * 1024;
const CSV_KINDS = {
  "profile.csv": "profile",
  "positions.csv": "positions",
  "education.csv": "education",
  "projects.csv": "projects",
};

function normKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function csvKind(path) {
  const base = String(path || "").split(/[/\\]/).pop().toLowerCase();
  return CSV_KINDS[base] || "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  const s = String(text || "").replace(/^\uFEFF/, "");
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === "\"") {
        if (s[i + 1] === "\"") {
          cell += "\"";
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === "\"") {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map(normKey);
  const out = [];
  for (const cells of rows.slice(1)) {
    if (cells.every((value) => !String(value || "").trim())) continue;
    const obj = {};
    headers.forEach((key, index) => {
      if (key) obj[key] = cells[index] || "";
    });
    out.push(obj);
  }
  return out;
}

function val(row, aliases) {
  for (const alias of aliases) {
    const value = String(row?.[normKey(alias)] || "").trim();
    if (value) return value;
  }
  return "";
}

function handleFromText(value) {
  const parsed = parseLinkedInHandle(value);
  if (parsed) return parsed;
  const match = String(value || "").match(/linkedin\.com\/in\/([a-zA-Z0-9-]{2,100})/i);
  return match ? parseLinkedInHandle(match[1]) : "";
}

function formatLinkedInDates(start, end) {
  const from = clip(start, TEXT.dates);
  const to = clip(end, TEXT.dates);
  if (!from && !to) return "";
  if (!to || /present|current/i.test(to)) return from ? `${from} – Present` : "";
  if (!from) return to;
  return `${from} – ${to}`;
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Unzip the archive and choose the CSV files.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function csvsFromZip(buffer) {
  if (buffer.byteLength > ZIP_MAX_BYTES) {
    throw new Error("That zip is too large. Request only Profile, Positions, Education, and Projects.");
  }
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  const min = Math.max(0, buffer.byteLength - 22 - 65535);
  for (let i = buffer.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Need a LinkedIn data zip, or the CSV files from it.");
  const count = view.getUint16(eocd + 10, true);
  const cdOff = view.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || count === 0xffff) {
    throw new Error("Unzip that archive and choose Profile.csv, Positions.csv, Education.csv, and Projects.csv.");
  }
  const found = {};
  let offset = cdOff;
  for (let n = 0; n < count && offset + 46 <= buffer.byteLength; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const uncompSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOff = view.getUint32(offset + 42, true);
    const path = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
    const kind = csvKind(path);
    if (!kind || found[kind] || uncompSize > CSV_MAX_BYTES || !compSize) continue;
    if (view.getUint32(localOff, true) !== 0x04034b50) continue;
    const locName = view.getUint16(localOff + 26, true);
    const locExtra = view.getUint16(localOff + 28, true);
    const data = bytes.subarray(localOff + 30 + locName + locExtra, localOff + 30 + locName + locExtra + compSize);
    let raw;
    if (method === 0) raw = data;
    else if (method === 8) raw = await inflateRaw(data);
    else continue;
    found[kind] = decodeUtf8(raw);
  }
  return found;
}

export function linkedInFromExportTexts(texts) {
  const src = texts && typeof texts === "object" ? texts : {};
  const next = emptyLinkedIn();
  const profileRows = parseCsv(src.profile);
  const profile = profileRows[0] || {};
  const first = val(profile, ["firstname", "first"]);
  const last = val(profile, ["lastname", "last"]);
  next.name = clip([first, last].filter(Boolean).join(" "), TEXT.name);
  next.headline = clip(
    val(profile, ["headline", "occupation", "summary"]),
    TEXT.headline
  );
  next.handle = handleFromText(val(profile, [
    "publicprofileurl",
    "vanityname",
    "linkedin",
    "publicprofile",
    "vanityurl",
    "websites",
  ]));
  if (!next.handle) {
    for (const value of Object.values(profile)) {
      next.handle = handleFromText(value);
      if (next.handle) break;
    }
  }
  for (const row of parseCsv(src.positions)) {
    const title = val(row, ["title", "jobtitle", "position"]);
    const org = val(row, ["companyname", "company"]);
    if (!title && !org) continue;
    next.experience.push({
      id: newLinkedInItemId("e"),
      title: clip(title, TEXT.title),
      org: clip(org, TEXT.org),
      dates: formatLinkedInDates(
        val(row, ["startedon", "startdate", "started", "fromdate"]),
        val(row, ["finishedon", "enddate", "ended", "todate"])
      ),
    });
    if (next.experience.length >= LINKEDIN_ITEM_MAX) break;
  }
  for (const row of parseCsv(src.education)) {
    const school = val(row, ["schoolname", "school", "institution"]);
    const degree = val(row, ["degreename", "degree"]);
    if (!school && !degree) continue;
    next.education.push({
      id: newLinkedInItemId("u"),
      school: clip(school, TEXT.school),
      degree: clip(degree, TEXT.degree),
      dates: formatLinkedInDates(
        val(row, ["startdate", "startedon", "started"]),
        val(row, ["enddate", "finishedon", "ended"])
      ),
    });
    if (next.education.length >= LINKEDIN_ITEM_MAX) break;
  }
  for (const row of parseCsv(src.projects)) {
    const name = val(row, ["title", "projectname", "name"]);
    const summary = val(row, ["description", "summary"]);
    if (!name && !summary) continue;
    next.projects.push({
      id: newLinkedInItemId("p"),
      name: clip(name, TEXT.project),
      summary: clip(summary, TEXT.summary),
    });
    if (next.projects.length >= LINKEDIN_ITEM_MAX) break;
  }
  return sanitizeLinkedIn(next);
}

export function linkedInHasDraft(raw) {
  const src = sanitizeLinkedIn(raw);
  return Boolean(
    parseLinkedInHandle(src.handle)
    || src.name
    || src.headline
    || src.photo
    || src.experience.length
    || src.education.length
    || src.projects.length
  );
}

export function linkedInImportSummary(imported) {
  const src = sanitizeLinkedIn(imported);
  const parts = [];
  if (src.handle) parts.push("profile link");
  if (src.name) parts.push("name");
  if (src.headline) parts.push("headline");
  if (src.experience.length) parts.push(`${src.experience.length} role${src.experience.length === 1 ? "" : "s"}`);
  if (src.education.length) parts.push(`${src.education.length} school${src.education.length === 1 ? "" : "s"}`);
  if (src.projects.length) parts.push(`${src.projects.length} project${src.projects.length === 1 ? "" : "s"}`);
  if (!parts.length) return "";
  return `Imported ${parts.join(", ")}. Tap what to show on your profile.`;
}

export async function importLinkedInArchive(fileList) {
  const files = [...(fileList || [])].filter(Boolean);
  if (!files.length) throw new Error("Choose a LinkedIn data zip or CSV files.");
  const texts = {};
  for (const file of files) {
    const name = String(file.name || "").toLowerCase();
    if (name.endsWith(".zip") || file.type === "application/zip") {
      Object.assign(texts, await csvsFromZip(await file.arrayBuffer()));
      continue;
    }
    const kind = csvKind(file.name);
    if (!kind) continue;
    if (file.size > CSV_MAX_BYTES) continue;
    texts[kind] = await file.text();
  }
  const imported = linkedInFromExportTexts(texts);
  if (!linkedInHasDraft(imported)) {
    throw new Error("No Profile, Positions, Education, or Projects data in that file.");
  }
  return imported;
}
