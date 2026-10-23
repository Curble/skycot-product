// A cookie jar for one home Mac. Through the relay the browser never talks to the Mac's
// address, so it cannot keep the Mac's session cookie itself; the tunnel keeps it here and adds
// it to every request it carries, exactly as the browser would for a page served by the Mac.
// Only what a single-origin session needs: name, value and expiry. Path and Domain do not apply
// (there is one origin, the Mac), and Secure/HttpOnly are about the browser's own jar.

export type CookieRecord = Readonly<
  Record<string, { readonly value: string; readonly expiresAt: number | null }>
>;

export function applySetCookie(
  jar: CookieRecord,
  setCookieHeaders: ReadonlyArray<string>,
  now: number,
): CookieRecord {
  const next: Record<string, { value: string; expiresAt: number | null }> = { ...jar };
  for (const header of setCookieHeaders) {
    const [pair, ...attributes] = header.split(";");
    if (pair === undefined) continue;
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) continue;
    let expiresAt: number | null = null;
    for (const attribute of attributes) {
      const [rawKey, ...rest] = attribute.split("=");
      const key = rawKey?.trim().toLowerCase();
      const attributeValue = rest.join("=").trim();
      if (key === "max-age") {
        const seconds = Number(attributeValue);
        if (Number.isFinite(seconds)) expiresAt = now + seconds * 1000;
      } else if (key === "expires" && expiresAt === null) {
        const when = Date.parse(attributeValue);
        if (Number.isFinite(when)) expiresAt = when;
      }
    }
    if (expiresAt !== null && expiresAt <= now) delete next[name];
    else next[name] = { value, expiresAt };
  }
  return next;
}

/** The `Cookie` header for a request now, or `null` when the jar has nothing live. */
export function cookieHeader(jar: CookieRecord, now: number): string | null {
  const live = Object.entries(jar).filter(
    ([, cookie]) => cookie.expiresAt === null || cookie.expiresAt > now,
  );
  return live.length === 0
    ? null
    : live.map(([name, cookie]) => `${name}=${cookie.value}`).join("; ");
}
