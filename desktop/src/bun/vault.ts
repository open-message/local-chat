import { LIVE_ORIGIN } from "../shared/rpc";
import type { HubKeys, LinkedDevice, ProfileSummary, VaultIndex } from "../shared/rpc";
import {
  makeSyncBundle,
  mergeIdentityJson,
  mergeVaultBundle,
  parseSyncBundle,
} from "../../../js/vault-merge.js";

type Fs = {
  mkdirSync: (path: string, opts?: { recursive?: boolean }) => void;
  writeFileSync: (path: string, data: string) => void;
  readFileSync: (path: string, enc: string) => string;
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  unlinkSync: (path: string) => void;
};

function loadFs(): { fs: Fs; join: (...parts: string[]) => string } {
  const fs = require("fs") as Fs;
  const { join } = require("path") as { join: (...parts: string[]) => string };
  return { fs, join };
}

function dataRoot() {
  const { fs, join } = loadFs();
  let base = ".";
  try {
    const { Utils } = require("electrobun/main") as { Utils?: { paths?: { userData?: string } } };
    if (Utils?.paths?.userData) base = Utils.paths.userData;
  } catch {
    /* use cwd */
  }
  const dir = join(base, "local-chat-vault");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(join(dir, "profiles"), { recursive: true });
  return { fs, join, dir };
}

function emptyIndex(): VaultIndex {
  return {
    activeId: "",
    profiles: [],
    devices: [],
    deletedPeerIds: {},
    hub: null,
    hubOnline: false,
    hubError: "",
    hubUrl: "",
    origin: LIVE_ORIGIN,
  };
}

function indexPath(dir: string, join: (...parts: string[]) => string) {
  return join(dir, "vault.json");
}

function profilePath(dir: string, join: (...parts: string[]) => string, id: string) {
  return join(dir, "profiles", `${id}.json`);
}

function devicePath(dir: string, join: (...parts: string[]) => string) {
  return join(dir, "device.json");
}

export function loadIndex(): VaultIndex {
  const { fs, join, dir } = dataRoot();
  const path = indexPath(dir, join);
  if (!fs.existsSync(path)) return emptyIndex();
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as VaultIndex & { homeZip?: unknown };
    const { homeZip: _dropped, ...rest } = parsed;
    return {
      ...emptyIndex(),
      ...rest,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      deletedPeerIds: parsed.deletedPeerIds && typeof parsed.deletedPeerIds === "object"
        ? parsed.deletedPeerIds as Record<string, number>
        : {},
      origin: parsed.origin || LIVE_ORIGIN,
      hubOnline: false,
      hubError: "",
      hubUrl: "",
    };
  } catch {
    return emptyIndex();
  }
}

export function saveIndex(index: VaultIndex) {
  const { fs, join, dir } = dataRoot();
  fs.writeFileSync(indexPath(dir, join), JSON.stringify(index, null, 2));
}

export function newId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function summaryFromBlob(id: string, json: string): ProfileSummary {
  try {
    const parsed = JSON.parse(json) as { peerId?: string; profile?: { handle?: string; updatedAt?: number } };
    return {
      id,
      peerId: String(parsed.peerId || ""),
      handle: String(parsed.profile?.handle || "New profile"),
      updatedAt: Number(parsed.profile?.updatedAt) || Date.now(),
    };
  } catch {
    return { id, peerId: "", handle: "New profile", updatedAt: Date.now() };
  }
}

export function getActiveId() {
  return loadIndex().activeId;
}

export function listProfiles() {
  return loadIndex().profiles;
}

export function readProfile(id: string) {
  const { fs, join, dir } = dataRoot();
  const path = profilePath(dir, join, id);
  if (!fs.existsSync(path)) return null;
  return fs.readFileSync(path, "utf8");
}

export function writeProfile(id: string, json: string) {
  const { fs, join, dir } = dataRoot();
  fs.writeFileSync(profilePath(dir, join, id), json);
  const index = loadIndex();
  const summary = summaryFromBlob(id, json);
  const rest = index.profiles.filter((p) => p.id !== id);
  index.profiles = [summary, ...rest];
  if (!index.activeId) index.activeId = id;
  saveIndex(index);
  return summary;
}

