// Forked from apps/mobile/metro.config.js (T3 Code, MIT), cut down: SKYCOT's app has no
// Uniwind themes, Shiki, licence generator or WebView stream scripts. It reads the workspace
// packages it shares with the Mac (skycot-rules, skycot-brand, contracts) and the plain
// client's pure modules in apps/nondev/src/plain.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const escapedWorkspaceRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver = {
  ...config.resolver,
  // The shared packages export TypeScript under the "import" condition only.
  unstable_conditionNames: [
    ...new Set([...(config.resolver?.unstable_conditionNames ?? []), "import", "react-native"]),
  ],
  blockList: [
    ...(Array.isArray(config.resolver?.blockList)
      ? config.resolver.blockList
      : config.resolver?.blockList
        ? [config.resolver.blockList]
        : []),
    new RegExp(`${escapedWorkspaceRoot}[/\\\\]\\.t3[/\\\\].*`),
    new RegExp(`${escapedWorkspaceRoot}[/\\\\]apps[/\\\\]skycot-mobile[/\\\\]ios[/\\\\].*`),
  ],
};

module.exports = config;
