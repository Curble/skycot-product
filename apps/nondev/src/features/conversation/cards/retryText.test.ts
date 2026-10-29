import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { retryTextFor } from "./retryText";

const user = (text: string) =>
  ({ type: "user_message", createdBy: "user", text }) as unknown as OrchestrationV2TurnItem;
const sam = () => ({ type: "assistant_message" }) as unknown as OrchestrationV2TurnItem;
const error = () => ({ type: "error" }) as unknown as OrchestrationV2TurnItem;

describe("retryTextFor", () => {
  it("returns the child's message before the latest error", () => {
    expect(retryTextFor([user("make a ball"), sam(), error()], 2)).toBe("make a ball");
  });
  it("is null once a newer message or error exists", () => {
    expect(retryTextFor([user("a"), error(), user("b")], 1)).toBeNull();
    expect(retryTextFor([user("a"), error(), error()], 1)).toBeNull();
  });
  it("is null with no message to resend", () => {
    expect(retryTextFor([error()], 0)).toBeNull();
    expect(retryTextFor([user("  "), error()], 1)).toBeNull();
  });
});
