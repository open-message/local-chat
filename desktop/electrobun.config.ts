import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Local Chat",
    identifier: "org.open-message.local-chat",
    version: "0.1.0",
  },
  build: {
    // Electrobun 2.0.1 still pins Cottontail 0.5.0 for the app runtime, but
    // Hutch 0.26 looks for bin/cottontail-core (a 0.6.0 layout) and fails with
    // CopySourceMissing. Bun is the supported fallback on this toolchain pair.
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      shell: { entrypoint: "src/shell/index.ts" },
      preload: { entrypoint: "src/preload/index.ts" },
      hub: { entrypoint: "src/hub/index.ts" },
    },
    copy: {
      "src/shell/index.html": "views/shell/index.html",
      "src/shell/index.css": "views/shell/index.css",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