export function renameProfile(id: string, handle: string) {
  const json = readProfile(id);
  if (!json) throw new Error("That profile is not in the vault.");
  const name = String(handle || "").trim().slice(0, 40);
  if (!name) throw new Error("Enter a name for this profile.");
  const parsed = JSON.parse(json) as { profile?: Record<string, unknown> };
  parsed.profile = { ...(parsed.profile || {}), handle: name, updatedAt: Date.now() };
  return writeProfile(id, JSON.stringify(parsed));
}

function publicHalf(jwk: JsonWebKey | null | undefined): JsonWebKey | null {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) return null;
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

async function emptyIdentityJson() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = publicHalf(await crypto.subtle.exportKey("jwk", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", spki))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return JSON.stringify({
    v: 1,
    peerId: `lc1u-${hash.slice(0, 32)}`,
    legacyId: false,
    publicKey,
    privateKey: { ...publicKey, d: privateJwk.d },
    profile: {
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
      questionnaire: {},
      loc: null,
      zip: null,
      updatedAt: 0,
    },
    interestedPeerIds: [],
    friends: [],
    chats: {},
    chatRooms: {},
    groups: {},
    groupInvites: [],
    pairState: {},
    filters: {
      minAge: 18,
      maxAge: 99,
      intents: [],
      distance: 25,
      interestWeight: 0.7,
      peopleFilter: "all",
    },
    offline: true,
    preciseGeolocation: false,
    linkedVault: null,
    syncRev: 0,
  });
}

export async function createProfile() {
  const id = newId();
  writeProfile(id, await emptyIdentityJson());
  setActiveProfile(id);
  return id;
}

export function profileIdForPeer(peerId: string) {
  const want = String(peerId || "").toLowerCase();
  if (!want) return "";
  return loadIndex().profiles.find((p) => p.peerId && p.peerId.toLowerCase() === want)?.id || "";
}

export function importBrowserProfile(json: string) {
  const parsed = JSON.parse(json) as { peerId?: string };
  const peerId = String(parsed.peerId || "");
  if (!peerId) throw new Error("That browser profile has no identity.");
  const existing = profileIdForPeer(peerId);
  if (existing) {
    const merged = mergeProfileJson(readProfile(existing), json);
    writeProfile(existing, merged);
    return existing;
  }
  const id = newId();
  writeProfile(id, json);
  return id;
}

export function deleteProfile(id: string) {
  const { fs, join, dir } = dataRoot();
  const path = profilePath(dir, join, id);
  if (fs.existsSync(path)) fs.unlinkSync(path);
  const index = loadIndex();
  index.profiles = index.profiles.filter((p) => p.id !== id);
  index.devices = index.devices.filter((d) => d.profileId !== id);
  if (index.activeId === id) index.activeId = index.profiles[0]?.id || "";
  saveIndex(index);
}

export function setActiveProfile(id: string) {
  const index = loadIndex();
  if (!index.profiles.some((p) => p.id === id)) return false;
  index.activeId = id;
  saveIndex(index);
  return true;
}

export function setOrigin(origin: string) {
  const index = loadIndex();
  index.origin = origin;
  saveIndex(index);
  return index.origin;
}

export function getOrigin() {
  return loadIndex().origin || LIVE_ORIGIN;
}

export function loadDeviceKeys() {
  const { fs, join, dir } = dataRoot();
  const path = devicePath(dir, join);
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8")) as { publicKey: JsonWebKey; privateKey: JsonWebKey };
  } catch {
    return null;
  }
}

export function saveDeviceKeys(keys: { publicKey: JsonWebKey; privateKey: JsonWebKey }) {
  const { fs, join, dir } = dataRoot();
  fs.writeFileSync(devicePath(dir, join), JSON.stringify(keys));
}

export function getHub(): HubKeys | null {
  return loadIndex().hub;
}

export function saveHub(hub: HubKeys) {
  const index = loadIndex();
  index.hub = hub;
  saveIndex(index);
}

async function createHubKeys(): Promise<HubKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", spki))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    publicKey,
    privateKey,
    hubId: `lc1v-${hash.slice(0, 32)}`,
  };
}

export async function ensureHub() {
  const existing = getHub();
  if (existing?.hubId && existing.privateKey) return existing;
  const keys = await createHubKeys();
  saveHub(keys);
  return keys;
}

export function listDevices() {
  return loadIndex().devices;
}

