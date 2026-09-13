/** Shared two-way merge for vault identities. Used by the web store and the desktop hub. */

export const VAULT_SYNC_KIND = "localchat-vault-sync";
export const VAULT_SYNC_VERSION = 2;
const CHAT_HISTORY_MAX = 200;
const CHAT_RETENTION_IDS = new Set(["session", "1h", "6h", "24h", "1w", "1m", "never"]);

const PROFILE_LIST_FIELDS = [
  "seeking",
  "seekingRelationships",
  "seekingFriendships",
  "networking",
  "musicianSeekingBand",
  "musicianInstruments",
  "bandSeekingMusician",
  "interests",
  "antiInterests",
  "hobbies",
  "youtubeVideoIds",
  "sectionOrder",
];

export function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function publicJwkOnly(jwk) {
  if (!jwk || typeof jwk !== "object") return null;
  const { kty, crv, x, y } = jwk;
  if (kty !== "EC" || crv !== "P-256" || !x || !y) return null;
  return { kty: "EC", crv: "P-256", x, y };
}

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw || "");
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function mergeList(left, right) {
  return uniqueStrings([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]);
}

function isChatRetention(id) {
  return CHAT_RETENTION_IDS.has(id);
}

function profileUsed(profile) {
  const p = asRecord(profile);
  return Boolean(String(p.handle || "").trim() || p.photo || p.dob);
}

export function identityBlobLooksUsed(blob) {
  const rec = typeof blob === "string" ? JSON.parse(blob) : blob;
  if (!rec || typeof rec !== "object") return false;
  if (profileUsed(rec.profile)) return true;
  if (Array.isArray(rec.friends) && rec.friends.length) return true;
  if (rec.chats && typeof rec.chats === "object" && Object.keys(rec.chats).length) return true;
  return false;
}

export function identitySummary(blob) {
  const rec = typeof blob === "string" ? JSON.parse(blob) : asRecord(blob);
  const profile = asRecord(rec.profile);
  return {
    peerId: String(rec.peerId || ""),
    handle: String(profile.handle || ""),
    updatedAt: Number(profile.updatedAt) || 0,
  };
}

function mergeProfileCard(local, remote) {
  const left = asRecord(local);
  const right = asRecord(remote);
  const localAt = Number(left.updatedAt) || 0;
  const remoteAt = Number(right.updatedAt) || 0;
  const remoteNewer = remoteAt > localAt
    || (remoteAt === localAt && profileUsed(right) && !profileUsed(left));
  const newer = remoteNewer ? right : left;
  const older = remoteNewer ? left : right;
  const out = { ...older, ...newer };
  for (const field of PROFILE_LIST_FIELDS) {
    out[field] = mergeList(left[field], right[field]);
  }
  out.questionnaire = remoteNewer
    ? { ...asRecord(left.questionnaire), ...asRecord(right.questionnaire) }
    : { ...asRecord(right.questionnaire), ...asRecord(left.questionnaire) };
  if (Array.isArray(out.seekingRelationships)) out.seeking = [...out.seekingRelationships];
  out.updatedAt = Math.max(localAt, remoteAt);
  return out;
}

function mergeChatRetracts(local, remote) {
  const out = { ...asRecord(local) };
  for (const [roomId, ids] of Object.entries(asRecord(remote))) {
    if (!roomId) continue;
    const prev = { ...asRecord(out[roomId]) };
    for (const [id, at] of Object.entries(asRecord(ids))) {
      if (!id) continue;
      prev[id] = Math.max(Number(prev[id]) || 0, Number(at) || 0);
    }
    const entries = Object.entries(prev)
      .sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
      .slice(-CHAT_HISTORY_MAX);
    if (entries.length) out[roomId] = Object.fromEntries(entries);
    else delete out[roomId];
  }
  return out;
}

