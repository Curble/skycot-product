import { describe, expect, it } from "vite-plus/test";

import {
  assistantAgeTerms,
  assistantName,
  canAllowAssistant,
  isLockedDownAssistant,
  isNotAllowedRefusal,
  notAllowedSentence,
} from "./assistants.ts";

describe("assistants in the Family profile", () => {
  it("locks down Codex and Claude only, and lets a grown-up allow the rest", () => {
    expect(isLockedDownAssistant("codex")).toBe(true);
    expect(isLockedDownAssistant("claudeAgent")).toBe(true);
    expect(canAllowAssistant("codex")).toBe(false);
    expect(canAllowAssistant("claudeAgent")).toBe(false);
    for (const driver of ["cursor", "opencode", "grok", "antigravity", "pi", "muse", "acp"]) {
      expect(canAllowAssistant(driver)).toBe(true);
    }
    expect(canAllowAssistant("")).toBe(false);
    expect(canAllowAssistant("../cursor")).toBe(false);
    expect(canAllowAssistant("x".repeat(65))).toBe(false);
  });

  it("states only the age facts the site states, as of October 2026", () => {
    expect(assistantAgeTerms("claudeAgent").sentence).toBe(
      "As of October 2026, Anthropic's Claude requires every user to be 18 or over.",
    );
    expect(assistantAgeTerms("codex").sentence).toBe(
      "As of October 2026, OpenAI's terms allow 13 to 17 year olds with a parent's permission.",
    );
    expect(assistantAgeTerms("muse")).toEqual({
      sentence: "Check Muse's own terms for age rules.",
      link: null,
    });
    expect(assistantAgeTerms("acp").sentence).toBe(
      "Check this assistant's own terms for age rules.",
    );
  });

  it("refuses with a sentence the grown-up can act on, which the client recognises", () => {
    const sentence = notAllowedSentence("cursor");
    expect(sentence).toBe(
      "Cursor isn't allowed in the Family profile yet. SKYCOT can't switch off Cursor's own add-ons (plugins, connectors and helper tools set up on this computer), so a grown-up decides. A grown-up can allow Cursor with the parent code, here or in Settings › Family, or pick Codex or Claude for this conversation.",
    );
    expect(isNotAllowedRefusal(sentence)).toBe(true);
    expect(notAllowedSentence("acp").startsWith("This assistant isn't allowed")).toBe(true);
    expect(assistantName("opencode2")).toBe("OpenCode");
  });
});
