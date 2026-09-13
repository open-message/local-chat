import { track } from "./analytics.js";
import { CHAT_TEXT_MAX, DEFAULT_CHAT_RETENTION } from "./config.js";
import { isChatRetention } from "./chat.js";
import { isDevicePeerId, verifyDeviceBinding } from "./device.js";
import { publicJwkOnly, randomNonce, signHello, verifyHello } from "./identity.js";
import { shareProfile } from "./profile.js";
import { chatRoomId, isUserPeerId } from "./share.js";
import * as defaultStore from "./store.js";

export const TURN_TIMEOUT_MS = 10_000;

function newTurnId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function localSnapshot(peerId, store = defaultStore) {
  const pair = store.getPair(peerId) || {};
  const me = store.getState().profile || {};
  return {
    meInterested: Boolean(pair.meInterested || store.isInterested(peerId)),
    themInterested: Boolean(pair.themInterested),
    matched: Boolean(pair.matched),
    friend: Boolean(pair.friend || store.isFriend?.(peerId)),
    friendAt: Number(pair.friendAt) || 0,
    myProfileUpdatedAt: me.updatedAt || 0,
    theirProfileUpdatedAt: pair.theirProfileUpdatedAt || 0,
    chatRetention: store.getChatRetention?.(peerId) || DEFAULT_CHAT_RETENTION,
    chatRetentionAt: Number(pair.chatRetentionAt) || 0,
    chatClearedAt: Number(pair.chatClearedAt) || 0,
    chatReadAt: Number(pair.chatReadAt) || 0,
    themChatReadAt: Number(pair.themChatReadAt) || 0,
  };
}

export function healLocalFromRemote(mine, theirs) {
  const meInterested = Boolean(mine.meInterested);
  const themInterested = Boolean(theirs.meInterested);
  const myAt = Number(mine.friendAt) || 0;
  const theirAt = Number(theirs.friendAt) || 0;
  let friend = Boolean(mine.friend);
  let friendAt = myAt;
  if (theirAt > myAt) {
    friend = Boolean(theirs.friend);
    friendAt = theirAt;
  } else if (theirAt === myAt) {
    friend = Boolean(mine.friend || theirs.friend);
  }
  let chatRetention = isChatRetention(mine.chatRetention) ? mine.chatRetention : DEFAULT_CHAT_RETENTION;
  let chatRetentionAt = Number(mine.chatRetentionAt) || 0;
  const theirRetAt = Number(theirs.chatRetentionAt) || 0;
  if (theirRetAt > chatRetentionAt && isChatRetention(theirs.chatRetention)) {
    chatRetention = theirs.chatRetention;
    chatRetentionAt = theirRetAt;
  }
  const chatClearedAt = Math.max(Number(mine.chatClearedAt) || 0, Number(theirs.chatClearedAt) || 0);
  const themChatReadAt = Math.max(Number(mine.themChatReadAt) || 0, Number(theirs.chatReadAt) || 0);
  return {
    ...mine,
    themInterested,
    matched: Boolean(meInterested && themInterested),
    friend,
    friendAt,
    chatRetention,
    chatRetentionAt,
    chatClearedAt,
    themChatReadAt,
  };
}

export function remoteNeedsOurCorrection(mine, theirs) {
  const matched = Boolean(mine.meInterested) && Boolean(theirs.meInterested);
  const myAt = Number(mine.friendAt) || 0;
  const theirAt = Number(theirs.friendAt) || 0;
  const friendNeedsPush =
    myAt > theirAt ||
    (myAt === theirAt && Boolean(mine.friend) !== Boolean(theirs.friend));
  const myRetAt = Number(mine.chatRetentionAt) || 0;
  const theirRetAt = Number(theirs.chatRetentionAt) || 0;
  const chatNeedsPush =
    myRetAt > theirRetAt ||
    (Number(mine.chatClearedAt) || 0) > (Number(theirs.chatClearedAt) || 0);
  return (
    Boolean(theirs.themInterested) !== Boolean(mine.meInterested) ||
    Boolean(theirs.matched) !== matched ||
    friendNeedsPush ||
    chatNeedsPush
  );
}

