import { HEARTBEAT_MS, PEER_TIMEOUT_MS } from "./config.js";
import { presenceDeviceId, verifyDeviceBinding } from "./device.js";
import { publicJwkOnly, samePublicKey, signProfileProof, verifyProfileProof } from "./identity.js";
import { publicProfile } from "./profile.js";
import {
  devicePresence,
  getDeviceId,
  getIdentity,
  getState,
  isPrimaryDevice,
} from "./store.js";
import { isUserPeerId } from "./share.js";

const PEER_OPTS = { debug: 0 };
const CLIENT_STAGGER_MS = 200;
const CLIENT_RETRY_MIN_MS = 8_000;
const CLIENT_RETRY_SPAN_MS = 7_000;
const CLIENT_HUNG_MS = 8_000;

function waitOpen(peer, { timeoutMs = 15_000, allowBusy = false } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      peer.off("open", onOpen);
      peer.off("error", onFail);
      reject(new Error("PeerJS cloud did not respond."));
    }, timeoutMs);
    const onOpen = (id) => {
      clearTimeout(timer);
      peer.off("open", onOpen);
      peer.off("error", onFail);
      resolve(id);
    };
    const onFail = (err) => {
      if (allowBusy && err?.type === "unavailable-id") {
        clearTimeout(timer);
        peer.off("open", onOpen);
        peer.off("error", onFail);
        resolve(null);
        return;
      }
      clearTimeout(timer);
      peer.off("open", onOpen);
      peer.off("error", onFail);
      reject(err);
    };
    peer.on("open", onOpen);
    peer.on("error", onFail);
  });
}

export class RoomNet {
  constructor({ onRoster, onStatus, onPairConnection }) {
    this.onRoster = onRoster;
    this.onStatus = onStatus;
    this.onPairConnection = onPairConnection;
    this.mainPeer = null;
    this.aliasPeer = null;
    this.hosts = new Map();
    this.clients = new Map();
    this.people = new Map();
    this.devices = new Map();
    this.rooms = [];
    this.timers = [];
    this.stopped = false;
    this.reclaiming = new Set();
    this.discovery = false;
  }

  status(text) {
    this.onStatus?.(text);
  }

  myPublic() {
    const { peerId, profile } = getState();
    return publicProfile(profile, peerId);
  }

  async myPresence() {
    const profile = this.myPublic();
    const proof = await signProfileProof(getIdentity(), profile);
    const device = await devicePresence();
    return {
      profile,
      ...proof,
      deviceId: device?.deviceId || getDeviceId() || getState().peerId,
      devicePublicKey: device?.publicKey || null,
      deviceBinding: device?.binding || null,
    };
  }

  emitRoster() {
    this.onRoster?.([...this.people.values()]);
  }

  attachPair(peer) {
    if (!peer) return;
    peer.on("connection", (conn) => this.onPairConnection?.(conn));
  }

  upsertPerson(profile, fromRoom, deviceId) {
    if (!this.discovery) return;
    if (!profile?.peerId || profile.peerId === getState().peerId) return;
    const prev = this.people.get(profile.peerId) || { rooms: new Set(), deviceIds: new Set() };
    const incomingKey = publicJwkOnly(profile.publicKey);
    if (prev.publicKey && incomingKey && !samePublicKey(prev.publicKey, incomingKey)) return;
    const rooms = prev.rooms instanceof Set ? prev.rooms : new Set();
    if (fromRoom) rooms.add(fromRoom);
    const deviceIds = prev.deviceIds instanceof Set ? prev.deviceIds : new Set(prev.deviceIds || []);
    if (deviceId) deviceIds.add(deviceId);
    this.people.set(profile.peerId, {
      ...prev,
      ...profile,
      publicKey: publicJwkOnly(prev.publicKey) || publicJwkOnly(profile.publicKey),
      rooms,
      deviceIds,
      lastSeen: Date.now(),
    });
    if (deviceId) {
      const rec = this.devices.get(deviceId) || { rooms: new Set() };
      const deviceRooms = rec.rooms instanceof Set ? rec.rooms : new Set();
      if (fromRoom) deviceRooms.add(fromRoom);
      this.devices.set(deviceId, { peerId: profile.peerId, rooms: deviceRooms, lastSeen: Date.now() });
    }
    this.emitRoster();
  }

