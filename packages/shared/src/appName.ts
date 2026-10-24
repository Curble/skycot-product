// nondev-seam: brand-advanced-app-name
/**
 * The product name people read: `T3CODE_APP_BASE_NAME` (`SKYCOT` from nondev/brand/env.cjs), or
 * "T3 Code" when it is unset, so upstream text is unchanged.
 *
 * Runs in Node and in the browser. The web build defines `process.env.T3CODE_APP_BASE_NAME`
 * (apps/web/vite.config.ts), so the literal lands in the bundle; a bundle without that define
 * has no `process`, and the name stays "T3 Code".
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

export const APP_NAME: string = (() => {
  try {
    return process.env.T3CODE_APP_BASE_NAME || "T3 Code";
  } catch {
    return "T3 Code";
  }
})();
