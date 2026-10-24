import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsSectionList, visibleSettingsSections } from "./SettingsScreen";

describe("Settings in the child view", () => {
  it("renders only Appearance and Voice", () => {
    const sections = visibleSettingsSections(true, true);
    const html = renderToStaticMarkup(
      <SettingsSectionList sections={sections} columns={2} active="appearance" />,
    );
    expect(html).toContain("Appearance");
    expect(html).toContain("Voice");
    expect(html).not.toContain("AI assistants");
    expect(html).not.toContain("Sharing &amp; review");
  });

  it("shows the grown-up sections once the parent code has opened them", () => {
    // SettingsScreen passes childView && the code still locked, so an open code means false here.
    const ids = visibleSettingsSections(true, false).map((entry) => entry.id);
    expect(ids).toContain("family");
    expect(ids).toContain("assistants");
    expect(ids).not.toContain("advanced");
  });
});
