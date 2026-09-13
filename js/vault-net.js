import { keyFingerprint } from "./device.js";
import { publicJwkOnly } from "./identity.js";
import { isVaultHubId } from "./share.js";
import {
  ensureDevice,
  exportBackup,
  getDevice,
  getLinkedVault,
  getState,
  identityLooksUsed,
  importBackup,
  mergeVaultState,
  onStoreSave,
  setLinkedVault,
} from "./store.js";

const PEER_OPTS = { debug: 0 };
const PAIR_TIMEOUT_MS = 90_000;
const SYNC_RETRY_MS = 8_000;
const PUSH_DEBOUNCE_MS = 400;

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function deviceLabel() {
  try {
    return String(navigator.userAgent || "Browser").slice(0, 80);
  } catch {
    return "Browser";
  }
}

export class VaultNet {
  constructor({ onStatus, onMerged } = {}) {
    this.onStatus = onStatus;
    this.onMerged = onMerged;
    this.peer = null;
    this.conn = null;
    this.stopped = false;
    this.mode = "";
    this.retryTimer = null;
    this.pushTimer = null;
    this.unsubSave = null;
  }

  status(text) {
    this.onStatus?.(text);
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.unsubSave?.();
    this.unsubSave = null;
    try { this.conn?.close(); } catch { /* ignore */ }
    this.conn = null;
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.peer = null;
  }

  async pair({ hubId, nonce, mode = "replace" }) {
    if (!isVaultHubId(hubId)) throw new Error("That link is not a Local Chat desktop QR.");
    if (!window.Peer) throw new Error("PeerJS failed to load. Check your network.");
    const device = await ensureDevice();
    if (!device?.publicKey) throw new Error("Could not create a device key for this browser.");
    this.mode = "pair";
    this.stopped = false;
    this.status("Connecting to desktop…");
    this.peer = new window.Peer(undefined, PEER_OPTS);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("PeerJS cloud did not respond.")), 15_000);
      this.peer.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.peer.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    if (this.stopped) return;
    this.status("Contacting the vault hub…");
    const conn = this.peer.connect(hubId, { reliable: true });
    this.conn = conn;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.peer?.off("error", onPeerErr);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error("Desktop did not accept this device in time.")), PAIR_TIMEOUT_MS);
      const onPeerErr = (err) => {
        const type = err && typeof err === "object" && "type" in err ? String(err.type) : "";
        if (type === "peer-unavailable") {
          finish(new Error("The desktop hub is not online. Keep Local Chat Vault open and tap Show QR again."));
          return;
        }
        finish(err instanceof Error ? err : new Error("Could not reach the desktop app."));
      };
      this.peer.on("error", onPeerErr);
      conn.on("open", () => {
        try {
          conn.send({
            type: "link-hello",
            nonce: nonce || "",
            mode,
            devicePublicKey: publicJwkOnly(device.publicKey),
            fingerprint: keyFingerprint(device.publicKey),
            label: deviceLabel(),
            existingPeerId: getState().peerId,
            existingHandle: getState().profile?.handle || "",
            existingUsed: identityLooksUsed(),
            offerBlob: identityLooksUsed() ? exportBackup() : "",
          });
          this.status("Waiting for the desktop app to authorize this device…");
        } catch (err) {
          finish(err instanceof Error ? err : new Error("Could not send a link request."));
        }
      });
      conn.on("data", async (msg) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "link-wait") {
          this.status("Waiting for the desktop app to authorize this device…");
          return;
        }
        if (msg.type === "link-deny") {
          finish(new Error(msg.reason || "Desktop denied this device."));
          return;
        }
        if (msg.type === "link-install" && msg.blob) {
          try {
            await importBackup(msg.blob);
            setLinkedVault(msg.linkedVault || {
              hubId,
              vaultPublicKey: msg.vaultPublicKey,
              profileId: getState().peerId,
              linkedAt: Date.now(),
            });
            await ensureDevice();
            finish();
          } catch (err) {
            finish(err instanceof Error ? err : new Error("Could not install the vault profile."));
          }
        }
      });
      conn.on("close", () => {
        if (this.stopped) return;
        finish(new Error("Connection to desktop closed."));
      });
      conn.on("error", (err) => {
        finish(err instanceof Error ? err : new Error("Could not reach the desktop app."));
      });
    });
  }

  async startSync() {
    const link = getLinkedVault();
    if (!link?.hubId || !window.Peer) return;
    this.mode = "sync";
    this.stopped = false;
    await ensureDevice();
    this.bindStorePush();
    this.connectSync(link);
  }

  bindStorePush() {
    if (this.unsubSave) return;
    this.unsubSave = onStoreSave(() => {
      if (this.stopped || this.mode !== "sync") return;
      if (this.pushTimer) clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => {
        this.pushTimer = null;
        this.pushState();
      }, PUSH_DEBOUNCE_MS);
    });
  }

  pushState(conn = this.conn) {
    if (this.stopped || this.mode !== "sync" || !conn) return;
    try {
      conn.send({
        type: "vault-state",
        blob: exportBackup(),
        fingerprint: keyFingerprint(getDevice().publicKey),
        profilePeerId: getState().peerId,
      });
    } catch {
      /* retry on next save or reconnect */
    }
  }

  connectSync(link) {
    if (this.stopped) return;
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.peer = new window.Peer(`lc1s-${randomId()}`, PEER_OPTS);
    this.peer.on("open", () => {
      if (this.stopped) return;
      const conn = this.peer.connect(link.hubId, { reliable: true });
      this.conn = conn;
      conn.on("open", () => {
        const device = getDevice();
        conn.send({
          type: "vault-hello",
          nonce: randomId(),
          devicePublicKey: publicJwkOnly(device.publicKey),
          fingerprint: keyFingerprint(device.publicKey),
          profilePeerId: getState().peerId,
        });
      });
      conn.on("data", (msg) => this.onSyncMessage(conn, msg, link));
      conn.on("close", () => this.scheduleSync(link));
      conn.on("error", () => this.scheduleSync(link));
    });
    this.peer.on("error", () => this.scheduleSync(link));
  }

  scheduleSync(link) {
    if (this.stopped || this.mode !== "sync") return;
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connectSync(link);
    }, SYNC_RETRY_MS);
  }

  onSyncMessage(conn, msg, link) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "vault-error") {
      this.status(msg.reason || "Desktop sync failed.");
      return;
    }
    if (msg.type === "vault-hello-ok") {
      return;
    }
    if (msg.type === "vault-pull") {
      this.pushState(conn);
      return;
    }
    if (msg.type === "vault-state" && msg.blob) {
      try {
        mergeVaultState(msg.blob);
        this.onMerged?.();
        if (!msg.echo) this.pushState(conn);
      } catch (err) {
        conn.send({ type: "vault-error", reason: err.message });
      }
    }
  }
}