function mergeChats(local, remote, retracts) {
  const blocked = asRecord(retracts);
  const out = { ...asRecord(local) };
  for (const [roomId, msgs] of Object.entries(asRecord(remote))) {
    const prev = Array.isArray(out[roomId]) ? out[roomId] : [];
    const ids = new Set(prev.map((m) => asRecord(m).id).filter(Boolean));
    const merged = [...prev];
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        const rec = asRecord(m);
        if (rec.id && !ids.has(rec.id)) {
          ids.add(rec.id);
          merged.push(m);
        }
      }
    }
    merged.sort((a, b) => (Number(asRecord(a).at) || 0) - (Number(asRecord(b).at) || 0));
    const denied = asRecord(blocked[roomId]);
    out[roomId] = merged.filter((m) => !denied[asRecord(m).id]).slice(-CHAT_HISTORY_MAX);
  }
  for (const [roomId, msgs] of Object.entries(out)) {
    const denied = asRecord(blocked[roomId]);
    if (!denied || !Object.keys(denied).length || !Array.isArray(msgs)) continue;
    out[roomId] = msgs.filter((m) => !denied[asRecord(m).id]);
  }
  return out;
}

function emptyPair() {
  return {
    meInterested: false,
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

function mergePair(local, remote) {
  const left = { ...emptyPair(), ...asRecord(local) };
  const right = { ...emptyPair(), ...asRecord(remote) };
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
  out.deviceIds = uniqueStrings([...(left.deviceIds || []), ...(right.deviceIds || [])]);
  return out;
}

function mergePairState(local, remote) {
  const out = { ...asRecord(local) };
  for (const [id, pair] of Object.entries(asRecord(remote))) {
    out[id] = mergePair(out[id], pair);
  }
  return out;
}

function mergeFriends(local, remote) {
  const map = new Map();
  for (const f of [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]) {
    const rec = asRecord(f);
    const id = String(rec.peerId || "");
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, rec);
      continue;
    }
    const newer = (Number(rec.updatedAt) || 0) >= (Number(prev.updatedAt) || 0) ? rec : prev;
    const older = newer === rec ? prev : rec;
    map.set(id, {
      ...older,
      ...newer,
      handle: newer.handle || older.handle,
      photo: newer.photo || older.photo,
      savedAt: Math.min(Number(prev.savedAt) || Date.now(), Number(rec.savedAt) || Date.now()),
      publicKey: publicJwkOnly(prev.publicKey) || publicJwkOnly(rec.publicKey),
      deviceIds: uniqueStrings([...(prev.deviceIds || []), ...(rec.deviceIds || [])]),
    });
  }
  return [...map.values()];
}

function mergeThemChatReadAt(left, right) {
  const out = { ...asRecord(left) };
  for (const [id, at] of Object.entries(asRecord(right))) {
    const next = Number(at) || 0;
    if (!id || next <= 0) continue;
    out[id] = Math.max(Number(out[id]) || 0, next);
  }
  return out;
}

function mergeGroupMembers(local, remote) {
  const map = new Map();
  for (const m of [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]) {
    const rec = asRecord(m);
    const peerId = String(rec.peerId || "");
    if (!peerId) continue;
    const prev = map.get(peerId);
    map.set(peerId, {
      peerId,
      publicKey: publicJwkOnly(prev?.publicKey) || publicJwkOnly(rec.publicKey),
      invitedBy: rec.invitedBy || prev?.invitedBy || "",
    });
  }
  return [...map.values()];
}

