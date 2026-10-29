// nondev-seam: skycot-no-provider-update-prompt-logic
/**
 * Whether the automatic "Updates Available" pop-up may appear. Off in a SKYCOT build (its own
 * family flow installs and updates add-ons); on for plain T3 Code. Manual updates in
 * Settings > Providers are unaffected.
 */
export function shouldShowProviderUpdatePrompt(appBaseName: string): boolean {
  return appBaseName.trim().toLowerCase() !== "skycot";
}
