import {
  CHAT_HISTORY_MAX,
  CHAT_RETENTION_OPTIONS,
  DEFAULT_CHAT_RETENTION,
} from "./config.js";

export const CHAT_RETENTION_IDS = new Set(CHAT_RETENTION_OPTIONS.map((o) => o.id));

export function isChatRetention(id) {
  return CHAT_RETENTION_IDS.has(id);
}

export function chatRetentionMs(id) {
  const opt = CHAT_RETENTION_OPTIONS.find((o) => o.id === id);
  if (!opt) return 0;
  return opt.ms;
}

export function pruneMessages(messages, { retention, clearedAt = 0, now = Date.now() } = {}) {
  const id = isChatRetention(retention) ? retention : DEFAULT_CHAT_RETENTION;
  const cut = Number(clearedAt) || 0;
  let next = (messages || []).filter((m) => (Number(m.at) || 0) > cut);
  const ms = chatRetentionMs(id);
  if (ms) {
    const oldest = now - ms;
    next = next.filter((m) => (Number(m.at) || 0) >= oldest);
  }
  return next.slice(-CHAT_HISTORY_MAX);
}

export function previewChatText(text, max = 72) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function lastReadOutgoing(messages, { me, themReadAt } = {}) {
  const readAt = Number(themReadAt) || 0;
  if (!me || !readAt) return null;
  let last = null;
  for (const m of messages || []) {
    if (!m || m.from !== me) continue;
    if ((Number(m.at) || 0) <= readAt) last = m;
  }
  return last;
}

export function canUndoOutgoing(message, { me, themReadAt } = {}) {
  if (!message || !me || message.from !== me) return false;
  return (Number(message.at) || 0) > (Number(themReadAt) || 0);
}

export function canUndoOutgoingGroup(message, { me, readAtByPeer } = {}) {
  if (!message || !me || message.from !== me) return false;
  const at = Number(message.at) || 0;
  for (const readAt of Object.values(readAtByPeer || {})) {
    if ((Number(readAt) || 0) >= at) return false;
  }
  return true;
}

export function lastReadMessageByPeer(messages, { me, members, readAtByPeer } = {}) {
  const list = messages || [];
  const out = new Map();
  for (const peerId of members || []) {
    if (!peerId || peerId === me) continue;
    const readAt = Number(readAtByPeer?.[peerId]) || 0;
    if (!readAt) continue;
    let last = null;
    for (const m of list) {
      if (!m || m.from === peerId) continue;
      if ((Number(m.at) || 0) <= readAt) last = m;
    }
    if (!last?.id) continue;
    const ids = out.get(last.id) || [];
    ids.push(peerId);
    out.set(last.id, ids);
  }
  return out;
}
