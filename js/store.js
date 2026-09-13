import {
  APP_NAME,
  CHAT_HISTORY_MAX,
  CHAT_TEXT_MAX,
  DEFAULT_CHAT_RETENTION,
  DEFAULT_DISTANCE_MILES,
  MAX_AGE,
  MIN_AGE,
  STORAGE_PREFIX,
  STORE_VERSION,
} from "./config.js";
import { isChatRetention, pruneMessages } from "./chat.js";
import {
  createDeviceKeys,
  deviceConnId,
  isDevicePeerId,
  isVaultHubId,
  signDeviceBinding,
} from "./device.js";
import {
  createIdentity,
  keysMatch,
  peerIdFromPublicJwk,
  publicJwkOnly,
  samePublicKey,
} from "./identity.js";
import { sanitizeBandcamp } from "./bandcamp.js";
import { sanitizeGithub } from "./github.js";
import { sanitizeLinkedIn } from "./linkedin.js";
import { emptyProfile, normalizeProfile, parseYoutubeChannelId, sanitizeSectionOrder, sanitizeYoutubeVideoIds } from "./profile.js";
import { sanitizeSoundCloud } from "./soundcloud.js";
import { parseYoutubePlaylistId, sanitizeYoutubePlaylistThumb } from "./youtube.js";
import { isUserPeerId } from "./share.js";

function slot() {
  const params = new URLSearchParams(location.search);
  return params.get("slot") || "default";
}

function key() {
  return `${STORAGE_PREFIX}:v${STORE_VERSION}:${slot()}`;
}

const NAV_VIEWS = ["stack", "chat", "friends", "you", "settings"];

function lastViewKey() {
  return `${key()}:view`;
}

export function isNavView(view) {
  return NAV_VIEWS.includes(view);
}

export function getLastView() {
  try {
    const view = localStorage.getItem(lastViewKey());
    return isNavView(view) ? view : "";
  } catch {
    return "";
  }
}

export function setLastView(view) {
  if (!isNavView(view)) return;
  try {
    localStorage.setItem(lastViewKey(), view);
  } catch {
    // Private mode or quota: keep the in-memory view only.
  }
}

function defaultFilters() {
  return {
    minAge: MIN_AGE,
    maxAge: MAX_AGE,
    intents: [],
    distance: DEFAULT_DISTANCE_MILES,
    interestWeight: 0.7,
    peopleFilter: "all",
  };
}

function normalizeFilters(raw) {
  const incoming = raw && typeof raw === "object" ? raw : {};
  const filters = { ...defaultFilters(), ...incoming };
  if (!["all", "connected", "friends"].includes(filters.peopleFilter)) {
    filters.peopleFilter = incoming.interestedOnly ? "connected" : "all";
  }
  delete filters.interestedOnly;
  delete filters.genders;
  return filters;
}

function defaultState() {
  return {
    peerId: "",
    legacyId: false,
    publicKey: null,
    privateKey: null,
    profile: emptyProfile(),
    interestedPeerIds: [],
    friends: [],
    chats: {},
    chatRooms: {},
    pairState: {},
    filters: defaultFilters(),
    offline: true,
    linkedVault: null,
    syncRev: 0,
  };
}

let state = defaultState();
let deviceKeys = { publicKey: null, privateKey: null };
let deviceId = "";

function desktopBridge() {
  try {
    return typeof window !== "undefined" ? window.localChatDesktop || null : null;
  } catch {
    return null;
  }
}

export function isDesktopApp() {
  return Boolean(desktopBridge());
}

export function isPrimaryDevice() {
  if (desktopBridge()?.isPrimary) return true;
  return !state.linkedVault?.hubId;
}

function persistSessionInDurable() {
  return Boolean(desktopBridge()?.persistSession);
}

function deviceStorageKey() {
  return `${STORAGE_PREFIX}:v${STORE_VERSION}:device:${slot()}`;
}

export function getSlot() {
  return slot();
}

export function getState() {
  return state;
}

export function isOffline() {
  return Boolean(state.offline);
}

export function getIdentity() {
  return {
    peerId: state.peerId,
    legacyId: Boolean(state.legacyId),
    publicKey: publicJwkOnly(state.publicKey),
    privateKey: state.privateKey,
  };
}

export function getDeviceId() {
  return deviceId;
}

export function getDevice() {
  return {
    deviceId,
    publicKey: publicJwkOnly(deviceKeys.publicKey),
    privateKey: deviceKeys.privateKey,
  };
}

export function getLinkedVault() {
  return state.linkedVault || null;
}

export function identityLooksUsed() {
  const p = state.profile || {};
  if (String(p.handle || "").trim()) return true;
  if (p.photo || p.dob) return true;
  if (state.friends?.length) return true;
  if (state.chats && Object.keys(state.chats).length) return true;
  return false;
}

export async function devicePresence() {
  if (!deviceId || !deviceKeys.publicKey || !state.privateKey) return null;
  const binding = await signDeviceBinding(getIdentity(), {
    deviceId,
    publicKey: deviceKeys.publicKey,
  });
  if (!binding) return null;
  return {
    deviceId,
    publicKey: publicJwkOnly(deviceKeys.publicKey),
    binding,
  };
}

function applyIdentity(identity) {
  state.peerId = identity.peerId;
  state.legacyId = Boolean(identity.legacyId);
  state.publicKey = publicJwkOnly(identity.publicKey);
  state.privateKey = identity.privateKey;
}

