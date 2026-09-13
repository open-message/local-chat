import {
  APP_NAME,
  CHAT_HISTORY_MAX,
  CHAT_TEXT_MAX,
  DEFAULT_CHAT_RETENTION,
  DEFAULT_DISTANCE_MILES,
  GROUP_MEMBER_MAX,
  MAX_AGE,
  MIN_AGE,
  STORAGE_PREFIX,
  STORE_VERSION,
  clampDistanceOption,
} from "./config.js";
import { isChatRetention, pruneMessages } from "./chat.js";
import { sanitizeGenesis, sanitizeGroupClear, sanitizeGroupPolicy, sanitizeInviteHop } from "./group.js";
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
import { emptyProfile, normalizeProfile, parseYoutubeChannelId, sanitizeSectionOrder, sanitizeYoutubeVideoIds, shareProfile } from "./profile.js";
import { sanitizeSoundCloud } from "./soundcloud.js";
import { parseYoutubePlaylistId, sanitizeYoutubePlaylistThumb } from "./youtube.js";
import { isGroupId, isUserPeerId } from "./share.js";
import {
  identityBlobLooksUsed,
  identitySummary,
  makeSyncBundle,
  mergeVaultBundle,
  parseSyncBundle,
  VAULT_SYNC_KIND,
} from "./vault-merge.js";

function slot() {
  const params = new URLSearchParams(location.search);
  return params.get("slot") || "default";
}

function key() {
  return `${STORAGE_PREFIX}:v${STORE_VERSION}:${slot()}`;
}

function indexKey() {
  return `${key()}:index`;
}

function identityStorageKey(peerId) {
  return `${key()}:p:${peerId}`;
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

function normalizeFilters(raw, precise = false) {
  const incoming = raw && typeof raw === "object" ? raw : {};
  const filters = { ...defaultFilters(), ...incoming };
  if (!["all", "connected", "friends"].includes(filters.peopleFilter)) {
    filters.peopleFilter = incoming.interestedOnly ? "connected" : "all";
  }
  filters.distance = clampDistanceOption(filters.distance, precise);
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
    chatRetracts: {},
    chatRooms: {},
    groups: {},
    groupInvites: [],
    pairState: {},
    filters: defaultFilters(),
    offline: true,
    preciseGeolocation: false,
    syncRev: 0,
  };
}

let state = defaultState();
let deviceKeys = { publicKey: null, privateKey: null };
let deviceId = "";
let identityIndex = emptyIdentityIndex();

function emptyIdentityIndex() {
  return {
    activePeerId: "",
    profiles: [],
    deletedPeerIds: {},
    linkedVault: null,
  };
}

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
  return !identityIndex.linkedVault?.hubId;
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

export function isPreciseGeolocation() {
  return Boolean(state.preciseGeolocation);
}

export function shareMyProfile(audience = "public") {
  return shareProfile(state.profile, state.peerId, audience, {
    preciseLoc: isPreciseGeolocation(),
  });
}

export function setPreciseGeolocation(on) {
  const next = Boolean(on);
  const filters = normalizeFilters(state.filters, next);
  if (state.preciseGeolocation === next && filters.distance === state.filters.distance) {
    return state;
  }
  state = { ...state, preciseGeolocation: next, filters };
  saveStore();
  return state;
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
  return identityIndex.linkedVault || null;
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

function stripLink(payload) {
  const next = { ...payload };
  delete next.linkedVault;
  delete next.devicePrivateKey;
  delete next.devicePublicKey;
  return next;
}

function readLocalItem(name) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeLocalItem(name, json) {
  try {
    localStorage.setItem(name, json);
  } catch {
    /* private mode */
  }
}

function removeLocalItem(name) {
  try {
    localStorage.removeItem(name);
  } catch {
    /* private mode */
  }
}

function parseIdentityIndex(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyIdentityIndex();
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles
        .map((p) => ({
          peerId: String(p?.peerId || ""),
          handle: String(p?.handle || ""),
          updatedAt: Number(p?.updatedAt) || 0,
        }))
        .filter((p) => isUserPeerId(p.peerId))
      : [];
    return {
      activePeerId: isUserPeerId(parsed.activePeerId) ? parsed.activePeerId : "",
      profiles,
      deletedPeerIds: parsed.deletedPeerIds && typeof parsed.deletedPeerIds === "object"
        ? parsed.deletedPeerIds
        : {},
      linkedVault: sanitizeLinkedVault(parsed.linkedVault),
    };
  } catch {
    return emptyIdentityIndex();
  }
}

function loadIdentityIndex() {
  const raw = readLocalItem(indexKey());
  identityIndex = raw ? parseIdentityIndex(raw) : emptyIdentityIndex();
  return identityIndex;
}

