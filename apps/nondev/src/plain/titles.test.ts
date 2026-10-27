import { describe, expect, it } from "vite-plus/test";

import { friendlyTitle, projectTitleFromFirstMake, promptTitle } from "./titles";

describe("friendlyTitle", () => {
  // Real titles the assistant wrote in the beta walkthrough (Ava and Leo).
  it.each([
    ["Create an Offline Bubbles Pet Page", "Bubbles pet page"],
    ["Build Twinkling Rocket Drawing Page", "Twinkling rocket"],
    ["Build Offline Rocket Star Catcher", "Rocket star catcher"],
    ["Create an Offline Dinosaur Quiz", "Dinosaur quiz"],
    ["Create Nan’s 80th Birthday Card", "Nan’s 80th birthday card"],
    ["Add Button to Make Dog Wag", "Button to make dog wag"],
    ["Make a Birthday Card for Mum", "Birthday card for Mum"],
    ["Design Simple Space Invaders Game App", "Space invaders game"],
    ["Create Interactive Volcano School Project Page", "Volcano school project"],
    ["Build a Quiz App", "Quiz app"],
  ])("%s → %s", (title, friendly) => {
    expect(friendlyTitle(title)).toBe(friendly);
  });

  it("leaves titles a person wrote or chose alone", () => {
    expect(friendlyTitle("my bubbles page")).toBe("my bubbles page");
    expect(friendlyTitle("Make a rocket go zoom")).toBe("Make a rocket go zoom");
    expect(friendlyTitle("Create Nan’s Card", { renamed: true })).toBe("Create Nan’s Card");
    expect(friendlyTitle("  Bubbles!  ")).toBe("Bubbles!");
  });

  it("keeps the original when stripping would leave nothing", () => {
    expect(friendlyTitle("Create Page")).toBe("Create Page");
    expect(friendlyTitle("")).toBe("");
  });
});

describe("raw request titles", () => {
  it("summarises the thing and drops the instructions", () => {
    const prompt =
      "make a page with a big friendly robot that waves when i click it and counts the clicks";
    expect(promptTitle(prompt)).toBe("Big Friendly Robot");
    expect(friendlyTitle(prompt)).toBe("Big Friendly Robot");
    expect(friendlyTitle(prompt, { renamed: true })).toBe(prompt);
    expect(promptTitle("Please make a birthday card for Mum with stars")).toBe(
      "Birthday Card For Mum",
    );
  });
});

describe("first project name", () => {
  it("uses a kid-friendly make name and keeps it within 32 characters", () => {
    expect(projectTitleFromFirstMake("make a page with a big friendly robot that waves")).toBe(
      "Big Friendly Robot",
    );
    expect(
      projectTitleFromFirstMake("my very long dinosaur project title with lots of extra words"),
    ).toHaveLength(32);
  });
});