export async function ensureIdentity() {
  const pub = publicJwkOnly(state.publicKey);
  const hasPriv = Boolean(state.privateKey?.d);
  if (pub && hasPriv) {
    if (!(await keysMatch(pub, state.privateKey))) {
      const identity = isUserPeerId(state.peerId)
        ? await createIdentity({ legacyPeerId: state.peerId })
        : await createIdentity();
      applyIdentity(identity);
      await ensureDevice();
      saveStore();
      return state;
    }
    const fingerprint = await peerIdFromPublicJwk(pub);
    if (state.legacyId) {
      if (!isUserPeerId(state.peerId)) state.peerId = fingerprint;
    } else if (!state.peerId) {
      state.peerId = fingerprint;
    } else if (state.peerId.toLowerCase() !== fingerprint.toLowerCase()) {
      state.legacyId = true;
    }
    return state;
  }
  const identity = isUserPeerId(state.peerId)
    ? await createIdentity({ legacyPeerId: state.peerId })
    : await createIdentity();
  applyIdentity(identity);
  await ensureDevice();
  saveStore();
  return state;
}

async function readDurableRaw() {
  const desktop = desktopBridge();
  if (desktop?.loadStore) {
    const raw = await desktop.loadStore();
    return raw || null;
  }
  try {
    return localStorage.getItem(key());
  } catch {
    return null;
  }
}

function writeDurableRaw(json) {
  const desktop = desktopBridge();
  if (desktop?.saveStore) {
    Promise.resolve(desktop.saveStore(json)).catch(() => {});
    return;
  }
  localStorage.setItem(key(), json);
}

function applyParsedStore(parsed) {
  state = {
    ...defaultState(),
    ...parsed,
    profile: normalizeProfile(parsed.profile),
    filters: normalizeFilters(parsed.filters),
    interestedPeerIds: parsed.interestedPeerIds || [],
    friends: sanitizeFriends(parsed.friends),
    chats: sanitizeChats(parsed.chats),
    chatRooms: sanitizeChatRooms(parsed.chatRooms),
    pairState: sanitizePairState(parsed.pairState || {}),
    peerId: isUserPeerId(parsed.peerId) ? parsed.peerId : "",
    legacyId: Boolean(parsed.legacyId),
    publicKey: publicJwkOnly(parsed.publicKey),
    privateKey: parsed.privateKey?.d ? parsed.privateKey : null,
    offline: parsed.offline == null ? true : Boolean(parsed.offline),
    linkedVault: sanitizeLinkedVault(parsed.linkedVault),
    syncRev: Number(parsed.syncRev) || 0,
  };
}

