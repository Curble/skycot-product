import { describe, expect, it } from "vite-plus/test";

import { grownUpRequestSentence, parsePendingRequests, requestHeading } from "./people";

describe("page internet approvals", () => {
  it("keeps page and exact sites for the Requests and Watch wording", () => {
    const requests = parsePendingRequests({
      requests: [
        {
          threadId: "thread-1",
          requestId: "page-internet:ask-1",
          target: "page-internet",
          childId: "ava",
          createdAt: 1,
          needsGrownUp: true,
          kind: "page-internet",
          page: "/games/dog.html",
          sites: ["dog.ceo", "example.com"],
          what: "dog.html wants internet from dog.ceo, example.com",
          fingerprint: "ask-fingerprint",
        },
      ],
    });
    if (requests === null) throw new Error("Expected the approval list to parse.");
    const [request] = requests;
    expect(request).toMatchObject({
      target: "page-internet",
      kind: "page-internet",
      page: "/games/dog.html",
      sites: ["dog.ceo", "example.com"],
    });
    expect(requestHeading(request!)).toBe("This page wants the internet");
    expect(grownUpRequestSentence(request!, "Ava")).toBe(
      "Ava's dog.html wants pictures and information from dog.ceo, example.com.",
    );
  });

  it("keeps older runtime approvals on the default request path", () => {
    const requests = parsePendingRequests({
      requests: [
        {
          threadId: "thread-1",
          requestId: "request-1",
          fingerprint: "fingerprint",
          kind: "command",
          what: "npm install three",
          needsGrownUp: true,
        },
      ],
    });
    if (requests === null) throw new Error("Expected the approval list to parse.");
    const [request] = requests;
    expect(request).not.toHaveProperty("target");
    expect(requestHeading(request!)).toBe("Run a command");
  });
});
