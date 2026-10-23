import { describe, expect, it } from "vite-plus/test";

import { titleFrom } from "./titles";

describe("a new conversation's first name", () => {
  it("keeps the thing being made, in the child's words", () => {
    expect(titleFrom("Please make a simple space game with a rocket and stars.")).toBe(
      "A simple space game",
    );
    expect(titleFrom("Can you make me a birthday card for Nan")).toBe("A birthday card for Nan");
    expect(titleFrom("Why is the sky blue?")).toBe("Why is the sky blue");
    expect(titleFrom("")).toBe("A new idea");
  });
});
