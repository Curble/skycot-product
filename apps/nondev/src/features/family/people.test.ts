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
    expect(grownUpRequestSentence(request!, "Ava")).toBe(
      "Ava's game wants to download a free 3D tool (three.js) from the internet.",
    );
  });

  it("does not call every grown-up request a game", () => {
    const request = parsePendingRequests({
      requests: [
        {
          threadId: "thread-1",
          requestId: "request-1",
          fingerprint: "fingerprint",
          kind: "file-change",
          what: "change a file",
          needsGrownUp: true,
        },
      ],
    })?.[0];
    expect(request && grownUpRequestSentence(request, "Ava")).toBe(
      "Ava needs a grown-up's help with one step.",
    );
  });

  it("attaches a batch to its members while still reading older single-request responses", () => {
    const request = (requestId: string) => ({
      threadId: "thread-1",
      requestId,
      fingerprint: `fp-${requestId}`,
      childId: "ava",
      needsGrownUp: true,
      kind: "command",
      projectCovers: ["addOns"],
    });
    const parsed = parsePendingRequests({
      requests: [request("r1"), request("r2")],
      batches: [
        {
          id: "batch-1",
          childId: "ava",
          project: "project-1",
          kind: "addOns",
          fingerprint: "batch-fp",
          items: [
            { threadId: "thread-1", requestId: "r1", what: "one", fingerprint: "fp-r1" },
            { threadId: "thread-1", requestId: "r2", what: "two", fingerprint: "fp-r2" },
          ],
        },
      ],
    });
    expect(parsed?.map((entry) => entry.batch?.id)).toEqual(["batch-1", "batch-1"]);
    expect(parsePendingRequests({ requests: [request("r1")] })?.[0]).not.toHaveProperty("batch");
  });
});
