import { Electroview } from "electrobun/view";
import type { ShellRPC, VaultIndex } from "../shared/rpc";
import qrcode from "./qrcode-generator.js";

const rpc = Electroview.defineRPC<ShellRPC>({
  handlers: {
    requests: {},
    messages: {
      linkRequest: (req) => {
        pendingLink = req;
        void render();
      },
      hubReady: () => {
        void refresh();
      },
    },
  },
});

new Electroview({ rpc });

let secret = "";
let vault: VaultIndex | null = null;
let pairing: { hubId: string; nonce: string; origin: string } | null = null;
let pendingLink: ShellRPC["bun"]["messages"]["linkRequest"] | null = null;
let error = "";
let passphrase = "";

const app = document.getElementById("app") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | ((e: Event) => void)> = {},
  ...kids: (Node | string | null)[]
) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (typeof value === "string") {
      node.setAttribute(key, value);
    }
  }
  for (const kid of kids) {
    if (kid) node.append(kid);
  }
  return node;
}

function pairingLink(p: { origin: string; hubId: string; nonce: string }) {
  return `${p.origin.replace(/\/$/, "")}/?link=${p.hubId}&n=${p.nonce}`;
}

function qrBox(text: string) {
  const wrap = el("div", { class: "qr" });
  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const qr = qrcode(0, "M");
    qr.addData(String(text), "Byte");
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true, alt: "Pairing QR code" });
    if (svg) wrap.innerHTML = svg;
    if (!wrap.querySelector("svg")) {
      wrap.replaceChildren(el("img", { src: qr.createDataURL(4, 8), alt: "Pairing QR code" }));
    }
  } catch {
    wrap.append(el("p", { class: "hint" }, "Could not draw a QR code. Use the link below."));
  }
  return wrap;
}

function b64(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(value: string) {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphraseValue: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphraseValue), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(plain: string, passphraseValue: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphraseValue, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return JSON.stringify({
    kind: "localchat-vault",
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: 210000,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(ct),
  }, null, 2);
}

async function decryptJson(file: string, passphraseValue: string) {
  const parsed = JSON.parse(file) as { kind?: string; salt?: string; iv?: string; ct?: string; iter?: number };
  if (parsed.kind !== "localchat-vault" || !parsed.salt || !parsed.iv || !parsed.ct) {
    if (file.includes("localchat-vault-plain")) return file;
    throw new Error("That file is not an encrypted Local Chat vault.");
  }
  const key = await deriveKey(passphraseValue, unb64(parsed.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parsed.iv) }, key, unb64(parsed.ct));
  return new TextDecoder().decode(pt);
}

async function refresh() {
  vault = await rpc.request.getVault({ secret });
  render();
}

