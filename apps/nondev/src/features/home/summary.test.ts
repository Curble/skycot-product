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
});
