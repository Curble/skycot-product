import { describe, expect, it } from "vite-plus/test";

import { summarySentence } from "./summary";

describe("summarySentence", () => {
  it("keeps the noun when only one kind of job exists", () => {
    expect(summarySentence(0, 1, 0, 3)).toBe("One job is waiting on you.");
    expect(summarySentence(0, 0, 2, 3)).toBe("2 jobs are ready to look at.");
  });

  it("says the noun once across several parts", () => {
    expect(summarySentence(1, 1, 0, 4)).toBe("One job is running, one is waiting on you.");
    expect(summarySentence(2, 0, 3, 9)).toBe("2 jobs are running, 3 are ready to look at.");
  });

  it("does not claim there is nothing while the Mac is unreachable", () => {
    expect(summarySentence(0, 0, 0, 0, false)).toMatch(/Waiting for your Mac/);
    expect(summarySentence(0, 0, 0, 0, true)).toMatch(/Nothing is on the go yet/);
  });

  it("uses child words for their things", () => {
    expect(summarySentence(1, 0, 0, 1, true, true)).toBe("One thing is being made.");
  });

  it("keeps a grown-up request separate from something waiting on the child", () => {
    expect(summarySentence(0, 1, 0, 2, true, true, 1)).toBe(
      "One thing is waiting on you, one thing needs a grown-up.",
    );
  });
});
