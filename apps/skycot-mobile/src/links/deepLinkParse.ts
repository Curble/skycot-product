/**
 * Reading SKYCOT's links (src/links/deepLinks.tsx says which there are). Pure, so it is tested
 * without a device.
 */
export type DeepLink =
  | {
      readonly kind: "link";
      readonly code: string;
      readonly address: string;
      readonly go: boolean;
      /** The whole link from a Mac's QR code (development builds), relay part and all. */
      readonly scanned?: string;
    }
  | { readonly kind: "section"; readonly id: string }
  | { readonly kind: "conversation"; readonly macId: string; readonly threadId: string }
  | { readonly kind: "demo"; readonly name: "plan" | "ask" | "made" }
  | { readonly kind: "open"; readonly route: "Macs" | "About" };

export function parseDeepLink(url: string, development: boolean): DeepLink | null {
  // Read by hand: React Native's URL class is only partly there, and this must never throw.
  const match = /^skycot(?:-dev)?:\/\/([^?#]*)(?:\?([^#]*))?/u.exec(url.trim());
  if (match === null) return null;
  const parts = (match[1] ?? "").split("/").filter((part) => part.length > 0);
  const query = new Map<string, string>();
  for (const pair of (match[2] ?? "").split("&")) {
    if (pair.length === 0) continue;
    const [key, value = ""] = pair.split("=");
    try {
      query.set(decodeURIComponent(key!), decodeURIComponent(value.replace(/\+/gu, " ")));
    } catch {
      return null;
    }
  }
  const [head, a, b] = parts;
  if (head === "link") {
    const go = development && query.get("go") === "1";
    const scanned = development ? (query.get("url") ?? null) : null;
    if (scanned) return { kind: "link", code: "", address: "", go, scanned };
    const code = query.get("code") ?? "";
    if (code.length === 0) return null;
    return { kind: "link", code, address: query.get("address") ?? "", go };
  }
  if (head === "section" && a) return { kind: "section", id: a };
  if (head === "open" && (a === "macs" || a === "about")) {
    return { kind: "open", route: a === "macs" ? "Macs" : "About" };
  }
  if (head === "demo" && development && (a === "plan" || a === "ask" || a === "made")) {
    return { kind: "demo", name: a };
  }
  if (head === "conversation" && a && b) {
    try {
      return {
        kind: "conversation",
        macId: decodeURIComponent(a),
        threadId: decodeURIComponent(b),
      };
    } catch {
      return null;
    }
  }
  return null;
}
