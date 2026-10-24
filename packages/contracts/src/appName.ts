// nondev-seam: brand-advanced-contracts-app-name
/**
 * The product name in contract copy people read: `T3CODE_APP_BASE_NAME` (`SKYCOT` from
 * nondev/brand/env.cjs), or "T3 Code" when it is unset. Same rule as packages/shared appName.ts
 * (contracts cannot depend on shared): the web build defines `process.env.T3CODE_APP_BASE_NAME`
 * (apps/web/vite.config.ts); a bundle without the define has no `process` and keeps "T3 Code".
 * Internal: not exported from the package index.
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

export const APP_NAME: string = (() => {
  try {
    return process.env.T3CODE_APP_BASE_NAME || "T3 Code";
  } catch {
    return "T3 Code";
  }
})();