export function pairViewsAgree(mine, theirs) {
  return (
    Boolean(mine.meInterested) === Boolean(theirs.themInterested) &&
    Boolean(mine.themInterested) === Boolean(theirs.meInterested) &&
    Boolean(mine.matched) === Boolean(theirs.matched) &&
    Boolean(mine.friend) === Boolean(theirs.friend)
  );
}

export class PairNet {
  constructor({
    roomNet,
    store,
    onMatch,
    onChange,
    onTurnFailed,
    timeoutMs = TURN_TIMEOUT_MS,
  } = {}) {
    this.roomNet = roomNet;
    this.store = store || defaultStore;
    this.onMatch = onMatch;
    this.onChange = onChange;
    this.onTurnFailed = onTurnFailed;
    this.timeoutMs = timeoutMs;
    this.conns = new Map();
    this.pending = new Map();
    this.inbound = new Map();
    this.matchNotified = new Set();
    this.profiles = new Map();
    this.typing = new Map();
    this.typingExpire = new Map();
    this.outboundTyping = new Map();
    this.outboundIdle = new Map();
    this.sentReadAt = new Map();
    this.handshakes = new Map();
    this.identityOf = new Map();
    this.devicesOf = new Map();
  }

  attachIncoming(conn) {
    this.bind(conn);
  }

  isPending(peerId) {
    return this.pending.has(peerId);
  }

  isConnected(peerId) {
    for (const connId of this.devicesOf.get(peerId) || []) {
      if (this.conns.get(connId)?.open) return true;
    }
    return Boolean(this.conns.get(peerId)?.open);
  }

  snapshot(peerId) {
    return localSnapshot(peerId, this.store);
  }

  identityIdFor(connId) {
    return this.identityOf.get(connId)
      || (isUserPeerId(connId) ? connId : "")
      || "";
  }

  rememberConn(connId, identityId) {
    if (!connId || !identityId) return;
    this.identityOf.set(connId, identityId);
    const set = this.devicesOf.get(identityId) || new Set();
    set.add(connId);
    this.devicesOf.set(identityId, set);
    this.store.rememberPeerDevice?.(identityId, connId);
  }

  forgetConn(connId) {
    const identityId = this.identityOf.get(connId);
    this.identityOf.delete(connId);
    if (!identityId) return;
    const set = this.devicesOf.get(identityId);
    if (!set) return;
    set.delete(connId);
    if (!set.size) this.devicesOf.delete(identityId);
  }

  targetDeviceIds(identityId) {
    const ids = new Set();
    for (const id of this.devicesOf.get(identityId) || []) ids.add(id);
    for (const id of this.roomNet?.deviceIdsFor?.(identityId) || []) ids.add(id);
    for (const id of this.store.deviceIdsForPeer?.(identityId) || []) ids.add(id);
    if (isUserPeerId(identityId)) ids.add(identityId);
    const me = this.store.getState().peerId;
    const myDevice = this.store.getDeviceId?.();
    ids.delete(me);
    if (myDevice) ids.delete(myDevice);
    return [...ids].filter(Boolean);
  }

  bind(conn) {
    const connId = conn.peer;
    this.conns.set(connId, conn);
    if (!this.handshakes.has(connId)) {
      this.handshakes.set(connId, {
        nonce: randomNonce(),
        verified: false,
        queue: [],
        identityId: isUserPeerId(connId) ? connId : "",
      });
    }
    conn.on("data", (msg) => this.onMessage(connId, msg));
    conn.on("open", () => this.startHandshake(connId, conn));
    conn.on("close", () => {
      if (this.conns.get(connId) !== conn) return;
      const identityId = this.identityIdFor(connId);
      this.conns.delete(connId);
      this.handshakes.delete(connId);
      this.forgetConn(connId);
      if (identityId && this.pending.has(identityId) && !this.isConnected(identityId)) {
        this.failTurn(identityId, "Connection closed before they could save.");
      }
      if (identityId) this.clearPeerTyping(identityId);
      this.onChange?.(identityId || connId, "conn");
    });
    conn.on?.("error", () => {
      const identityId = this.identityIdFor(connId);
      if (identityId && this.pending.has(identityId)) this.failTurn(identityId, "Connection failed before they could save.");
    });
    if (conn.open) this.startHandshake(connId, conn);
  }

