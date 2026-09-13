import { GENDERS, LOOKING_FOR_OPTIONS, MIN_AGE, MUSIC_GENRES, MUSIC_INSTRUMENTS, NETWORKING_INTENTS } from "./config.js";
import { publishedLoc } from "./geo.js";
import { emptyBandcamp, sanitizeBandcamp, shareBandcamp } from "./bandcamp.js";
import { emptyGithub, sanitizeGithub, shareGithub } from "./github.js";
import { emptyLinkedIn, sanitizeLinkedIn, shareLinkedIn } from "./linkedin.js";
import { emptySoundCloud, sanitizeSoundCloud, shareSoundCloud } from "./soundcloud.js";
import { parseYoutubePlaylistId, sanitizeYoutubePlaylistThumb } from "./youtube.js";

function copyList(value) {
  return Array.isArray(value) ? [...value] : [];
}

export function ageFromDob(dob) {
  if (!dob) return null;
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  return age;
}

export function isAdult(dob) {
  const age = ageFromDob(dob);
  return age != null && age >= MIN_AGE;
}

export const PRIVACY_LEVELS = [
  { id: "public", label: "Public", letter: "P" },
  { id: "connections", label: "Connections", letter: "C" },
  { id: "friends", label: "Friends", letter: "F" },
  { id: "me", label: "Me", letter: "M" },
];

const PRIVACY_RANK = { public: 0, connections: 1, friends: 2, me: 3 };
const SCALAR_PRIVACY = [
  "photo",
  "handle",
  "gender",
  "genderSelf",
  "age",
  "loc",
  "preciseLoc",
  "interests",
  "antiInterests",
  "hobbies",
  "youtubeChannelId",
  "youtubePlaylistId",
  "github",
  "bandcamp",
  "soundcloud",
  "linkedin",
];
const YT_CHANNEL_ID_RE = /^UC[\w-]{22}$/;
const YT_CHANNEL_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

export function parseYoutubeChannelId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (YT_CHANNEL_ID_RE.test(raw)) return raw;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (!YT_CHANNEL_HOSTS.has(host)) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase() === "channel");
  const id = i >= 0 ? parts[i + 1] || "" : "";
  return YT_CHANNEL_ID_RE.test(id) ? id : "";
}

function youtubeUploadsPlaylistId(channelId) {
  const id = parseYoutubeChannelId(channelId);
  return id ? `UU${id.slice(2)}` : "";
}

export function youtubeChannelUrl(channelId) {
  const id = parseYoutubeChannelId(channelId);
  return id ? `https://www.youtube.com/channel/${id}` : "";
}