function saveIdentityIndex() {
  writeLocalItem(indexKey(), JSON.stringify({
    activePeerId: identityIndex.activePeerId,
    profiles: identityIndex.profiles,
    deletedPeerIds: identityIndex.deletedPeerIds,
    linkedVault: identityIndex.linkedVault,
  }));
}

function samePeerId(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function isTombstoned(peerId) {
  const want = String(peerId || "").trim();
  if (!want) return false;
  for (const [id, at] of Object.entries(identityIndex.deletedPeerIds || {})) {
    if (samePeerId(id, want) && Number(at) > 0) return true;
  }
  return false;
}

function eachLocalKey(fn) {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i);
      if (name) fn(name);
    }
  } catch {
    /* private mode */
  }
}

function readIdentityBlob(peerId) {
  const id = String(peerId || "").trim();
  if (!id) return null;
  const exact = identityStorageKey(id);
  const direct = readLocalItem(exact);
  if (direct) return direct;
  const want = exact.toLowerCase();
  let found = null;
  eachLocalKey((name) => {
    if (found || name.toLowerCase() !== want) return;
    found = localStorage.getItem(name);
  });
  return found;
}

function readDurableBlobForPeer(peerId) {
  const raw = readLocalItem(key());
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return samePeerId(parsed?.peerId, peerId) ? raw : null;
  } catch {
    return null;
  }
}

function loadIdentityRaw(peerId) {
  return readIdentityBlob(peerId) || readDurableBlobForPeer(peerId);
}

function writeIdentityBlob(peerId, json) {
  const id = String(peerId || "").trim();
  if (!id) return false;
  const name = identityStorageKey(id);
  writeLocalItem(name, json);
  return readLocalItem(name) === json;
}

function removeIdentityBlob(peerId) {
  const id = String(peerId || "").trim();
  if (!id) return;
  const exact = identityStorageKey(id);
  removeLocalItem(exact);
  const want = exact.toLowerCase();
  const extras = [];
  eachLocalKey((name) => {
    if (name.toLowerCase() === want) extras.push(name);
  });
  for (const name of extras) removeLocalItem(name);
}

function adoptIdentityBlob(peerId, raw) {
  const id = String(peerId || "").trim();
  const json = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (!id || !json) return false;
  writeIdentityBlob(id, json);
  try {
    const parsed = JSON.parse(json);
    upsertIndexSummary({
      peerId: parsed.peerId || id,
      profile: parsed.profile || {},
    });
  } catch {
    upsertIndexSummary({ peerId: id, profile: {} });
  }
  saveIdentityIndex();
  return true;
}

function identitiesOnThisDevice() {
  const byId = new Map();
  const add = (p) => {
    const peerId = String(p?.peerId || "").trim();
    if (!isUserPeerId(peerId) || isTombstoned(peerId)) return;
    const handle = String(p?.handle || "").trim();
    const updatedAt = Number(p?.updatedAt) || 0;
    const prev = byId.get(peerId.toLowerCase());
    if (!prev || updatedAt >= (Number(prev.updatedAt) || 0)) {
      const keepId = prev && samePeerId(prev.peerId, state.peerId) ? prev.peerId : peerId;
      byId.set(peerId.toLowerCase(), {
        peerId: keepId,
        handle: handle || prev?.handle || "",
        updatedAt: Math.max(updatedAt, Number(prev?.updatedAt) || 0),
      });
    }
  };
  if (isUserPeerId(state.peerId)) {
    add({
      peerId: state.peerId,
      handle: state.profile?.handle || "",
      updatedAt: state.profile?.updatedAt || 0,
    });
  }
  for (const p of identityIndex.profiles) add(p);
  const blobPrefix = `${key()}:p:`;
  eachLocalKey((name) => {
    if (name === key()) {
      try {
        const parsed = JSON.parse(readLocalItem(name) || "");
        add({
          peerId: parsed?.peerId,
          handle: parsed?.profile?.handle || "",
          updatedAt: parsed?.profile?.updatedAt || 0,
        });
      } catch {
        /* skip */
      }
      return;
    }
    if (!name.startsWith(blobPrefix)) return;
    const raw = localStorage.getItem(name);
    let handle = "";
    let updatedAt = 0;
    try {
      const parsed = JSON.parse(raw);
      handle = String(parsed?.profile?.handle || "");
      updatedAt = Number(parsed?.profile?.updatedAt) || 0;
    } catch {
      /* skip unreadable blobs */
    }
    add({
      peerId: name.slice(blobPrefix.length),
      handle,
      updatedAt,
    });
  });
  return [...byId.values()].filter((p) => (
    samePeerId(p.peerId, state.peerId) || Boolean(loadIdentityRaw(p.peerId))
  ));
}

