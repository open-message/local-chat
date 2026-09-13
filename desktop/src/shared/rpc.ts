export const LIVE_ORIGIN = "https://open-message.github.io/local-chat/";
export const DEV_ORIGIN = "http://localhost:4173/";

export type ProfileSummary = {
  id: string;
  peerId: string;
  handle: string;
  updatedAt: number;
};

export type LinkedDevice = {
  id: string;
  fingerprint: string;
  label: string;
  profileId: string;
  publicKey: JsonWebKey | null;
  authorizedAt: number;
};

export type LinkRequest = {
  requestId: string;
  fingerprint: string;
  label: string;
  nonce: string;
  existingPeerId: string;
  existingHandle: string;
  existingUsed: boolean;
};

export type HubKeys = {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
  hubId: string;
};

export type VaultIndex = {
  activeId: string;
  profiles: ProfileSummary[];
  devices: LinkedDevice[];
  deletedPeerIds: Record<string, number>;
  hub: HubKeys | null;
  hubOnline: boolean;
  hubError: string;
  hubUrl: string;
  origin: string;
  /** True when launched with `make desktop` / `hutch electrobun dev`. */
  dev?: boolean;
};

export type ShellRPC = {
  bun: {
    requests: {
      getSecret: { params: Record<string, never>; response: { secret: string } };
      getVault: { params: { secret: string }; response: VaultIndex };
      setOrigin: { params: { secret: string; origin: string }; response: { origin: string } };
      setActiveProfile: { params: { secret: string; id: string }; response: { ok: boolean } };
      newProfile: { params: { secret: string }; response: { id: string } };
      renameProfile: { params: { secret: string; id: string; handle: string }; response: { ok: boolean } };
      deleteProfile: { params: { secret: string; id: string }; response: { ok: boolean } };
      startPairing: { params: { secret: string }; response: { hubId: string; nonce: string; origin: string } };
      openProfile: {
        params: { secret: string; profileId: string };
        response: { opened: boolean; hubId: string; nonce: string; origin: string };
      };
      retryHub: { params: { secret: string }; response: { ok: boolean } };
      stopPairing: { params: { secret: string }; response: { ok: boolean } };
      decideLink: {
        params: { secret: string; requestId: string; allow: boolean; profileId: string; importExisting?: boolean; label?: string };
        response: { ok: boolean };
      };
      renameDevice: { params: { secret: string; id: string; label: string }; response: { ok: boolean } };
      revokeDevice: { params: { secret: string; id: string }; response: { ok: boolean } };
      exportVault: { params: { secret: string }; response: { json: string } };
      importVault: { params: { secret: string; json: string }; response: { ok: boolean } };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      linkRequest: LinkRequest;
      hubReady: { hubId: string };
    };
  };
};

export type LiveRPC = {
  bun: {
    requests: {
      loadStore: { params: { profileId?: string }; response: { json: string | null; profileId: string } };
      saveStore: { params: { json: string; profileId?: string }; response: { ok: boolean } };
      getDevice: { params: Record<string, never>; response: { publicKey: JsonWebKey; privateKey: JsonWebKey } | null };
      saveDevice: { params: { publicKey: JsonWebKey; privateKey: JsonWebKey }; response: { ok: boolean } };
      getLanHost: { params: Record<string, never>; response: { host: string } };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: Record<string, never>;
  };
};

export type HubRPC = {
  bun: {
    requests: {
      getHub: { params: Record<string, never>; response: HubKeys };
      saveHub: { params: HubKeys; response: { ok: boolean } };
      pairingNonce: { params: Record<string, never>; response: { nonce: string } };
      hubListening: { params: { hubId: string; error?: string }; response: { ok: boolean } };
      reportLink: {
        params: {
          requestId: string;
          fingerprint: string;
          label: string;
          nonce: string;
          devicePublicKey: JsonWebKey | null;
          mode?: string;
          existingPeerId?: string;
          existingHandle?: string;
          existingUsed?: boolean;
          offerBlob?: string;
        };
        response: { allow: boolean; blob?: string; linkedVault?: Record<string, unknown> };
      };
      deviceAllowed: {
        params: { fingerprint: string; profilePeerId?: string };
        response: { ok: boolean };
      };
      getVaultBundle: { params: Record<string, never>; response: { json: string } };
      mergeVaultBundle: { params: { json: string }; response: { json: string } };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      setPairingNonce: { nonce: string };
    };
  };
};
