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
