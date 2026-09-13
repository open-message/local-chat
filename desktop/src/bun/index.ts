import { BrowserWindow, BrowserView, BuildConfig } from "electrobun/main";
import { electrobunEventEmitter } from "electrobun/main/events";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubRPC, LiveRPC, ShellRPC } from "../shared/rpc";
import { LIVE_ORIGIN } from "../shared/rpc";
import { isLanHost, lanHostname, lanShareOrigin } from "../shared/lan";
import * as vault from "./vault";

/** `make desktop` is Electrobun `dev` (unpackaged). `make desktop-build` is `stable`. */
function isDevBuild() {
  try {
    return !BuildConfig.getSync().isPackaged;
  } catch {
    return true;
  }
}

function configuredOrigin() {
  if (!isDevBuild()) return LIVE_ORIGIN;
  return vault.getOrigin() || LIVE_ORIGIN;
}

const SHELL_SECRET = [...crypto.getRandomValues(new Uint8Array(16))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const HUB_HTTP_SECRET = [...crypto.getRandomValues(new Uint8Array(16))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

type PendingLink = {
  requestId: string;
  fingerprint: string;
  label: string;
  nonce: string;
  devicePublicKey: JsonWebKey | null;
  mode: string;
  existingPeerId: string;
  existingHandle: string;
  existingUsed: boolean;
  offerBlob: string;
  resolve: (value: { allow: boolean; blob?: string; linkedVault?: Record<string, unknown> }) => void;
};

const pendingLinks = new Map<string, PendingLink>();
let pairingNonce = "";
let pairingProfileId = "";
let liveProfileId = "";
let hubListening = false;
let hubError = "";
let hubHttpPort = 0;
let openedSystemHub = false;
let hubBrowser: ChildProcess | null = null;
let hubCdp: WebSocket | null = null;
let hubLaunching = false;
let hubWatchdog: ReturnType<typeof setTimeout> | null = null;
let chatWindow: BrowserWindow | null = null;
let hubWindow: BrowserWindow | null = null;
let shellRpc: ReturnType<typeof BrowserView.defineRPC<ShellRPC>>;
let hubRpc: ReturnType<typeof BrowserView.defineRPC<HubRPC>>;

function requireSecret(secret: string) {
  if (secret !== SHELL_SECRET) throw new Error("Unauthorized.");
}

function shareOrigin() {
  return lanShareOrigin(configuredOrigin());
}

function chatUrl(profileId = "") {
  const origin = configuredOrigin().replace(/\/$/, "");
  const url = new URL(`${origin}/`);
  if (profileId) url.searchParams.set("slot", profileId);
  return url.toString();
}

function peerIdFromJson(json: string) {
  try {
    return String(JSON.parse(json)?.peerId || "");
  } catch {
    return "";
  }
}

function resolveStoreProfileId(json: string, requestedId = "") {
  const byPeer = vault.profileIdForPeer(peerIdFromJson(json));
  if (byPeer) return byPeer;
  if (requestedId && vault.readProfile(requestedId)) return requestedId;
  if (liveProfileId && vault.readProfile(liveProfileId)) return liveProfileId;
  return vault.getActiveId();
}

/** Strip a trailing document (…/index.html) so we can append hub paths. */
function siteDirectory(origin: string) {
  try {
    const url = new URL(origin.includes("://") ? origin : `http://${origin}`);
    if (/\.html?$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/[^/]+$/i, "/") || "/";
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return origin.replace(/\/$/, "").replace(/\/[^/]+\.html?$/i, "");
  }
}

/** Hub page must be a secure context on this machine. HTTP *.local is not. */
function hubSiteBase() {
  const fallback = "http://127.0.0.1:4173";
  const raw = siteDirectory(configuredOrigin());
  try {
    const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (!isLanHost(url.hostname) && url.protocol === "https:") return raw;
    let port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (url.protocol === "https:" && isLanHost(url.hostname)) {
      const n = Number(port);
      if (n > 1) port = String(n - 1);
    }
    if (port === "80" || port === "443") port = "4173";
    return `http://127.0.0.1:${port}`;
  } catch {
    return fallback;
  }
}

function hubPageUrl(external = false) {
  const params = new URLSearchParams({
    v: "5",
    hubPort: String(hubHttpPort),
    hubKey: HUB_HTTP_SECRET,
  });
  if (external) params.set("ext", "1");
  // System Chromium in a dev build always uses make local so the hub page is
  // available even before desktop-hub.html is published to GitHub Pages.
  const base = external && isDevBuild() ? "http://127.0.0.1:4173" : hubSiteBase();
  return `${base}/desktop-hub.html?${params}`;
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "*";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Chrome Private Network Access: HTTPS pages (GitHub Pages) → http://127.0.0.1
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };
  return headers;
}

function chromeBins() {
  return [
    "/snap/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
}

function canUseHeadedChrome() {
  const display = process.env.DISPLAY || "";
  if (display.startsWith("localhost:") || display.startsWith("127.0.0.1:")) return false;
  return Boolean(display || process.env.WAYLAND_DISPLAY);
}

function hubProfileDir() {
  return join(tmpdir(), `local-chat-hub-${process.pid}-${Date.now()}`);
}

function spawnEnv(headless: boolean) {
  const env = { ...process.env };
  if (headless) {
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
  }
  return env;
}

function closeHubCdp() {
  const ws = hubCdp;
  hubCdp = null;
  if (!ws) return;
  try {
    ws.close();
  } catch {
    /* already closed */
  }
}

function waitForDevtools(child: ChildProcess, ms: number) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let buf = "";
    const finish = (ok: string | null, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      if (ok) resolve(ok);
      else reject(err || new Error("Chromium did not open DevTools."));
    };
    const timer = setTimeout(() => finish(null, new Error("Chromium did not open DevTools.")), ms);
    const onData = (chunk: Buffer | string) => {
      buf += String(chunk);
      if (buf.length > 8000) buf = buf.slice(-4000);
      const match = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) finish(match[1].replace(/\/$/, ""));
    };
    child.stderr?.on("data", onData);
    child.once("exit", () => finish(null, new Error("Chromium exited before DevTools.")));
  });
}

