import { describe, expect, it } from "vite-plus/test";

import { notAllowedSentence } from "@t3tools/skycot-rules/assistants";

import { refusedDriver } from "../conversation/cards/AssistantRefusalNote";
import {
  allowSheetCopy,
  ASSISTANT_STATE_LABEL,
  assistantFamilyState,
  assistantStateLine,
  familyAgeTermsNote,
  familyAssistantOrder,
  isAssistantRefusal,
  refusalCardCopy,
} from "./assistantAllowance";
import { familyCopy } from "./copy";
import { parseServerStatus, viewFromStatus } from "./family";

const TECHNICAL = /add-on|plugin|connector|provider|driver|engine|session|MCP|helper tool/i;

describe("which assistants a child can use", () => {
  it("keeps Codex and Claude locked down, whatever the list says", () => {
    expect(assistantFamilyState("codex", [])).toBe("locked-down");
    expect(assistantFamilyState("claudeAgent", ["claudeAgent"])).toBe("locked-down");
    expect(ASSISTANT_STATE_LABEL["locked-down"]).toBe("Locked down");
  });

  it("shows the others as allowed by a grown-up or not allowed", () => {
    expect(assistantFamilyState("cursor", ["cursor"])).toBe("allowed");
    expect(assistantFamilyState("opencode", ["cursor"])).toBe("not-allowed");
    expect(ASSISTANT_STATE_LABEL.allowed).toBe("Allowed by a grown-up");
    expect(ASSISTANT_STATE_LABEL["not-allowed"]).toBe("Not allowed");
    expect(assistantStateLine("allowed")).toMatch(/other Family rules still apply/);
    expect(assistantStateLine("not-allowed")).toMatch(/until a grown-up allows it/);
  });

  it("lists Codex and Claude first, each assistant once", () => {
    expect(familyAssistantOrder(["cursor", "codex", "grok", "claudeAgent", "cursor"])).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
    ]);
  });

  it("reads the engine's list, and none while the profile is off or from an older engine", () => {
    const base = {
      enabled: true,
      childName: null,
      createdAt: null,
      attemptsLeft: 5,
      lockedForMs: 0,
      children: [],
      timeZone: null,
    };
    const status = parseServerStatus({ ...base, allowedAssistants: ["cursor", 7] })!;
    expect(viewFromStatus(status, 0, false).allowedAssistants).toEqual(["cursor"]);
    expect(viewFromStatus(parseServerStatus(base)!, 0, false).allowedAssistants).toEqual([]);
    expect(viewFromStatus({ ...status, enabled: false }, 0, false).allowedAssistants).toEqual([]);
  });
});

describe("the allow sheet", () => {
  it("shows the assistant's own age rules, with its terms where SKYCOT cites them", () => {
    const cursor = allowSheetCopy("cursor");
    expect(cursor.title).toBe("Allow Cursor for the Family profile?");
    expect(cursor.age.sentence).toBe(
      "As of October 2026, Cursor requires every user to be 18 or over.",
    );
    expect(cursor.age.link).toBe("https://cursor.com/terms-of-service");
    expect(cursor.linkLabel).toBe("Read Cursor's terms");
    expect(allowSheetCopy("antigravity").age.sentence).toMatch(/^Google sets its own rules/);
  });

  it("says plainly to check the terms when SKYCOT states no age fact, and invents no link", () => {
    const pi = allowSheetCopy("pi");
    expect(pi.age.sentence).toBe("Check Pi's own terms for age rules.");
    expect(pi.age.link).toBeNull();
    expect(allowSheetCopy("opencode").age.link).toBeNull();
  });

  it("says what SKYCOT can't switch off, and what still applies", () => {
    const copy = allowSheetCopy("opencode");
    expect(copy.addOns).toBe(
      "SKYCOT can't switch off OpenCode's own add-ons (plugins, connectors and helper tools set up on this computer), so a child using OpenCode may reach them.",
    );
    for (const rule of [
      "every step is checked",
      "plan first",
      "shield",
      "bedtime and limits",
      "parent code",
    ]) {
      expect(copy.stillApplies).toContain(rule);
    }
    expect(copy.confirm).toBe("Allow OpenCode");
  });

  it("uses no em dashes in its new copy", () => {
    for (const driver of ["cursor", "pi", "codex", "claudeAgent"]) {
      const copy = allowSheetCopy(driver);
      const words = [
        copy.title,
        copy.description,
        copy.age.sentence,
        copy.addOns,
        copy.stillApplies,
        copy.codeHelp,
        copy.done,
        ...Object.values(refusalCardCopy(driver)),
      ];
      for (const line of words) expect(line).not.toContain("—");
    }
    expect(familyAgeTermsNote()).not.toContain("—");
  });
});

describe("the chat card for a refused assistant", () => {
  it("recognises the engine's refusal sentence, and nothing else", () => {
    expect(isAssistantRefusal(notAllowedSentence("cursor"))).toBe(true);
    expect(isAssistantRefusal(notAllowedSentence("acp"))).toBe(true);
    expect(isAssistantRefusal("Provider turn failed.")).toBe(false);
    expect(isAssistantRefusal(null)).toBe(false);
  });

  it("finds the assistant from the conversation's provider thread", () => {
    const projection = {
      providerThreads: [{ id: "pt-1", driver: "cursor" }],
    } as never;
    expect(refusedDriver({ providerThreadId: "pt-1" } as never, projection)).toBe("cursor");
    expect(refusedDriver({ providerThreadId: "pt-2" } as never, projection)).toBeNull();
    expect(refusedDriver({ providerThreadId: null } as never, projection)).toBeNull();
  });

  it("tells the child to ask a grown-up, in plain words", () => {
    const copy = refusalCardCopy("cursor");
    expect(familyCopy.fetchGrownUp).toBe("Time to find a grown-up");
    expect(copy.title).toBe("Ask a grown-up to say yes");
    expect(copy.body).toBe(
      "Cursor can't help here until a grown-up says yes. Your message wasn't sent to it.",
    );
    expect(copy.title).not.toMatch(TECHNICAL);
    expect(copy.body).not.toMatch(TECHNICAL);
  });

  it("gives the grown-up the allow button, and the next step once allowed", () => {
    const copy = refusalCardCopy("cursor");
    expect(copy.grownUp).toMatch(/^For a grown-up: /);
    expect(copy.grownUp).toContain("with the parent code");
    expect(copy.allow).toBe("Allow Cursor for the Family profile…");
    expect(copy.allowedTitle).toBe("Cursor is allowed now");
    expect(copy.allowedBody).toBe("Send the message again to start.");
    expect(refusalCardCopy(null).grownUp).toContain("Settings › Family");
  });
});

describe("where a parent picks an assistant for a child", () => {
  it("shows Codex's and Claude's age rules, as the site states them", () => {
    const note = familyAgeTermsNote();
    expect(note).toContain("OpenAI's terms allow 13 to 17 year olds with a parent's permission");
    expect(note).toContain("Anthropic's Claude requires every user to be 18 or over");
    expect(note).toContain("Settings › Family");
  });
});
