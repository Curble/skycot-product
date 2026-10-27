import { describe, expect, it } from "vite-plus/test";

import { buildReport, feedbackSubject, mailtoUrl, type FeedbackDetails } from "./report";

const details: FeedbackDetails = {
  appVersion: "0.6.0",
  engineVersion: "0.6.0",
  computer: "macOS (arm64)",
  familyProfileOn: true,
  readingLevel: "makers",
  logLines: [
    "warn opened /Users/me/Ava/page.html",
    "error Ava could not sign in as mum@example.com",
  ],
};

describe("buildReport", () => {
  it("is only the message when details are off", () => {
    const report = buildReport({ type: "broke", message: " It froze ", details: null });
    expect(report).toBe("It froze");
  });
  it("includes the details, redacted, when on", () => {
    const report = buildReport({
      type: "broke",
      message: "It froze",
      details,
      childNames: ["Ava"],
    });
    expect(report).toContain("Family profile: on");
    expect(report).toContain("Reading level: Makers (8–10)");
    expect(report).toContain("version: 0.6.0");
    expect(report).not.toContain("MarkMark");
    expect(report).not.toContain("mum@example.com");
    expect(report).not.toContain("Ava");
  });
  it("keeps only the last 20 log lines", () => {
    const logLines = Array.from({ length: 30 }, (_, i) => `line-${i}`);
    const report = buildReport({ type: "idea", message: "x", details: { ...details, logLines } });
    expect(report).not.toContain("line-9\n");
    expect(report).toContain("line-10");
    expect(report).toContain("line-29");
  });
  it("says so when there are no engine messages", () => {
    const report = buildReport({
      type: "idea",
      message: "x",
      details: { ...details, logLines: [] },
    });
    expect(report).toContain("Recent engine messages: none");
  });
});

describe("mailtoUrl", () => {
  it("addresses hello@skycot.com with the type in the subject and the report as the body", () => {
    const url = mailtoUrl("confusing", "Hi & bye");
    expect(url.startsWith("mailto:hello@skycot.com?subject=")).toBe(true);
    expect(decodeURIComponent(url)).toContain(feedbackSubject("confusing"));
    expect(url).toContain("body=Hi%20%26%20bye");
  });
});
