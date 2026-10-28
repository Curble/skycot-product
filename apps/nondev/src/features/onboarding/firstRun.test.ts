import { describe, expect, it } from "vite-plus/test";

import type { Route } from "../../router";
import { shouldShowOnboarding, showsFamilySetupCard } from "./onboarding";

const home: Route = { name: "home" };
const welcome: Route = { name: "welcome" };
const providers = [{ status: "ready" }] as never;
type Welcome = "done" | "skipped" | null;

describe("first run, every combination", () => {
  const welcomes: ReadonlyArray<Welcome> = [null, "skipped", "done"];
  const families: ReadonlyArray<boolean | null> = [null, false, true];
  const providerStates = [null, [], providers] as const;

  it("the welcome page itself always shows", () => {
    for (const w of welcomes)
      for (const f of families)
        for (const p of providerStates)
          expect(shouldShowOnboarding(welcome, p, w, f), `${w} ${f} ${p}`).toBe(true);
  });

  it("anywhere else it shows exactly once: engine answered, nothing recorded, profile off", () => {
    for (const w of welcomes)
      for (const f of families)
        for (const p of providerStates) {
          const expected = p !== null && f === false && w === null;
          expect(shouldShowOnboarding(home, p, w, f), `${w} ${f} ${p}`).toBe(expected);
        }
  });
});

describe("the Home set-up card", () => {
  const profile = { welcome: "skipped", source: "engine", enabled: false, legacy: false } as const;

  it("appears only after Skip, on the engine's word, while no profile exists", () => {
    const welcomes: ReadonlyArray<Welcome> = [null, "skipped", "done"];
    for (const welcomeState of welcomes) {
      expect(showsFamilySetupCard({ ...profile, welcome: welcomeState })).toBe(
        welcomeState === "skipped",
      );
    }
  });

  it("goes away once a profile exists, old or new, and never shows from the cache", () => {
    expect(showsFamilySetupCard({ ...profile, enabled: true })).toBe(false);
    expect(showsFamilySetupCard({ ...profile, legacy: true })).toBe(false);
    expect(showsFamilySetupCard({ ...profile, source: "cache" })).toBe(false);
  });
});
