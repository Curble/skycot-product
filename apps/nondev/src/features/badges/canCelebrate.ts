// A sticker never arrives on top of something that needs the child's attention: a safety
// card (personal details, an approval), any sheet or full-screen moment (a grown-up's code,
// the asleep screen, "Who's using SKYCOT?"), or a hidden window. The host just tries again
// a little later.
const BUSY = [".fm-shield", ".fm-approval", ".fm-family-cover", '[aria-modal="true"]'].join(",");

export function canCelebrateNow(): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState !== "visible") return false;
  return document.querySelector(BUSY) === null;
}