  pinnedKey(peerId) {
    return this.store.pinnedPublicKey?.(peerId)
      || publicJwkOnly(this.roomNet?.people?.get(peerId)?.publicKey)
      || publicJwkOnly(this.handshakes.get(peerId)?.publicKey);
  }

  async deviceBinding() {
    return this.store.devicePresence?.() || null;
  }

  async startHandshake(connId, conn) {
    const hs = this.handshakes.get(connId);
    if (!hs || hs.verified || !conn?.open) return;
    const device = await this.deviceBinding();
    const hello = await signHello(this.store.getIdentity(), {
      nonce: hs.nonce,
      theirNonce: hs.theirNonce || "",
      device: device ? { deviceId: device.deviceId, publicKey: device.publicKey, binding: device.binding } : null,
    });
    if (this.conns.get(connId) !== conn || !conn.open) return;
    conn.send(hello);
  }

  rejectPeer(connId, message) {
    const identityId = this.identityIdFor(connId);
    if (identityId && this.pending.has(identityId)) this.failTurn(identityId, message);
    const conn = this.conns.get(connId);
    this.handshakes.delete(connId);
    this.conns.delete(connId);
    this.forgetConn(connId);
    try { conn?.close(); } catch { /* ignore */ }
  }

  markVerified(connId, publicKey, identityId) {
    const hs = this.handshakes.get(connId);
    if (!hs || hs.verified) return;
    hs.publicKey = publicJwkOnly(publicKey);
    hs.identityId = identityId;
    this.rememberConn(connId, identityId);
    if (this.store.pinPeerPublicKey && !this.store.pinPeerPublicKey(identityId, hs.publicKey)) {
      this.rejectPeer(connId, "Identity could not be verified.");
      return;
    }
    hs.verified = true;
    const conn = this.conns.get(connId);
    const queued = hs.queue.splice(0);
    for (const msg of queued) {
      if (conn?.open) conn.send(msg);
    }
    this.sendSync(identityId);
    this.sendChatRead(identityId);
    this.onChange?.(identityId, "conn");
  }

  async onIdHello(connId, msg) {
    const conn = this.conns.get(connId);
    const hs = this.handshakes.get(connId);
    if (!conn || !hs) return;
    const identityId = msg.peerId;
    const expectedPeerId = hs.identityId || (isUserPeerId(connId) ? connId : "");
    const ok = await verifyHello(msg, {
      expectedPeerId: expectedPeerId || undefined,
      pinnedPublicKey: this.pinnedKey(identityId),
      ourNonce: msg.theirNonce ? hs.nonce : "",
    });
    if (!ok) {
      this.rejectPeer(connId, "Identity could not be verified.");
      return;
    }
    if (msg.deviceId && isDevicePeerId(connId) && String(msg.deviceId) !== String(connId)) {
      this.rejectPeer(connId, "Identity could not be verified.");
      return;
    }
    if (msg.deviceId && msg.deviceBinding) {
      const bound = await verifyDeviceBinding(msg, {
        expectedPeerId: identityId,
        expectedDeviceId: isDevicePeerId(connId) ? connId : msg.deviceId,
        identityPublicKey: msg.publicKey,
      });
      if (!bound) {
        this.rejectPeer(connId, "Identity could not be verified.");
        return;
      }
    }
    hs.theirNonce = msg.nonce;
    hs.publicKey = publicJwkOnly(msg.publicKey);
    hs.identityId = identityId;
    this.rememberConn(connId, identityId);
    if (!hs.verified) {
      const device = await this.deviceBinding();
      const hello = await signHello(this.store.getIdentity(), {
        nonce: hs.nonce,
        theirNonce: msg.nonce,
        device: device ? { deviceId: device.deviceId, publicKey: device.publicKey, binding: device.binding } : null,
      });
      if (this.conns.get(connId) === conn && conn.open) conn.send(hello);
    }
    if (msg.theirNonce) this.markVerified(connId, hs.publicKey, identityId);
  }

  retainPeers(peerIds) {
    const keep = new Set(peerIds || []);
    for (const [connId, conn] of this.conns) {
      const identityId = this.identityIdFor(connId);
      if (keep.has(identityId) || keep.has(connId)) continue;
      conn.close();
      this.conns.delete(connId);
      this.handshakes.delete(connId);
      this.forgetConn(connId);
    }
  }

