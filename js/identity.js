import { PROTOCOL } from "./config.js";
import { subtle } from "./subtle.js";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const SIGN = { name: "ECDSA", hash: "SHA-256" };
export const PROOF_MAX_AGE_MS = 5 * 60 * 1000;

export function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64) {
  const s = atob(String(b64 || ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function publicJwkOnly(jwk) {
  if (!jwk || typeof jwk !== "object") return null;
  const { kty, crv, x, y } = jwk;
  if (kty !== "EC" || crv !== "P-256" || !x || !y) return null;
  return { kty: "EC", crv: "P-256", x, y };
}

export function samePublicKey(a, b) {
  const left = publicJwkOnly(a);
  const right = publicJwkOnly(b);
  if (!left || !right) return false;
  return left.x === right.x && left.y === right.y;
}

async function importPublicKey(jwk) {
  const pub = publicJwkOnly(jwk);
  if (!pub) throw new Error("Invalid public key.");
  return subtle().importKey("jwk", pub, ECDSA, true, ["verify"]);
}

async function importPrivateKey(jwk) {
  const pub = publicJwkOnly(jwk);
  if (!pub || !jwk?.d) throw new Error("Invalid private key.");
  return subtle().importKey("jwk", { ...pub, d: jwk.d, ext: true }, ECDSA, true, ["sign"]);
}

export async function peerIdFromPublicKey(publicKey) {
  const spki = await subtle().exportKey("spki", publicKey);
  const hash = await subtle().digest("SHA-256", spki);
  return `${PROTOCOL}u-${bytesToHex(hash).slice(0, 32)}`;
}

export async function peerIdFromPublicJwk(jwk) {
  return peerIdFromPublicKey(await importPublicKey(jwk));
}

export async function createKeypair() {
  const pair = await subtle().generateKey(ECDSA, true, ["sign", "verify"]);
  const publicKey = publicJwkOnly(await subtle().exportKey("jwk", pair.publicKey));
  const privateJwk = await subtle().exportKey("jwk", pair.privateKey);
  return {
    publicKey,
    privateKey: { ...publicKey, d: privateJwk.d },
  };
}

export async function createIdentity({ legacyPeerId } = {}) {
  const keys = await createKeypair();
  const publicCryptoKey = await importPublicKey(keys.publicKey);
  const peerId = legacyPeerId || await peerIdFromPublicKey(publicCryptoKey);
  return {
    peerId,
    legacyId: Boolean(legacyPeerId),
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
}

export async function keysMatch(publicJwk, privateJwk) {
  const pub = publicJwkOnly(publicJwk);
  const privPub = publicJwkOnly(privateJwk);
  if (!pub || !privPub || !privateJwk?.d) return false;
  if (pub.x !== privPub.x || pub.y !== privPub.y) return false;
  try {
    await importPublicKey(pub);
    await importPrivateKey(privateJwk);
    return true;
  } catch {
    return false;
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export async function sha256Hex(bytes) {
  return bytesToHex(await subtle().digest("SHA-256", bytes));
}

export async function profileHash(profile) {
  const body = {
    v: profile?.v ?? 1,
    peerId: profile?.peerId || "",
    age: profile?.age ?? null,
    gender: profile?.gender || "",
    genderSelf: profile?.genderSelf || "",
    seeking: profile?.seeking || [],
    seekingRelationships: profile?.seekingRelationships || [],
    seekingFriendships: profile?.seekingFriendships || [],
    networking: profile?.networking || [],
    musicianSeekingBand: profile?.musicianSeekingBand || [],
    musicianInstruments: profile?.musicianInstruments || [],
    bandSeekingMusician: profile?.bandSeekingMusician || [],
    photo: profile?.photo || "",
    interests: profile?.interests || [],
    antiInterests: profile?.antiInterests || [],
    hobbies: profile?.hobbies || [],
    questionnaire: profile?.questionnaire || {},
    loc: profile?.loc || null,
    zip: profile?.zip || null,
    updatedAt: profile?.updatedAt || 0,
  };
  return sha256Hex(new TextEncoder().encode(stableStringify(body)));
}

export async function signBytes(privateJwk, bytes) {
  const key = await importPrivateKey(privateJwk);
  return bytesToB64(await subtle().sign(SIGN, key, bytes));
}

export async function verifyBytes(publicJwk, bytes, sigB64) {
  try {
    const key = await importPublicKey(publicJwk);
    return subtle().verify(SIGN, key, b64ToBytes(sigB64), bytes);
  } catch {
    return false;
  }
}

function proofBytes({ peerId, publicKey, updatedAt, ts, hash }) {
  const pub = publicJwkOnly(publicKey);
  return new TextEncoder().encode(
    `lc1-profile|${peerId}|${pub.x}|${pub.y}|${updatedAt}|${ts}|${hash}`
  );
}

export async function signProfileProof(identity, profile) {
  const ts = Date.now();
  const hash = await profileHash(profile);
  const bytes = proofBytes({
    peerId: identity.peerId,
    publicKey: identity.publicKey,
    updatedAt: profile.updatedAt || 0,
    ts,
    hash,
  });
  return {
    publicKey: publicJwkOnly(identity.publicKey),
    ts,
    sig: await signBytes(identity.privateKey, bytes),
    legacyId: Boolean(identity.legacyId),
  };
}

export async function verifyProfileProof(profile, proof, { now = Date.now(), maxAge = PROOF_MAX_AGE_MS, pinnedPublicKey } = {}) {
  if (!profile?.peerId || !proof?.sig) return false;
  const pub = publicJwkOnly(proof.publicKey);
  if (!pub) return false;
  if (pinnedPublicKey && !samePublicKey(pinnedPublicKey, pub)) return false;
  const ts = Number(proof.ts) || 0;
  if (!ts || Math.abs(now - ts) > maxAge) return false;
  if (!proof.legacyId) {
    const expectedId = await peerIdFromPublicJwk(pub);
    if (expectedId.toLowerCase() !== String(profile.peerId).toLowerCase()) return false;
  }
  const hash = await profileHash(profile);
  const bytes = proofBytes({
    peerId: profile.peerId,
    publicKey: pub,
    updatedAt: profile.updatedAt || 0,
    ts,
    hash,
  });
  return verifyBytes(pub, bytes, proof.sig);
}

function helloBytes({ peerId, publicKey, nonce, theirNonce, ts, legacyId }) {
  const pub = publicJwkOnly(publicKey);
  return new TextEncoder().encode(
    `lc1-hello|${peerId}|${pub.x}|${pub.y}|${nonce}|${theirNonce || ""}|${ts}|${legacyId ? "1" : "0"}`
  );
}

export function randomNonce() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function signHello(identity, { nonce, theirNonce = "", device = null } = {}) {
  const ts = Date.now();
  const legacyId = Boolean(identity.legacyId);
  const bytes = helloBytes({
    peerId: identity.peerId,
    publicKey: identity.publicKey,
    nonce,
    theirNonce,
    ts,
    legacyId,
  });
  const msg = {
    type: "id-hello",
    peerId: identity.peerId,
    publicKey: publicJwkOnly(identity.publicKey),
    legacyId,
    nonce,
    theirNonce,
    ts,
    sig: await signBytes(identity.privateKey, bytes),
  };
  if (device?.deviceId && device.publicKey && device.binding) {
    msg.deviceId = device.deviceId;
    msg.devicePublicKey = publicJwkOnly(device.publicKey);
    msg.deviceBinding = device.binding;
  }
  return msg;
}

export async function verifyHello(msg, { expectedPeerId, pinnedPublicKey, ourNonce, now = Date.now(), maxAge = PROOF_MAX_AGE_MS } = {}) {
  if (!msg || msg.type !== "id-hello" || !msg.sig || !msg.nonce) return false;
  if (expectedPeerId && String(msg.peerId) !== String(expectedPeerId)) return false;
  const pub = publicJwkOnly(msg.publicKey);
  if (!pub) return false;
  if (pinnedPublicKey && !samePublicKey(pinnedPublicKey, pub)) return false;
  const ts = Number(msg.ts) || 0;
  if (!ts || Math.abs(now - ts) > maxAge) return false;
  if (!msg.legacyId) {
    const expectedId = await peerIdFromPublicJwk(pub);
    if (expectedId.toLowerCase() !== String(msg.peerId).toLowerCase()) return false;
  }
  if (ourNonce && msg.theirNonce !== ourNonce) return false;
  const bytes = helloBytes({
    peerId: msg.peerId,
    publicKey: pub,
    nonce: msg.nonce,
    theirNonce: msg.theirNonce || "",
    ts,
    legacyId: Boolean(msg.legacyId),
  });
  return verifyBytes(pub, bytes, msg.sig);
}
