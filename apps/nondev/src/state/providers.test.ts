import { ProviderInstanceId, ServerProvider, type ModelSelection } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  automaticModelSelection,
  defaultAssistantPreference,
  isReadyProvider,
  resolveDefaultModelSelection,
  usableChosenSelection,
} from "./providers";

const decodeProvider = Schema.decodeUnknownSync(ServerProvider);

function model(slug: string, isDefault = false) {
  return { slug, name: slug, isCustom: false, isDefault, capabilities: null };
}

function provider(driver: string, fields: Record<string, unknown> = {}): ServerProvider {
  return decodeProvider({
    instanceId: driver,
    driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-24T02:00:00.000Z",
    models: [model(`${driver}-small`), model(`${driver}-best`, true)],
    ...fields,
  });
}

const signedOut = (driver: string) =>
  provider(driver, { status: "error", auth: { status: "unauthenticated" } });

const pick = (instanceId: string, slug: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model: slug,
});

describe("isReadyProvider", () => {
  it("is only true for an assistant the engine says is signed in and working", () => {
    expect(isReadyProvider(provider("claudeAgent"))).toBe(true);
    expect(isReadyProvider(signedOut("claudeAgent"))).toBe(false);
    // The pending snapshot a server start publishes, before any probe answered.
    expect(
      isReadyProvider(
        provider("claudeAgent", {
          installed: false,
          status: "warning",
          auth: { status: "unknown" },
        }),
      ),
    ).toBe(false);
  });
});

describe("automaticModelSelection", () => {
  it("never picks an installed assistant that is signed out", () => {
    // The beta 3 bug: Claude was installed but not signed in, and Settings called it the
    // ready default. Now nothing can run, so there is no default at all.
    expect(automaticModelSelection([signedOut("claudeAgent")])).toBeNull();
  });

  it("skips a signed-out assistant for the next one that is ready", () => {
    expect(automaticModelSelection([signedOut("claudeAgent"), provider("codex")])).toEqual(
      pick("codex", "codex-best"),
    );
  });

  it("prefers a ready assistant over one that only reports a warning", () => {
    const unsure = provider("antigravity", { status: "warning", auth: { status: "unknown" } });
    expect(automaticModelSelection([unsure, provider("codex")])).toEqual(
      pick("codex", "codex-best"),
    );
    // With nothing ready, the unsure one is still better than nothing.
    expect(automaticModelSelection([unsure])).toEqual(pick("antigravity", "antigravity-best"));
  });
});

describe("resolveDefaultModelSelection with a chosen default", () => {
  const providers = [provider("codex"), provider("claudeAgent")];

  it("keeps Automatic (the first ready) when nothing was chosen", () => {
    expect(resolveDefaultModelSelection(providers, null, { chosen: null })).toEqual(
      pick("codex", "codex-best"),
    );
    expect(resolveDefaultModelSelection(providers, null)).toEqual(pick("codex", "codex-best"));
  });

  it("starts new conversations with the chosen assistant and model", () => {
    const chosen = pick("claudeAgent", "claudeAgent-small");
    expect(resolveDefaultModelSelection(providers, null, { chosen })).toEqual(chosen);
  });

  it("uses the assistant's own default model when the chosen model is gone", () => {
    expect(
      resolveDefaultModelSelection(providers, null, { chosen: pick("claudeAgent", "retired") }),
    ).toEqual(pick("claudeAgent", "claudeAgent-best"));
  });

  it("falls back to Automatic while the chosen assistant needs signing in again", () => {
    const chosen = pick("claudeAgent", "claudeAgent-best");
    expect(
      resolveDefaultModelSelection([provider("codex"), signedOut("claudeAgent")], null, {
        chosen,
      }),
    ).toEqual(pick("codex", "codex-best"));
    expect(usableChosenSelection([signedOut("claudeAgent")], { chosen })).toBeNull();
  });

  it("lets a project's own default win over the person's default", () => {
    const projectDefault = pick("codex", "codex-small");
    expect(
      resolveDefaultModelSelection(
        providers,
        { defaultModelSelection: projectDefault },
        { chosen: pick("claudeAgent", "claudeAgent-best") },
      ),
    ).toEqual(projectDefault);
  });

  it("lets the Family allowance win over the chosen default", () => {
    const withCursor = [provider("codex"), provider("cursor")];
    const chosen = pick("cursor", "cursor-best");
    const notAllowed = defaultAssistantPreference(
      { defaultModelSelection: chosen },
      { enabled: true, allowedAssistants: [] },
    );
    expect(resolveDefaultModelSelection(withCursor, null, notAllowed)).toEqual(
      pick("codex", "codex-best"),
    );
    const allowed = defaultAssistantPreference(
      { defaultModelSelection: chosen },
      { enabled: true, allowedAssistants: ["cursor"] },
    );
    expect(resolveDefaultModelSelection(withCursor, null, allowed)).toEqual(chosen);
    // Off, the Family rule does not apply at all.
    const off = defaultAssistantPreference(
      { defaultModelSelection: chosen },
      { enabled: false, allowedAssistants: [] },
    );
    expect(off.mayUse).toBeUndefined();
    expect(resolveDefaultModelSelection(withCursor, null, off)).toEqual(chosen);
  });

  it("treats Codex and Claude as always allowed for the Family profile", () => {
    const preference = defaultAssistantPreference(
      { defaultModelSelection: pick("claudeAgent", "claudeAgent-best") },
      { enabled: true, allowedAssistants: [] },
    );
    expect(preference.mayUse?.("claudeAgent")).toBe(true);
    expect(preference.mayUse?.("codex")).toBe(true);
    expect(resolveDefaultModelSelection(providers, null, preference)).toEqual(
      pick("claudeAgent", "claudeAgent-best"),
    );
  });
});