  async acceptPresence(msg, fromRoom, connPeer = "") {
    const profile = msg?.profile;
    if (!profile?.peerId) return false;
    const prev = this.people.get(profile.peerId);
    const ok = await verifyProfileProof(profile, msg, { pinnedPublicKey: prev?.publicKey });
    if (!ok) return false;
    const deviceId = presenceDeviceId(msg, connPeer);
    if (msg.deviceId && msg.deviceBinding) {
      const bound = await verifyDeviceBinding(msg, {
        expectedPeerId: profile.peerId,
        expectedDeviceId: msg.deviceId,
        identityPublicKey: msg.publicKey,
      });
      if (!bound) return false;
    }
    this.upsertPerson({ ...profile, publicKey: publicJwkOnly(msg.publicKey) }, fromRoom, deviceId);
    return true;
  }

  dropDevice(deviceId, fromRoom) {
    if (!deviceId) return;
    const rec = this.devices.get(deviceId);
    if (rec) {
      if (fromRoom && rec.rooms instanceof Set) rec.rooms.delete(fromRoom);
      if (!fromRoom || !rec.rooms || rec.rooms.size === 0) this.devices.delete(deviceId);
    }
    const peerId = rec?.peerId;
    if (!peerId) return;
    const person = this.people.get(peerId);
    if (!person) return;
    if (person.deviceIds instanceof Set) person.deviceIds.delete(deviceId);
    const still = [...(this.devices.values())].some((d) => d.peerId === peerId);
    if (!still) this.dropPerson(peerId, fromRoom);
    else this.emitRoster();
  }

  dropPerson(peerId, fromRoom) {
    const prev = this.people.get(peerId);
    if (!prev) return;
    if (fromRoom && prev.rooms instanceof Set) prev.rooms.delete(fromRoom);
    if (!fromRoom || !prev.rooms || prev.rooms.size === 0) {
      this.people.delete(peerId);
      for (const [id, rec] of [...this.devices]) {
        if (rec.peerId === peerId) this.devices.delete(id);
      }
    }
    this.emitRoster();
  }

  async start(rooms, { discovery = true } = {}) {
    this.stopped = false;
    this.rooms = rooms || [];
    this.discovery = false;
    if (!window.Peer) throw new Error("PeerJS failed to load. Check your network.");
    const connId = getDeviceId() || getState().peerId;
    this.status("Connecting…");
    this.mainPeer = new window.Peer(connId, PEER_OPTS);
    this.attachPair(this.mainPeer);
    this.mainPeer.on("disconnected", () => {
      if (!this.stopped) this.mainPeer.reconnect();
    });
    this.mainPeer.on("error", (err) => {
      if (err?.type === "peer-unavailable") return;
      if (err?.type === "unavailable-id") {
        this.status("This device id is already open in another tab.");
        return;
      }
      const msg = String(err?.message || "").trim();
      if (msg) this.status(msg);
    });
    await waitOpen(this.mainPeer);
    if (isPrimaryDevice() && isUserPeerId(getState().peerId) && getState().peerId !== connId) {
      this.aliasPeer = new window.Peer(getState().peerId, PEER_OPTS);
      this.attachPair(this.aliasPeer);
      this.aliasPeer.on("error", (err) => {
        if (err?.type === "unavailable-id" || err?.type === "peer-unavailable") return;
      });
      const aliasId = await waitOpen(this.aliasPeer, { allowBusy: true }).catch(() => null);
      if (!aliasId) {
        try { this.aliasPeer.destroy(); } catch { /* ignore */ }
        this.aliasPeer = null;
      }
    }
    this.timers.push(setInterval(() => this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => this.sweep(), 5_000));
    if (discovery) this.joinDiscovery(this.rooms);
    else this.status("Offline — friends only");
  }

