const connProfile = new WeakMap();
const profileConns = new Map();

function trackConn(profileId, conn) {
  if (!profileId || !conn) return;
  let set = profileConns.get(profileId);
  if (!set) {
    set = new Set();
    profileConns.set(profileId, set);
  }
  set.add(conn);
  const drop = () => {
    set.delete(conn);
    if (!set.size) profileConns.delete(profileId);
  };
  conn.on("close", drop);
  conn.on("error", drop);
}

function broadcastProfile(profileId, msg, except) {
  for (const c of [...(profileConns.get(profileId) || [])]) {
    if (c === except) continue;
    try { c.send(msg); } catch { /* ignore */ }
  }
}

function status(text) {
  const node = document.getElementById("status");
  if (node) node.textContent = text;
}

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function waitFor(read, ms, message) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const value = read();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - start > ms) {
        reject(new Error(message));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function hubHttpConfig() {
  try {
    const q = new URLSearchParams(location.search);
    const port = q.get("hubPort");
    const key = q.get("hubKey");
    if (!port || !key) return null;
    return { port, key, external: q.get("ext") === "1" };
  } catch {
    return null;
  }
}

function ensureWebRtc() {
  const w = window;
  if (!w.RTCPeerConnection && w.webkitRTCPeerConnection) {
    w.RTCPeerConnection = w.webkitRTCPeerConnection;
  }
  if (!w.RTCSessionDescription && w.webkitRTCSessionDescription) {
    w.RTCSessionDescription = w.webkitRTCSessionDescription;
  }
  if (!w.RTCIceCandidate && w.webkitRTCIceCandidate) {
    w.RTCIceCandidate = w.webkitRTCIceCandidate;
  }
  return typeof w.RTCPeerConnection === "function";
}

function createHttpBridge() {
  const cfg = hubHttpConfig();
  if (!cfg) throw new Error("Desktop hub bridge did not load.");
  function request(method, params) {
    return fetch(`http://127.0.0.1:${cfg.port}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({ method, params }),
    }).then(async (res) => {
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok || data.error) throw new Error(data.error || res.statusText || "Hub RPC failed.");
      return data.payload;
    });
  }
  return {
    getHub: () => request("getHub", {}),
    saveHub: (keys) => request("saveHub", keys),
    hubListening: (params) => request("hubListening", params),
    reportLink: (params) => request("reportLink", params),
    deviceAllowed: (params) => request("deviceAllowed", params),
    getProfileBlob: (params) => request("getProfileBlob", params),
    mergeProfileBlob: (params) => request("mergeProfileBlob", params),
  };
}

async function createHubKeys() {
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

function bindConn(hub, conn) {
  conn.on("data", async (msg) => {
    const data = msg;
    if (!data || typeof data !== "object") return;
    if (data.type === "link-hello") {
      const requestId = randomId();
      conn.send({ type: "link-wait" });
      const result = await hub.reportLink({
        requestId,
        fingerprint: String(data.fingerprint || ""),
        label: String(data.label || "Browser"),
        nonce: String(data.nonce || ""),
        devicePublicKey: data.devicePublicKey || null,
        mode: String(data.mode || ""),
        existingPeerId: String(data.existingPeerId || ""),
        existingHandle: String(data.existingHandle || ""),
        existingUsed: Boolean(data.existingUsed),
        offerBlob: typeof data.offerBlob === "string" ? data.offerBlob : "",
      });
      if (!result.allow || !result.blob) {
        conn.send({ type: "link-deny", reason: "Desktop denied this device." });
        conn.close();
        return;
      }
      conn.send({
        type: "link-install",
        blob: result.blob,
        linkedVault: result.linkedVault,
        vaultPublicKey: result.linkedVault?.vaultPublicKey,
      });
      return;
    }
    if (data.type === "vault-hello") {
      const allowed = await hub.deviceAllowed({
        fingerprint: String(data.fingerprint || ""),
        profilePeerId: String(data.profilePeerId || ""),
      });
      if (!allowed.ok) {
        conn.send({ type: "vault-error", reason: "This device is not authorized." });
        conn.close();
        return;
      }
      connProfile.set(conn, allowed.profileId);
      trackConn(allowed.profileId, conn);
      conn.send({ type: "vault-hello-ok" });
      const blob = await hub.getProfileBlob({ profileId: allowed.profileId });
      if (blob.json) conn.send({ type: "vault-state", blob: blob.json });
      broadcastProfile(allowed.profileId, { type: "vault-pull" }, conn);
      return;
    }
    if (data.type === "vault-state" && typeof data.blob === "string") {
      let profileId = connProfile.get(conn) || "";
      if (!profileId && data.fingerprint && data.profilePeerId) {
        const allowed = await hub.deviceAllowed({
          fingerprint: String(data.fingerprint),
          profilePeerId: String(data.profilePeerId),
        });
        if (allowed.ok) {
          profileId = allowed.profileId;
          connProfile.set(conn, profileId);
          trackConn(profileId, conn);
        }
      }
      if (!profileId) return;
      const merged = await hub.mergeProfileBlob({ profileId, json: data.blob });
      if (!data.echo) {
        conn.send({ type: "vault-state", blob: merged.json, echo: true });
        broadcastProfile(profileId, { type: "vault-state", blob: merged.json, echo: true }, conn);
      }
    }
  });
}

function listen(Peer, hubId, hub) {
  const peer = new Peer(hubId, { debug: 0 });
  peer.on("connection", (conn) => bindConn(hub, conn));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vault hub did not reach PeerJS.")), 20_000);
    const fail = (err) => {
      const type = err && typeof err === "object" && "type" in err ? String(err.type) : "";
      if (type === "peer-unavailable") return;
      clearTimeout(timer);
      try { peer.destroy?.(); } catch { /* ignore */ }
      if (type === "unavailable-id") {
        reject(Object.assign(new Error("unavailable-id"), { type: "unavailable-id" }));
        return;
      }
      reject(err instanceof Error ? err : new Error(type || "PeerJS error"));
    };
    peer.on("open", () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on("error", fail);
  });
}

async function startHub(hub) {
  if (!ensureWebRtc()) {
    throw new Error("no-webrtc");
  }
  let keys;
  try {
    keys = await hub.getHub();
  } catch {
    keys = await createHubKeys();
    await hub.saveHub(keys);
  }
  if (!keys?.hubId) {
    keys = await createHubKeys();
    await hub.saveHub(keys);
  }
  const Peer = await waitFor(() => window.Peer, 8_000, "PeerJS failed to load. Check your network.");
  try {
    await listen(Peer, keys.hubId, hub);
    return keys.hubId;
  } catch (err) {
    const type = err && typeof err === "object" && "type" in err ? String(err.type) : "";
    if (type !== "unavailable-id") throw err;
    keys = await createHubKeys();
    await hub.saveHub(keys);
    await listen(Peer, keys.hubId, hub);
    return keys.hubId;
  }
}

function timeoutMs(method) {
  return method === "reportLink" ? 120_000 : 20_000;
}

function createEventBridge() {
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = randomId();
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        document.removeEventListener("lc-hub-res", onEvt);
        domWatch.disconnect();
        if (error) reject(new Error(error));
        else resolve(result);
      };
      const timer = setTimeout(() => finish("Desktop hub bridge did not respond."), timeoutMs(method));
      const onPayload = (data) => {
        if (!data || data.ns !== "lc-hub" || data.kind !== "res" || data.id !== id) return;
        finish(data.error, data.result);
      };
      const onMsg = (event) => {
        if (event.source !== window) return;
        onPayload(event.data);
      };
      const onEvt = (event) => onPayload(event.detail);
      const onDom = (mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!node || node.nodeName !== "SCRIPT") continue;
            const script = node;
            if ((script.type || script.getAttribute("type") || "") !== "application/x-lc-hub-res") continue;
            try {
              onPayload(JSON.parse(node.textContent || "{}"));
            } catch {
              /* ignore */
            }
            node.remove();
          }
        }
      };
      const domWatch = new MutationObserver(onDom);
      window.addEventListener("message", onMsg);
      document.addEventListener("lc-hub-res", onEvt);
      domWatch.observe(document.documentElement, { childList: true });
      const payload = { ns: "lc-hub", kind: "req", id, method, params };
      window.postMessage(payload, "*");
      document.dispatchEvent(new CustomEvent("lc-hub-req", { detail: payload }));
      const node = document.createElement("script");
      node.type = "application/x-lc-hub";
      node.textContent = JSON.stringify(payload);
      document.documentElement.appendChild(node);
    });
  }
  return {
    getHub: () => request("getHub", {}),
    saveHub: (keys) => request("saveHub", keys),
    hubListening: (params) => request("hubListening", params),
    reportLink: (params) => request("reportLink", params),
    deviceAllowed: (params) => request("deviceAllowed", params),
    getProfileBlob: (params) => request("getProfileBlob", params),
    mergeProfileBlob: (params) => request("mergeProfileBlob", params),
  };
}

function createHostBridge() {
  const pending = new Map();
  let nextId = 1;
  const onMessage = (msg) => {
    if (!msg || typeof msg !== "object" || msg.type !== "response") return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (!msg.success) waiter.reject(new Error(msg.error || "RPC failed"));
    else waiter.resolve(msg.payload);
  };
  if (!window.__electrobun) throw new Error("Desktop hub bridge did not load.");
  window.__electrobun.receiveMessageFromHost = onMessage;
  window.__electrobun.receiveMessageFromBun = onMessage;
  const queued = window.__electrobunPendingHostMessages || [];
  window.__electrobunPendingHostMessages = [];
  for (const msg of queued) onMessage(msg);

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Desktop hub bridge did not respond."));
      }, timeoutMs(method));
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      const packet = JSON.stringify({ type: "request", id, method, params });
      const bridge = window.__electrobunHostBridge || window.__electrobunBunBridge;
      if (bridge?.postMessage) {
        bridge.postMessage(packet);
        return;
      }
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error("Desktop hub bridge did not load."));
    });
  }
  return {
    getHub: () => request("getHub", {}),
    saveHub: (keys) => request("saveHub", keys),
    hubListening: (params) => request("hubListening", params),
    reportLink: (params) => request("reportLink", params),
    deviceAllowed: (params) => request("deviceAllowed", params),
    getProfileBlob: (params) => request("getProfileBlob", params),
    mergeProfileBlob: (params) => request("mergeProfileBlob", params),
  };
}

function pingPreload(ms) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      document.removeEventListener("lc-hub-pong", onEvt);
      domWatch.disconnect();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    const onMsg = (event) => {
      if (event.source === window && event.data?.ns === "lc-hub" && event.data.kind === "pong") done(true);
    };
    const onEvt = () => done(true);
    const onDom = (mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node || node.nodeName !== "SCRIPT") continue;
          if ((node.type || node.getAttribute("type") || "") !== "application/x-lc-hub-res") continue;
          node.remove();
          done(true);
        }
      }
    };
    const domWatch = new MutationObserver(onDom);
    window.addEventListener("message", onMsg);
    document.addEventListener("lc-hub-pong", onEvt);
    domWatch.observe(document.documentElement, { childList: true });
    window.postMessage({ ns: "lc-hub", kind: "ping" }, "*");
    document.dispatchEvent(new CustomEvent("lc-hub-ping"));
    const node = document.createElement("script");
    node.type = "application/x-lc-hub-ping";
    document.documentElement.appendChild(node);
  });
}

async function resolveHub() {
  if (hubHttpConfig()) return createHttpBridge();
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (window.localChatHub) return window.localChatHub;
    if (await pingPreload(250)) return createEventBridge();
    if (window.__electrobunHostBridge || window.__electrobunBunBridge) return createHostBridge();
  }
  throw new Error("Desktop hub bridge did not load.");
}

async function report(hub, hubId, error) {
  try {
    await hub.hubListening({ hubId: hubId || "", error: error || "" });
  } catch {
    /* vault window still polls on hubReady */
  }
}

async function boot() {
  status("Starting vault hub…");
  const hub = await resolveHub();
  try {
    const hubId = await startHub(hub);
    await report(hub, hubId, "");
    status("Vault hub is online.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await report(hub, "", message);
    if (message === "no-webrtc" || /does not support WebRTC/i.test(message)) {
      status(
        hubHttpConfig()?.external
          ? "This browser does not support WebRTC."
          : "This app window has no WebRTC. A system browser window should open for the hub.",
      );
      return;
    }
    status(message);
  }
}

boot().catch((err) => {
  status(err instanceof Error ? err.message : String(err));
});
