import { describe, expect, it } from "vite-plus/test";

import { greeting } from "./greeting";

describe("home greeting", () => {
  it("uses a neutral greeting overnight", () => {
    expect(greeting(4)).toBe("Hello");
    expect(greeting(5)).toBe("Good morning");
    expect(greeting(16)).toBe("Good afternoon");
    expect(greeting(17)).toBe("Good evening");
  });
});