async function loadDeviceKeys() {
  const desktop = desktopBridge();
  if (desktop?.getDevice) {
    const rec = await desktop.getDevice();
    if (rec?.publicKey && rec?.privateKey?.d) return rec;
  }
  try {
    const raw = localStorage.getItem(deviceStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const publicKey = publicJwkOnly(parsed.publicKey);
    if (!publicKey || !parsed.privateKey?.d) return null;
    if (!(await keysMatch(publicKey, parsed.privateKey))) return null;
    return { publicKey, privateKey: parsed.privateKey };
  } catch {
    return null;
  }
}

async function persistDeviceKeys(keys) {
  const desktop = desktopBridge();
  if (desktop?.saveDevice) {
    Promise.resolve(desktop.saveDevice({
      publicKey: publicJwkOnly(keys.publicKey),
      privateKey: keys.privateKey,
    })).catch(() => {});
    return;
  }
  try {
    localStorage.setItem(deviceStorageKey(), JSON.stringify({
      publicKey: publicJwkOnly(keys.publicKey),
      privateKey: keys.privateKey,
    }));
  } catch {
    // Private mode: device keys stay in memory.
  }
}

export async function ensureDevice() {
  let keys = await loadDeviceKeys();
  if (!keys?.publicKey || !keys?.privateKey?.d) {
    keys = await createDeviceKeys();
    await persistDeviceKeys(keys);
  }
  deviceKeys = {
    publicKey: publicJwkOnly(keys.publicKey),
    privateKey: keys.privateKey,
  };
  deviceId = state.peerId
    ? await deviceConnId(state.peerId, deviceKeys.publicKey)
    : "";
  return getDevice();
}

export async function loadStore() {
  try {
    const raw = await readDurableRaw();
    if (!raw) {
      state = defaultState();
      await ensureIdentity();
      await ensureDevice();
      saveStore();
      return state;
    }
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    applyParsedStore(parsed);
    await ensureIdentity();
    await ensureDevice();
    if (!persistSessionInDurable()) mergeSessionChats();
    pruneAllChats({ save: false });
    seedChatReadAt();
    saveStore();
  } catch {
    state = defaultState();
    await ensureIdentity();
    await ensureDevice();
    saveStore();
  }
  return state;
}

function sessionKey() {
  return `${STORAGE_PREFIX}:v${STORE_VERSION}:session:${slot()}`;
}

function loadSessionChats() {
  try {
    const raw = sessionStorage.getItem(sessionKey());
    if (!raw) return {};
    return sanitizeChats(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeSessionChats(chats) {
  try {
    if (!chats || !Object.keys(chats).length) {
      sessionStorage.removeItem(sessionKey());
      return;
    }
    sessionStorage.setItem(sessionKey(), JSON.stringify(chats));
  } catch {
    // Private mode or quota: session transcripts stay in memory only.
  }
}

function mergeSessionChats() {
  const session = loadSessionChats();
  if (!Object.keys(session).length) return;
  const chats = { ...state.chats };
  for (const [roomId, msgs] of Object.entries(session)) {
    const prev = chats[roomId] || [];
    const ids = new Set(prev.map((m) => m.id));
    const merged = [...prev];
    for (const m of msgs) {
      if (!ids.has(m.id)) merged.push(m);
    }
    merged.sort((a, b) => (a.at || 0) - (b.at || 0));
    chats[roomId] = merged.slice(-CHAT_HISTORY_MAX);
  }
  state.chats = chats;
}

function splitChats() {
  const durable = {};
  const session = {};
  for (const [roomId, msgs] of Object.entries(state.chats || {})) {
    const peerId = peerIdForRoom(roomId);
    const retention = peerId ? getChatRetention(peerId) : "never";
    if (retention === "session") session[roomId] = msgs;
    else durable[roomId] = msgs;
  }
  return { durable, session };
}

function bumpSyncRev() {
  state.syncRev = Math.max(Number(state.syncRev) || 0, Date.now());
}

const saveListeners = new Set();

export function onStoreSave(fn) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

export function saveStore({ fromSync = false } = {}) {
  if (!fromSync) bumpSyncRev();
  const { durable, session } = splitChats();
  const chats = persistSessionInDurable() ? state.chats : durable;
  const payload = {
    ...state,
    chats,
  };
  delete payload.devicePrivateKey;
  delete payload.devicePublicKey;
  writeDurableRaw(JSON.stringify(payload));
  if (!persistSessionInDurable()) writeSessionChats(session);
  if (!fromSync) {
    for (const fn of saveListeners) {
      try { fn(); } catch { /* ignore */ }
    }
  }
}

export function trySaveStore() {
  try {
    saveStore();
    return true;
  } catch {
    return false;
  }
}

function sanitizeFriends(friends) {
  if (!Array.isArray(friends)) return [];
  return friends
    .map((f) => {
      const snap = friendSnapshot(f);
      if (!snap?.peerId) return null;
      return { ...snap, savedAt: Number(f.savedAt) || Date.now() };
    })
    .filter(Boolean);
}

function sanitizeChats(chats) {
  const out = {};
  if (!chats || typeof chats !== "object" || Array.isArray(chats)) return out;
  for (const [roomId, msgs] of Object.entries(chats)) {
    if (!Array.isArray(msgs)) continue;
    out[roomId] = msgs
      .filter((m) => m && m.id && m.from && typeof m.text === "string")
      .map((m) => ({
        id: String(m.id),
        from: String(m.from),
        text: String(m.text).slice(0, CHAT_TEXT_MAX),
        at: Number(m.at) || 0,
      }))
      .slice(-CHAT_HISTORY_MAX);
  }
  return out;
}

function sanitizeDeviceIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const value = String(id || "");
    if (!isDevicePeerId(value) && !isUserPeerId(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function sanitizeLinkedVault(raw) {
  if (!raw || typeof raw !== "object") return null;
  const hubId = String(raw.hubId || "");
  if (!isVaultHubId(hubId)) return null;
  return {
    hubId,
    vaultPublicKey: publicJwkOnly(raw.vaultPublicKey),
    profileId: String(raw.profileId || ""),
    linkedAt: Number(raw.linkedAt) || Date.now(),
  };
}

function sanitizeChatRooms(rooms) {
  const out = {};
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) return out;
  for (const [peerId, roomId] of Object.entries(rooms)) {
    if (!peerId || typeof roomId !== "string" || !roomId) continue;
    out[peerId] = roomId;
  }
  return out;
}

function sanitizePairState(pairState) {
  const out = {};
  for (const [id, pair] of Object.entries(pairState || {})) {
    const meInterested = Boolean(pair.meInterested);
    const themInterested = Boolean(pair.themInterested);
    const matched = Boolean(meInterested && themInterested);
    out[id] = {
      ...pair,
      meInterested,
      themInterested,
      matched,
      // Existing matches predate this flag; do not re-celebrate them on load.
      matchCelebrated: matched && pair.matchCelebrated !== false,
      friend: Boolean(pair.friend),
      friendAt: Number(pair.friendAt) || 0,
      chatRetention: isChatRetention(pair.chatRetention) ? pair.chatRetention : "",
      chatRetentionAt: Number(pair.chatRetentionAt) || 0,
      chatClearedAt: Number(pair.chatClearedAt) || 0,
      chatReadAt: Number(pair.chatReadAt) || 0,
      themChatReadAt: Number(pair.themChatReadAt) || 0,
      publicKey: publicJwkOnly(pair.publicKey),
      deviceIds: sanitizeDeviceIds(pair.deviceIds),
      updatedAt: Number(pair.updatedAt) || 0,
    };
  }
  return out;
}

function emptyPair(peerId) {
  return {
    meInterested: state.interestedPeerIds.includes(peerId),
    themInterested: false,
    matched: false,
    matchCelebrated: false,
    friend: false,
    friendAt: 0,
    handle: "",
    theirProfileUpdatedAt: 0,
    chatRetention: "",
    chatRetentionAt: 0,
    chatClearedAt: 0,
    chatReadAt: 0,
    themChatReadAt: 0,
    publicKey: null,
    deviceIds: [],
    updatedAt: 0,
  };
}

export function nextFriendAt(peerId) {
  const pair = state.pairState[peerId] || {};
  return Math.max(Date.now(), (Number(pair.friendAt) || 0) + 1);
}

export function capturePairSlice() {
  return {
    interestedPeerIds: [...state.interestedPeerIds],
    pairState: JSON.parse(JSON.stringify(state.pairState)),
  };
}

export function restorePairSlice(slice) {
  if (!slice) return;
  state.interestedPeerIds = [...slice.interestedPeerIds];
  state.pairState = JSON.parse(JSON.stringify(slice.pairState));
}

function syncInterestList(peerId, meInterested) {
  const set = new Set(state.interestedPeerIds);
  if (meInterested) set.add(peerId);
  else set.delete(peerId);
  state.interestedPeerIds = [...set];
}

export function tryApplyPair(peerId, patch) {
  const prev = capturePairSlice();
  const current = state.pairState[peerId] || emptyPair(peerId);
  const next = { ...current, ...patch };
  next.meInterested = Boolean(next.meInterested);
  next.themInterested = Boolean(next.themInterested);
  next.matched = Boolean(next.meInterested && next.themInterested);
  next.matchCelebrated = next.matched ? Boolean(next.matchCelebrated) : false;
  next.publicKey = publicJwkOnly(current.publicKey) || publicJwkOnly(next.publicKey);
  next.deviceIds = sanitizeDeviceIds(next.deviceIds || current.deviceIds);
  next.updatedAt = Math.max(Number(current.updatedAt) || 0, Number(next.updatedAt) || 0, Date.now());
  syncInterestList(peerId, next.meInterested);
  state.pairState = { ...state.pairState, [peerId]: next };
  if (!trySaveStore()) {
    restorePairSlice(prev);
    return { ok: false, prev };
  }
  return { ok: true, prev, pair: next };
}

export function revertMyInterest(peerId, prev) {
  const current = state.pairState[peerId] || emptyPair(peerId);
  const old = prev?.pairState?.[peerId] || emptyPair(peerId);
  return tryApplyPair(peerId, {
    ...current,
    meInterested: Boolean(old.meInterested),
    themInterested: Boolean(current.themInterested),
  });
}

export function revertThemInterest(peerId, prev) {
  const current = state.pairState[peerId] || emptyPair(peerId);
  const old = prev?.pairState?.[peerId] || emptyPair(peerId);
  return tryApplyPair(peerId, {
    ...current,
    themInterested: Boolean(old.themInterested),
    meInterested: Boolean(current.meInterested),
  });
}

export function updateStore(patch) {
  state = { ...state, ...patch };
  saveStore();
  return state;
}

export function updateProfile(patch) {
  state.profile = normalizeProfile({ ...state.profile, ...patch, updatedAt: Date.now() });
  saveStore();
  return state.profile;
}

export function setInterested(peerId, on) {
  return tryApplyPair(peerId, { meInterested: on });
}

export function isInterested(peerId) {
  return state.interestedPeerIds.includes(peerId);
}

export function upsertPair(peerId, patch) {
  const applied = tryApplyPair(peerId, patch);
  if (!applied.ok) return state.pairState[peerId] || emptyPair(peerId);
  return applied.pair;
}

export function getPair(peerId) {
  return state.pairState[peerId] || null;
}

export function friendSnapshot(profile) {
  if (!profile) return null;
  return {
    peerId: profile.peerId,
    handle: profile.handle || "",
    age: profile.age ?? null,
    gender: profile.gender || "",
    genderSelf: profile.genderSelf || "",
    seeking: Array.isArray(profile.seekingRelationships)
      ? [...profile.seekingRelationships]
      : Array.isArray(profile.seeking) ? [...profile.seeking] : [],
    seekingRelationships: Array.isArray(profile.seekingRelationships)
      ? [...profile.seekingRelationships]
      : Array.isArray(profile.seeking) ? [...profile.seeking] : [],
    seekingFriendships: Array.isArray(profile.seekingFriendships) ? [...profile.seekingFriendships] : [],
    networking: Array.isArray(profile.networking) ? [...profile.networking] : [],
    musicianSeekingBand: Array.isArray(profile.musicianSeekingBand) ? [...profile.musicianSeekingBand] : [],
    musicianInstruments: Array.isArray(profile.musicianInstruments) ? [...profile.musicianInstruments] : [],
    bandSeekingMusician: Array.isArray(profile.bandSeekingMusician) ? [...profile.bandSeekingMusician] : [],
    photo: profile.photo || "",
    interests: Array.isArray(profile.interests) ? [...profile.interests] : [],
    antiInterests: Array.isArray(profile.antiInterests) ? [...profile.antiInterests] : [],
    hobbies: Array.isArray(profile.hobbies) ? [...profile.hobbies] : [],
    youtubeChannelId: parseYoutubeChannelId(profile.youtubeChannelId) || "",
    youtubeVideoIds: sanitizeYoutubeVideoIds(profile.youtubeVideoIds),
    youtubePlaylistId: parseYoutubePlaylistId(profile.youtubePlaylistId) || "",
    youtubePlaylistThumb: sanitizeYoutubePlaylistThumb(profile.youtubePlaylistThumb),
    github: sanitizeGithub(profile.github),
    bandcamp: sanitizeBandcamp(profile.bandcamp),
    soundcloud: sanitizeSoundCloud(profile.soundcloud),
    linkedin: sanitizeLinkedIn(profile.linkedin),
    questionnaire: { ...(profile.questionnaire || {}) },
    sectionOrder: sanitizeSectionOrder(profile.sectionOrder),
    loc: profile.loc ? { ...profile.loc } : null,
    zip: profile.zip || profile.zones?.zip || null,
    updatedAt: profile.updatedAt || 0,
    publicKey: publicJwkOnly(profile.publicKey),
    deviceIds: sanitizeDeviceIds(profile.deviceIds),
  };
}

export function addFriend(profile, { friendAt } = {}) {
  const snap = friendSnapshot(profile);
  if (!snap?.peerId) return;
  const prev = state.friends.find((f) => f.peerId === snap.peerId);
  const friends = state.friends.filter((f) => f.peerId !== snap.peerId);
  const next = {
    ...prev,
    ...snap,
    handle: snap.handle || prev?.handle || "",
    savedAt: prev?.savedAt || Date.now(),
    publicKey: publicJwkOnly(prev?.publicKey)
      || snap.publicKey
      || publicJwkOnly(state.pairState[snap.peerId]?.publicKey),
    deviceIds: sanitizeDeviceIds([...(prev?.deviceIds || []), ...(snap.deviceIds || [])]),
  };
  delete next.zones;
  friends.unshift(next);
  state.friends = friends;
  upsertPair(snap.peerId, {
    friend: true,
    friendAt: friendAt ?? nextFriendAt(snap.peerId),
    handle: snap.handle || prev?.handle || "",
  });
}

export function updateFriend(profile) {
  const i = state.friends.findIndex((f) => f.peerId === profile.peerId);
  if (i < 0) return null;
  const prev = state.friends[i];
  const snap = friendSnapshot({ ...prev, ...profile, handle: profile.handle || prev.handle });
  const next = {
    ...snap,
    savedAt: prev.savedAt,
    publicKey: publicJwkOnly(prev.publicKey) || snap.publicKey,
    deviceIds: sanitizeDeviceIds([...(prev.deviceIds || []), ...(snap.deviceIds || [])]),
  };
  delete next.zones;
  const friends = [...state.friends];
  friends[i] = next;
  state.friends = friends;
  if (snap.handle) upsertPair(snap.peerId, { handle: snap.handle });
  saveStore();
  return next;
}

export function getFriend(peerId) {
  return state.friends.find((f) => f.peerId === peerId) || null;
}

export function isFriend(peerId) {
  return state.friends.some((f) => f.peerId === peerId);
}

export function rememberPeerDevice(peerId, connId) {
  if (!isUserPeerId(peerId) || (!isDevicePeerId(connId) && !isUserPeerId(connId))) return;
  const pair = state.pairState[peerId] || emptyPair(peerId);
  const deviceIds = sanitizeDeviceIds([...(pair.deviceIds || []), connId]);
  if (deviceIds.length !== (pair.deviceIds || []).length) {
    upsertPair(peerId, { deviceIds });
  }
  const friend = getFriend(peerId);
  if (friend) {
    const next = sanitizeDeviceIds([...(friend.deviceIds || []), connId]);
    if (next.length !== (friend.deviceIds || []).length) {
      updateFriend({ ...friend, deviceIds: next });
    }
  }
}

export function deviceIdsForPeer(peerId) {
  const ids = new Set();
  for (const id of state.pairState[peerId]?.deviceIds || []) ids.add(id);
  for (const id of getFriend(peerId)?.deviceIds || []) ids.add(id);
  if (isUserPeerId(peerId)) ids.add(peerId);
  return [...ids];
}

export function setLinkedVault(link) {
  state.linkedVault = sanitizeLinkedVault(link);
  saveStore();
  return state.linkedVault;
}

export function unlinkVault() {
  state.linkedVault = null;
  saveStore();
}

export function removeFriend(peerId, { friendAt } = {}) {
  state.friends = state.friends.filter((f) => f.peerId !== peerId);
  upsertPair(peerId, { friend: false, friendAt: friendAt ?? nextFriendAt(peerId) });
}

export function themInterestedUnmatched(peerId) {
  const pair = state.pairState[peerId];
  return Boolean(pair?.themInterested && !pair?.matched);
}

function peerIdForRoom(roomId) {
  if (!roomId) return "";
  for (const [peerId, id] of Object.entries(state.chatRooms || {})) {
    if (id === roomId) return peerId;
  }
  return "";
}

function sameChatList(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((m, i) => m.id === b[i].id && m.at === b[i].at);
}

function prunedList(roomId, messages) {
  const peerId = peerIdForRoom(roomId);
  const retention = peerId ? getChatRetention(peerId) : "never";
  const clearedAt = peerId ? getChatClearedAt(peerId) : 0;
  return pruneMessages(messages || [], { retention, clearedAt });
}

function pruneAllChats({ save = true } = {}) {
  const next = {};
  let changed = false;
  for (const [roomId, msgs] of Object.entries(state.chats || {})) {
    const pruned = prunedList(roomId, msgs);
    if (!sameChatList(pruned, msgs)) changed = true;
    if (pruned.length) next[roomId] = pruned;
    else if (msgs.length) changed = true;
  }
  if (changed) state.chats = next;
  if (changed && save) saveStore();
  return changed;
}

export function getChatRoom(peerId) {
  return state.chatRooms?.[peerId] || "";
}

export function rememberChatRoom(peerId, roomId) {
  if (!peerId || !roomId) return roomId;
  const rooms = state.chatRooms || {};
  const mapped = rooms[peerId] !== roomId;
  if (mapped) state.chatRooms = { ...rooms, [peerId]: roomId };
  const pair = state.pairState[peerId] || {};
  if (!isChatRetention(pair.chatRetention)) {
    const existing = state.chats[roomId] || [];
    if (existing.length) {
      upsertPair(peerId, { chatRetention: "never", chatRetentionAt: 1 });
      return roomId;
    }
  }
  if (mapped) saveStore();
  return roomId;
}

export function getChatRetention(peerId) {
  const pair = state.pairState[peerId];
  if (isChatRetention(pair?.chatRetention)) return pair.chatRetention;
  const roomId = state.chatRooms?.[peerId];
  if (roomId && (state.chats[roomId] || []).length) return "never";
  return DEFAULT_CHAT_RETENTION;
}

export function getChatClearedAt(peerId) {
  return Number(state.pairState[peerId]?.chatClearedAt) || 0;
}

export function setChatRetention(peerId, retention, { retentionAt } = {}) {
  if (!peerId || !isChatRetention(retention)) return getChatRetention(peerId);
  const at = Number(retentionAt) || Date.now();
  const pair = state.pairState[peerId] || {};
  const prevAt = Number(pair.chatRetentionAt) || 0;
  if (at < prevAt) return getChatRetention(peerId);
  if (at === prevAt && pair.chatRetention === retention) return retention;
  if (at === prevAt && isChatRetention(pair.chatRetention)) return pair.chatRetention;
  upsertPair(peerId, { chatRetention: retention, chatRetentionAt: at });
  const roomId = state.chatRooms[peerId];
  if (roomId) pruneChat(roomId);
  return getChatRetention(peerId);
}

export function getChat(roomId) {
  if (!roomId) return [];
  pruneChat(roomId);
  return state.chats[roomId] || [];
}

export function pruneChat(roomId) {
  if (!roomId) return [];
  const prev = state.chats[roomId] || [];
  const next = prunedList(roomId, prev);
  if (sameChatList(next, prev)) return next;
  const chats = { ...state.chats };
  if (next.length) chats[roomId] = next;
  else delete chats[roomId];
  state.chats = chats;
  saveStore();
  return next;
}

export function appendChat(roomId, message, { peerId } = {}) {
  if (!roomId || !message?.id) return getChat(roomId);
  if (peerId) rememberChatRoom(peerId, roomId);
  const fromPeer = peerId || peerIdForRoom(roomId);
  if (fromPeer && !isChatRetention(state.pairState[fromPeer]?.chatRetention)) {
    upsertPair(fromPeer, { chatRetention: DEFAULT_CHAT_RETENTION, chatRetentionAt: 0 });
  }
  const clearedAt = fromPeer ? getChatClearedAt(fromPeer) : 0;
  const at = Number(message.at) || Date.now();
  if (at <= clearedAt) return getChat(roomId);
  const prev = prunedList(roomId, state.chats[roomId] || []);
  if (prev.some((m) => m.id === message.id)) {
    if (!sameChatList(prev, state.chats[roomId] || [])) {
      state.chats = { ...state.chats, [roomId]: prev };
      saveStore();
    }
    return prev;
  }
  const next = [
    ...prev,
    {
      id: String(message.id),
      from: String(message.from || ""),
      text: String(message.text || "").slice(0, CHAT_TEXT_MAX),
      at,
    },
  ].slice(-CHAT_HISTORY_MAX);
  state.chats = { ...state.chats, [roomId]: next };
  saveStore();
  return next;
}

export function clearChat(peerId, { roomId, clearedAt } = {}) {
  if (!peerId) return [];
  const at = Math.max(Number(clearedAt) || Date.now(), getChatClearedAt(peerId));
  upsertPair(peerId, { chatClearedAt: at, chatReadAt: at });
  const id = roomId || state.chatRooms[peerId];
  if (!id) return [];
  const prev = state.chats[id] || [];
  const next = prev.filter((m) => (Number(m.at) || 0) > at);
  const chats = { ...state.chats };
  if (next.length) chats[id] = next;
  else delete chats[id];
  state.chats = chats;
  saveStore();
  return next;
}

function lastChatAt(peerId) {
  const roomId = state.chatRooms?.[peerId];
  if (!roomId) return 0;
  return (state.chats[roomId] || []).reduce((max, m) => Math.max(max, Number(m.at) || 0), 0);
}

function seedChatReadAt() {
  let changed = false;
  const nextPairs = { ...state.pairState };
  for (const [peerId, roomId] of Object.entries(state.chatRooms || {})) {
    const msgs = state.chats[roomId] || [];
    if (!msgs.length) continue;
    const pair = nextPairs[peerId] || emptyPair(peerId);
    if (Number(pair.chatReadAt) > 0) continue;
    const lastAt = msgs.reduce((max, m) => Math.max(max, Number(m.at) || 0), 0);
    nextPairs[peerId] = { ...pair, chatReadAt: lastAt };
    changed = true;
  }
  if (changed) state.pairState = nextPairs;
  return changed;
}

export function unreadChatCount(peerId) {
  if (!peerId) return 0;
  const roomId = state.chatRooms?.[peerId];
  if (!roomId) return 0;
  const me = state.peerId;
  const readAt = Number(state.pairState[peerId]?.chatReadAt) || 0;
  let n = 0;
  for (const m of state.chats[roomId] || []) {
    if (!m || m.from === me) continue;
    if ((Number(m.at) || 0) > readAt) n += 1;
  }
  return n;
}

export function totalUnreadCount() {
  let n = 0;
  for (const f of state.friends || []) n += unreadChatCount(f.peerId);
  return n;
}

export function markChatRead(peerId) {
  if (!peerId) return false;
  const lastAt = lastChatAt(peerId);
  const prev = Number(state.pairState[peerId]?.chatReadAt) || 0;
  const at = lastAt || prev || Date.now();
  if (at === prev) return false;
  upsertPair(peerId, { chatReadAt: at });
  return true;
}

export function getThemChatReadAt(peerId) {
  return Number(state.pairState[peerId]?.themChatReadAt) || 0;
}

export function setThemChatReadAt(peerId, at) {
  if (!peerId) return false;
  const next = Number(at) || 0;
  const prev = Number(state.pairState[peerId]?.themChatReadAt) || 0;
  if (next <= prev) return false;
  upsertPair(peerId, { themChatReadAt: next });
  return true;
}

export function mergeFriendProfile(saved, live) {
  if (!saved) return live || null;
  if (!live) return saved;
  const next = {
    ...saved,
    ...live,
    handle: saved.handle || live.handle || "",
    photo: live.photo || saved.photo || "",
    youtubeChannelId: Object.prototype.hasOwnProperty.call(live, "youtubeChannelId")
      ? parseYoutubeChannelId(live.youtubeChannelId) || ""
      : parseYoutubeChannelId(saved.youtubeChannelId) || "",
    youtubeVideoIds: Object.prototype.hasOwnProperty.call(live, "youtubeVideoIds")
      ? sanitizeYoutubeVideoIds(live.youtubeVideoIds)
      : sanitizeYoutubeVideoIds(saved.youtubeVideoIds),
    youtubePlaylistId: Object.prototype.hasOwnProperty.call(live, "youtubePlaylistId")
      ? parseYoutubePlaylistId(live.youtubePlaylistId) || ""
      : parseYoutubePlaylistId(saved.youtubePlaylistId) || "",
    youtubePlaylistThumb: Object.prototype.hasOwnProperty.call(live, "youtubePlaylistThumb")
      ? sanitizeYoutubePlaylistThumb(live.youtubePlaylistThumb)
      : sanitizeYoutubePlaylistThumb(saved.youtubePlaylistThumb),
    github: Object.prototype.hasOwnProperty.call(live, "github")
      ? sanitizeGithub(live.github)
      : sanitizeGithub(saved.github),
    bandcamp: Object.prototype.hasOwnProperty.call(live, "bandcamp")
      ? sanitizeBandcamp(live.bandcamp)
      : sanitizeBandcamp(saved.bandcamp),
    soundcloud: Object.prototype.hasOwnProperty.call(live, "soundcloud")
      ? sanitizeSoundCloud(live.soundcloud)
      : sanitizeSoundCloud(saved.soundcloud),
    linkedin: Object.prototype.hasOwnProperty.call(live, "linkedin")
      ? sanitizeLinkedIn(live.linkedin)
      : sanitizeLinkedIn(saved.linkedin),
    sectionOrder: Object.prototype.hasOwnProperty.call(live, "sectionOrder")
      ? sanitizeSectionOrder(live.sectionOrder)
      : sanitizeSectionOrder(saved.sectionOrder),
    loc: live.loc || saved.loc,
    zip: live.zip || saved.zip || saved.zones?.zip || null,
    peerId: saved.peerId,
    savedAt: saved.savedAt,
    publicKey: publicJwkOnly(saved.publicKey) || publicJwkOnly(live.publicKey),
  };
  delete next.zones;
  return next;
}

export function exportBackup() {
  const payload = {
    v: STORE_VERSION,
    exportedAt: Date.now(),
    ...state,
  };
  delete payload.devicePrivateKey;
  delete payload.devicePublicKey;
  return JSON.stringify(payload, null, 2);
}

export function pinPeerPublicKey(peerId, publicKey) {
  const pub = publicJwkOnly(publicKey);
  if (!peerId || !pub) return false;
  const pair = state.pairState[peerId];
  const friend = getFriend(peerId);
  if (pair?.publicKey && !samePublicKey(pair.publicKey, pub)) return false;
  if (friend?.publicKey && !samePublicKey(friend.publicKey, pub)) return false;
  if (!pair?.publicKey) upsertPair(peerId, { publicKey: pub });
  if (friend && !friend.publicKey) updateFriend({ ...friend, publicKey: pub });
  return true;
}

export function pinnedPublicKey(peerId) {
  return publicJwkOnly(state.pairState[peerId]?.publicKey) || publicJwkOnly(getFriend(peerId)?.publicKey);
}

export async function importBackup(json) {
  const parsed = typeof json === "string" ? JSON.parse(json) : json;
  if (!parsed || !parsed.peerId || !parsed.profile) {
    throw new Error(`That file does not look like a ${APP_NAME} backup.`);
  }
  if (!isUserPeerId(parsed.peerId)) {
    throw new Error(`That file does not look like a ${APP_NAME} backup.`);
  }
  const pub = publicJwkOnly(parsed.publicKey);
  const hasPriv = Boolean(parsed.privateKey?.d);
  if (pub && !hasPriv) {
    throw new Error("That backup is missing the private key for this identity.");
  }
  if (hasPriv && !pub) {
    throw new Error("That backup is missing the public key for this identity.");
  }
  if (hasPriv && pub && !(await keysMatch(pub, parsed.privateKey))) {
    throw new Error("That backup's keys do not match.");
  }
  let legacyId = Boolean(parsed.legacyId);
  if (pub) {
    const fingerprint = await peerIdFromPublicJwk(pub);
    if (parsed.peerId.toLowerCase() !== fingerprint.toLowerCase()) {
      if (parsed.legacyId === false) {
        throw new Error("That backup's identity does not match its key.");
      }
      legacyId = true;
    }
  }
  state = {
    ...defaultState(),
    peerId: parsed.peerId,
    legacyId,
    publicKey: pub,
    privateKey: hasPriv ? parsed.privateKey : null,
    profile: normalizeProfile(parsed.profile),
    interestedPeerIds: parsed.interestedPeerIds || [],
    friends: sanitizeFriends(parsed.friends),
    chats: sanitizeChats(parsed.chats),
    chatRooms: sanitizeChatRooms(parsed.chatRooms),
    pairState: sanitizePairState(parsed.pairState || {}),
    filters: normalizeFilters(parsed.filters),
    offline: parsed.offline == null ? true : Boolean(parsed.offline),
    linkedVault: sanitizeLinkedVault(parsed.linkedVault) || state.linkedVault,
    syncRev: Number(parsed.syncRev) || Date.now(),
  };
  await ensureIdentity();
  await ensureDevice();
  pruneAllChats({ save: false });
  seedChatReadAt();
  saveStore();
  return state;
}

function mergeChats(local, remote) {
  const out = { ...sanitizeChats(local) };
  for (const [roomId, msgs] of Object.entries(sanitizeChats(remote))) {
    const prev = out[roomId] || [];
    const ids = new Set(prev.map((m) => m.id));
    const merged = [...prev];
    for (const m of msgs) {
      if (!ids.has(m.id)) merged.push(m);
    }
    merged.sort((a, b) => (a.at || 0) - (b.at || 0));
    out[roomId] = merged.slice(-CHAT_HISTORY_MAX);
  }
  return out;
}

function mergePair(local, remote) {
  const left = { ...emptyPair(""), ...local };
  const right = { ...emptyPair(""), ...remote };
  const out = { ...left };
  if ((Number(right.friendAt) || 0) > (Number(left.friendAt) || 0)) {
    out.friend = Boolean(right.friend);
    out.friendAt = Number(right.friendAt) || 0;
  } else if ((Number(right.friendAt) || 0) === (Number(left.friendAt) || 0)) {
    out.friend = Boolean(left.friend || right.friend);
  }
  if ((Number(right.chatRetentionAt) || 0) > (Number(left.chatRetentionAt) || 0) && isChatRetention(right.chatRetention)) {
    out.chatRetention = right.chatRetention;
    out.chatRetentionAt = Number(right.chatRetentionAt) || 0;
  }
  out.chatClearedAt = Math.max(Number(left.chatClearedAt) || 0, Number(right.chatClearedAt) || 0);
  out.chatReadAt = Math.max(Number(left.chatReadAt) || 0, Number(right.chatReadAt) || 0);
  out.themChatReadAt = Math.max(Number(left.themChatReadAt) || 0, Number(right.themChatReadAt) || 0);
  if ((Number(right.updatedAt) || 0) > (Number(left.updatedAt) || 0)) {
    out.meInterested = Boolean(right.meInterested);
    out.themInterested = Boolean(right.themInterested);
    out.handle = right.handle || left.handle;
    out.theirProfileUpdatedAt = Math.max(Number(left.theirProfileUpdatedAt) || 0, Number(right.theirProfileUpdatedAt) || 0);
    out.updatedAt = Number(right.updatedAt) || 0;
  } else {
    out.handle = left.handle || right.handle;
    out.theirProfileUpdatedAt = Math.max(Number(left.theirProfileUpdatedAt) || 0, Number(right.theirProfileUpdatedAt) || 0);
    out.updatedAt = Math.max(Number(left.updatedAt) || 0, Number(right.updatedAt) || 0);
  }
  out.matched = Boolean(out.meInterested && out.themInterested);
  out.publicKey = publicJwkOnly(left.publicKey) || publicJwkOnly(right.publicKey);
  out.deviceIds = sanitizeDeviceIds([...(left.deviceIds || []), ...(right.deviceIds || [])]);
  return out;
}

function mergeFriends(local, remote) {
  const map = new Map();
  for (const f of sanitizeFriends(local)) map.set(f.peerId, f);
  for (const f of sanitizeFriends(remote)) {
    const prev = map.get(f.peerId);
    if (!prev) {
      map.set(f.peerId, f);
      continue;
    }
    const newer = (Number(f.updatedAt) || 0) >= (Number(prev.updatedAt) || 0) ? f : prev;
    const older = newer === f ? prev : f;
    map.set(f.peerId, {
      ...older,
      ...newer,
      handle: newer.handle || older.handle,
      photo: newer.photo || older.photo,
      savedAt: Math.min(Number(prev.savedAt) || Date.now(), Number(f.savedAt) || Date.now()),
      publicKey: publicJwkOnly(prev.publicKey) || publicJwkOnly(f.publicKey),
      deviceIds: sanitizeDeviceIds([...(prev.deviceIds || []), ...(f.deviceIds || [])]),
    });
  }
  return [...map.values()];
}

export function mergeVaultState(remote, { identityFromVault = false } = {}) {
  const parsed = typeof remote === "string" ? JSON.parse(remote) : remote;
  if (!parsed || !isUserPeerId(parsed.peerId)) {
    throw new Error(`That file does not look like a ${APP_NAME} backup.`);
  }
  if (state.peerId && parsed.peerId !== state.peerId) {
    throw new Error("Vault profile does not match this identity.");
  }
  if (identityFromVault || !state.privateKey?.d) {
    const pub = publicJwkOnly(parsed.publicKey);
    const hasPriv = Boolean(parsed.privateKey?.d);
    if (pub && hasPriv) {
      state.peerId = parsed.peerId;
      state.legacyId = Boolean(parsed.legacyId);
      state.publicKey = pub;
      state.privateKey = parsed.privateKey;
    }
  }
  const remoteProfile = normalizeProfile(parsed.profile);
  const remoteAt = remoteProfile.updatedAt || 0;
  const localAt = state.profile.updatedAt || 0;
  const remoteUsed = Boolean(String(remoteProfile.handle || "").trim() || remoteProfile.photo || remoteProfile.dob);
  const localUsed = Boolean(String(state.profile.handle || "").trim() || state.profile.photo || state.profile.dob);
  if (remoteAt > localAt || (remoteAt === localAt && remoteUsed && !localUsed)) {
    state.profile = remoteProfile;
  }
  const remoteRev = Number(parsed.syncRev) || 0;
  const localRev = Number(state.syncRev) || 0;
  if (remoteRev > localRev) {
    state.filters = normalizeFilters(parsed.filters);
  }
  state.friends = mergeFriends(state.friends, parsed.friends);
  const pairs = { ...state.pairState };
  for (const [id, pair] of Object.entries(sanitizePairState(parsed.pairState || {}))) {
    pairs[id] = mergePair(pairs[id], pair);
  }
  state.pairState = pairs;
  state.interestedPeerIds = Object.entries(state.pairState)
    .filter(([, pair]) => pair.meInterested)
    .map(([id]) => id);
  state.chatRooms = { ...sanitizeChatRooms(parsed.chatRooms), ...state.chatRooms };
  state.chats = mergeChats(state.chats, parsed.chats);
  if (parsed.linkedVault && !state.linkedVault) {
    state.linkedVault = sanitizeLinkedVault(parsed.linkedVault);
  }
  state.syncRev = Math.max(localRev, remoteRev, Date.now());
  pruneAllChats({ save: false });
  seedChatReadAt();
  saveStore({ fromSync: true });
  return state;
}
