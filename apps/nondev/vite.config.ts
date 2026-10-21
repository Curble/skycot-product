import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import pkg from "./package.json" with { type: "json" };

import {
  DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES,
  DEV_PROXIED_PATH_PREFIXES,
} from "@t3tools/shared/devProxy";

import { loadRepoEnv } from "../../scripts/lib/public-config";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

// Mirrors apps/web/vite.config.ts: single-origin dev is signalled positively
// because `loadRepoEnv` merges `.env` underneath the process env.
const isSingleOriginDev = process.env.T3CODE_SINGLE_ORIGIN_DEV === "1";

// The dev runner hands every browser package the same PORT (the web Vite's).
// Offset from it so `vp run dev` can start both clients side by side; an
// explicit T3CODE_NONDEV_PORT wins.
const webPort = Number(process.env.PORT ?? 5733);
const port = Number(process.env.T3CODE_NONDEV_PORT ?? webPort + 66);
const explicitHost = process.env.HOST?.trim();
const host = explicitHost || "localhost";
const configuredWsUrl = isSingleOriginDev ? undefined : process.env.VITE_WS_URL?.trim();
const configuredHttpUrl = isSingleOriginDev ? undefined : process.env.VITE_HTTP_URL?.trim();
const configuredAppVersion = process.env.APP_VERSION?.trim() || pkg.version;

function resolveDevProxyTarget(
  backendPort: string | undefined,
  wsUrl: string | undefined,
): string | undefined {
  const backend = Number(backendPort?.trim());
  if (Number.isInteger(backend) && backend > 0) {
    return `http://localhost:${backend}/`;
  }
  if (!wsUrl) {
    return undefined;
  }
  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const devProxyTarget = resolveDevProxyTarget(process.env.T3CODE_PORT, configuredWsUrl);

const webSrc = new URL("../web/src/", import.meta.url).pathname;

export default defineConfig(() => {
  return {
    // Served beside the stock UI at <server>/simple/ (apps/server/scripts/cli.ts
    // copies dist/ to dist/client/simple). Routes live in the URL hash so the
    // server's SPA fallback, which serves the stock index.html, never fires.
    base: "/simple/",
    plugins: [react({ compiler: true }), tailwindcss()],
    define: {
      // Never bake an origin into a browser bundle; the client resolves the
      // backend from window.location.origin (AGENTS.md, "three ways to hurt yourself" #3).
      "import.meta.env.VITE_WS_URL": JSON.stringify(configuredWsUrl ?? ""),
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? ""),
      // The aliased apps/web modules read every key below; pin them so none is undefined.
      "import.meta.env.VITE_T3CODE_RELAY_URL": JSON.stringify(""),
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(""),
      "import.meta.env.VITE_CLERK_JWT_TEMPLATE": JSON.stringify(""),
      "import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID": JSON.stringify(""),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_URL": JSON.stringify(""),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_DATASET": JSON.stringify(""),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_TOKEN": JSON.stringify(""),
      "import.meta.env.VITE_HOSTED_APP_URL": JSON.stringify(""),
      "import.meta.env.VITE_HOSTED_APP_CHANNEL": JSON.stringify(""),
      "import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY": JSON.stringify(""),
      "import.meta.env.APP_VERSION": JSON.stringify(configuredAppVersion),
    },
    resolve: {
      // Order matters: the specific shim first keeps apps/web's composer draft
      // store (which `~/lib/utils` drags in) out of this bundle.
      alias: [
        {
          find: "~/lib/utils",
          replacement: new URL("./src/lib/utils.ts", import.meta.url).pathname,
        },
        { find: /^~\//, replacement: webSrc },
      ],
      dedupe: ["react", "react-dom"],
    },
    server: {
      host,
      port,
      strictPort: true,
      allowedHosts: [".ts.net"],
      ...(devProxyTarget
        ? {
            // One entry per shared prefix; the server's dev catch-all 404s the
            // same list, so the two sides cannot drift.
            proxy: Object.fromEntries(
              DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
                prefix,
                {
                  target: devProxyTarget,
                  changeOrigin: !DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES.has(prefix),
                  ...(prefix === "/ws" || prefix === "/api" ? { ws: true } : {}),
                },
              ]),
            ),
          }
        : {}),
      ...(explicitHost
        ? {
            hmr: {
              protocol: "ws",
              host: explicitHost,
              clientPort: port,
            },
          }
        : {}),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      manifest: true,
    },
  };
});
