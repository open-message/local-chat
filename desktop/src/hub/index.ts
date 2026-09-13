import { Electroview } from "electrobun/view";
import type { HubKeys, HubRPC } from "../shared/rpc";

type HubBridge = {
  getHub: () => Promise<HubKeys>;
  saveHub: (keys: HubKeys) => Promise<{ ok: boolean }>;
  hubListening: (params: { hubId: string; error?: string }) => Promise<{ ok: boolean }>;
  reportLink: (params: Record<string, unknown>) => Promise<{ allow: boolean; blob?: string; linkedVault?: Record<string, unknown> }>;
  deviceAllowed: (params: { fingerprint: string }) => Promise<{ ok: boolean }>;
  getVaultBundle: () => Promise<{ json: string }>;
  mergeVaultBundle: (params: { json: string }) => Promise<{ json: string }>;
};

const rpc = Electroview.defineRPC<HubRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {},
    messages: {
      setPairingNonce: () => {},
    },
  },
});

new Electroview({ rpc });

const api: HubBridge = {
  getHub: () => rpc.request.getHub({}),
  saveHub: (keys) => rpc.request.saveHub(keys),
  hubListening: (params) => rpc.request.hubListening(params),
  reportLink: (params) => rpc.request.reportLink(params as HubRPC["bun"]["requests"]["reportLink"]["params"]),
  deviceAllowed: (params) => rpc.request.deviceAllowed(params),
  getVaultBundle: () => rpc.request.getVaultBundle({}),
  mergeVaultBundle: (params) => rpc.request.mergeVaultBundle(params),
};

(window as Window & { localChatHub?: HubBridge }).localChatHub = api;

function reply(id: string, result?: unknown, error?: string) {
  const payload = { ns: "lc-hub", kind: "res", id, result, error };
  try {
    window.postMessage(payload, "*");
  } catch {
    /* ignore */
  }
  try {
    document.dispatchEvent(new CustomEvent("lc-hub-res", { detail: payload }));
  } catch {
    /* ignore */
  }
  try {
    const node = document.createElement("script");
    node.type = "application/x-lc-hub-res";
    node.textContent = JSON.stringify(payload);
    document.documentElement.appendChild(node);
  } catch {
    /* ignore */
  }
}

async function handleReq(data: { id?: string; method?: string; params?: unknown }) {
  const id = String(data.id || "");
  const method = String(data.method || "") as keyof HubBridge;
  if (!id || !method || !(method in api)) {
    if (id) reply(id, undefined, "Unknown hub method.");
    return;
  }
  try {
    const result = await (api[method] as (params: unknown) => Promise<unknown>)(data.params);
    reply(id, result);
  } catch (err) {
    reply(id, undefined, err instanceof Error ? err.message : String(err));
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.ns !== "lc-hub") return;
  if (data.kind === "ping") {
    window.postMessage({ ns: "lc-hub", kind: "pong" }, "*");
    return;
  }
  if (data.kind === "req") void handleReq(data);
});

document.addEventListener("lc-hub-ping", () => {
  document.dispatchEvent(new CustomEvent("lc-hub-pong"));
});

document.addEventListener("lc-hub-req", (event) => {
  const data = (event as CustomEvent).detail;
  if (data && typeof data === "object") void handleReq(data);
});

function isHubScript(node: Node, type: string) {
  if (!node || node.nodeName !== "SCRIPT") return false;
  const script = node as HTMLScriptElement;
  return (script.type || script.getAttribute("type") || "") === type;
}

function watchHubDom() {
  const root = document.documentElement;
  if (!root) {
    document.addEventListener("DOMContentLoaded", watchHubDom, { once: true });
    return;
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isHubScript(node, "application/x-lc-hub-ping")) {
          (node as HTMLScriptElement).remove();
          try {
            document.dispatchEvent(new CustomEvent("lc-hub-pong"));
          } catch {
            /* ignore */
          }
          try {
            window.postMessage({ ns: "lc-hub", kind: "pong" }, "*");
          } catch {
            /* ignore */
          }
          continue;
        }
        if (!isHubScript(node, "application/x-lc-hub")) continue;
        const script = node as HTMLScriptElement;
        try {
          const data = JSON.parse(script.textContent || "{}");
          script.remove();
          if (data?.kind === "ping") {
            window.postMessage({ ns: "lc-hub", kind: "pong" }, "*");
          } else {
            void handleReq(data);
          }
        } catch {
          script.remove();
        }
      }
    }
  }).observe(root, { childList: true });
}

watchHubDom();