export function youtubeChannelEmbedUrl(channelId) {
  const list = youtubeUploadsPlaylistId(channelId);
  return list
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}`
    : "";
}

export const YOUTUBE_VIDEO_MAX = 24;
const YT_VIDEO_ID_RE = /^[\w-]{11}$/;

export function sanitizeYoutubeVideoIds(ids) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw || "");
    if (!YT_VIDEO_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= YOUTUBE_VIDEO_MAX) break;
  }
  return out;
}
const MAP_PRIVACY = ["lookingFor", "questionnaire"];
const MAP_PRIVACY_SET = new Set(MAP_PRIVACY);

const LOOKING_FOR_PRIVACY_DEFAULTS_V2 = {
  relationships: "me",
  friendships: "connections",
  networking: "me",
  "musician-seeking-band": "me",
  "band-seeking-musician": "me",
};

export const LOOKING_FOR_PRIVACY_DEFAULTS = {
  relationships: "public",
  friendships: "public",
  networking: "public",
  "musician-seeking-band": "public",
  "band-seeking-musician": "public",
};
const PRIVACY_DEFAULTS_VERSION = 6;

export function isPrivacyLevel(value) {
  return Object.prototype.hasOwnProperty.call(PRIVACY_RANK, value);
}

export function privacyLetter(level) {
  return PRIVACY_LEVELS.find((o) => o.id === level)?.letter || "P";
}

export function privacyVisible(level, audience) {
  const field = isPrivacyLevel(level) ? level : "public";
  const view = isPrivacyLevel(audience) ? audience : "public";
  return PRIVACY_RANK[field] <= PRIVACY_RANK[view];
}

function copyPrivacyMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, level] of Object.entries(value)) {
    if (isPrivacyLevel(level)) out[key] = level;
  }
  return out;
}

function scalarPrivacyDefaultsAt(version) {
  const out = {};
  for (const key of SCALAR_PRIVACY) out[key] = "public";
  if (version >= 2) {
    for (const key of SCALAR_PRIVACY) out[key] = "me";
    out.handle = "connections";
  }
  if (version >= 3) {
    out.photo = "public";
    out.gender = "public";
    out.genderSelf = "public";
    out.age = "public";
    out.interests = "public";
    out.hobbies = "public";
  }
  if (version >= 4) out.loc = "public";
  if (version >= 6) out.loc = "me";
  out.preciseLoc = "me";
  return out;
}

function lookingForDefaultAt(version, id) {
  if (version >= 5) return LOOKING_FOR_PRIVACY_DEFAULTS[id] || "public";
  if (version >= 2) return LOOKING_FOR_PRIVACY_DEFAULTS_V2[id] || "me";
  return "public";
}

function questionnaireDefaultAt(version) {
  return version >= 2 ? "me" : "public";
}

export function emptyPrivacy() {
  return {
    v: PRIVACY_DEFAULTS_VERSION,
    ...scalarPrivacyDefaultsAt(PRIVACY_DEFAULTS_VERSION),
    lookingFor: { ...LOOKING_FOR_PRIVACY_DEFAULTS },
    questionnaire: {},
  };
}

export function normalizePrivacy(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const privacy = emptyPrivacy();
  const srcV = Number(src.v) || 1;
  const fromOldDefaults = srcV < PRIVACY_DEFAULTS_VERSION;
  const oldScalar = fromOldDefaults ? scalarPrivacyDefaultsAt(srcV) : null;
  for (const key of SCALAR_PRIVACY) {
    if (!isPrivacyLevel(src[key])) continue;
    if (fromOldDefaults && src[key] === oldScalar[key]) continue;
    privacy[key] = src[key];
  }
  const looking = copyPrivacyMap(src.lookingFor);
  for (const [id, level] of Object.entries(looking)) {
    if (fromOldDefaults && level === lookingForDefaultAt(srcV, id)) continue;
    privacy.lookingFor[id] = level;
  }
  const answers = copyPrivacyMap(src.questionnaire);
  for (const [id, level] of Object.entries(answers)) {
    if (fromOldDefaults && level === questionnaireDefaultAt(srcV)) continue;
    privacy.questionnaire[id] = level;
  }
  return privacy;
}

export function fieldPrivacy(profile, field, item) {
  const privacy = normalizePrivacy(profile?.privacy);
  if (field === "lookingFor") {
    const id = item || "";
    const level = privacy.lookingFor?.[id];
    if (isPrivacyLevel(level)) return level;
    return LOOKING_FOR_PRIVACY_DEFAULTS[id] || "public";
  }
  if (item != null && item !== "") {
    const level = privacy[field]?.[item];
    return isPrivacyLevel(level) ? level : "me";
  }
  return isPrivacyLevel(privacy[field]) ? privacy[field] : "me";
}

export function withFieldPrivacy(privacy, field, item, level) {
  const next = normalizePrivacy(privacy);
  if (!isPrivacyLevel(level)) return next;
  if (item != null && item !== "" && MAP_PRIVACY_SET.has(field)) {
    next[field] = { ...next[field], [String(item)]: level };
    return next;
  }
  if (SCALAR_PRIVACY.includes(field)) next[field] = level;
  return next;
}

function sharePublishedLoc(loc, privacy, audience, opts) {
  if (!opts.preciseLoc) return null;
  const preciseLevel = isPrivacyLevel(privacy?.preciseLoc) ? privacy.preciseLoc : "me";
  return privacyVisible(preciseLevel, audience) ? publishedLoc(loc) : null;
}

function listIfVisible(ids, level, audience) {
  return privacyVisible(level, audience) ? copyList(ids) : [];
}

function filterQuestionnaire(answers, map, audience) {
  const out = {};
  for (const [id, value] of Object.entries(answers || {})) {
    if (!value) continue;
    if (privacyVisible(map?.[id] || "me", audience)) out[id] = value;
  }
  return out;
}

export const PROFILE_SECTION_IDS = [
  "about",
  "looking",
  "interests",
  "hobbies",
  "antiInterests",
  "values",
  "youtube",
  "youtube-music",
  "linkedin",
  "github",
  "soundcloud",
  "bandcamp",
];

const PREVIOUS_DEFAULT_SECTION_ORDER = [
  "about",
  "youtube",
  "youtube-music",
  "soundcloud",
  "bandcamp",
  "github",
  "linkedin",
  "looking",
  "antiInterests",
  "values",
  "interests",
  "hobbies",
];

function sameSectionOrder(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function sanitizeSectionOrder(order) {
  const known = new Set(PROFILE_SECTION_IDS);
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(order) ? order : []) {
    const id = String(raw || "");
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (!out.length || sameSectionOrder(out, PREVIOUS_DEFAULT_SECTION_ORDER)) {
    return [...PROFILE_SECTION_IDS];
  }
  for (const id of PROFILE_SECTION_IDS) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

export function applySectionOrder(current, visibleOrder) {
  const full = sanitizeSectionOrder(current);
  const visible = [];
  const seen = new Set();
  const known = new Set(PROFILE_SECTION_IDS);
  for (const raw of Array.isArray(visibleOrder) ? visibleOrder : []) {
    const id = String(raw || "");
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    visible.push(id);
  }
  if (!visible.length) return full;
  const next = [...visible];
  for (const id of full) {
    if (seen.has(id)) continue;
    const oldIndex = full.indexOf(id);
    let insertAt = next.length;
    for (let i = oldIndex - 1; i >= 0; i--) {
      const j = next.indexOf(full[i]);
      if (j >= 0) {
        insertAt = j + 1;
        break;
      }
    }
    next.splice(insertAt, 0, id);
  }
  return sanitizeSectionOrder(next);
}

export function emptyProfile() {
  return {
    handle: "",
    dob: "",
    gender: "",
    genderSelf: "",
    seeking: [],
    seekingRelationships: [],
    seekingFriendships: [],
    networking: [],
    musicianSeekingBand: [],
    musicianInstruments: [],
    bandSeekingMusician: [],
    photo: "",
    interests: [],
    antiInterests: [],
    hobbies: [],
    youtubeChannelId: "",
    youtubeVideoIds: [],
    youtubePlaylistId: "",
    youtubePlaylistThumb: "",
    github: emptyGithub(),
    bandcamp: emptyBandcamp(),
    soundcloud: emptySoundCloud(),
    linkedin: emptyLinkedIn(),
    questionnaire: {},
    privacy: emptyPrivacy(),
    sectionOrder: [...PROFILE_SECTION_IDS],
    loc: null,
    zip: null,
    updatedAt: 0,
  };
}

export function normalizeProfile(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const profile = { ...emptyProfile(), ...src };
  const hasStructuredSeeking =
    Object.prototype.hasOwnProperty.call(src, "seekingRelationships") ||
    Object.prototype.hasOwnProperty.call(src, "seekingFriendships") ||
    Object.prototype.hasOwnProperty.call(src, "networking");
  if (!hasStructuredSeeking) {
    profile.seekingRelationships = copyList(src.seeking);
  }
  profile.seekingRelationships = copyList(profile.seekingRelationships);
  profile.seekingFriendships = copyList(profile.seekingFriendships);
  profile.networking = copyList(profile.networking);
  profile.musicianSeekingBand = copyList(profile.musicianSeekingBand);
  profile.musicianInstruments = copyList(profile.musicianInstruments);
  profile.bandSeekingMusician = copyList(profile.bandSeekingMusician);
  profile.seeking = [...profile.seekingRelationships];
  profile.interests = copyList(profile.interests);
  profile.antiInterests = copyList(profile.antiInterests);
  profile.hobbies = copyList(profile.hobbies);
  const youtubeChannelId = parseYoutubeChannelId(src.youtubeChannelId);
  profile.youtubeChannelId = youtubeChannelId || String(src.youtubeChannelId || "").trim().slice(0, 120);
  profile.youtubeVideoIds = sanitizeYoutubeVideoIds(src.youtubeVideoIds);
  const youtubePlaylistId = parseYoutubePlaylistId(src.youtubePlaylistId);
  profile.youtubePlaylistId = youtubePlaylistId || String(src.youtubePlaylistId || "").trim().slice(0, 120);
  profile.youtubePlaylistThumb = sanitizeYoutubePlaylistThumb(src.youtubePlaylistThumb);
  profile.github = sanitizeGithub(src.github);
  profile.bandcamp = sanitizeBandcamp(src.bandcamp);
  profile.soundcloud = sanitizeSoundCloud(src.soundcloud);
  profile.linkedin = sanitizeLinkedIn(src.linkedin);
  profile.questionnaire = profile.questionnaire && typeof profile.questionnaire === "object"
    ? { ...profile.questionnaire }
    : {};
  profile.privacy = normalizePrivacy(src.privacy);
  profile.sectionOrder = sanitizeSectionOrder(src.sectionOrder);
  const zip = String(src.zip || src.zones?.zip || "").trim();
  profile.zip = zip || null;
  delete profile.zones;
  return profile;
}

export function seekingLists(person) {
  const src = person && typeof person === "object" ? person : {};
  const relationships = Array.isArray(src.seekingRelationships)
    ? src.seekingRelationships
    : copyList(src.seeking);
  return {
    relationships,
    friendships: copyList(src.seekingFriendships),
    networking: copyList(src.networking),
    musicianSeekingBand: copyList(src.musicianSeekingBand),
    musicianInstruments: copyList(src.musicianInstruments),
    bandSeekingMusician: copyList(src.bandSeekingMusician),
  };
}

export function hasRelationshipIntent(person) {
  return seekingLists(person).relationships.length > 0;
}

export function lookingForIntentIds(person) {
  const lists = seekingLists(person);
  const ids = [];
  if (lists.relationships.length) ids.push("relationships");
  if (lists.friendships.length) ids.push("friendships");
  if (lists.networking.length) ids.push("networking");
  if (lists.musicianSeekingBand.length || lists.musicianInstruments.length) {
    ids.push("musician-seeking-band");
  }
  if (lists.bandSeekingMusician.length) ids.push("band-seeking-musician");
  return ids;
}

export function lookingForOptionLabel(id) {
  return LOOKING_FOR_OPTIONS.find((o) => o.id === id)?.label || id;
}

export function hasLookingFor(profile) {
  return lookingForIntentIds(profile).length > 0;
}

export function identityBasicsComplete(profile) {
  if (!profile) return false;
  return Boolean(
    String(profile.handle || "").trim() &&
      isAdult(profile.dob) &&
      profile.gender &&
      (profile.gender !== "self" || String(profile.genderSelf || "").trim())
  );
}

export function profileComplete(profile) {
  if (!profile) return false;
  return Boolean(
    identityBasicsComplete(profile) &&
      hasLookingFor(profile) &&
      profile.photo &&
      profile.loc &&
      profile.zip
  );
}

export function publicProfile(profile, peerId, opts) {
  return visibleProfile(profile, peerId, "public", opts);
}

export function shareProfile(profile, peerId, audience = "public", opts) {
  return visibleProfile(profile, peerId, audience, opts);
}

export function visibleProfile(profile, peerId, audience = "public", opts = {}) {
  const normalized = normalizeProfile(profile);
  const privacy = normalized.privacy;
  const see = (field) => privacyVisible(privacy[field], audience);
  const lookingLevel = (id) => fieldPrivacy({ privacy }, "lookingFor", id);
  const seekingRelationships = listIfVisible(
    normalized.seekingRelationships,
    lookingLevel("relationships"),
    audience
  );
  const seekingFriendships = listIfVisible(
    normalized.seekingFriendships,
    lookingLevel("friendships"),
    audience
  );
  const networking = listIfVisible(
    normalized.networking,
    lookingLevel("networking"),
    audience
  );
  const musicianInstruments = listIfVisible(
    normalized.musicianInstruments,
    lookingLevel("musician-seeking-band"),
    audience
  );
  const musicianSeekingBand = listIfVisible(
    normalized.musicianSeekingBand,
    lookingLevel("musician-seeking-band"),
    audience
  );
  const bandSeekingMusician = listIfVisible(
    normalized.bandSeekingMusician,
    lookingLevel("band-seeking-musician"),
    audience
  );
  const genderVisible = see("gender");
  const out = {
    v: 1,
    peerId,
    age: see("age") ? ageFromDob(normalized.dob) : null,
    gender: genderVisible ? normalized.gender : "",
    genderSelf: genderVisible && see("genderSelf") ? (normalized.genderSelf || "") : "",
    seeking: seekingRelationships,
    seekingRelationships,
    seekingFriendships,
    networking,
    musicianSeekingBand,
    musicianInstruments,
    bandSeekingMusician,
    photo: see("photo") ? normalized.photo : "",
    interests: listIfVisible(normalized.interests, privacy.interests, audience),
    antiInterests: listIfVisible(normalized.antiInterests, privacy.antiInterests, audience),
    hobbies: listIfVisible(normalized.hobbies, privacy.hobbies, audience),
    youtubeChannelId: see("youtubeChannelId") ? parseYoutubeChannelId(normalized.youtubeChannelId) : "",
    youtubeVideoIds: see("youtubeChannelId") ? sanitizeYoutubeVideoIds(normalized.youtubeVideoIds) : [],
    youtubePlaylistId: see("youtubePlaylistId") ? parseYoutubePlaylistId(normalized.youtubePlaylistId) : "",
    youtubePlaylistThumb: see("youtubePlaylistId") ? sanitizeYoutubePlaylistThumb(normalized.youtubePlaylistThumb) : "",
    github: see("github") ? shareGithub(normalized.github) : emptyGithub(),
    bandcamp: see("bandcamp") ? shareBandcamp(normalized.bandcamp) : emptyBandcamp(),
    soundcloud: see("soundcloud") ? shareSoundCloud(normalized.soundcloud) : emptySoundCloud(),
    linkedin: see("linkedin") ? shareLinkedIn(normalized.linkedin) : emptyLinkedIn(),
    questionnaire: filterQuestionnaire(normalized.questionnaire, privacy.questionnaire, audience),
    sectionOrder: sanitizeSectionOrder(normalized.sectionOrder),
    loc: sharePublishedLoc(normalized.loc, privacy, audience, opts),
    zip: see("loc") ? normalized.zip : null,
    updatedAt: normalized.updatedAt || 0,
  };
  if (see("handle")) out.handle = normalized.handle || "";
  return out;
}

export function seekingGenderLabels(ids) {
  if ((ids || []).includes("everyone")) return ["Everyone"];
  return (ids || []).map((id) => {
    if (id === "self") return "Self-described";
    return GENDERS.find((g) => g.id === id)?.label || id;
  });
}

export function optionLabels(options, ids) {
  return (ids || []).map((id) => options.find((o) => o.id === id)?.label || id);
}

export function networkingLabels(ids) {
  return optionLabels(NETWORKING_INTENTS, ids);
}

export function lookingForChips(person, { compact } = {}) {
  const lists = seekingLists(person);
  const chips = [];
  if (lists.relationships.length) {
    const who = seekingGenderLabels(lists.relationships).join(", ");
    const name = lookingForOptionLabel("relationships");
    chips.push({
      id: "relationships",
      label: compact ? name : `${name} · ${who}`,
    });
  }
  if (lists.friendships.length) {
    const who = seekingGenderLabels(lists.friendships).join(", ");
    const name = lookingForOptionLabel("friendships");
    chips.push({
      id: "friendships",
      label: compact ? name : `${name} · ${who}`,
    });
  }
  if (lists.networking.length) {
    const labels = networkingLabels(lists.networking);
    const name = lookingForOptionLabel("networking");
    if (compact) {
      for (const label of labels) chips.push({ id: "networking", label });
    } else {
      chips.push({
        id: "networking",
        label: `${name} · ${labels.join(", ")}`,
      });
    }
  }
  if (lists.musicianSeekingBand.length || lists.musicianInstruments.length) {
    const instruments = optionLabels(MUSIC_INSTRUMENTS, lists.musicianInstruments);
    const genres = optionLabels(MUSIC_GENRES, lists.musicianSeekingBand);
    const detail = [...instruments, ...genres].join(", ");
    const name = lookingForOptionLabel("musician-seeking-band");
    chips.push({
      id: "musician-seeking-band",
      label: compact || !detail ? name : `${name} · ${detail}`,
    });
  }
  if (lists.bandSeekingMusician.length) {
    const labels = optionLabels(MUSIC_INSTRUMENTS, lists.bandSeekingMusician);
    const name = lookingForOptionLabel("band-seeking-musician");
    chips.push({
      id: "band-seeking-musician",
      label: compact ? name : `${name} · ${labels.join(", ")}`,
    });
  }
  return chips;
}

export function genderLabel(profile) {
  if (!profile) return "";
  if (profile.gender === "self") return profile.genderSelf || "Self-described";
  if (profile.gender === "woman") return "Woman";
  if (profile.gender === "man") return "Man";
  if (profile.gender === "nonbinary") return "Non-binary";
  return "";
}