  ensureDevice(connId, identityId) {
    if (!connId) return null;
    const existing = this.conns.get(connId);
    if (existing) {
      if (identityId) this.rememberConn(connId, identityId);
      return existing;
    }
    const conn = this.roomNet?.connectPeer(connId);
    if (!conn) return null;
    if (identityId) {
      this.handshakes.set(connId, {
        nonce: randomNonce(),
        verified: false,
        queue: [],
        identityId,
      });
      this.rememberConn(connId, identityId);
    }
    this.bind(conn);
    return conn;
  }

  ensure(peerId) {
    let any = null;
    for (const connId of this.targetDeviceIds(peerId)) {
      const conn = this.ensureDevice(connId, peerId);
      if (conn) any = any || conn;
    }
    return any;
  }

  sendTo(connId, msg) {
    const conn = this.conns.get(connId);
    if (!conn) return false;
    const hs = this.handshakes.get(connId);
    if (msg?.type !== "id-hello" && hs && !hs.verified) {
      hs.queue.push(msg);
      return true;
    }
    if (conn.open) {
      conn.send(msg);
      return true;
    }
    conn.once?.("open", () => conn.send(msg));
    return true;
  }

  send(peerId, msg) {
    this.ensure(peerId);
    const connIds = [...(this.devicesOf.get(peerId) || [])];
    if (this.conns.has(peerId) && !connIds.includes(peerId)) connIds.push(peerId);
    if (!connIds.length) return false;
    let ok = false;
    for (const connId of connIds) {
      if (this.sendTo(connId, msg)) ok = true;
    }
    return ok;
  }

  sendSync(peerId, conn = null) {
    if (conn?.open) {
      const connId = conn.peer;
      if (!this.handshakes.get(connId)?.verified) return;
      if (this.pending.has(peerId) || this.inbound.has(peerId)) return;
      conn.send({ type: "sync", snapshot: this.snapshot(peerId) });
      return;
    }
    if (this.pending.has(peerId) || this.inbound.has(peerId)) return;
    this.send(peerId, { type: "sync", snapshot: this.snapshot(peerId) });
  }

  proposeInterest(peerId, value) {
    const wanted = Boolean(value);
    if (this.pending.has(peerId)) return;
    if (Boolean(this.store.isInterested(peerId)) === wanted) return;

    const applied = this.store.tryApplyPair(peerId, { meInterested: wanted });
    if (!applied.ok) {
      this.onTurnFailed?.(peerId, {
        message: "Could not save on this device. Your interest was not changed.",
        reverted: true,
      });
      this.onChange?.(peerId);
      return;
    }

    const turnId = newTurnId();
    this.pending.set(peerId, { turnId, prev: applied.prev, value: wanted, timer: null });

    const conn = this.ensure(peerId);
    if (!conn) {
      this.pending.delete(peerId);
      this.store.revertMyInterest(peerId, applied.prev);
      this.onTurnFailed?.(peerId, {
        message: "Could not reach them to save this update. Your interest was reverted.",
        reverted: true,
      });
      this.onChange?.(peerId);
      return;
    }

    const rec = this.pending.get(peerId);
    rec.timer = setTimeout(() => {
      this.failTurn(peerId, "They did not confirm the save in time. Your interest was reverted.");
    }, this.timeoutMs);
    this.send(peerId, { type: "turn-propose", turnId, action: { type: "interested", value: wanted } });
    this.onChange?.(peerId);
  }

