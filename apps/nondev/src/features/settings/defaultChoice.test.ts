import { ProviderInstanceId, ServerProvider, type ModelSelection } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { defaultAssistantPreference } from "../../state/providers";
import { AUTOMATIC, defaultChoiceFooter, defaultChoiceModel } from "./defaultChoice";
import { isProviderReady, isStillChecking, statusSentence } from "./providerCatalog";

const decodeProvider = Schema.decodeUnknownSync(ServerProvider);

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
    models: [
      {
        slug: `${driver}-best`,
        name: "Best",
        isCustom: false,
        isDefault: true,
        capabilities: null,
      },
      { slug: `${driver}-small`, name: "Small", isCustom: false, capabilities: null },
    ],
    ...fields,
  });
}

const signedOut = (driver: string) =>
  provider(driver, {
    status: "error",
    auth: { status: "unauthenticated" },
    message: "Claude Code is not authenticated. Run `claude auth login` and try again.",
  });
const pending = (driver: string) =>
  provider(driver, {
    installed: false,
    status: "warning",
    auth: { status: "unknown" },
    message: "Claude provider status has not been checked in this session yet.",
  });

const pick = (instanceId: string, slug: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model: slug,
});

const OFF = { enabled: false, allowedAssistants: [] };
const ADVANCED = "Advanced mode";

describe("the Ready a provider row shows", () => {
  it("says Ready only when the engine reports the assistant signed in", () => {
    expect(isProviderReady(provider("claudeAgent"))).toBe(true);
    expect(isProviderReady(signedOut("claudeAgent"))).toBe(false);
    expect(statusSentence(signedOut("claudeAgent"))).toBe("Installed. Needs you to sign in.");
  });

  it("says Checking… while the engine has not answered, never Ready or a sign-in", () => {
    expect(isProviderReady(pending("claudeAgent"))).toBe(false);
    expect(isStillChecking(pending("claudeAgent"), "claudeAgent")).toBe(true);
    expect(isStillChecking(undefined, "claudeAgent")).toBe(true);
    expect(statusSentence(pending("claudeAgent"))).toBe("Checking…");
    // Codex has no snapshot until its managed sign-in starts, so it offers the sign-in.
    expect(isStillChecking(undefined, "codex")).toBe(false);
    expect(isStillChecking(signedOut("claudeAgent"), "claudeAgent")).toBe(false);
    expect(isStillChecking(provider("claudeAgent"), "claudeAgent")).toBe(false);
  });
});

describe("defaultChoiceModel", () => {
  it("offers Automatic plus only the assistants that are installed and signed in", () => {
    const model = defaultChoiceModel(
      [provider("codex"), signedOut("claudeAgent"), pending("antigravity")],
      defaultAssistantPreference(null, OFF),
    );
    expect(model.rows.map((row) => row.value)).toEqual([AUTOMATIC, "codex"]);
    expect(model.checked).toBe(AUTOMATIC);
    expect(model.inUse).toBe("ChatGPT");
    expect(model.rows[0]!.subtitle).toBe(
      "The first assistant that is ready. Right now that's ChatGPT.",
    );
    expect(model.rows[1]!.subtitle).toBe("Codex, from OpenAI. Signed in and ready.");
    expect(model.rows[1]!.selection).toEqual(pick("codex", "codex-best"));
  });

  it("never calls a signed-out Claude the ready default (the beta 3 bug)", () => {
    const model = defaultChoiceModel(
      [signedOut("claudeAgent")],
      defaultAssistantPreference(null, OFF),
    );
    expect(model.rows.map((row) => row.value)).toEqual([AUTOMATIC]);
    expect(model.inUse).toBeNull();
    expect(defaultChoiceFooter(model, { familyOn: false, advancedLabel: ADVANCED })).toBe(
      "Once an assistant is ready it will be used for new conversations.",
    );
  });

  it("ticks the chosen assistant and keeps the model Advanced mode picked for it", () => {
    const chosen = pick("claudeAgent", "claudeAgent-small");
    const model = defaultChoiceModel(
      [provider("codex"), provider("claudeAgent")],
      defaultAssistantPreference({ defaultModelSelection: chosen }, OFF),
    );
    expect(model.checked).toBe("claudeAgent");
    expect(model.inUse).toBe("Claude");
    expect(model.chosenUnavailable).toBe(false);
    expect(model.rows.find((row) => row.value === "claudeAgent")!.selection).toEqual(chosen);
    expect(defaultChoiceFooter(model, { familyOn: false, advancedLabel: ADVANCED })).toBe(
      "New conversations start with Claude. You can still pick another one for a single conversation in Advanced mode.",
    );
  });

  it("keeps a chosen assistant that needs signing in again, ticked but waiting", () => {
    const model = defaultChoiceModel(
      [provider("codex"), signedOut("claudeAgent")],
      defaultAssistantPreference(
        { defaultModelSelection: pick("claudeAgent", "claudeAgent-best") },
        OFF,
      ),
    );
    const row = model.rows.find((entry) => entry.value === "claudeAgent")!;
    expect(row.disabled).toBe(true);
    expect(row.subtitle).toBe(
      "Installed. Needs you to sign in. New conversations use ChatGPT until then.",
    );
    expect(model.checked).toBe("claudeAgent");
    expect(model.inUse).toBe("ChatGPT");
    expect(model.chosenUnavailable).toBe(true);
  });

  it("with the Family profile on, lists only allowed assistants and says the code is needed", () => {
    const providers = [provider("codex"), provider("cursor")];
    const model = defaultChoiceModel(
      providers,
      defaultAssistantPreference(null, { enabled: true, allowedAssistants: [] }),
    );
    expect(model.rows.map((row) => row.value)).toEqual([AUTOMATIC, "codex"]);
    expect(defaultChoiceFooter(model, { familyOn: true, advancedLabel: ADVANCED })).toMatch(
      /Changing this asks for the parent code\.$/,
    );

    const chosenCursor = defaultChoiceModel(
      providers,
      defaultAssistantPreference(
        { defaultModelSelection: pick("cursor", "cursor-best") },
        { enabled: true, allowedAssistants: [] },
      ),
    );
    const cursor = chosenCursor.rows.find((row) => row.value === "cursor")!;
    expect(cursor.disabled).toBe(true);
    expect(cursor.subtitle).toBe(
      "Not allowed for the Family profile. New conversations use ChatGPT until then.",
    );
    expect(chosenCursor.inUse).toBe("ChatGPT");
  });
});