function upsertIndexSummary(st) {
  const peerId = String(st?.peerId || "");
  if (!isUserPeerId(peerId)) return;
  const summary = {
    peerId,
    handle: String(st.profile?.handle || ""),
    updatedAt: Number(st.profile?.updatedAt) || Date.now(),
  };
  identityIndex.profiles = [summary, ...identityIndex.profiles.filter((p) => !samePeerId(p.peerId, peerId))];
  identityIndex.activePeerId = peerId;
  for (const id of Object.keys(identityIndex.deletedPeerIds || {})) {
    if (samePeerId(id, peerId)) delete identityIndex.deletedPeerIds[id];
  }
}

function identityPayloadFromState() {
  const { durable, session } = splitChats();
  const chats = persistSessionInDurable() ? state.chats : durable;
  return stripLink({
    ...state,
    chats,
  });
}

function applyParsedStore(parsed) {
  state = {
    ...defaultState(),
    ...parsed,
    profile: normalizeProfile(parsed.profile),
    filters: normalizeFilters(parsed.filters, Boolean(parsed.preciseGeolocation)),
    interestedPeerIds: parsed.interestedPeerIds || [],
    friends: sanitizeFriends(parsed.friends),
    chats: sanitizeChats(parsed.chats),
    chatRetracts: sanitizeChatRetracts(parsed.chatRetracts),
    chatRooms: sanitizeChatRooms(parsed.chatRooms),
    groups: sanitizeGroups(parsed.groups),
    groupInvites: sanitizeGroupInvites(parsed.groupInvites),
    pairState: sanitizePairState(parsed.pairState || {}),
    peerId: isUserPeerId(parsed.peerId) ? parsed.peerId : "",
    legacyId: Boolean(parsed.legacyId),
    publicKey: publicJwkOnly(parsed.publicKey),
    privateKey: parsed.privateKey?.d ? parsed.privateKey : null,
    offline: parsed.offline == null ? true : Boolean(parsed.offline),
    preciseGeolocation: Boolean(parsed.preciseGeolocation),
    syncRev: Number(parsed.syncRev) || 0,
  };
  delete state.linkedVault;
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
    loadIdentityIndex();
    for (const p of identityIndex.profiles) {
      if (!isUserPeerId(p.peerId) || isTombstoned(p.peerId) || readLocalItem(identityStorageKey(p.peerId))) continue;
      const raw = loadIdentityRaw(p.peerId);
      if (raw) writeIdentityBlob(p.peerId, raw);
    }
    let raw = null;
    if (identityIndex.activePeerId) raw = loadIdentityRaw(identityIndex.activePeerId);
    if (!raw) raw = await readDurableRaw();
    if (!raw) {
      state = defaultState();
      await ensureIdentity();
      await ensureDevice();
      saveStore();
      return state;
    }
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    applyParsedStore(parsed);
    if (!identityIndex.linkedVault && parsed.linkedVault) {
      identityIndex.linkedVault = sanitizeLinkedVault(parsed.linkedVault);
    }
    await ensureIdentity();
    await ensureDevice();
    if (!persistSessionInDurable()) mergeSessionChats();
    pruneAllChats({ save: false });
    seedChatReadAt();
    pruneIdentityIndex();
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
    chats[roomId] = withoutRetracts(roomId, merged.slice(-CHAT_HISTORY_MAX));
  }
  state.chats = chats;
}