  failTurn(peerId, message) {
    const pending = this.pending.get(peerId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(peerId);
    this.store.revertMyInterest(peerId, pending.prev);
    this.send(peerId, { type: "turn-abort", turnId: pending.turnId });
    this.onTurnFailed?.(peerId, { message, reverted: true });
    this.onChange?.(peerId);
  }

  commitTurn(peerId) {
    const pending = this.pending.get(peerId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(peerId);
    this.send(peerId, { type: "turn-commit", turnId: pending.turnId });
    if (pending.value) track("interested");
    this.maybeCompleteMatch(peerId);
    this.onChange?.(peerId);
  }

  onMessage(connId, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "id-hello") {
      this.onIdHello(connId, msg);
      return;
    }
    const peerId = this.identityIdFor(connId);
    if (!peerId || !this.handshakes.get(connId)?.verified) return;
    if (msg.type === "sync" && msg.snapshot) this.healFromRemote(peerId, msg.snapshot);
    else if (msg.type === "turn-propose") this.onTurnPropose(peerId, msg);
    else if (msg.type === "turn-vote") this.onTurnVote(peerId, msg);
    else if (msg.type === "turn-commit") this.onTurnCommit(peerId, msg);
    else if (msg.type === "turn-abort") this.onTurnAbort(peerId, msg);
    else if (msg.type === "match-reveal") this.onMatchReveal(peerId, msg);
    else if (msg.type === "friend") this.onFriend(peerId, msg);
    else if (msg.type === "profile-request") this.onProfileRequest(peerId);
    else if (msg.type === "profile") this.onProfile(peerId, msg);
    else if (msg.type === "chat") this.onChat(peerId, msg);
    else if (msg.type === "chat-policy") this.onChatPolicy(peerId, msg);
    else if (msg.type === "chat-clear") this.onChatClear(peerId, msg);
    else if (msg.type === "chat-read") this.onChatRead(peerId, msg);
    else if (msg.type === "chat-typing") this.onTyping(peerId, msg);
  }

  liveProfile(peerId) {
    return this.roomNet?.people?.get(peerId) || this.profiles.get(peerId) || null;
  }

  rememberedProfile(peerId) {
    return this.liveProfile(peerId) || this.store.getFriend(peerId) || this.profiles.get(peerId) || null;
  }

  audienceFor(peerId) {
    const pair = this.store.getPair(peerId) || {};
    if (this.store.isFriend(peerId) || pair.friend) return "friends";
    if (pair.matched || (pair.meInterested && pair.themInterested)) return "connections";
    return "public";
  }

  myShareProfile(peerId) {
    const { peerId: me, profile } = this.store.getState();
    return {
      ...shareProfile(profile, me, this.audienceFor(peerId)),
      publicKey: publicJwkOnly(this.store.getIdentity?.()?.publicKey),
    };
  }

  pushProfiles() {
    for (const peerId of this.devicesOf.keys()) {
      this.send(peerId, { type: "profile", profile: this.myShareProfile(peerId) });
    }
  }

  requestProfile(peerId) {
    if (!peerId || peerId === this.store.getState().peerId) return;
    this.send(peerId, { type: "profile-request" });
    this.send(peerId, { type: "profile", profile: this.myShareProfile(peerId) });
  }

  onProfileRequest(peerId) {
    this.send(peerId, { type: "profile", profile: this.myShareProfile(peerId) });
  }

  onProfile(peerId, msg) {
    const profile = { ...(msg.profile || {}), peerId };
    if (msg.profile?.handle) profile.handle = msg.profile.handle;
    this.profiles.set(peerId, profile);
    if (this.store.isFriend(peerId)) this.store.updateFriend(profile);
    this.onChange?.(peerId, "profile");
  }

  async sendChat(peerId, text) {
    const trimmed = String(text || "").trim().slice(0, CHAT_TEXT_MAX);
    if (!trimmed) return;
    this.setTyping(peerId, false);
    const me = this.store.getState().peerId;
    const roomId = await chatRoomId(me, peerId);
    const msg = {
      type: "chat",
      roomId,
      id: newTurnId(),
      text: trimmed,
      at: Date.now(),
    };
    this.store.rememberChatRoom?.(peerId, roomId);
    this.store.appendChat(roomId, {
      id: msg.id,
      from: me,
      text: msg.text,
      at: msg.at,
    }, { peerId });
    this.send(peerId, msg);
    this.onChange?.(peerId, "chat");
  }

  async onChat(peerId, msg) {
    const text = String(msg.text || "").trim().slice(0, CHAT_TEXT_MAX);
    if (!text || !msg.id) return;
    this.clearPeerTyping(peerId, { silent: true });
    const me = this.store.getState().peerId;
    const roomId = await chatRoomId(me, peerId);
    if (msg.roomId && msg.roomId !== roomId) return;
    this.store.rememberChatRoom?.(peerId, roomId);
    this.store.appendChat(roomId, {
      id: String(msg.id),
      from: peerId,
      text,
      at: Number(msg.at) || Date.now(),
    }, { peerId });
    this.onChange?.(peerId, "chat");
  }

  sendChatRead(peerId) {
    if (!peerId) return;
    const at = Number(this.store.getPair(peerId)?.chatReadAt) || 0;
    if (!at) return;
    const last = this.sentReadAt.get(peerId) || 0;
    if (at <= last) return;
    this.sentReadAt.set(peerId, at);
    this.send(peerId, { type: "chat-read", at });
  }

  onChatRead(peerId, msg) {
    const at = Number(msg.at) || 0;
    if (!at) return;
    if (!this.store.setThemChatReadAt(peerId, at)) return;
    this.onChange?.(peerId, "chat-read");
  }

  isTyping(peerId) {
    return Boolean(this.typing.get(peerId));
  }

  setTyping(peerId, typing) {
    if (!peerId) return;
    const on = Boolean(typing);
    const was = Boolean(this.outboundTyping.get(peerId));
    const idle = this.outboundIdle.get(peerId);
    if (idle) clearTimeout(idle);
    if (!on) {
      this.outboundIdle.delete(peerId);
      if (!was) return;
      this.outboundTyping.set(peerId, false);
      this.send(peerId, { type: "chat-typing", typing: false });
      return;
    }
    if (!was) {
      this.outboundTyping.set(peerId, true);
      this.send(peerId, { type: "chat-typing", typing: true });
    }
    this.outboundIdle.set(peerId, setTimeout(() => {
      this.outboundTyping.set(peerId, false);
      this.outboundIdle.delete(peerId);
      this.send(peerId, { type: "chat-typing", typing: false });
    }, 1600));
  }

  onTyping(peerId, msg) {
    const on = Boolean(msg.typing);
    const expire = this.typingExpire.get(peerId);
    if (expire) clearTimeout(expire);
    this.typing.set(peerId, on);
    if (on) {
      this.typingExpire.set(peerId, setTimeout(() => {
        this.typing.set(peerId, false);
        this.typingExpire.delete(peerId);
        this.onChange?.(peerId, "chat-typing");
      }, 3000));
    } else {
      this.typingExpire.delete(peerId);
    }
    this.onChange?.(peerId, "chat-typing");
  }

  clearPeerTyping(peerId, { silent } = {}) {
    const expire = this.typingExpire.get(peerId);
    if (expire) clearTimeout(expire);
    this.typingExpire.delete(peerId);
    const was = Boolean(this.typing.get(peerId));
    this.typing.set(peerId, false);
    if (was && !silent) this.onChange?.(peerId, "chat-typing");
  }

  async pairRoomId(peerId) {
    const me = this.store.getState().peerId;
    const roomId = await chatRoomId(me, peerId);
    this.store.rememberChatRoom?.(peerId, roomId);
    return roomId;
  }

  async setChatRetention(peerId, retention) {
    if (!peerId || !isChatRetention(retention)) return;
    const at = Date.now();
    this.store.setChatRetention(peerId, retention, { retentionAt: at });
    const roomId = await this.pairRoomId(peerId);
    this.send(peerId, { type: "chat-policy", roomId, retention, at });
    this.onChange?.(peerId, "chat-policy");
  }

  async onChatPolicy(peerId, msg) {
    const roomId = await this.pairRoomId(peerId);
    if (msg.roomId && msg.roomId !== roomId) return;
    const mine = this.snapshot(peerId);
    const incomingAt = Number(msg.at) || 0;
    this.store.setChatRetention(peerId, msg.retention, { retentionAt: incomingAt });
    if ((mine.chatRetentionAt || 0) > incomingAt) {
      this.send(peerId, {
        type: "chat-policy",
        roomId,
        retention: this.store.getChatRetention(peerId),
        at: mine.chatRetentionAt,
      });
    }
    this.onChange?.(peerId, "chat-policy");
  }

  async clearChat(peerId) {
    if (!peerId) return;
    const roomId = await this.pairRoomId(peerId);
    const at = Date.now();
    this.store.clearChat(peerId, { roomId, clearedAt: at });
    this.send(peerId, { type: "chat-clear", roomId, at });
    this.onChange?.(peerId, "chat-clear");
  }

  async onChatClear(peerId, msg) {
    const roomId = await this.pairRoomId(peerId);
    if (msg.roomId && msg.roomId !== roomId) return;
    const mineAt = Number(this.store.getChatClearedAt?.(peerId)) || 0;
    const incomingAt = Number(msg.at) || Date.now();
    this.store.clearChat(peerId, { roomId, clearedAt: incomingAt });
    if (mineAt > incomingAt) this.send(peerId, { type: "chat-clear", roomId, at: mineAt });
    this.onChange?.(peerId, "chat-clear");
  }

  proposeFriend(peerId, value, profile) {
    const wanted = Boolean(value);
    if (Boolean(this.store.isFriend(peerId)) === wanted) return;
    const friendAt = this.store.nextFriendAt(peerId);
    if (wanted) {
      this.store.addFriend({ ...profile, peerId }, { friendAt });
    } else {
      this.store.removeFriend(peerId, { friendAt });
    }
    const share = this.myShareProfile(peerId);
    this.send(peerId, {
      type: "friend",
      friend: wanted,
      friendAt,
      handle: share.handle || "",
      profile: share,
    });
    this.onChange?.(peerId);
  }

  onFriend(peerId, msg) {
    const incomingAt = Number(msg.friendAt) || 0;
    const mine = this.snapshot(peerId);
    if (incomingAt < (mine.friendAt || 0)) {
      const share = this.myShareProfile(peerId);
      this.send(peerId, {
        type: "friend",
        friend: Boolean(mine.friend),
        friendAt: mine.friendAt,
        handle: share.handle || "",
        profile: share,
      });
      return;
    }
    this.applyFriendState(peerId, {
      friend: Boolean(msg.friend),
      friendAt: incomingAt,
      profile: msg.profile,
      handle: msg.handle,
    });
    if (msg.profile) this.profiles.set(peerId, { ...msg.profile, peerId, handle: msg.handle || msg.profile.handle || "" });
    this.onChange?.(peerId);
  }

  applyFriendState(peerId, { friend, friendAt, profile, handle }) {
    if (friend) {
      const live = this.liveProfile(peerId);
      const existing = this.store.getFriend(peerId);
      const pair = this.store.getPair(peerId) || {};
      this.store.addFriend({
        ...(existing || {}),
        ...(live || {}),
        ...(profile || {}),
        peerId,
        handle: handle || pair.handle || existing?.handle || live?.handle || "",
      }, { friendAt });
    } else {
      this.store.removeFriend(peerId, { friendAt });
    }
  }

  onTurnPropose(peerId, msg) {
    const value = Boolean(msg.action?.value);
    const existing = this.inbound.get(peerId);
    if (existing?.turnId === msg.turnId) {
      this.send(peerId, { type: "turn-vote", turnId: msg.turnId, ok: true });
      return;
    }
    const applied = this.store.tryApplyPair(peerId, { themInterested: value });
    if (!applied.ok) {
      this.send(peerId, {
        type: "turn-vote",
        turnId: msg.turnId,
        ok: false,
        error: "save-failed",
      });
      return;
    }
    this.inbound.set(peerId, { turnId: msg.turnId, prev: applied.prev });
    this.send(peerId, { type: "turn-vote", turnId: msg.turnId, ok: true });
    this.onChange?.(peerId);
  }

  onTurnVote(peerId, msg) {
    const pending = this.pending.get(peerId);
    if (!pending || pending.turnId !== msg.turnId) {
      if (msg.ok) this.send(peerId, { type: "turn-abort", turnId: msg.turnId });
      return;
    }
    if (!msg.ok) {
      this.failTurn(peerId, "They could not save this update. Your interest was reverted.");
      return;
    }
    this.commitTurn(peerId);
  }

  onTurnCommit(peerId, msg) {
    const inbound = this.inbound.get(peerId);
    if (!inbound || inbound.turnId !== msg.turnId) return;
    this.inbound.delete(peerId);
    this.maybeCompleteMatch(peerId);
    this.onChange?.(peerId);
  }

  onTurnAbort(peerId, msg) {
    const inbound = this.inbound.get(peerId);
    if (!inbound || inbound.turnId !== msg.turnId) return;
    this.inbound.delete(peerId);
    this.store.revertThemInterest(peerId, inbound.prev);
    this.onChange?.(peerId);
  }

  onMatchReveal(peerId, msg) {
    const mine = this.snapshot(peerId);
    const patch = {};
    if (mine.meInterested && msg.handle) patch.handle = msg.handle;
    let changed = false;
    if (Object.keys(patch).length) {
      const applied = this.store.tryApplyPair(peerId, patch);
      changed = Boolean(applied.ok);
    }
    this.maybeCompleteMatch(peerId);
    if (changed) this.onChange?.(peerId);
  }

  healFromRemote(peerId, theirs) {
    if (this.pending.has(peerId) || this.inbound.has(peerId)) return;
    const mine = this.snapshot(peerId);
    const healed = healLocalFromRemote(mine, theirs);
    if ((theirs.myProfileUpdatedAt || 0) > (healed.theirProfileUpdatedAt || 0)) {
      healed.theirProfileUpdatedAt = theirs.myProfileUpdatedAt;
    }
    const changed =
      healed.themInterested !== mine.themInterested ||
      healed.matched !== mine.matched ||
      healed.theirProfileUpdatedAt !== mine.theirProfileUpdatedAt;
    if (changed) {
      const applied = this.store.tryApplyPair(peerId, {
        themInterested: healed.themInterested,
        meInterested: healed.meInterested,
        matched: healed.matched,
        theirProfileUpdatedAt: healed.theirProfileUpdatedAt,
      });
      if (!applied.ok) return;
    }
    const friendChanged =
      Boolean(healed.friend) !== Boolean(mine.friend) ||
      (healed.friendAt || 0) !== (mine.friendAt || 0);
    if (friendChanged) {
      this.applyFriendState(peerId, {
        friend: healed.friend,
        friendAt: healed.friendAt,
        handle: this.store.getPair(peerId)?.handle,
      });
    }
    const chatChanged =
      healed.chatRetention !== mine.chatRetention ||
      (healed.chatRetentionAt || 0) !== (mine.chatRetentionAt || 0) ||
      (healed.chatClearedAt || 0) !== (mine.chatClearedAt || 0);
    if (chatChanged) {
      this.store.tryApplyPair(peerId, {
        chatRetention: healed.chatRetention,
        chatRetentionAt: healed.chatRetentionAt,
        chatClearedAt: healed.chatClearedAt,
      });
      const roomId = this.store.getChatRoom?.(peerId);
      if (roomId) this.store.pruneChat(roomId);
      else {
        this.pairRoomId(peerId).then((id) => {
          this.store.pruneChat(id);
          this.onChange?.(peerId, "chat-policy");
        });
      }
    }
    const readChanged = (healed.themChatReadAt || 0) !== (mine.themChatReadAt || 0);
    if (readChanged) this.store.setThemChatReadAt(peerId, healed.themChatReadAt);
    if (remoteNeedsOurCorrection(healed, theirs)) this.sendSync(peerId);
    this.maybeCompleteMatch(peerId);
    if (readChanged && !changed && !friendChanged && !chatChanged) {
      this.onChange?.(peerId, "chat-read");
      return;
    }
    if (changed || friendChanged || chatChanged) this.onChange?.(peerId, chatChanged && !changed && !friendChanged ? "chat-policy" : undefined);
  }

  syncOutgoingInterest(peerIds) {
    for (const peerId of peerIds || []) {
      if (this.store.isInterested(peerId) || this.store.isFriend(peerId) || this.profiles.has(peerId)) this.ensure(peerId);
    }
  }

  maybeCompleteMatch(peerId) {
    const snap = this.snapshot(peerId);
    if (!snap.meInterested || !snap.themInterested) {
      this.matchNotified.delete(peerId);
      return;
    }
    const first = !this.matchNotified.has(peerId);
    this.notifyMatch(peerId);
    if (first) {
      const share = this.myShareProfile(peerId);
      this.send(peerId, { type: "match-reveal", handle: share.handle || "" });
      this.send(peerId, { type: "profile", profile: share });
    }
  }

  notifyMatch(peerId) {
    if (this.matchNotified.has(peerId)) return;
    this.matchNotified.add(peerId);
    const pair = this.store.getPair(peerId) || {};
    if (pair.matchCelebrated) return;
    this.store.tryApplyPair(peerId, { matchCelebrated: true });
    track("match");
    this.onMatch?.(peerId);
  }
}
