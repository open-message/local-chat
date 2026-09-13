import { DEVICE_ID_PREFIX, PROTOCOL, VAULT_HUB_PREFIX } from "./config.js";
import {
  PROOF_MAX_AGE_MS,
  createKeypair,
  publicJwkOnly,
  samePublicKey,
  sha256Hex,
  signBytes,
  verifyBytes,
} from "./identity.js";

const DEVICE_BIND_MAX_AGE_MS = PROOF_MAX_AGE_MS;

function hexId(prefix, hex) {
  return `${prefix}${String(hex || "").slice(0, 32).toLowerCase()}`;
}

export function isDevicePeerId(id) {
  return new RegExp(`^${PROTOCOL}c-[0-9a-f]{32}$`, "i").test(String(id || ""));
}

export function isVaultHubId(id) {
  return new RegExp(`^${PROTOCOL}v-[0-9a-f]{32}$`, "i").test(String(id || ""));
}

export async function deviceConnId(identityPeerId, devicePublicJwk) {
  const pub = publicJwkOnly(devicePublicJwk);
  if (!identityPeerId || !pub) return "";
  const hex = await sha256Hex(new TextEncoder().encode(
    `lc1-conn|${identityPeerId}|${pub.x}|${pub.y}`
  ));
  return hexId(DEVICE_ID_PREFIX, hex);
}

export async function vaultHubId(devicePublicJwk) {
  const pub = publicJwkOnly(devicePublicJwk);
  if (!pub) return "";
  const hex = await sha256Hex(new TextEncoder().encode(`lc1-vault|${pub.x}|${pub.y}`));
  return hexId(VAULT_HUB_PREFIX, hex);
}

export function keyFingerprint(jwk) {
  const pub = publicJwkOnly(jwk);
  if (!pub) return "";
  return `${pub.x.slice(0, 4)}${pub.y.slice(-4)}`.toLowerCase();
}

function bindingBytes({ peerId, deviceId, devicePublicKey, ts }) {
  const pub = publicJwkOnly(devicePublicKey);
  return new TextEncoder().encode(
    `lc1-device|${peerId}|${deviceId}|${pub.x}|${pub.y}|${ts}`
  );
}

export async function signDeviceBinding(identity, { deviceId, publicKey }) {
  const ts = Date.now();
  const devicePublicKey = publicJwkOnly(publicKey);
  if (!identity?.peerId || !deviceId || !devicePublicKey || !identity.privateKey) return null;
  return {
    ts,
    sig: await signBytes(identity.privateKey, bindingBytes({
      peerId: identity.peerId,
      deviceId,
      devicePublicKey,
      ts,
    })),
  };
}

export async function verifyDeviceBinding(msg, {
  expectedPeerId,
  expectedDeviceId,
  identityPublicKey,
  now = Date.now(),
  maxAge = DEVICE_BIND_MAX_AGE_MS,
} = {}) {
  const binding = msg?.deviceBinding || msg?.binding;
  const deviceId = msg?.deviceId;
  const devicePublicKey = publicJwkOnly(msg?.devicePublicKey || msg?.publicKey);
  const peerId = msg?.peerId || expectedPeerId;
  const identityPub = publicJwkOnly(identityPublicKey || msg?.publicKey);
  if (!binding?.sig || !deviceId || !devicePublicKey || !peerId || !identityPub) return false;
  if (expectedPeerId && String(peerId) !== String(expectedPeerId)) return false;
  if (expectedDeviceId && String(deviceId) !== String(expectedDeviceId)) return false;
  const ts = Number(binding.ts) || 0;
  if (!ts || Math.abs(now - ts) > maxAge) return false;
  return verifyBytes(identityPub, bindingBytes({
    peerId,
    deviceId,
    devicePublicKey,
    ts,
  }), binding.sig);
}

export async function createDeviceKeys() {
  return createKeypair();
}

export function presenceDeviceId(msg, fallback = "") {
  if (isDevicePeerId(msg?.deviceId)) return msg.deviceId;
  if (isDevicePeerId(fallback)) return fallback;
  return String(msg?.profile?.peerId || msg?.peerId || fallback || "");
}

export { DEVICE_ID_PREFIX, VAULT_HUB_PREFIX };