function mergeGroup(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const left = asRecord(local);
  const right = asRecord(remote);
  const chain = (Array.isArray(right.chain) ? right.chain : []).length
    > (Array.isArray(left.chain) ? left.chain : []).length
    ? right.chain
    : left.chain;
  const retentionAt = Number(right.chatRetentionAt) || 0;
  const localRetAt = Number(left.chatRetentionAt) || 0;
  const useRemoteRet = retentionAt > localRetAt && isChatRetention(right.chatRetention);
  return {
    ...left,
    ...right,
    genesis: left.genesis || right.genesis,
    members: mergeGroupMembers(left.members, right.members),
    pendingInvites: uniqueStrings([
      ...(Array.isArray(left.pendingInvites) ? left.pendingInvites : []),
      ...(Array.isArray(right.pendingInvites) ? right.pendingInvites : []),
    ]),
    chain,
    left: Boolean(left.left || right.left),
    chatRetention: useRemoteRet ? right.chatRetention : left.chatRetention,
    chatRetentionAt: Math.max(localRetAt, retentionAt),
    chatPolicy: pickSignedAt(left.chatPolicy, right.chatPolicy),
    chatClearedAt: Math.max(Number(left.chatClearedAt) || 0, Number(right.chatClearedAt) || 0),
    chatClear: pickSignedAt(left.chatClear, right.chatClear),
    chatReadAt: Math.max(Number(left.chatReadAt) || 0, Number(right.chatReadAt) || 0),
    themChatReadAt: mergeThemChatReadAt(left.themChatReadAt, right.themChatReadAt),
  };
}

function pickSignedAt(local, remote) {
  const left = asRecord(local);
  const right = asRecord(remote);
  const leftAt = Number(left.at) || 0;
  const rightAt = Number(right.at) || 0;
  if (rightAt > leftAt && right.sig) return remote;
  if (leftAt && left.sig) return local;
  return remote || local || null;
}

function mergeGroups(local, remote) {
  const out = { ...asRecord(local) };
  for (const [id, group] of Object.entries(asRecord(remote))) {
    out[id] = mergeGroup(out[id], group);
  }
  return out;
}

function inviteKey(row) {
  const raw = asRecord(row?.invite || row);
  const groupId = String(raw.groupId || asRecord(raw.genesis).groupId || "");
  const sig = String(raw.sig || "");
  return groupId && sig ? `${groupId}:${sig}` : "";
}

