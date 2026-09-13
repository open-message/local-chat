import {
  CHAT_TEXT_MAX,
  GROUP_INVITE_POLICIES,
  GROUP_MEMBER_MAX,
  GROUP_NAME_MAX,
} from "./config.js";
import { isChatRetention } from "./chat.js";
import {
  peerIdFromPublicJwk,
  publicJwkOnly,
  samePublicKey,
  signBytes,
  verifyBytes,
} from "./identity.js";
import { isGroupId, isUserPeerId } from "./share.js";

export const GROUP_INVITE_POLICY_IDS = new Set(GROUP_INVITE_POLICIES.map((o) => o.id));

export function isInvitePolicy(id) {
  return GROUP_INVITE_POLICY_IDS.has(id);
}

export function sanitizeGroupName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, GROUP_NAME_MAX);
}

function encode(parts) {
  return new TextEncoder().encode(parts.join("|"));
}

export function genesisBody(genesis) {
  return {
    groupId: String(genesis?.groupId || ""),
    name: sanitizeGroupName(genesis?.name),
    creatorId: String(genesis?.creatorId || ""),
    invitePolicy: isInvitePolicy(genesis?.invitePolicy) ? genesis.invitePolicy : "",
    createdAt: Number(genesis?.createdAt) || 0,
  };
}

