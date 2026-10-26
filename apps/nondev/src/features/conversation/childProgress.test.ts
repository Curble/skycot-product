import { describe, expect, it } from "vite-plus/test";

import { childProgressSentence } from "./childProgress";

describe("childProgressSentence", () => {
  it("hides technical details behind child-safe progress lines", () => {
    expect(childProgressSentence("web")).toBe("Looking something up on the internet");
    expect(childProgressSentence("search")).toBe("Looking through your project");
    expect(childProgressSentence("command")).toBe("Working on your project");
    expect(childProgressSentence("edit")).toBe("Saving a change");
    expect(childProgressSentence("subagent")).toBe("Sam is getting help");
    expect(childProgressSentence("read")).toBe("Checking something in your project");
  });
});