export function cleanDeviceLabel(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function addDevice(device: LinkedDevice) {
  const index = loadIndex();
  const label = cleanDeviceLabel(device.label);
  const rec = { ...device, label };
  index.devices = [rec, ...index.devices.filter((d) => d.id !== rec.id && d.fingerprint !== rec.fingerprint)];
  saveIndex(index);
}

export function renameDevice(id: string, label: string) {
  const name = cleanDeviceLabel(label);
  if (!name) throw new Error("Enter a name for this device.");
  const index = loadIndex();
  const rec = index.devices.find((d) => d.id === id);
  if (!rec) throw new Error("That device is not linked.");
  rec.label = name;
  saveIndex(index);
}

export function revokeDevice(id: string) {
  const index = loadIndex();
  index.devices = index.devices.filter((d) => d.id !== id);
  saveIndex(index);
}

export function findDevice(fingerprint: string) {
  const want = String(fingerprint || "");
  if (!want) return null;
  return loadIndex().devices.find((d) => d.fingerprint === want) || null;
}

export function exportBundleJson() {
  const index = loadIndex();
  const profiles: Record<string, unknown> = {};
  for (const p of index.profiles) {
    const json = readProfile(p.id);
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as { peerId?: string };
      if (parsed.peerId) profiles[parsed.peerId] = parsed;
    } catch {
      /* skip bad file */
    }
  }
  return JSON.stringify(makeSyncBundle(profiles, index.deletedPeerIds || {}));
}

function applyBundleToDisk(bundleJson: string) {
  const parsed = parseSyncBundle(bundleJson);
  const index = loadIndex();
  const keep: ProfileSummary[] = [];
  const { fs, join, dir } = dataRoot();
  for (const p of index.profiles) {
    const tombstoned = Boolean(p.peerId && parsed.deletedPeerIds[p.peerId] && !parsed.profiles[p.peerId]);
    if (tombstoned) {
      const path = profilePath(dir, join, p.id);
      if (fs.existsSync(path)) fs.unlinkSync(path);
      continue;
    }
    keep.push(p);
  }
  index.profiles = keep;
  index.deletedPeerIds = parsed.deletedPeerIds;
  if (index.activeId && !index.profiles.some((p) => p.id === index.activeId)) {
    index.activeId = index.profiles[0]?.id || "";
  }
  saveIndex(index);
  for (const [peerId, blob] of Object.entries(parsed.profiles)) {
    const json = JSON.stringify(blob);
    const existing = profileIdForPeer(peerId);
    if (existing) writeProfile(existing, json);
    else writeProfile(newId(), json);
  }
}

export function mergeIncomingBundle(json: string) {
  const remote = json && json.trim() ? json : JSON.stringify(makeSyncBundle({}, {}));
  const merged = mergeVaultBundle(exportBundleJson(), remote);
  applyBundleToDisk(JSON.stringify(merged));
  return JSON.stringify(merged);
}

export function exportAll() {
  const index = loadIndex();
  const profiles: Record<string, unknown> = {};
  for (const p of index.profiles) {
    const json = readProfile(p.id);
    if (json) profiles[p.id] = JSON.parse(json);
  }
  return JSON.stringify({
    kind: "localchat-vault-plain",
    v: 1,
    exportedAt: Date.now(),
    index,
    profiles,
    device: loadDeviceKeys(),
  });
}

export function importAll(json: string) {
  const parsed = JSON.parse(json) as {
    kind?: string;
    index?: VaultIndex;
    profiles?: Record<string, unknown>;
    device?: { publicKey: JsonWebKey; privateKey: JsonWebKey };
  };
  if (parsed.kind !== "localchat-vault-plain" || !parsed.index) {
    throw new Error("That file is not a Local Chat vault.");
  }
  saveIndex({
    ...emptyIndex(),
    ...parsed.index,
    profiles: Array.isArray(parsed.index.profiles) ? parsed.index.profiles : [],
    devices: Array.isArray(parsed.index.devices) ? parsed.index.devices : [],
    deletedPeerIds: parsed.index.deletedPeerIds && typeof parsed.index.deletedPeerIds === "object"
      ? parsed.index.deletedPeerIds
      : {},
  });
  if (parsed.profiles) {
    for (const [id, blob] of Object.entries(parsed.profiles)) {
      writeProfile(id, JSON.stringify(blob));
    }
  }
  if (parsed.device) saveDeviceKeys(parsed.device);
}

export function mergeProfileJson(localJson: string | null, remoteJson: string) {
  return mergeIdentityJson(localJson, remoteJson);
}