function genesisBytes(genesis) {
  const body = genesisBody(genesis);
  const pub = publicJwkOnly(genesis?.publicKey);
  return encode([
    "lc1-group-genesis",
    body.groupId,
    body.name,
    body.creatorId,
    body.invitePolicy,
    String(body.createdAt),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export function sanitizeGenesis(genesis) {
  const pub = publicJwkOnly(genesis?.publicKey);
  const body = genesisBody(genesis);
  if (!isGroupId(body.groupId) || !isUserPeerId(body.creatorId) || !body.invitePolicy || !pub || !genesis?.sig) {
    return null;
  }
  return {
    type: "group-genesis",
    ...body,
    publicKey: pub,
    sig: String(genesis.sig),
  };
}

export async function signGenesis(identity, { groupId, name, invitePolicy }) {
  const genesis = {
    type: "group-genesis",
    groupId,
    name: sanitizeGroupName(name),
    creatorId: identity.peerId,
    invitePolicy: isInvitePolicy(invitePolicy) ? invitePolicy : "creator",
    createdAt: Date.now(),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  genesis.sig = await signBytes(identity.privateKey, genesisBytes(genesis));
  return genesis;
}

export async function verifyGenesis(genesis) {
  const clean = sanitizeGenesis(genesis);
  if (!clean) return null;
  const pub = clean.publicKey;
  const expectedId = await peerIdFromPublicJwk(pub);
  if (expectedId.toLowerCase() !== clean.creatorId.toLowerCase()) return null;
  if (!(await verifyBytes(pub, genesisBytes(clean), clean.sig))) return null;
  return clean;
}

function inviteSignBody(invite) {
  return {
    groupId: String(invite?.groupId || ""),
    from: String(invite?.from || ""),
    to: String(invite?.to || ""),
    at: Number(invite?.at) || 0,
    genesisSig: String(invite?.genesis?.sig || invite?.genesisSig || ""),
  };
}

function inviteBytes(invite) {
  const body = inviteSignBody(invite);
  const pub = publicJwkOnly(invite?.publicKey);
  return encode([
    "lc1-group-invite",
    body.groupId,
    body.from,
    body.to,
    String(body.at),
    body.genesisSig,
    pub?.x || "",
    pub?.y || "",
  ]);
}

export function sanitizeInviteHop(invite) {
  const pub = publicJwkOnly(invite?.publicKey);
  const groupId = String(invite?.groupId || "");
  const from = String(invite?.from || "");
  const to = String(invite?.to || "");
  const sig = String(invite?.sig || "");
  if (!isGroupId(groupId) || !isUserPeerId(from) || !isUserPeerId(to) || from === to || !pub || !sig) {
    return null;
  }
  const genesis = invite.genesis ? sanitizeGenesis(invite.genesis) : null;
  const hop = {
    type: "group-invite",
    groupId,
    from,
    to,
    at: Number(invite.at) || 0,
    publicKey: pub,
    sig,
  };
  if (genesis) hop.genesis = genesis;
  return hop;
}

function sanitizeChain(chain) {
  if (!Array.isArray(chain)) return [];
  const out = [];
  for (const hop of chain) {
    const clean = sanitizeInviteHop(hop);
    if (!clean) return [];
    out.push(clean);
  }
  return out;
}

export async function verifyInviteSignature(invite) {
  const hop = sanitizeInviteHop(invite);
  if (!hop) return null;
  const expectedId = await peerIdFromPublicJwk(hop.publicKey);
  if (expectedId.toLowerCase() !== hop.from.toLowerCase()) return null;
  const signed = invite.genesis ? { ...hop, genesis: invite.genesis } : hop;
  if (!(await verifyBytes(hop.publicKey, inviteBytes(signed), hop.sig))) return null;
  return hop;
}

/**
 * Walk signed invites from the creator to `memberId`.
 * Creator membership is genesis (empty chain).
 */
export async function verifyMemberProof(genesis, chain, memberId, memberPub) {
  const gen = await verifyGenesis(genesis);
  if (!gen || !isUserPeerId(memberId)) return null;
  const pub = publicJwkOnly(memberPub);
  if (!pub) return null;
  const expectedId = await peerIdFromPublicJwk(pub);
  if (expectedId.toLowerCase() !== String(memberId).toLowerCase()) return null;

  if (memberId === gen.creatorId) {
    if (!samePublicKey(pub, gen.publicKey)) return null;
    if (Array.isArray(chain) && chain.length) return null;
    return { genesis: gen, chain: [], publicKey: pub };
  }

  const hops = sanitizeChain(chain);
  if (!hops.length) return null;
  let prevTo = gen.creatorId;
  for (let i = 0; i < hops.length; i += 1) {
    const hop = hops[i];
    if (hop.groupId !== gen.groupId || hop.from !== prevTo) return null;
    if (i === 0) {
      if (hop.from !== gen.creatorId || !samePublicKey(hop.publicKey, gen.publicKey)) return null;
    } else if (gen.invitePolicy !== "members") {
      return null;
    }
    const signed = hop.genesis ? hop : { ...hop, genesis: gen };
    if (!(await verifyInviteSignature(signed))) return null;
    prevTo = hop.to;
  }
  if (prevTo !== memberId) return null;
  return { genesis: gen, chain: hops, publicKey: pub };
}

export async function verifyInvite(invite, { expectedTo, pinnedInviterKey } = {}) {
  const hop = sanitizeInviteHop(invite);
  const genesis = await verifyGenesis(invite?.genesis);
  if (!hop || !genesis || hop.groupId !== genesis.groupId) return null;
  if (expectedTo && hop.to !== expectedTo) return null;
  if (pinnedInviterKey && !samePublicKey(pinnedInviterKey, hop.publicKey)) return null;
  const signed = { ...hop, genesis };
  if (!(await verifyInviteSignature(signed))) return null;
  const chain = sanitizeChain(invite.chain);
  const proof = await verifyMemberProof(genesis, chain, hop.from, hop.publicKey);
  if (!proof) return null;
  if (hop.from !== genesis.creatorId && genesis.invitePolicy !== "members") return null;
  return { ...signed, chain: proof.chain, genesis };
}

export function canInvite(group, peerId) {
  if (!group || group.left || !peerId) return false;
  if (peerId === group.creatorId) return true;
  if (group.invitePolicy === "creator") return false;
  if (group.invitePolicy !== "members") return false;
  return (group.members || []).some((m) => m.peerId === peerId);
}

export function isGroupMember(group, peerId) {
  if (!group || !peerId) return false;
  if (peerId === group.creatorId) return true;
  return (group.members || []).some((m) => m.peerId === peerId);
}

export function isPublicGroup(group) {
  return group?.invitePolicy === "members";
}

/** Private groups: any member. Public groups: only the creator. */
export function canClearGroup(group, peerId) {
  if (!group || group.left || !isGroupMember(group, peerId)) return false;
  if (isPublicGroup(group)) return peerId === group.creatorId;
  return true;
}

export function canSetGroupRetention(group, peerId) {
  return canClearGroup(group, peerId);
}

export function memberCount(group) {
  const ids = new Set();
  for (const m of group?.members || []) {
    if (m?.peerId) ids.add(m.peerId);
  }
  for (const id of group?.pendingInvites || []) ids.add(id);
  return ids.size;
}

export function groupHasRoom(group) {
  return memberCount(group) < GROUP_MEMBER_MAX;
}

export function membersFromInvite(invite, extra = []) {
  const map = new Map();
  const add = (peerId, publicKey, invitedBy = "") => {
    if (!isUserPeerId(peerId)) return;
    const prev = map.get(peerId) || { peerId, publicKey: null, invitedBy: "" };
    map.set(peerId, {
      peerId,
      publicKey: publicJwkOnly(publicKey) || prev.publicKey,
      invitedBy: invitedBy || prev.invitedBy || "",
    });
  };
  const genesis = invite?.genesis;
  if (genesis?.creatorId) add(genesis.creatorId, genesis.publicKey, "");
  for (const hop of invite?.chain || []) {
    add(hop.from, hop.publicKey, hop.from === genesis?.creatorId ? "" : "");
    add(hop.to, null, hop.from);
  }
  if (invite?.from) add(invite.from, invite.publicKey, invite.chain?.length ? invite.chain[invite.chain.length - 1]?.from : genesis?.creatorId);
  if (invite?.to) add(invite.to, extra.find((m) => m.peerId === invite.to)?.publicKey, invite.from);
  for (const m of extra) add(m.peerId, m.publicKey, m.invitedBy);
  return [...map.values()];
}

export function ourChainFor(group, peerId) {
  if (!group || peerId === group.creatorId) return [];
  return Array.isArray(group.chain) ? group.chain.map(sanitizeInviteHop).filter(Boolean) : [];
}

export async function signInvite(identity, { genesis, to, chain = [] }) {
  const invite = {
    type: "group-invite",
    groupId: genesis.groupId,
    from: identity.peerId,
    to: String(to),
    at: Date.now(),
    genesis,
    chain: sanitizeChain(chain),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  invite.sig = await signBytes(identity.privateKey, inviteBytes(invite));
  return invite;
}

function replyBytes(msg) {
  const pub = publicJwkOnly(msg?.publicKey);
  return encode([
    "lc1-group-invite-reply",
    String(msg?.groupId || ""),
    String(msg?.from || ""),
    msg?.accept ? "1" : "0",
    String(Number(msg?.at) || 0),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export async function signInviteReply(identity, { groupId, accept }) {
  const msg = {
    type: "group-invite-reply",
    groupId,
    from: identity.peerId,
    accept: Boolean(accept),
    at: Date.now(),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  msg.sig = await signBytes(identity.privateKey, replyBytes(msg));
  return msg;
}

export async function verifyInviteReply(msg, { expectedFrom, pinnedPublicKey } = {}) {
  if (!msg || msg.type !== "group-invite-reply" || !isGroupId(msg.groupId) || !isUserPeerId(msg.from) || !msg.sig) {
    return null;
  }
  if (expectedFrom && msg.from !== expectedFrom) return null;
  const pub = publicJwkOnly(msg.publicKey);
  if (!pub) return null;
  if (pinnedPublicKey && !samePublicKey(pinnedPublicKey, pub)) return null;
  const expectedId = await peerIdFromPublicJwk(pub);
  if (expectedId.toLowerCase() !== String(msg.from).toLowerCase()) return null;
  if (!(await verifyBytes(pub, replyBytes(msg), msg.sig))) return null;
  return {
    type: "group-invite-reply",
    groupId: msg.groupId,
    from: msg.from,
    accept: Boolean(msg.accept),
    at: Number(msg.at) || 0,
    publicKey: pub,
    sig: String(msg.sig),
  };
}

function helloBytes(msg) {
  const pub = publicJwkOnly(msg?.publicKey);
  return encode([
    "lc1-group-hello",
    String(msg?.groupId || ""),
    String(msg?.from || ""),
    String(Number(msg?.at) || 0),
    String(msg?.genesis?.sig || ""),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export async function signGroupHello(identity, { genesis, chain = [] }) {
  const msg = {
    type: "group-hello",
    groupId: genesis.groupId,
    from: identity.peerId,
    at: Date.now(),
    genesis,
    chain: sanitizeChain(chain),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  msg.sig = await signBytes(identity.privateKey, helloBytes(msg));
  return msg;
}

export async function verifyGroupHello(msg, { pinnedPublicKey } = {}) {
  if (!msg || msg.type !== "group-hello" || !isUserPeerId(msg.from) || !msg.sig) return null;
  const genesis = await verifyGenesis(msg.genesis);
  if (!genesis || genesis.groupId !== msg.groupId) return null;
  const pub = publicJwkOnly(msg.publicKey);
  if (!pub) return null;
  if (pinnedPublicKey && !samePublicKey(pinnedPublicKey, pub)) return null;
  if (!(await verifyBytes(pub, helloBytes({ ...msg, genesis }), msg.sig))) return null;
  const proof = await verifyMemberProof(genesis, msg.chain, msg.from, pub);
  if (!proof) return null;
  return {
    type: "group-hello",
    groupId: genesis.groupId,
    from: msg.from,
    at: Number(msg.at) || 0,
    genesis,
    chain: proof.chain,
    publicKey: pub,
    sig: String(msg.sig),
  };
}

function leaveBytes(msg) {
  const pub = publicJwkOnly(msg?.publicKey);
  return encode([
    "lc1-group-leave",
    String(msg?.groupId || ""),
    String(msg?.from || ""),
    String(Number(msg?.at) || 0),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export async function signGroupLeave(identity, { groupId }) {
  const msg = {
    type: "group-leave",
    groupId,
    from: identity.peerId,
    at: Date.now(),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  msg.sig = await signBytes(identity.privateKey, leaveBytes(msg));
  return msg;
}

export async function verifyGroupLeave(msg, { expectedFrom, pinnedPublicKey } = {}) {
  if (!msg || msg.type !== "group-leave" || !isGroupId(msg.groupId) || !isUserPeerId(msg.from) || !msg.sig) {
    return null;
  }
  if (expectedFrom && msg.from !== expectedFrom) return null;
  const pub = publicJwkOnly(msg.publicKey);
  if (!pub) return null;
  if (pinnedPublicKey && !samePublicKey(pinnedPublicKey, pub)) return null;
  const expectedId = await peerIdFromPublicJwk(pub);
  if (expectedId.toLowerCase() !== String(msg.from).toLowerCase()) return null;
  if (!(await verifyBytes(pub, leaveBytes(msg), msg.sig))) return null;
  return {
    type: "group-leave",
    groupId: msg.groupId,
    from: msg.from,
    at: Number(msg.at) || 0,
    publicKey: pub,
    sig: String(msg.sig),
  };
}

function readBytes(msg) {
  const pub = publicJwkOnly(msg?.publicKey);
  return encode([
    "lc1-group-read",
    String(msg?.groupId || ""),
    String(msg?.from || ""),
    String(Number(msg?.at) || 0),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export async function signGroupRead(identity, { groupId, at }) {
  const msg = {
    type: "group-read",
    groupId,
    from: identity.peerId,
    at: Number(at) || 0,
    publicKey: publicJwkOnly(identity.publicKey),
  };
  msg.sig = await signBytes(identity.privateKey, readBytes(msg));
  return msg;
}

export async function verifyGroupRead(msg, { pinnedPublicKey } = {}) {
  if (!msg || msg.type !== "group-read" || !isGroupId(msg.groupId) || !isUserPeerId(msg.from) || !msg.sig) {
    return null;
  }
  const pub = publicJwkOnly(msg.publicKey);
  if (!pub) return null;
  if (pinnedPublicKey && !samePublicKey(pinnedPublicKey, pub)) return null;
  const expectedId = await peerIdFromPublicJwk(pub);
  if (expectedId.toLowerCase() !== String(msg.from).toLowerCase()) return null;
  if (!(await verifyBytes(pub, readBytes(msg), msg.sig))) return null;
  return {
    type: "group-read",
    groupId: msg.groupId,
    from: msg.from,
    at: Number(msg.at) || 0,
    publicKey: pub,
    sig: String(msg.sig),
  };
}

function clearBytes(msg) {
  const pub = publicJwkOnly(msg?.publicKey);
  return encode([
    "lc1-group-clear",
    String(msg?.groupId || ""),
    String(msg?.from || ""),
    String(Number(msg?.at) || 0),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export function sanitizeGroupClear(msg, groupId = "") {
  const pub = publicJwkOnly(msg?.publicKey);
  const id = String(msg?.groupId || groupId || "");
  const from = String(msg?.from || "");
  const sig = String(msg?.sig || "");
  if (!msg || msg.type !== "group-clear" || !isGroupId(id) || !isUserPeerId(from) || !pub || !sig) {
    return null;
  }
  if (groupId && id !== groupId) return null;
  return {
    type: "group-clear",
    groupId: id,
    from,
    at: Number(msg.at) || 0,
    publicKey: pub,
    sig,
  };
}

export async function signGroupClear(identity, { groupId, at }) {
  const msg = {
    type: "group-clear",
    groupId,
    from: identity.peerId,
    at: Number(at) || Date.now(),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  msg.sig = await signBytes(identity.privateKey, clearBytes(msg));
  return msg;
}

export async function verifyGroupClear(msg, { pinnedPublicKey } = {}) {
  const clean = sanitizeGroupClear(msg);
  if (!clean) return null;
  if (pinnedPublicKey && !samePublicKey(pinnedPublicKey, clean.publicKey)) return null;
  const expectedId = await peerIdFromPublicJwk(clean.publicKey);
  if (expectedId.toLowerCase() !== clean.from.toLowerCase()) return null;
  if (!(await verifyBytes(clean.publicKey, clearBytes(clean), clean.sig))) return null;
  return clean;
}

function policyBytes(msg) {
  const pub = publicJwkOnly(msg?.publicKey);
  return encode([
    "lc1-group-policy",
    String(msg?.groupId || ""),
    String(msg?.from || ""),
    String(msg?.retention || ""),
    String(Number(msg?.at) || 0),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export function sanitizeGroupPolicy(msg, groupId = "") {
  const pub = publicJwkOnly(msg?.publicKey);
  const id = String(msg?.groupId || groupId || "");
  const from = String(msg?.from || "");
  const sig = String(msg?.sig || "");
  const retention = String(msg?.retention || "");
  if (!msg || msg.type !== "group-policy" || !isGroupId(id) || !isUserPeerId(from) || !pub || !sig) {
    return null;
  }
  if (groupId && id !== groupId) return null;
  if (!isChatRetention(retention)) return null;
  return {
    type: "group-policy",
    groupId: id,
    from,
    retention,
    at: Number(msg.at) || 0,
    publicKey: pub,
    sig,
  };
}

export async function signGroupPolicy(identity, { groupId, retention, at }) {
  const msg = {
    type: "group-policy",
    groupId,
    from: identity.peerId,
    retention,
    at: Number(at) || Date.now(),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  msg.sig = await signBytes(identity.privateKey, policyBytes(msg));
  return msg;
}

export async function verifyGroupPolicy(msg, { pinnedPublicKey } = {}) {
  const clean = sanitizeGroupPolicy(msg);
  if (!clean) return null;
  if (pinnedPublicKey && !samePublicKey(pinnedPublicKey, clean.publicKey)) return null;
  const expectedId = await peerIdFromPublicJwk(clean.publicKey);
  if (expectedId.toLowerCase() !== clean.from.toLowerCase()) return null;
  if (!(await verifyBytes(clean.publicKey, policyBytes(clean), clean.sig))) return null;
  return clean;
}

function chatBytes(msg) {
  const pub = publicJwkOnly(msg?.publicKey);
  return encode([
    "lc1-group-chat",
    String(msg?.groupId || ""),
    String(msg?.id || ""),
    String(msg?.from || ""),
    String(msg?.text || ""),
    String(Number(msg?.at) || 0),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export async function signGroupChat(identity, { groupId, id, text, chain = [] }) {
  const msg = {
    type: "group-chat",
    groupId,
    id: String(id),
    from: identity.peerId,
    text: String(text || "").slice(0, CHAT_TEXT_MAX),
    at: Date.now(),
    chain: sanitizeChain(chain),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  msg.sig = await signBytes(identity.privateKey, chatBytes(msg));
  return msg;
}

export async function verifyGroupChat(msg, { genesis, pinnedAuthorKey } = {}) {
  if (!msg || msg.type !== "group-chat" || !msg.id || !isGroupId(msg.groupId) || !isUserPeerId(msg.from)) return null;
  const text = String(msg.text || "").trim().slice(0, CHAT_TEXT_MAX);
  if (!text || !msg.sig) return null;
  const pub = publicJwkOnly(msg.publicKey);
  if (!pub) return null;
  if (pinnedAuthorKey && !samePublicKey(pinnedAuthorKey, pub)) return null;
  const expectedId = await peerIdFromPublicJwk(pub);
  if (expectedId.toLowerCase() !== String(msg.from).toLowerCase()) return null;
  const body = {
    groupId: msg.groupId,
    id: String(msg.id),
    from: msg.from,
    text,
    at: Number(msg.at) || 0,
    publicKey: pub,
  };
  if (!(await verifyBytes(pub, chatBytes(body), msg.sig))) return null;
  const gen = genesis || msg.genesis;
  const proof = await verifyMemberProof(gen, msg.chain, msg.from, pub);
  if (!proof || proof.genesis.groupId !== msg.groupId) return null;
  return {
    type: "group-chat",
    ...body,
    chain: proof.chain,
    genesis: proof.genesis,
    sig: String(msg.sig),
  };
}

function chatUndoBytes(msg) {
  const pub = publicJwkOnly(msg?.publicKey);
  return encode([
    "lc1-group-chat-undo",
    String(msg?.groupId || ""),
    String(msg?.id || ""),
    String(msg?.from || ""),
    String(Number(msg?.at) || 0),
    pub?.x || "",
    pub?.y || "",
  ]);
}

export async function signGroupChatUndo(identity, { groupId, id, chain = [] }) {
  const msg = {
    type: "group-chat-undo",
    groupId,
    id: String(id),
    from: identity.peerId,
    at: Date.now(),
    chain: sanitizeChain(chain),
    publicKey: publicJwkOnly(identity.publicKey),
  };
  msg.sig = await signBytes(identity.privateKey, chatUndoBytes(msg));
  return msg;
}

export async function verifyGroupChatUndo(msg, { genesis, pinnedAuthorKey } = {}) {
  if (!msg || msg.type !== "group-chat-undo" || !msg.id || !isGroupId(msg.groupId) || !isUserPeerId(msg.from)) {
    return null;
  }
  if (!msg.sig) return null;
  const pub = publicJwkOnly(msg.publicKey);
  if (!pub) return null;
  if (pinnedAuthorKey && !samePublicKey(pinnedAuthorKey, pub)) return null;
  const expectedId = await peerIdFromPublicJwk(pub);
  if (expectedId.toLowerCase() !== String(msg.from).toLowerCase()) return null;
  const body = {
    groupId: msg.groupId,
    id: String(msg.id),
    from: msg.from,
    at: Number(msg.at) || 0,
    publicKey: pub,
  };
  if (!(await verifyBytes(pub, chatUndoBytes(body), msg.sig))) return null;
  const gen = genesis || msg.genesis;
  const proof = await verifyMemberProof(gen, msg.chain, msg.from, pub);
  if (!proof || proof.genesis.groupId !== msg.groupId) return null;
  return {
    type: "group-chat-undo",
    ...body,
    chain: proof.chain,
    genesis: proof.genesis,
    sig: String(msg.sig),
  };
}
