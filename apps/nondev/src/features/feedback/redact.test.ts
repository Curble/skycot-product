import { describe, expect, it } from "vite-plus/test";

import { redactForFeedback, removeNames } from "./redact";

describe("redactForFeedback", () => {
  it("strips home-folder paths", () => {
    const out = redactForFeedback("failed at /Users/me/Documents/Ava school/page.html now");
    expect(out).not.toContain("MarkMark");
    expect(out).not.toContain("Documents");
    expect(out).toContain("[path]");
    expect(redactForFeedback("open ~/Desktop/x.txt")).toBe("open [path]");
  });
  it("strips email addresses", () => {
    expect(redactForFeedback("sent to mum@example.com ok")).toBe("sent to [email] ok");
  });
  it("strips 4 to 8 digit numbers and leaves short ones", () => {
    expect(redactForFeedback("code 123456 and 4821, port 80, 12")).toBe(
      "code [number] and [number], port 80, 12",
    );
    expect(redactForFeedback("pin 12345678")).toBe("pin [number]");
  });
  it("strips links to other hosts but keeps skycot.com", () => {
    expect(redactForFeedback("see https://evil.example.org/a?b=1 here")).toBe("see [link] here");
    expect(redactForFeedback("see https://www.skycot.com/privacy 2026")).toBe(
      "see https://www.skycot.com/privacy [number]",
    );
    expect(redactForFeedback("https://skycot.com/x1234")).toBe("https://skycot.com/x1234");
    expect(redactForFeedback("https://skycot.com.evil.io/x")).toBe("[link]");
  });
  it("strips long ids", () => {
    expect(redactForFeedback("thread a1b2c3d4-e5f6-4711-8899-aabbccddeeff failed")).not.toContain(
      "a1b2c3d4",
    );
  });
  it("leaves plain sentences alone", () => {
    expect(redactForFeedback("Connection dropped, retrying")).toBe("Connection dropped, retrying");
  });
});

describe("removeNames", () => {
  it("removes a name as a whole word in any case", () => {
    expect(removeNames("ava asked; Avalon fine; AVA.", ["Ava"])).toBe(
      "[name] asked; Avalon fine; [name].",
    );
  });
});
