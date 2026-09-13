/**
 * Web Crypto for Local Chat. Uses window.crypto.subtle in a secure context
 * (HTTPS / localhost). On plain HTTP (http://spark.local, LAN IPs) SubtleCrypto
 * is missing, so ECDSA P-256 + SHA-256 fall back to @noble/curves.
 */
import { p256, sha256 } from "./vendor/noble-p256.js";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" };

const P256_SPKI_PREFIX = Uint8Array.of(
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
);

function bytesToB64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value) {
  const s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function field32(bytes) {
  if (bytes.length === 32) return bytes;
  if (bytes.length > 32) return bytes.slice(bytes.length - 32);
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

function jwkPoint(jwk) {
  const x = field32(b64urlToBytes(jwk.x));
  const y = field32(b64urlToBytes(jwk.y));
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

function pubJwkFromPoint(point) {
  const uncompressed = point[0] === 4 && point.length === 65
    ? point
    : p256.Point.fromHex(point).toBytes(false);
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(uncompressed.slice(1, 33)),
    y: bytesToB64url(uncompressed.slice(33, 65)),
    ext: true,
  };
}

const nobleSubtle = {
  async digest(algo, data) {
    const name = typeof algo === "string" ? algo : algo?.name;
    if (String(name).toUpperCase() !== "SHA-256") {
      throw new Error("Only SHA-256 is supported without HTTPS.");
    }
    return sha256(asBytes(data)).buffer;
  },
  async generateKey() {
    const secret = p256.utils.randomPrivateKey();
    const pub = pubJwkFromPoint(p256.getPublicKey(secret, false));
    return {
      publicKey: { type: "public", algorithm: ECDSA, jwk: { ...pub } },
      privateKey: { type: "private", algorithm: ECDSA, jwk: { ...pub, d: bytesToB64url(secret) } },
    };
  },
  async exportKey(format, key) {
    if (format === "jwk") {
      if (key.type === "private") return { ...key.jwk };
      const { d, ...pub } = key.jwk;
      return pub;
    }
    if (format === "spki") {
      const point = jwkPoint(key.jwk);
      const out = new Uint8Array(P256_SPKI_PREFIX.length + point.length);
      out.set(P256_SPKI_PREFIX);
      out.set(point, P256_SPKI_PREFIX.length);
      return out.buffer;
    }
    throw new Error("Unsupported key format.");
  },
  async importKey(format, keyData) {
    if (format !== "jwk") throw new Error("Unsupported key format.");
    const pub = {
      kty: "EC",
      crv: "P-256",
      x: keyData.x,
      y: keyData.y,
      ext: true,
    };
    if (keyData.d) {
      return { type: "private", algorithm: ECDSA, jwk: { ...pub, d: keyData.d } };
    }
    return { type: "public", algorithm: ECDSA, jwk: pub };
  },
  async sign(_algo, key, data) {
    const sig = p256.sign(asBytes(data), field32(b64urlToBytes(key.jwk.d)));
    return sig.toCompactRawBytes().buffer;
  },
  async verify(_algo, key, signature, data) {
    try {
      return p256.verify(asBytes(signature), asBytes(data), jwkPoint(key.jwk));
    } catch {
      return false;
    }
  },
};

export function subtle() {
  const native = globalThis.crypto && globalThis.crypto.subtle;
  return native || nobleSubtle;
}
