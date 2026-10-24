/**
 * (Not used by the phone's screens now: Face ID says yes with this phone's own Secure Enclave
 * key, src/faceid, which needs no web address. Kept for the passkey route, which the plain
 * client in a browser still uses.)
 *
 * Face ID to say yes, through a passkey: Phase 1's design (WHO-IS-WHO, "Passkeys and the
 * relying party"). A passkey belongs to a secure web address, and an iPhone app may only use
 * one for an address Apple has seen it own (an "associated domain"). The home Wi-Fi address of
 * a Mac is neither, so on this phone, today, the parent code says yes.
 *
 * What switches it on: SKYCOT Relay (Phase 2) gives every Mac one stable https address, and
 * the app is signed with that domain's `webcredentials:` entitlement (an Apple Developer step
 * for Mark). Then `passkeySupport` turns on iOS's passkey sheet, and the Mac's existing
 * routes (`/devices/passkey/*`, `/approver/challenge`) work unchanged.
 */
export interface PasskeySupport {
  readonly possible: boolean;
  /** Why not, in the words the Phase 1 phone uses for an insecure address. */
  readonly reason: string | null;
}

export const PASSKEYS_WAIT_FOR_RELAY =
  "Face ID needs a secure connection to the Mac, which this address isn't. Use the parent code for now; SKYCOT Relay will bring Face ID to phones away from the Mac.";

export function passkeySupport(): PasskeySupport {
  return { possible: false, reason: PASSKEYS_WAIT_FOR_RELAY };
}
