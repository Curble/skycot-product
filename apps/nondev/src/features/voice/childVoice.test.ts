import { describe, expect, it } from "vite-plus/test";

import { whereChildVoiceGoes } from "./copy";

describe("where a child's voice goes, for the parent", () => {
  it("names the company for each browser and recommends Safari away from it", () => {
    const chrome = whereChildVoiceGoes("google", "Ava");
    expect(chrome.where).toContain("sound of Ava's voice to Google");
    expect(chrome.advice).toContain("Safari");
    expect(whereChildVoiceGoes("microsoft", null).where).toContain(
      "the child's voice to Microsoft",
    );
    const safari = whereChildVoiceGoes("apple", "Ava");
    expect(safari.where).toContain("on the Mac itself");
    expect(safari.advice).toBeNull();
    expect(whereChildVoiceGoes("none", "Ava").where).toContain("can't listen");
  });
});
