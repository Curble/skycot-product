import { isLoopbackHost } from "./preview.ts";

// nondev-seam: brand-scheme-return-url
const DESKTOP_SCHEME = globalThis.process?.env?.T3CODE_DESKTOP_SCHEME ?? "t3code";

export function providerAuthReturnUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const desktop =
      [`${DESKTOP_SCHEME}:`, `${DESKTOP_SCHEME}-dev:`].includes(url.protocol) && url.host === "app";
    const web =
      ["http:", "https:"].includes(url.protocol) &&
      (isLoopbackHost(url.hostname) || url.origin === "https://app.t3.codes");
    if (
      url.username ||
      url.password ||
      (!desktop && !web) ||
      (url.pathname !== "/welcome" &&
        url.pathname !== "/settings" &&
        !url.pathname.startsWith("/settings/"))
    )
      return undefined;
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        url.pathname === "/welcome" ||
        !["machine", "project", "checkout", "environmentId", "instanceId"].includes(key)
      ) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== "/welcome" || !/^#agents:[\w-]+$/u.test(url.hash)) url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