  joinDiscovery(rooms = this.rooms) {
    if (this.stopped || !this.mainPeer) return;
    this.rooms = rooms || this.rooms || [];
    const already = this.discovery;
    this.discovery = true;
    let stagger = 0;
    let started = 0;
    for (const room of this.rooms) {
      if (this.hosts.has(room.roomId)) continue;
      if (this.clients.get(room.roomId)?.conn?.open) continue;
      started += 1;
      if (room.role === "client") {
        this.joinAsClient(room, { delay: stagger });
        stagger += CLIENT_STAGGER_MS;
      } else {
        this.tryHost(room);
      }
    }
    if (!already || started) this.status("Online in nearby ZIP rooms");
  }

  dropRoomPeople(roomId) {
    for (const peerId of [...this.people.keys()]) this.dropPerson(peerId, roomId);
  }

  leaveRoom(roomId) {
    this.reclaiming.delete(roomId);
    const host = this.hosts.get(roomId);
    if (host) {
      host.peer?.destroy();
      this.hosts.delete(roomId);
    }
    const client = this.clients.get(roomId);
    if (client) {
      client.conn?.close();
      this.clients.delete(roomId);
    }
    this.dropRoomPeople(roomId);
  }

  syncRooms(rooms) {
    const next = rooms || [];
    const wanted = new Map(next.map((room) => [room.roomId, room]));
    for (const id of [...this.hosts.keys()]) {
      if (!wanted.has(id)) this.leaveRoom(id);
    }
    for (const id of [...this.clients.keys()]) {
      if (!wanted.has(id)) this.leaveRoom(id);
    }
    for (const room of next) {
      if (room.role === "host" && this.clients.has(room.roomId)) this.leaveRoom(room.roomId);
      if (room.role === "client" && this.hosts.has(room.roomId)) this.leaveRoom(room.roomId);
    }
    this.rooms = next;
    if (this.discovery) this.joinDiscovery(next);
  }

  leaveDiscovery() {
    const had = this.discovery || this.hosts.size || this.clients.size || this.people.size;
    this.discovery = false;
    this.reclaiming.clear();
    for (const rec of this.hosts.values()) rec.peer?.destroy();
    for (const rec of this.clients.values()) rec.conn?.close();
    this.hosts.clear();
    this.clients.clear();
    this.people.clear();
    this.devices.clear();
    if (!had) return;
    this.emitRoster();
    this.status("Offline — friends only");
  }