async function attachHubCdp(devtoolsUrl: string, pageUrl: string) {
  closeHubCdp();
  const ws = new WebSocket(devtoolsUrl);
  hubCdp = ws;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DevTools websocket timeout.")), 8000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("DevTools websocket failed."));
    }, { once: true });
  });
  ws.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url: pageUrl } }));
  ws.addEventListener("close", () => {
    if (hubCdp === ws) hubCdp = null;
  });
}

function spawnChrome(bin: string, args: string[], env: Record<string, string | undefined>) {
  return new Promise<ChildProcess | null>((resolve) => {
    let settled = false;
    const done = (child: ChildProcess | null) => {
      if (settled) return;
      settled = true;
      resolve(child);
    };
    try {
      const child = spawn(bin, args, {
        stdio: ["ignore", "ignore", "pipe"],
        env,
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 4000) stderr = stderr.slice(-2000);
      });
      child.once("error", (err) => {
        console.error("[hub] spawn error", bin, err.message);
        done(null);
      });
      child.once("exit", (code, signal) => {
        console.error("[hub] exited", bin, code, signal, stderr.trim().slice(-500));
      });
      child.once("spawn", () => done(child));
      setTimeout(() => {
        if (child.pid && child.exitCode === null) done(child);
      }, 50);
    } catch (err) {
      console.error("[hub] spawn threw", bin, err);
      done(null);
    }
  });
}

async function stopHubBrowser() {
  openedSystemHub = false;
  closeHubCdp();
  const child = hubBrowser;
  hubBrowser = null;
  if (!child || child.killed) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      resolve();
    }, 800);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function armHubWatchdog() {
  if (hubWatchdog) clearTimeout(hubWatchdog);
  hubWatchdog = setTimeout(() => {
    if (hubListening) return;
    hubError = `Hub Chromium started but never came online. Keep make local running. Hub URL: ${hubHttpPort ? hubPageUrl(true) : "(hub RPC is not running)"}`;
    notifyShell();
  }, 12_000);
}

function adoptHubBrowser(child: ChildProcess) {
  hubBrowser = child;
  openedSystemHub = true;
  child.once("exit", () => {
    if (hubBrowser !== child) return;
    hubBrowser = null;
    openedSystemHub = false;
    closeHubCdp();
    hubListening = false;
    hubError = "Hub Chromium exited.";
    notifyShell();
  });
  return true;
}

function hubAlreadyRunning() {
  return Boolean(
    hubBrowser
    && hubBrowser.exitCode === null
    && hubCdp
    && hubCdp.readyState === WebSocket.OPEN,
  );
}

