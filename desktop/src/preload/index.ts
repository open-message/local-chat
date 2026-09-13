import { Electroview } from "electrobun/view";
import type { LiveRPC } from "../shared/rpc";

const rpc = Electroview.defineRPC<LiveRPC>({
  handlers: {
    requests: {},
    messages: {},
  },
});

new Electroview({ rpc });

function patchGeolocation() {
  if (!navigator.geolocation || (navigator.geolocation as { __lcPatched?: boolean }).__lcPatched) return;
  const native = navigator.geolocation;
  const nativeGet = native.getCurrentPosition.bind(native);
  (native as { __lcPatched?: boolean }).__lcPatched = true;
  const DESKTOP_GPS_MS = 4_000;

  native.getCurrentPosition = (success, error, options) => {
    const timeout = Math.min(options?.timeout ?? DESKTOP_GPS_MS, DESKTOP_GPS_MS);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      error({
        code: 3,
        message: "Timeout expired",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    }, timeout);
    nativeGet(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        success(pos);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error(err);
      },
      {
        enableHighAccuracy: false,
        timeout,
        maximumAge: options?.maximumAge ?? 0,
      }
    );
  };

  native.watchPosition = (success, error, options) => {
    native.getCurrentPosition(success, error, options);
    return 0;
  };
}

patchGeolocation();

function pageProfileId() {
  try {
    return new URLSearchParams(location.search).get("slot") || "";
  } catch {
    return "";
  }
}

let boundProfileId = "";

const api = {
  isPrimary: true,
  persistSession: true,
  loadStore: async () => {
    boundProfileId = pageProfileId();
    const res = await rpc.request.loadStore({ profileId: boundProfileId });
    if (res?.profileId) boundProfileId = res.profileId;
    return res?.json ?? null;
  },
  saveStore: async (json: string) => {
    await rpc.request.saveStore({ json, profileId: boundProfileId || pageProfileId() });
    return true;
  },
  getDevice: async () => rpc.request.getDevice({}),
  saveDevice: async (keys: { publicKey: JsonWebKey; privateKey: JsonWebKey }) => {
    await rpc.request.saveDevice(keys);
    return true;
  },
  getLanHost: async () => {
    try {
      const res = await rpc.request.getLanHost({});
      return res?.host || "";
    } catch {
      return "";
    }
  },
};

(window as Window & { localChatDesktop?: typeof api }).localChatDesktop = api;