  stop() {
    this.stopped = true;
    this.discovery = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const rec of this.hosts.values()) rec.peer?.destroy();
    for (const rec of this.clients.values()) rec.conn?.close();
    this.hosts.clear();
    this.clients.clear();
    this.mainPeer?.destroy();
    this.mainPeer = null;
    this.aliasPeer?.destroy();
    this.aliasPeer = null;
    this.people.clear();
    this.devices.clear();
    this.emitRoster();
  }

  async broadcastProfile() {
    const presence = await this.myPresence();
    for (const rec of this.hosts.values()) {
      rec.roster.set(presence.deviceId, presence);
      this.hostBroadcast(rec, { type: "peer-join", ...presence, roomId: rec.room.roomId });
    }
    for (const rec of this.clients.values()) {
      if (rec.conn?.open) rec.conn.send({ type: "hello", ...presence, persistentId: getState().peerId });
    }
  }

  tryHost(room) {
    if (this.stopped || !this.discovery) return;
    const old = this.hosts.get(room.roomId);
    old?.peer?.destroy();
    const peer = new window.Peer(room.roomId, PEER_OPTS);
    const rec = {
      room,
      peer,
      roster: new Map(),
      lastSeen: new Map(),
      conns: new Map(),
      identityOf: new Map(),
    };
    this.hosts.set(room.roomId, rec);
    const ready = this.myPresence().then((presence) => {
      if (this.hosts.get(room.roomId) !== rec) return;
      rec.roster.set(presence.deviceId, presence);
    });
    peer.on("open", () => {
      if (this.stopped || !this.discovery || this.hosts.get(room.roomId) !== rec) {
        peer.destroy();
        return;
      }
      const client = this.clients.get(room.roomId);
      client?.conn?.close();
      this.clients.delete(room.roomId);
      peer.on("connection", (conn) => {
        ready.then(() => this.onHostConnection(rec, conn));
      });
      this.status(room.label ? `Hosting ZIP ${room.label}` : "Hosting ZIP room");
    });
    peer.on("error", (err) => {
      if (err?.type === "unavailable-id") {
        peer.destroy();
        this.hosts.delete(room.roomId);
        this.joinAsClient(room);
      }
    });
    peer.on("disconnected", () => {
      if (this.stopped) return;
      setTimeout(() => {
        if (!this.stopped && this.hosts.get(room.roomId)?.peer === peer) this.tryHost(room);
      }, 400 + Math.random() * 800);
    });
  }

  joinAsClient(room, { delay = 0 } = {}) {
    if (this.stopped || !this.discovery || !this.mainPeer) return;
    if (delay > 0) {
      const timer = setTimeout(() => this.joinAsClient(room), delay);
      this.timers.push(timer);
      return;
    }
    const existing = this.clients.get(room.roomId);
    if (existing?.conn?.open) return;
    existing?.conn?.close();
    const conn = this.mainPeer.connect(room.roomId, { reliable: true });
    this.clients.set(room.roomId, { room, conn, startedAt: Date.now() });
    conn.on("open", () => {
      if (!this.discovery || this.clients.get(room.roomId)?.conn !== conn) {
        conn.close();
        return;
      }
      this.myPresence().then((presence) => {
        if (!this.discovery || this.clients.get(room.roomId)?.conn !== conn) return;
        conn.send({
          type: "hello",
          ...presence,
          persistentId: getState().peerId,
        });
      });
    });
    conn.on("data", (msg) => this.onClientMessage(room.roomId, msg));
    conn.on("close", () => {
      if (this.clients.get(room.roomId)?.conn !== conn) return;
      this.scheduleReclaim(room);
    });
    conn.on("error", () => {
      if (this.clients.get(room.roomId)?.conn !== conn) return;
      this.scheduleReclaim(room);
    });
  }

  scheduleReclaim(room) {
    if (this.stopped || !this.discovery) return;
    this.clients.delete(room.roomId);
    if (this.reclaiming.has(room.roomId)) return;
    this.reclaiming.add(room.roomId);
    const delay = room.role === "client"
      ? CLIENT_RETRY_MIN_MS + Math.random() * CLIENT_RETRY_SPAN_MS
      : 300 + Math.random() * 900;
    const timer = setTimeout(() => {
      this.reclaiming.delete(room.roomId);
      if (this.stopped || this.hosts.has(room.roomId) || this.clients.has(room.roomId)) return;
      if (room.role === "client") this.joinAsClient(room);
      else this.tryHost(room);
    }, delay);
    this.timers.push(timer);
  }

  onHostConnection(rec, conn) {
    if (!this.discovery) {
      conn.close();
      return;
    }
    rec.conns.set(conn.peer, conn);
    rec.deviceOf = rec.deviceOf || new Map();
    conn.on("data", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "hello" && msg.profile) {
        this.acceptPresence(msg, rec.room.roomId, conn.peer).then((ok) => {
          if (!ok) {
            conn.close();
            return;
          }
          const deviceId = presenceDeviceId(msg, conn.peer);
          rec.identityOf.set(conn.peer, msg.profile.peerId);
          rec.deviceOf.set(conn.peer, deviceId);
          rec.roster.set(deviceId, {
            profile: msg.profile,
            publicKey: msg.publicKey,
            ts: msg.ts,
            sig: msg.sig,
            legacyId: msg.legacyId,
            deviceId,
            devicePublicKey: msg.devicePublicKey,
            deviceBinding: msg.deviceBinding,
          });
          rec.lastSeen.set(deviceId, Date.now());
          conn.send({
            type: "roster",
            roomId: rec.room.roomId,
            hostPeerId: getState().peerId,
            peers: [...rec.roster.values()],
          });
          this.hostBroadcast(rec, { ...msg, type: "peer-join", roomId: rec.room.roomId }, conn.peer);
        });
      } else if (msg.type === "hb") {
        const deviceId = presenceDeviceId(msg, conn.peer);
        rec.lastSeen.set(deviceId, Date.now());
        if (msg.profile) {
          this.acceptPresence(msg, rec.room.roomId, conn.peer).then((ok) => {
            if (!ok) return;
            rec.roster.set(deviceId, {
              profile: msg.profile,
              publicKey: msg.publicKey,
              ts: msg.ts,
              sig: msg.sig,
              legacyId: msg.legacyId,
              deviceId,
              devicePublicKey: msg.devicePublicKey,
              deviceBinding: msg.deviceBinding,
            });
          });
        }
      }
    });
    conn.on("close", () => {
      const identityId = rec.identityOf.get(conn.peer);
      const deviceId = rec.deviceOf?.get(conn.peer) || conn.peer;
      rec.conns.delete(conn.peer);
      rec.roster.delete(deviceId);
      rec.lastSeen.delete(deviceId);
      rec.identityOf.delete(conn.peer);
      rec.deviceOf?.delete(conn.peer);
      this.dropDevice(deviceId, rec.room.roomId);
      this.hostBroadcast(rec, {
        type: "peer-leave",
        peerId: identityId || conn.peer,
        deviceId,
        roomId: rec.room.roomId,
      });
    });
  }

  hostBroadcast(rec, msg, exceptPeer) {
    for (const [id, conn] of rec.conns) {
      if (id !== exceptPeer && conn.open) conn.send(msg);
    }
  }

  onClientMessage(roomId, msg) {
    if (!this.discovery || !msg || typeof msg !== "object") return;
    if (msg.type === "roster") {
      for (const p of msg.peers || []) this.acceptPresence(p, roomId);
    } else if (msg.type === "peer-join" && msg.profile) {
      this.acceptPresence(msg, roomId);
    } else if (msg.type === "peer-leave") {
      if (msg.deviceId) this.dropDevice(msg.deviceId, roomId);
      else if (msg.peerId) this.dropPerson(msg.peerId, roomId);
    }
  }

  heartbeat() {
    if (!this.discovery) return;
    this.myPresence().then((presence) => {
      if (!this.discovery) return;
      for (const rec of this.hosts.values()) {
        rec.roster.set(presence.deviceId, presence);
      }
      for (const rec of this.clients.values()) {
        if (rec.conn?.open) rec.conn.send({ type: "hb", ...presence });
      }
    });
  }

  sweep() {
    if (!this.discovery) return;
    const now = Date.now();
    for (const rec of this.hosts.values()) {
      for (const [deviceId, seen] of rec.lastSeen) {
        if (deviceId === getDeviceId() || deviceId === getState().peerId) continue;
        if (now - seen > PEER_TIMEOUT_MS) {
          const identityId = rec.roster.get(deviceId)?.profile?.peerId;
          rec.roster.delete(deviceId);
          rec.lastSeen.delete(deviceId);
          rec.conns.get(deviceId)?.close();
          rec.conns.delete(deviceId);
          this.dropDevice(deviceId, rec.room.roomId);
          this.hostBroadcast(rec, {
            type: "peer-leave",
            peerId: identityId || deviceId,
            deviceId,
            roomId: rec.room.roomId,
          });
        }
      }
    }
    for (const room of this.rooms) {
      if (room.role !== "client") continue;
      if (this.reclaiming.has(room.roomId)) continue;
      const rec = this.clients.get(room.roomId);
      if (rec?.conn?.open) continue;
      if (rec && now - rec.startedAt < CLIENT_HUNG_MS) continue;
      rec?.conn?.close();
      this.scheduleReclaim(room);
    }
  }

  connectPeer(peerId) {
    if (!this.mainPeer || !peerId) return null;
    if (peerId === getState().peerId || peerId === getDeviceId()) return null;
    return this.mainPeer.connect(peerId, { reliable: true });
  }

  deviceIdsFor(peerId) {
    const person = this.people.get(peerId);
    const ids = new Set();
    if (person?.deviceIds instanceof Set) {
      for (const id of person.deviceIds) ids.add(id);
    } else if (Array.isArray(person?.deviceIds)) {
      for (const id of person.deviceIds) ids.add(id);
    }
    return [...ids];
  }
}