async function openSystemHub() {
  if (hubLaunching) return true;
  if (hubAlreadyRunning()) return true;
  hubLaunching = true;
  try {
    if (!hubHttpPort) startHubHttp();
    if (!hubHttpPort) return false;
    await stopHubBrowser();
    const url = hubPageUrl(true);
    const profile = hubProfileDir();
    const headlessArgs = [
      "--headless=new",
      "--ozone-platform=headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "about:blank",
    ];
    const headedArgs = [
      "--new-window",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profile}`,
      url,
    ];
    for (const bin of chromeBins()) {
      const child = await spawnChrome(bin, headlessArgs, spawnEnv(true));
      if (!child) continue;
      adoptHubBrowser(child);
      try {
        const devtools = await waitForDevtools(child, 10_000);
        await attachHubCdp(devtools, url);
        console.log("[hub] running", bin, "cdp");
        return true;
      } catch (err) {
        console.error("[hub] DevTools", bin, err instanceof Error ? err.message : err);
        await stopHubBrowser();
      }
    }
    if (canUseHeadedChrome()) {
      for (const bin of chromeBins()) {
        const child = await spawnChrome(bin, headedArgs, spawnEnv(false));
        if (child) {
          console.log("[hub] running", bin, "window");
          return adoptHubBrowser(child);
        }
      }
    }
    return false;
  } finally {
    hubLaunching = false;
  }
}

function isMissingWebRtc(error: string) {
  return error === "no-webrtc" || /does not support WebRTC/i.test(error);
}

function notifyShell() {
  try {
    shellRpc?.send.hubReady({ hubId: vault.getHub()?.hubId || "" });
  } catch {
    /* vault window may not be ready yet */
  }
}

function sendPairingNonce(nonce: string) {
  try {
    Promise.resolve(hubRpc?.send.setPairingNonce({ nonce })).catch(() => {});
  } catch {
    /* system Chromium hub does not receive Electrobun messages */
  }
}

function vaultSnapshot() {
  return {
    ...vault.loadIndex(),
    origin: configuredOrigin(),
    hubOnline: hubListening,
    hubError,
    hubUrl: hubHttpPort ? hubPageUrl(true) : "",
    dev: isDevBuild(),
  };
}

function linkedPayload() {
  const hub = vault.getHub();
  if (!hub) return { allow: false as const };
  return {
    allow: true as const,
    blob: vault.exportBundleJson(),
    linkedVault: {
      hubId: hub.hubId,
      vaultPublicKey: hub.publicKey,
      linkedAt: Date.now(),
    },
  };
}

function authorizeDevice(pending: PendingLink, label: string) {
  const hub = vault.getHub();
  if (!hub) {
    pending.resolve({ allow: false });
    return false;
  }
  if (pending.offerBlob) {
    try {
      vault.mergeIncomingBundle(pending.offerBlob);
    } catch {
      /* keep existing vault identities */
    }
  }
  vault.addDevice({
    id: vault.newId(),
    fingerprint: pending.fingerprint,
    label,
    profileId: "",
    publicKey: pending.devicePublicKey,
    authorizedAt: Date.now(),
  });
  pending.resolve(linkedPayload());
  notifyShell();
  return true;
}

async function openHubWindow() {
  if (hubAlreadyRunning() && hubListening) return;
  hubListening = false;
  hubError = "";
  if (hubWatchdog) {
    clearTimeout(hubWatchdog);
    hubWatchdog = null;
  }
  notifyShell();
  if (!hubHttpPort) startHubHttp();
  const ok = await openSystemHub();
  if (ok) {
    if (!hubListening) {
      hubError = "Starting the hub in Chromium (no extra window).";
      notifyShell();
      armHubWatchdog();
    }
    return;
  }
  if (process.platform === "linux") {
    hubError = `Could not start Chromium for the hub. Install chromium-browser and keep make local running. ${hubHttpPort ? hubPageUrl(true) : ""}`;
    notifyShell();
    return;
  }
  const url = hubPageUrl();
  if (hubWindow) {
    try {
      hubWindow.webview.loadURL(url);
      return;
    } catch {
      hubWindow = null;
    }
  }
  hubWindow = new BrowserWindow({
    title: "Local Chat Hub",
    url,
    preload: "views://hub/index.js",
    rpc: hubRpc,
    frame: { width: 360, height: 160 },
  });
}

const liveRpc = BrowserView.defineRPC<LiveRPC>({
  handlers: {
    requests: {
      loadStore: ({ profileId } = {}) => {
        const id = (profileId && vault.readProfile(profileId) && profileId)
          || liveProfileId
          || vault.getActiveId();
        if (!id) return { json: null, profileId: "" };
        return { json: vault.readProfile(id), profileId: id };
      },
      saveStore: ({ json, profileId }) => {
        const id = resolveStoreProfileId(json, profileId);
        if (!id) return { ok: false };
        try {
          vault.writeProfile(id, vault.mergeProfileJson(vault.readProfile(id), json));
        } catch {
          return { ok: false };
        }
        return { ok: true };
      },
      getDevice: () => vault.loadDeviceKeys(),
      saveDevice: (keys) => {
        vault.saveDeviceKeys(keys);
        return { ok: true };
      },
      getLanHost: () => ({ host: lanHostname() }),
    },
    messages: {},
  },
});

function openChatWindow(profileId: string) {
  const reuse = Boolean(chatWindow) && liveProfileId === profileId;
  liveProfileId = profileId;
  vault.setActiveProfile(profileId);
  const url = chatUrl(profileId);
  const title = vault.listProfiles().find((p) => p.id === profileId)?.handle || "Local Chat";
  if (chatWindow) {
    try {
      chatWindow.setTitle(title);
      if (!reuse) chatWindow.webview.loadURL(url);
      chatWindow.show();
      chatWindow.activate();
      return true;
    } catch {
      chatWindow = null;
    }
  }
  chatWindow = new BrowserWindow({
    title,
    url,
    preload: "views://preload/index.js",
    rpc: liveRpc,
    frame: { width: 420, height: 780 },
  });
  return true;
}

const hubRequests: HubRPC["bun"]["requests"] = {
  getHub: () => vault.ensureHub(),
  saveHub: (keys) => {
    vault.saveHub(keys);
    notifyShell();
    return { ok: true };
  },
  pairingNonce: () => ({ nonce: pairingNonce }),
  hubListening: ({ hubId, error }) => {
    const message = String(error || "");
    if (!hubId && isMissingWebRtc(message)) {
      hubListening = false;
      if (!openedSystemHub && !hubLaunching && !hubAlreadyRunning()) {
        void openSystemHub().then((ok) => {
          hubError = ok
            ? "Starting the hub in Chromium (no extra window)."
            : `Could not start Chromium for the hub. ${hubHttpPort ? hubPageUrl(true) : ""}`;
          if (ok) armHubWatchdog();
          notifyShell();
        });
      }
      return { ok: true };
    }
    hubListening = Boolean(hubId);
    hubError = hubListening ? "" : message;
    if (hubListening && hubWatchdog) {
      clearTimeout(hubWatchdog);
      hubWatchdog = null;
    }
    notifyShell();
    return { ok: true };
  },
  reportLink: ({ requestId, fingerprint, label, nonce, devicePublicKey, existingPeerId, existingHandle, existingUsed, offerBlob }) => {
    if (!pairingNonce || nonce !== pairingNonce) {
      return Promise.resolve({ allow: false });
    }
    const pending: PendingLink = {
      requestId,
      fingerprint,
      label,
      nonce,
      devicePublicKey,
      mode: "",
      existingPeerId: existingPeerId || "",
      existingHandle: existingHandle || "",
      existingUsed: Boolean(existingUsed),
      offerBlob: offerBlob || "",
      resolve: () => {},
    };
    return new Promise((resolve) => {
      pending.resolve = resolve;
      pendingLinks.set(requestId, pending);
      shellRpc?.send.linkRequest({
        requestId,
        fingerprint,
        label,
        nonce,
        existingPeerId: pending.existingPeerId,
        existingHandle: pending.existingHandle,
        existingUsed: pending.existingUsed,
      });
    });
  },
  deviceAllowed: ({ fingerprint }) => {
    const rec = vault.findDevice(fingerprint);
    return { ok: Boolean(rec) };
  },
  getVaultBundle: () => ({ json: vault.exportBundleJson() }),
  mergeVaultBundle: ({ json }) => ({ json: vault.mergeIncomingBundle(json) }),
};

async function dispatchHubRequest(method: string, params: unknown) {
  const handler = hubRequests[method as keyof typeof hubRequests] as ((p: unknown) => unknown) | undefined;
  if (!handler) throw new Error("Unknown hub method.");
  return handler(params);
}

function startHubHttp() {
  try {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        if (req.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: corsHeaders(req) });
        }
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405, headers: corsHeaders(req) });
        }
        const path = new URL(req.url).pathname;
        if (path !== "/rpc") {
          return new Response("Not found", { status: 404, headers: corsHeaders(req) });
        }
        const auth = req.headers.get("authorization") || "";
        if (auth !== `Bearer ${HUB_HTTP_SECRET}`) {
          return Response.json({ error: "Unauthorized." }, { status: 401, headers: corsHeaders(req) });
        }
        try {
          const body = await req.json() as { method?: string; params?: unknown };
          const payload = await dispatchHubRequest(String(body.method || ""), body.params);
          return Response.json({ payload }, { headers: corsHeaders(req) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 400, headers: corsHeaders(req) });
        }
      },
    });
    hubHttpPort = server.port;
  } catch {
    hubHttpPort = 0;
  }
}

hubRpc = BrowserView.defineRPC<HubRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: hubRequests,
    messages: {},
  },
});

shellRpc = BrowserView.defineRPC<ShellRPC>({
  handlers: {
    requests: {
      getSecret: () => ({ secret: SHELL_SECRET }),
      getVault: ({ secret }) => {
        requireSecret(secret);
        return vaultSnapshot();
      },
      setOrigin: ({ secret, origin }) => {
        requireSecret(secret);
        if (!isDevBuild()) return { origin: LIVE_ORIGIN };
        const next = vault.setOrigin(origin);
        void openHubWindow();
        return { origin: next };
      },
      setActiveProfile: ({ secret, id }) => {
        requireSecret(secret);
        return { ok: vault.setActiveProfile(id) };
      },
      newProfile: async ({ secret }) => {
        requireSecret(secret);
        const id = await vault.createProfile();
        return { id };
      },
      renameProfile: ({ secret, id, handle }) => {
        requireSecret(secret);
        vault.renameProfile(id, handle);
        return { ok: true };
      },
      deleteProfile: ({ secret, id }) => {
        requireSecret(secret);
        vault.deleteProfile(id);
        if (liveProfileId === id) liveProfileId = vault.getActiveId();
        return { ok: true };
      },
      startPairing: ({ secret }) => {
        requireSecret(secret);
        if (!hubListening) throw new Error("The hub is not online yet.");
        const hub = vault.getHub();
        if (!hub?.hubId) throw new Error("The hub is not ready yet.");
        pairingProfileId = "";
        pairingNonce = vault.newId();
        sendPairingNonce(pairingNonce);
        return {
          hubId: hub.hubId,
          nonce: pairingNonce,
          origin: shareOrigin(),
        };
      },
      openProfile: ({ secret, profileId }) => {
        requireSecret(secret);
        if (!vault.readProfile(profileId)) throw new Error("That profile is not in the vault.");
        const opened = openChatWindow(profileId);
        const hub = vault.getHub();
        return {
          opened,
          hubId: hub?.hubId || "",
          nonce: pairingNonce,
          origin: shareOrigin(),
        };
      },
      retryHub: ({ secret }) => {
        requireSecret(secret);
        void stopHubBrowser().then(() => openHubWindow());
        return { ok: true };
      },
      stopPairing: ({ secret }) => {
        requireSecret(secret);
        pairingNonce = "";
        pairingProfileId = "";
        sendPairingNonce("");
        return { ok: true };
      },
      decideLink: ({ secret, requestId, allow, label }) => {
        requireSecret(secret);
        const pending = pendingLinks.get(requestId);
        if (!pending) return { ok: false };
        if (!allow) {
          pendingLinks.delete(requestId);
          pending.resolve({ allow: false });
          return { ok: true };
        }
        const name = vault.cleanDeviceLabel(label || "");
        if (!name) return { ok: false };
        pendingLinks.delete(requestId);
        return { ok: authorizeDevice(pending, name) };
      },
      renameDevice: ({ secret, id, label }) => {
        requireSecret(secret);
        vault.renameDevice(id, label);
        return { ok: true };
      },
      revokeDevice: ({ secret, id }) => {
        requireSecret(secret);
        vault.revokeDevice(id);
        return { ok: true };
      },
      exportVault: ({ secret }) => {
        requireSecret(secret);
        return { json: vault.exportAll() };
      },
      importVault: ({ secret, json }) => {
        requireSecret(secret);
        vault.importAll(json);
        return { ok: true };
      },
    },
    messages: {},
  },
});

electrobunEventEmitter.on("close", (event: { data?: { id?: number } }) => {
  if (chatWindow && event.data?.id === chatWindow.id) {
    chatWindow = null;
    liveProfileId = "";
  }
  if (hubWindow && event.data?.id === hubWindow.id) {
    hubWindow = null;
    if (!openedSystemHub) {
      hubListening = false;
      hubError = "The hub window was closed.";
      notifyShell();
    }
  }
});

const vaultWindow = new BrowserWindow({
  title: "Local Chat Vault",
  url: "views://shell/index.html",
  frame: { width: 440, height: 760 },
  rpc: shellRpc,
});

startHubHttp();
void vault.ensureHub().finally(() => openHubWindow());

void vaultWindow;
void liveRpc;