function splitChats() {
  const durable = {};
  const session = {};
  for (const [roomId, msgs] of Object.entries(state.chats || {})) {
    const retention = retentionForRoom(roomId);
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
  const payload = identityPayloadFromState();
  const json = JSON.stringify(payload);
  if (state.peerId) writeIdentityBlob(state.peerId, json);
  writeDurableRaw(json);
  upsertIndexSummary(state);
  saveIdentityIndex();
  if (!persistSessionInDurable()) writeSessionChats(splitChats().session);
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

function sanitizeChatRetracts(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [roomId, ids] of Object.entries(raw)) {
    if (!roomId || !ids || typeof ids !== "object" || Array.isArray(ids)) continue;
    const room = {};
    for (const [id, at] of Object.entries(ids)) {
      const key = String(id || "");
      if (!key) continue;
      room[key] = Number(at) || 0;
    }
    const entries = Object.entries(room)
      .sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
      .slice(-CHAT_HISTORY_MAX);
    if (entries.length) out[roomId] = Object.fromEntries(entries);
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

function sanitizePeerIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const value = String(id || "");
    if (!isUserPeerId(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function sanitizeThemChatReadAt(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, at] of Object.entries(raw)) {
    if (!isUserPeerId(id)) continue;
    const n = Number(at) || 0;
    if (n > 0) out[id] = n;
  }
  return out;
}

function sanitizeGroupMember(raw) {
  const peerId = String(raw?.peerId || "");
  if (!isUserPeerId(peerId)) return null;
  return {
    peerId,
    publicKey: publicJwkOnly(raw.publicKey),
    invitedBy: isUserPeerId(raw.invitedBy) ? String(raw.invitedBy) : "",
  };
}

function sanitizeGroup(groupId, raw) {
  const genesis = sanitizeGenesis(raw?.genesis);
  if (!genesis || genesis.groupId !== groupId) return null;
  const members = [];
  const seen = new Set();
  const add = (row) => {
    const member = sanitizeGroupMember(row);
    if (!member || seen.has(member.peerId)) return;
    seen.add(member.peerId);
    members.push(member);
  };
  add({ peerId: genesis.creatorId, publicKey: genesis.publicKey, invitedBy: "" });
  for (const m of raw?.members || []) add(m);
  const chain = [];
  for (const hop of raw?.chain || []) {
    const clean = sanitizeInviteHop(hop);
    if (clean) chain.push(clean);
  }
  return {
    name: genesis.name,
    creatorId: genesis.creatorId,
    invitePolicy: genesis.invitePolicy,
    createdAt: genesis.createdAt,
    genesis,
    members,
    pendingInvites: sanitizePeerIds(raw?.pendingInvites).slice(0, GROUP_MEMBER_MAX),
    chain,
    left: Boolean(raw?.left),
    chatRetention: isChatRetention(raw?.chatRetention) ? raw.chatRetention : DEFAULT_CHAT_RETENTION,
    chatRetentionAt: Number(raw?.chatRetentionAt) || 0,
    chatPolicy: sanitizeGroupPolicy(raw?.chatPolicy, groupId),
    chatClearedAt: Number(raw?.chatClearedAt) || 0,
    chatClear: sanitizeGroupClear(raw?.chatClear, groupId),
    chatReadAt: Number(raw?.chatReadAt) || 0,
    themChatReadAt: sanitizeThemChatReadAt(raw?.themChatReadAt),
  };
}

function sanitizeGroups(groups) {
  const out = {};
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) return out;
  for (const [groupId, raw] of Object.entries(groups)) {
    if (!isGroupId(groupId)) continue;
    const clean = sanitizeGroup(groupId, raw);
    if (clean) out[groupId] = clean;
  }
  return out;
}

function sanitizeGroupInvites(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const raw = row?.invite || row;
    const hop = sanitizeInviteHop(raw);
    const genesis = sanitizeGenesis(raw?.genesis || row?.genesis);
    if (!hop || !genesis || hop.groupId !== genesis.groupId) continue;
    const key = `${hop.groupId}:${hop.sig}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chain = [];
    for (const item of raw?.chain || []) {
      const clean = sanitizeInviteHop(item);
      if (clean) chain.push(clean);
    }
    out.push({
      invite: { ...hop, genesis, chain },
      receivedAt: Number(row?.receivedAt) || Date.now(),
    });
  }
  return out.slice(0, 50);
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
  identityIndex.linkedVault = sanitizeLinkedVault(link);
  saveIdentityIndex();
  return identityIndex.linkedVault;
}

export function unlinkVault() {
  identityIndex.linkedVault = null;
  saveIdentityIndex();
}

function pruneIdentityIndex() {
  const blobPrefix = `${key()}:p:`;
  eachLocalKey((name) => {
    if (!name.startsWith(blobPrefix)) return;
    if (isTombstoned(name.slice(blobPrefix.length))) removeLocalItem(name);
  });
  const usable = identitiesOnThisDevice();
  const keep = new Set(usable.map((p) => String(p.peerId || "").toLowerCase()));
  identityIndex.profiles = identityIndex.profiles.filter((p) => keep.has(String(p.peerId || "").toLowerCase()));
  if (identityIndex.activePeerId && !keep.has(String(identityIndex.activePeerId).toLowerCase())) {
    identityIndex.activePeerId = state.peerId || usable[0]?.peerId || "";
  }
}

export function listIdentities() {
  const active = state.peerId || identityIndex.activePeerId;
  return identitiesOnThisDevice().map((p) => ({
    ...p,
    active: samePeerId(p.peerId, active),
  }));
}

export function getActivePeerId() {
  return state.peerId || identityIndex.activePeerId || "";
}

export async function switchIdentity(peerId) {
  const want = String(peerId || "").trim();
  if (!isUserPeerId(want)) throw new Error("That identity is not on this device.");
  if (samePeerId(want, state.peerId)) return state;
  saveStore();
  let raw = loadIdentityRaw(want);
  if (!raw) {
    const durable = await readDurableRaw();
    if (durable) {
      try {
        const parsed = typeof durable === "string" ? JSON.parse(durable) : durable;
        if (samePeerId(parsed?.peerId, want)) {
          raw = typeof durable === "string" ? durable : JSON.stringify(durable);
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!raw) throw new Error("That identity is not on this device.");
  adoptIdentityBlob(want, raw);
  applyParsedStore(JSON.parse(raw));
  identityIndex.activePeerId = state.peerId || want;
  writeDurableRaw(typeof raw === "string" ? raw : JSON.stringify(raw));
  saveIdentityIndex();
  await ensureIdentity();
  await ensureDevice();
  saveStore();
  return state;
}

export async function createIdentityProfile() {
  saveStore();
  const prev = String(state.peerId || "").trim();
  if (isUserPeerId(prev) && !loadIdentityRaw(prev)) {
    throw new Error("Could not save the current profile before switching.");
  }
  state = defaultState();
  await ensureIdentity();
  await ensureDevice();
  saveStore();
  return state;
}

export async function deleteIdentity(peerId) {
  const want = String(peerId || "").trim();
  if (!isUserPeerId(want)) throw new Error("That identity is not on this device.");
  const others = identitiesOnThisDevice().filter((p) => !samePeerId(p.peerId, want));
  const deletingLoadable = samePeerId(want, state.peerId) || Boolean(loadIdentityRaw(want));
  if (deletingLoadable && others.length < 1) {
    throw new Error("Keep at least one identity on this device.");
  }
  identityIndex.deletedPeerIds = {
    ...identityIndex.deletedPeerIds,
    [want]: Date.now(),
  };
  identityIndex.profiles = identityIndex.profiles.filter((p) => !samePeerId(p.peerId, want));
  removeIdentityBlob(want);
  const next = others[0]?.peerId || identityIndex.profiles[0]?.peerId || "";
  const switching = samePeerId(state.peerId, want);
  identityIndex.activePeerId = switching ? next : (state.peerId || next);
  saveIdentityIndex();
  if (switching && next) {
    const raw = loadIdentityRaw(next);
    if (raw) {
      applyParsedStore(JSON.parse(raw));
      writeDurableRaw(raw);
    }
    await ensureIdentity();
    await ensureDevice();
  }
  pruneIdentityIndex();
  saveIdentityIndex();
  for (const fn of saveListeners) {
    try { fn(); } catch { /* ignore */ }
  }
  return next;
}

export function exportAllIdentities() {
  const profiles = {};
  for (const p of identitiesOnThisDevice()) {
    if (samePeerId(p.peerId, state.peerId)) {
      profiles[p.peerId] = identityPayloadFromState();
      continue;
    }
    const raw = loadIdentityRaw(p.peerId);
    if (!raw) continue;
    try {
      profiles[p.peerId] = JSON.parse(raw);
    } catch {
      /* skip */
    }
  }
  if (state.peerId && !profiles[state.peerId]) {
    profiles[state.peerId] = identityPayloadFromState();
  }
  return makeSyncBundle(profiles, identityIndex.deletedPeerIds);
}

export async function installVaultBundle(raw, { linkedVault = null, fromSync = false } = {}) {
  if (state.peerId) saveStore({ fromSync: true });
  const local = exportAllIdentities();
  const remote = parseSyncBundle(raw);
  const unusedLocal = new Set(
    Object.entries(local.profiles)
      .filter(([, blob]) => !identityBlobLooksUsed(blob))
      .map(([id]) => id),
  );
  const merged = mergeVaultBundle(local, remote);
  const remoteIds = new Set(Object.keys(remote.profiles));
  for (const peerId of unusedLocal) {
    if (remoteIds.has(peerId)) continue;
    if (Object.keys(merged.profiles).length <= 1) continue;
    delete merged.profiles[peerId];
  }
  for (const p of identityIndex.profiles) {
    if (!merged.profiles[p.peerId]) removeLocalItem(identityStorageKey(p.peerId));
  }
  const summaries = [];
  for (const [peerId, blob] of Object.entries(merged.profiles)) {
    const rec = { ...(blob && typeof blob === "object" ? blob : {}), peerId };
    const json = JSON.stringify(stripLink(rec));
    writeIdentityBlob(peerId, json);
    summaries.push({ ...identitySummary(rec), peerId });
  }
  identityIndex.profiles = summaries;
  identityIndex.deletedPeerIds = merged.deletedPeerIds;
  if (linkedVault) {
    identityIndex.linkedVault = sanitizeLinkedVault(linkedVault) || identityIndex.linkedVault;
  }
  let active = identityIndex.activePeerId || state.peerId;
  if (!merged.profiles[active]) active = summaries[0]?.peerId || "";
  identityIndex.activePeerId = active;
  saveIdentityIndex();
  if (active && merged.profiles[active]) {
    applyParsedStore(merged.profiles[active]);
    writeDurableRaw(JSON.stringify(stripLink(merged.profiles[active])));
  }
  await ensureIdentity();
  await ensureDevice();
  pruneAllChats({ save: false });
  seedChatReadAt();
  saveStore({ fromSync: true });
  if (!fromSync) {
    for (const fn of saveListeners) {
      try { fn(); } catch { /* ignore */ }
    }
  }
  return state;
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

function retentionForRoom(roomId) {
  if (isGroupId(roomId)) {
    const group = state.groups[roomId];
    if (!group) return "never";
    return isChatRetention(group.chatRetention) ? group.chatRetention : DEFAULT_CHAT_RETENTION;
  }
  const peerId = peerIdForRoom(roomId);
  return peerId ? getChatRetention(peerId) : "never";
}

function clearedAtForRoom(roomId) {
  if (isGroupId(roomId)) return Number(state.groups[roomId]?.chatClearedAt) || 0;
  const peerId = peerIdForRoom(roomId);
  return peerId ? getChatClearedAt(peerId) : 0;
}

function withoutRetracts(roomId, messages) {
  const ids = state.chatRetracts?.[roomId];
  if (!ids) return messages || [];
  return (messages || []).filter((m) => !m?.id || !ids[m.id]);
}

function prunedList(roomId, messages) {
  return withoutRetracts(roomId, pruneMessages(messages || [], {
    retention: retentionForRoom(roomId),
    clearedAt: clearedAtForRoom(roomId),
  }));
}

function rememberRetract(roomId, messageId, at = Date.now()) {
  const id = String(messageId || "");
  if (!roomId || !id) return false;
  const rooms = { ...(state.chatRetracts || {}) };
  const prev = { ...(rooms[roomId] || {}) };
  const nextAt = Math.max(Number(prev[id]) || 0, Number(at) || 0);
  if (prev[id] === nextAt) return false;
  prev[id] = nextAt;
  const entries = Object.entries(prev)
    .sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
    .slice(-CHAT_HISTORY_MAX);
  rooms[roomId] = Object.fromEntries(entries);
  state.chatRetracts = rooms;
  return true;
}

export function getChatRetracts(roomId) {
  return { ...(state.chatRetracts?.[roomId] || {}) };
}

export function retractChat(roomId, messageId, { from, viewedAt, save = true } = {}) {
  if (!roomId || !messageId) return null;
  const id = String(messageId);
  const prev = state.chats[roomId] || [];
  const msg = prev.find((m) => m.id === id) || null;
  if (from && msg && msg.from !== from) return null;
  if (viewedAt != null && msg && (Number(msg.at) || 0) <= Number(viewedAt)) return null;
  rememberRetract(roomId, id);
  if (!msg) {
    if (save) saveStore();
    return null;
  }
  const next = prev.filter((m) => m.id !== id);
  const chats = { ...state.chats };
  if (next.length) chats[roomId] = next;
  else delete chats[roomId];
  state.chats = chats;
  if (save) saveStore();
  return msg;
}

export function applyChatRetracts(roomId, ids, { from, viewedAt } = {}) {
  if (!roomId || !ids) return false;
  const list = Array.isArray(ids) ? ids : Object.keys(ids);
  let changed = false;
  for (const id of list) {
    if (!id) continue;
    const had = Boolean(state.chatRetracts?.[roomId]?.[id]);
    const before = (state.chats[roomId] || []).length;
    retractChat(roomId, id, { from, viewedAt, save: false });
    if ((state.chats[roomId] || []).length !== before || (!had && state.chatRetracts?.[roomId]?.[id])) {
      changed = true;
    }
  }
  if (changed) saveStore();
  return changed;
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
  if (peerId && !isGroupId(roomId)) rememberChatRoom(peerId, roomId);
  const fromPeer = isGroupId(roomId) ? "" : (peerId || peerIdForRoom(roomId));
  if (fromPeer && !isChatRetention(state.pairState[fromPeer]?.chatRetention)) {
    upsertPair(fromPeer, { chatRetention: DEFAULT_CHAT_RETENTION, chatRetentionAt: 0 });
  }
  const clearedAt = clearedAtForRoom(roomId);
  const at = Number(message.at) || Date.now();
  if (at <= clearedAt) return getChat(roomId);
  if (state.chatRetracts?.[roomId]?.[String(message.id)]) return getChat(roomId);
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
  const groups = { ...state.groups };
  for (const [groupId, group] of Object.entries(groups)) {
    const msgs = state.chats[groupId] || [];
    if (!msgs.length || Number(group.chatReadAt) > 0) continue;
    const lastAt = msgs.reduce((max, m) => Math.max(max, Number(m.at) || 0), 0);
    groups[groupId] = { ...group, chatReadAt: lastAt };
    changed = true;
  }
  if (changed) state.groups = groups;
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
  for (const groupId of Object.keys(state.groups || {})) n += unreadGroupCount(groupId);
  n += (state.groupInvites || []).length;
  return n;
}

export function markChatRead(peerId) {
  if (!peerId) return false;
  const lastAt = lastChatAt(peerId);
  const prev = Number(state.pairState[peerId]?.chatReadAt) || 0;
  const at = Math.max(lastAt, prev) || Date.now();
  if (at === prev) return false;
  upsertPair(peerId, { chatReadAt: at });
  return true;
}

export function getGroup(groupId) {
  return state.groups[groupId] || null;
}

export function listGroups() {
  return Object.entries(state.groups || {})
    .filter(([, g]) => g && !g.left)
    .map(([groupId, group]) => ({ groupId, ...group }));
}

export function getGroupInvites() {
  return [...(state.groupInvites || [])];
}

function putGroup(groupId, group, { save = true } = {}) {
  const clean = sanitizeGroup(groupId, group);
  if (!clean) return null;
  state.groups = { ...state.groups, [groupId]: clean };
  if (save) saveStore();
  return clean;
}

export function saveGroup(groupId, group) {
  return putGroup(groupId, group);
}

export function addGroupMember(groupId, member) {
  const group = state.groups[groupId];
  if (!group) return null;
  const next = sanitizeGroupMember(member);
  if (!next) return group;
  const members = group.members.filter((m) => m.peerId !== next.peerId);
  const prev = group.members.find((m) => m.peerId === next.peerId);
  members.push({
    ...prev,
    ...next,
    publicKey: next.publicKey || prev?.publicKey || null,
    invitedBy: next.invitedBy || prev?.invitedBy || "",
  });
  return putGroup(groupId, { ...group, members });
}

export function setGroupPendingInvites(groupId, peerIds) {
  const group = state.groups[groupId];
  if (!group) return null;
  return putGroup(groupId, { ...group, pendingInvites: sanitizePeerIds(peerIds) });
}

export function addGroupPendingInvite(groupId, peerId) {
  const group = state.groups[groupId];
  if (!group || !isUserPeerId(peerId)) return null;
  if (group.members.some((m) => m.peerId === peerId)) return group;
  const pending = sanitizePeerIds([...(group.pendingInvites || []), peerId]);
  return putGroup(groupId, { ...group, pendingInvites: pending });
}

export function clearGroupPendingInvite(groupId, peerId) {
  const group = state.groups[groupId];
  if (!group) return null;
  const pending = (group.pendingInvites || []).filter((id) => id !== peerId);
  if (pending.length === (group.pendingInvites || []).length) return group;
  return putGroup(groupId, { ...group, pendingInvites: pending });
}

export function queueIncomingGroupInvite(invite) {
  const hop = sanitizeInviteHop(invite);
  const genesis = sanitizeGenesis(invite?.genesis);
  if (!hop || !genesis) return false;
  const key = `${hop.groupId}:${hop.sig}`;
  const existing = state.groupInvites || [];
  if (existing.some((row) => `${row.invite.groupId}:${row.invite.sig}` === key)) return false;
  if (state.groups[hop.groupId] && !state.groups[hop.groupId].left) return false;
  const chain = [];
  for (const item of invite.chain || []) {
    const clean = sanitizeInviteHop(item);
    if (clean) chain.push(clean);
  }
  state.groupInvites = [
    ...existing,
    { invite: { ...hop, genesis, chain }, receivedAt: Date.now() },
  ].slice(0, 50);
  saveStore();
  return true;
}

export function removeIncomingGroupInvite(groupId, sig) {
  const next = (state.groupInvites || []).filter((row) => {
    if (row.invite.groupId !== groupId) return true;
    if (sig && row.invite.sig !== sig) return true;
    return false;
  });
  if (next.length === (state.groupInvites || []).length) return false;
  state.groupInvites = next;
  saveStore();
  return true;
}

export function leaveGroupLocal(groupId) {
  const group = state.groups[groupId];
  if (!group) return null;
  return putGroup(groupId, { ...group, left: true, pendingInvites: [] });
}

export function getGroupRetention(groupId) {
  const group = state.groups[groupId];
  if (isChatRetention(group?.chatRetention)) return group.chatRetention;
  if (groupId && (state.chats[groupId] || []).length) return "never";
  return DEFAULT_CHAT_RETENTION;
}

export function setGroupRetention(groupId, retention, { retentionAt, chatPolicy } = {}) {
  const group = state.groups[groupId];
  if (!group || !isChatRetention(retention)) return getGroupRetention(groupId);
  const incoming = sanitizeGroupPolicy(chatPolicy, groupId);
  const prevPolicy = sanitizeGroupPolicy(group.chatPolicy, groupId);
  const at = Number(retentionAt) || Number(incoming?.at) || Date.now();
  const prevAt = Number(group.chatRetentionAt) || 0;
  if (at < prevAt) return getGroupRetention(groupId);
  const nextPolicy = incoming && (Number(incoming.at) || 0) >= (Number(prevPolicy?.at) || 0)
    ? incoming
    : prevPolicy;
  if (at === prevAt && group.chatRetention === retention && nextPolicy === prevPolicy) return retention;
  putGroup(groupId, { ...group, chatRetention: retention, chatRetentionAt: at, chatPolicy: nextPolicy });
  pruneChat(groupId);
  return getGroupRetention(groupId);
}

export function clearGroupChat(groupId, { clearedAt, chatClear } = {}) {
  const group = state.groups[groupId];
  if (!group) return [];
  const incoming = sanitizeGroupClear(chatClear, groupId);
  const prevClear = sanitizeGroupClear(group.chatClear, groupId);
  const at = Math.max(
    Number(clearedAt) || Number(incoming?.at) || Date.now(),
    Number(group.chatClearedAt) || 0,
  );
  const nextClear = incoming && (Number(incoming.at) || 0) >= (Number(prevClear?.at) || 0)
    ? incoming
    : prevClear;
  putGroup(groupId, { ...group, chatClearedAt: at, chatClear: nextClear, chatReadAt: at }, { save: false });
  const prev = state.chats[groupId] || [];
  const next = prev.filter((m) => (Number(m.at) || 0) > at);
  const chats = { ...state.chats };
  if (next.length) chats[groupId] = next;
  else delete chats[groupId];
  state.chats = chats;
  saveStore();
  return next;
}

export function unreadGroupCount(groupId) {
  const group = state.groups[groupId];
  if (!group || group.left) return 0;
  const me = state.peerId;
  const readAt = Number(group.chatReadAt) || 0;
  let n = 0;
  for (const m of state.chats[groupId] || []) {
    if (!m || m.from === me) continue;
    if ((Number(m.at) || 0) > readAt) n += 1;
  }
  return n;
}

export function markGroupRead(groupId) {
  const group = state.groups[groupId];
  if (!group) return false;
  const lastAt = (state.chats[groupId] || []).reduce((max, m) => Math.max(max, Number(m.at) || 0), 0);
  const prev = Number(group.chatReadAt) || 0;
  const at = Math.max(lastAt, prev) || Date.now();
  if (at === prev) return false;
  putGroup(groupId, { ...group, chatReadAt: at });
  return true;
}

export function getGroupThemChatReadAt(groupId) {
  return sanitizeThemChatReadAt(state.groups[groupId]?.themChatReadAt);
}

export function setGroupThemChatReadAt(groupId, peerId, at) {
  const group = state.groups[groupId];
  if (!group || !isUserPeerId(peerId) || peerId === state.peerId) return false;
  const next = Number(at) || 0;
  const prev = Number(group.themChatReadAt?.[peerId]) || 0;
  if (next <= prev) return false;
  putGroup(groupId, {
    ...group,
    themChatReadAt: { ...sanitizeThemChatReadAt(group.themChatReadAt), [peerId]: next },
  });
  return true;
}

export function memberPublicKey(groupId, peerId) {
  const group = state.groups[groupId];
  if (!group) return null;
  const member = (group.members || []).find((m) => m.peerId === peerId);
  return publicJwkOnly(member?.publicKey) || (peerId === group.creatorId ? publicJwkOnly(group.genesis?.publicKey) : null);
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
    chatRetracts: sanitizeChatRetracts(parsed.chatRetracts),
    chatRooms: sanitizeChatRooms(parsed.chatRooms),
    groups: sanitizeGroups(parsed.groups),
    groupInvites: sanitizeGroupInvites(parsed.groupInvites),
    pairState: sanitizePairState(parsed.pairState || {}),
    filters: normalizeFilters(parsed.filters, Boolean(parsed.preciseGeolocation)),
    offline: parsed.offline == null ? true : Boolean(parsed.offline),
    preciseGeolocation: Boolean(parsed.preciseGeolocation),
    syncRev: Number(parsed.syncRev) || Date.now(),
  };
  await ensureIdentity();
  await ensureDevice();
  pruneAllChats({ save: false });
  seedChatReadAt();
  saveStore();
  return state;
}

export async function mergeVaultState(remote, { identityFromVault = false } = {}) {
  const parsed = typeof remote === "string" ? JSON.parse(remote) : remote;
  if (parsed?.kind === VAULT_SYNC_KIND || parsed?.profiles) {
    return installVaultBundle(parsed, { fromSync: true });
  }
  if (!parsed || !isUserPeerId(parsed.peerId)) {
    throw new Error(`That file does not look like a ${APP_NAME} backup.`);
  }
  return installVaultBundle(makeSyncBundle([parsed]), {
    fromSync: true,
    linkedVault: identityFromVault ? identityIndex.linkedVault : null,
  });
}
