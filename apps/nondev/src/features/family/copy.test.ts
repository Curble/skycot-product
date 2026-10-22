import { describe, expect, it } from "vite-plus/test";

import brand from "../../../../../nondev/brand.json";
import { CLI_NAME, PRODUCT_NAME } from "../../brand";
import { actionReason } from "./copy";

describe("actionReason", () => {
  // QA FK-13: every card's code sheet said "uses the internet, installs something, deletes…".
  it("gives a grown-up card's own reason on its code sheet", () => {
    const reason = actionReason("approve", "It touches a secrets file or key.");
    expect(reason).toContain("It touches a secrets file or key.");
    expect(reason).not.toMatch(/installs something, deletes/);
    expect(actionReason("approve")).toMatch(/grown-up allows it/);
  });

  it("explains the new grown-up actions", () => {
    expect(actionReason("renameChild")).toMatch(/parent set up/);
    expect(actionReason("saveSecret")).toMatch(/key or password/);
  });
});

describe("brand", () => {
  // QA FK-15: the pairing screen told people to type T3's command.
  it("names the command and product brand.json names", () => {
    expect(CLI_NAME).toBe(brand.cliName);
    expect(PRODUCT_NAME).toBe(brand.productName);
  });
});