function mergeGroupInvites(local, remote) {
  const out = [];
  const seen = new Set();
  for (const row of [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]) {
    const key = inviteKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function mergeIdentity(local, remote, { identityFromVault = false } = {}) {
  const right = asRecord(remote);
  if (!right.peerId) throw new Error("That backup has no identity.");
  const left = local && typeof local === "object" ? asRecord(local) : {};
  if (left.peerId && right.peerId && left.peerId !== right.peerId) {
    throw new Error("Vault profile does not match this identity.");
  }
  const localHasPriv = Boolean(asRecord(left.privateKey).d);
  const remoteHasPriv = Boolean(asRecord(right.privateKey).d);
  const takeRemoteKeys = identityFromVault || !localHasPriv;
  const publicKey = takeRemoteKeys
    ? (right.publicKey || left.publicKey)
    : (left.publicKey || right.publicKey);
  const privateKey = takeRemoteKeys
    ? (remoteHasPriv ? right.privateKey : left.privateKey)
    : (localHasPriv ? left.privateKey : right.privateKey);
  const peerId = takeRemoteKeys ? (right.peerId || left.peerId) : (left.peerId || right.peerId);
  const legacyId = takeRemoteKeys ? (right.legacyId ?? left.legacyId) : (left.legacyId ?? right.legacyId);
  const localRev = Number(left.syncRev) || 0;
  const remoteRev = Number(right.syncRev) || 0;
  const filters = remoteRev > localRev ? (right.filters ?? left.filters) : (left.filters ?? right.filters);
  const preciseGeolocation = remoteRev > localRev
    ? Boolean(right.preciseGeolocation ?? left.preciseGeolocation)
    : Boolean(left.preciseGeolocation ?? right.preciseGeolocation);
  const pairState = mergePairState(left.pairState, right.pairState);
  const interestedPeerIds = Object.entries(pairState)
    .filter(([, pair]) => asRecord(pair).meInterested)
    .map(([id]) => id);
  const chatRetracts = mergeChatRetracts(left.chatRetracts, right.chatRetracts);
  return {
    ...left,
    ...right,
    peerId,
    legacyId: Boolean(legacyId),
    publicKey,
    privateKey,
    profile: mergeProfileCard(left.profile, right.profile),
    friends: mergeFriends(left.friends, right.friends),
    chatRetracts,
    chats: mergeChats(left.chats, right.chats, chatRetracts),
    chatRooms: { ...asRecord(right.chatRooms), ...asRecord(left.chatRooms) },
    groups: mergeGroups(left.groups, right.groups),
    groupInvites: mergeGroupInvites(left.groupInvites, right.groupInvites),
    pairState,
    interestedPeerIds,
    filters,
    preciseGeolocation,
    linkedVault: null,
    syncRev: Math.max(localRev, remoteRev, Date.now()),
  };
}

export function mergeIdentityJson(localJson, remoteJson) {
  if (!localJson) {
    return typeof remoteJson === "string" ? remoteJson : JSON.stringify(remoteJson);
  }
  const local = typeof localJson === "string" ? JSON.parse(localJson) : localJson;
  const remote = typeof remoteJson === "string" ? JSON.parse(remoteJson) : remoteJson;
  return JSON.stringify(mergeIdentity(local, remote));
}

export function mergeDeletedPeerIds(left, right) {
  const out = { ...asRecord(left) };
  for (const [id, at] of Object.entries(asRecord(right))) {
    if (!id) continue;
    const next = Number(at) || 0;
    const prev = Number(out[id]) || 0;
    if (next > prev) out[id] = next;
  }
  return out;
}

export function parseSyncBundle(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("That file is not a Local Chat vault sync.");
  }
  if (parsed.kind === VAULT_SYNC_KIND && Number(parsed.v) >= VAULT_SYNC_VERSION) {
    const profiles = {};
    for (const [key, blob] of Object.entries(asRecord(parsed.profiles))) {
      const rec = typeof blob === "string" ? JSON.parse(blob) : blob;
      const peerId = String(rec?.peerId || key || "");
      if (peerId) profiles[peerId] = rec;
    }
    return {
      v: VAULT_SYNC_VERSION,
      kind: VAULT_SYNC_KIND,
      profiles,
      deletedPeerIds: asRecord(parsed.deletedPeerIds),
    };
  }
  if (parsed.peerId) {
    return {
      v: VAULT_SYNC_VERSION,
      kind: VAULT_SYNC_KIND,
      profiles: { [parsed.peerId]: parsed },
      deletedPeerIds: {},
    };
  }
  throw new Error("That file is not a Local Chat vault sync.");
}

export function makeSyncBundle(profiles, deletedPeerIds = {}) {
  const map = {};
  const src = Array.isArray(profiles) ? profiles : Object.values(profiles || {});
  for (const blob of src) {
    const rec = typeof blob === "string" ? JSON.parse(blob) : blob;
    const peerId = String(rec?.peerId || "");
    if (peerId) map[peerId] = rec;
  }
  return {
    v: VAULT_SYNC_VERSION,
    kind: VAULT_SYNC_KIND,
    profiles: map,
    deletedPeerIds: asRecord(deletedPeerIds),
  };
}

function identityFreshness(blob) {
  const rec = asRecord(blob);
  return Math.max(Number(asRecord(rec.profile).updatedAt) || 0, Number(rec.syncRev) || 0);
}

export function mergeVaultBundle(localBundle, remoteBundle) {
  const left = parseSyncBundle(localBundle);
  const right = parseSyncBundle(remoteBundle);
  const deleted = mergeDeletedPeerIds(left.deletedPeerIds, right.deletedPeerIds);
  const profiles = {};
  const peerIds = new Set([...Object.keys(left.profiles), ...Object.keys(right.profiles)]);
  for (const peerId of peerIds) {
    const l = left.profiles[peerId];
    const r = right.profiles[peerId];
    const merged = l && r ? mergeIdentity(l, r) : (l || r);
    const deletedAt = Number(deleted[peerId]) || 0;
    const updatedAt = identityFreshness(merged);
    if (deletedAt && deletedAt >= updatedAt) continue;
    if (deletedAt && updatedAt > deletedAt) delete deleted[peerId];
    profiles[peerId] = merged;
  }
  return makeSyncBundle(profiles, deleted);
}