function render() {
  app.replaceChildren();
  if (!vault) {
    app.append(el("p", { class: "lede" }, error || "Loading vault…"));
    return;
  }
  const active = vault.profiles.find((p) => p.id === vault?.activeId);

  app.append(
    el("section", { class: "panel" },
      el("h1", {}, "Local Chat Vault"),
      el("p", { class: "lede" }, "Identities live on this computer. Open a profile to chat in this app. Scan Show QR from a phone to copy that identity onto the phone.")
    ),
    el("section", { class: "panel" },
      el("h2", {}, "Profiles"),
      ...vault.profiles.map((p) => el("div", { class: "list-item" },
        el("label", {},
          el("input", {
            type: "radio",
            name: "profile",
            ...(p.id === vault?.activeId ? { checked: "checked" } : {}),
            onChange: () => {
              void rpc.request.setActiveProfile({ secret, id: p.id }).then(refresh);
            },
          }),
          ` ${p.handle || "New profile"}`
        ),
        el("div", { class: "list-actions" },
          el("button", {
            class: "primary",
            type: "button",
            onClick: async () => {
              try {
                const opened = await rpc.request.openProfile({ secret, profileId: p.id });
                error = opened.opened ? "" : "Could not open the chat window.";
                await refresh();
              } catch (err) {
                error = err instanceof Error ? err.message : String(err);
                render();
              }
            },
          }, "Open"),
          el("button", {
            type: "button",
            onClick: () => {
              const handle = prompt("Profile name", p.handle || "");
              if (handle == null) return;
              void rpc.request.renameProfile({ secret, id: p.id, handle }).then(refresh).catch((err) => {
                error = err instanceof Error ? err.message : String(err);
                render();
              });
            },
          }, "Rename"),
          el("button", {
            class: "danger",
            type: "button",
            onClick: () => {
              if (!confirm("Delete this identity from the vault?")) return;
              void rpc.request.deleteProfile({ secret, id: p.id }).then(refresh);
            },
          }, "Delete")
        )
      )),
      el("div", { class: "row" },
        el("button", {
          class: "primary",
          type: "button",
          onClick: () => void rpc.request.newProfile({ secret }).then(refresh),
        }, "New profile")
      ),
      el("p", { class: "hint" }, active ? `Selected for linking: ${active.handle || active.peerId || active.id}` : "Create a profile, then open it.")
    ),
    el("section", { class: "panel" },
      el("h2", {}, "Link a device"),
      pairing
        ? el("div", {},
          qrBox(pairingLink(pairing)),
          el("p", { class: "hint share-url" }, pairingLink(pairing)),
          el("p", { class: "hint" }, "The phone must open this link (scan the QR). Opening spark.local without ?link= creates a different identity."),
          el("div", { class: "row" },
            el("button", {
              type: "button",
              onClick: () => {
                void navigator.clipboard.writeText(pairingLink(pairing!)).catch(() => {});
              },
            }, "Copy link"),
            el("button", {
              type: "button",
              onClick: () => {
                pairing = null;
                void rpc.request.stopPairing({ secret }).then(refresh);
              },
            }, "Stop")
          )
        )
        : el("div", {},
          el("button", {
            class: "primary",
            type: "button",
            ...((vault.hubOnline && vault.hub?.hubId) || vault.hubError ? {} : { disabled: "disabled" }),
            onClick: async () => {
              try {
                if (vault?.hubError) {
                  error = "";
                  await rpc.request.retryHub({ secret });
                  await refresh();
                  return;
                }
                if (!vault?.hub?.hubId || !vault.hubOnline) {
                  error = vault?.hubError || "The hub is not online yet.";
                  render();
                  return;
                }
                pairing = await rpc.request.startPairing({ secret });
                error = "";
                render();
              } catch (err) {
                error = err instanceof Error ? err.message : String(err);
                render();
              }
            },
          }, vault.hubOnline && vault.hub?.hubId ? "Show QR" : vault.hubError ? "Retry hub" : "Starting hub…"),
          vault.hubError ? el("p", { class: "error" }, vault.hubError) : null,
          vault.hubUrl && !vault.hubOnline
            ? el("div", {},
              el("p", { class: "hint share-url" }, vault.hubUrl),
              el("button", {
                type: "button",
                onClick: () => {
                  void navigator.clipboard.writeText(vault.hubUrl || "").catch(() => {});
                },
              }, "Copy hub URL"),
            )
            : null,
          vault.hubOnline ? null : el("p", { class: "hint" }, vault.dev
            ? "The hub runs in Chromium on this computer (no extra window). Keep make local running. Phone QR uses https://spark.local:4174 — not the Chat site in your laptop browser."
            : "The hub runs in Chromium on this computer.")
        ),
      pendingLink
        ? el("div", { class: "pending" },
          el("p", {}, pendingLink.existingUsed
            ? `This browser already has ${pendingLink.existingHandle || "an identity"} (${pendingLink.existingPeerId.slice(0, 16)}…). Import it into the vault before replacing it?`
            : `Authorize ${pendingLink.label || "a browser"} (${pendingLink.fingerprint})?`),
          pendingLink.existingUsed
            ? el("div", { class: "row" },
              el("button", {
                class: "primary",
                type: "button",
                onClick: () => {
                  const requestId = pendingLink?.requestId || "";
                  pendingLink = null;
                  void rpc.request.decideLink({ secret, requestId, allow: true, profileId: "", importExisting: true }).then(refresh);
                },
              }, "Import, then link"),
              el("button", {
                type: "button",
                onClick: () => {
                  const profileId = (document.getElementById("link-profile") as HTMLSelectElement)?.value || vault?.activeId || "";
                  const requestId = pendingLink?.requestId || "";
                  pendingLink = null;
                  void rpc.request.decideLink({ secret, requestId, allow: true, profileId, importExisting: false }).then(refresh);
                },
              }, "Replace with vault profile")
            )
            : null,
          el("select", { id: "link-profile" },
            ...vault.profiles.map((p) => el("option", { value: p.id, ...(p.id === vault?.activeId ? { selected: "selected" } : {}) }, p.handle || p.id))
          ),
          el("div", { class: "row" },
            pendingLink.existingUsed ? null : el("button", {
              class: "primary",
              type: "button",
              onClick: () => {
                const profileId = (document.getElementById("link-profile") as HTMLSelectElement)?.value || vault?.activeId || "";
                const requestId = pendingLink?.requestId || "";
                pendingLink = null;
                void rpc.request.decideLink({ secret, requestId, allow: true, profileId }).then(refresh);
              },
            }, "Authorize"),
            el("button", {
              type: "button",
              onClick: () => {
                const requestId = pendingLink?.requestId || "";
                pendingLink = null;
                void rpc.request.decideLink({ secret, requestId, allow: false, profileId: "" }).then(refresh);
              },
            }, "Deny")
          )
        )
        : el("p", { class: "hint" }, "Select a profile, Show QR, then scan it from the phone. Linked browsers share that identity and keep it in sync.")
    ),
    el("section", { class: "panel" },
      el("h2", {}, "Linked devices"),
      vault.devices.length
        ? undefined
        : el("p", { class: "hint" }, "No linked browsers yet."),
      ...vault.devices.map((d) => el("div", { class: "list-item" },
        el("span", {}, `${d.label || d.fingerprint} · ${d.fingerprint}`),
        el("button", {
          class: "danger",
          type: "button",
          onClick: () => void rpc.request.revokeDevice({ secret, id: d.id }).then(refresh),
        }, "Revoke")
      ))
    ),
    el("section", { class: "panel" },
      el("h2", {}, "Encrypted backup"),
      el("input", {
        type: "password",
        placeholder: "Passphrase",
        onInput: (e) => {
          passphrase = (e.target as HTMLInputElement).value;
        },
      }),
      el("div", { class: "row" },
        el("button", {
          type: "button",
          onClick: async () => {
            try {
              if (!passphrase) throw new Error("Set a passphrase first.");
              const { json } = await rpc.request.exportVault({ secret });
              const file = await encryptJson(json, passphrase);
              const blob = new Blob([file], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "local-chat-vault.json";
              a.click();
            } catch (err) {
              error = err instanceof Error ? err.message : String(err);
              render();
            }
          },
        }, "Export"),
        el("button", {
          type: "button",
          onClick: () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              try {
                if (!passphrase) throw new Error("Set a passphrase first.");
                const json = await decryptJson(await file.text(), passphrase);
                await rpc.request.importVault({ secret, json });
                await refresh();
              } catch (err) {
                error = err instanceof Error ? err.message : String(err);
                render();
              }
            };
            input.click();
          },
        }, "Import")
      ),
      el("p", { class: "hint" }, "Anyone with this file and the passphrase can be every identity in the vault.")
    )
  );
  if (vault.dev) {
    app.append(
      el("section", { class: "panel" },
        el("h2", {}, "Chat site"),
        el("input", {
          value: vault.origin,
          onChange: (e) => {
            const origin = (e.target as HTMLInputElement).value.trim();
            void rpc.request.setOrigin({ secret, origin }).then(refresh);
          },
        }),
        el("p", { class: "hint" }, "Production is GitHub Pages. Use http://localhost:4173/ while developing so a phone on https://spark.local:4174 joins the same rooms.")
      )
    );
  }
  if (error) app.prepend(el("p", { class: "error" }, error));
}

async function boot() {
  secret = (await rpc.request.getSecret({})).secret;
  await refresh();
}

boot().catch((err) => {
  error = err instanceof Error ? err.message : String(err);
  render();
});
