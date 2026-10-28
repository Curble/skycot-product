// The grown-up proof for this window, kept in memory only (never stored on disk). The engine also
// sets it as an HttpOnly cookie, but the Mac app's page (skycot://app) is not the engine's origin,
// so the cookie never comes back; this copy travels as a header instead.
let proof: string | null = null;

export function keepUnlockProof(token: string | null | undefined) {
  if (typeof token === "string" && token.length > 0) proof = token;
}

export function readUnlockProof(): string | null {
  return proof;
}

export function forgetUnlockProof() {
  proof = null;
}
