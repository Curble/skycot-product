import { describe, expect, it } from "vite-plus/test";

import { withExplainMarker, readExplainMarker } from "./explain.ts";
import {
  isLocalPreviewAddress,
  localAddressFromOutput,
  plainTerminalText,
  PROBLEM_OUTPUT_MAX,
  readPointing,
  withPointing,
  withPreviewProblem,
  type Pointer,
} from "./preview.ts";

describe("isLocalPreviewAddress", () => {
  it("accepts this Mac's own addresses", () => {
    for (const url of [
      "http://localhost:5173/",
      "http://127.0.0.1:3000/page",
      "http://127.1.2.3/",
      "https://app.localhost:8443/",
      "http://[::1]:4000/",
      "http://0.0.0.0:8080/",
      "HTTP://LocalHost:3000",
      "http://localhost:3000/page?x=1#top",
    ]) {
      expect(isLocalPreviewAddress(url), url).toBe(true);
    }
  });

  it("refuses the internet, other schemes and look-alikes", () => {
    for (const url of [
      "https://example.com/",
      "http://localhost.example.com/",
      "http://192.168.1.20:3000/",
      "http://10.0.0.1/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://user:pass@localhost:3000/",
      "http://127.0.0.1.nip.io/",
      "http://localhost:3000@example.com/",
      "http://localhost\\@example.com/",
      "http://localhost:99999/",
      "not a url",
    ]) {
      expect(isLocalPreviewAddress(url), url).toBe(false);
    }
  });
});

describe("localAddressFromOutput", () => {
  it("reads the address Vite prints, colours and all", () => {
    const output =
      "\u001b[32m  VITE v6.0.0\u001b[39m  ready in 312 ms\r\n\r\n  ➜  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\r\n  ➜  Network: use --host to expose\r\n";
    expect(localAddressFromOutput(output)).toBe("http://localhost:5173/");
  });

  it("opens a server bound to every network card as localhost", () => {
    expect(localAddressFromOutput("Serving on http://0.0.0.0:8000 (Ctrl-C to stop)")).toBe(
      "http://localhost:8000/",
    );
    expect(localAddressFromOutput("listening at http://[::]:3000.")).toBe("http://localhost:3000/");
  });

  it("skips addresses on other computers and falls back to a printed port", () => {
    expect(
      localAddressFromOutput("Network: http://192.168.1.5:3000\nServer listening on port 3000"),
    ).toBe("http://localhost:3000/");
    expect(localAddressFromOutput("Docs at https://vitejs.dev/config")).toBeNull();
    expect(localAddressFromOutput("npm ERR! missing script: dev")).toBeNull();
  });

  it("leaves plain text readable for a grown-up", () => {
    expect(plainTerminalText("\u001b[31mError\u001b[0m\r\nline two")).toBe("Error\nline two");
  });
});

describe("pointing blocks", () => {
  const title: Pointer = {
    label: "the big pink title",
    pageUrl: "http://localhost:5173/",
    tagName: "h1",
    selector: "main > h1.title",
    html: '<h1 class="title">\n  Welcome to my pet page\n</h1>',
  };

  it("tells the assistant which element is meant, in words", () => {
    const text = withPointing("make this bigger", [title]);
    expect(text).toContain("make this bigger\n\n[SKYCOT pointing at: the big pink title]");
    expect(text).toContain("selector `main > h1.title`");
    expect(text).toContain('Looks like: <h1 class="title"> Welcome to my pet page </h1>');
  });

  it("round-trips through the explain marker and back to chips", () => {
    const sent = withExplainMarker(withPointing("make this bigger", [title]), true, false);
    const { text } = readExplainMarker(sent);
    expect(readPointing(text)).toEqual({
      text: "make this bigger",
      labels: ["the big pink title"],
    });
  });

  it("keeps a label from closing its own bracket and caps the count", () => {
    const sent = withPointing("", [{ ...title, label: "the [odd] one" }, title, title, title]);
    const read = readPointing(sent);
    expect(read.text).toBe("");
    expect(read.labels).toEqual(["the odd one", "the big pink title", "the big pink title"]);
  });

  it("leaves a message without pointing alone", () => {
    expect(readPointing("just words")).toEqual({ text: "just words", labels: [] });
    expect(withPointing("just words", [])).toBe("just words");
  });
});

describe("preview problem block", () => {
  const problem = {
    what: "The preview didn't start.",
    how: "It runs `npm run dev`.",
    output: "\u001b[31mError\u001b[0m: Cannot find module 'server.js'\n  at main (app.js:1)",
  };

  it("hands the assistant the command and what it printed", () => {
    const sent = withPreviewProblem("The preview didn't work. Can you fix it?", problem);
    expect(
      sent.startsWith("The preview didn't work. Can you fix it?\n\n[SKYCOT preview problem]"),
    ).toBe(true);
    expect(sent).toContain("The preview didn't start. It runs `npm run dev`.");
    expect(sent).toContain("Error: Cannot find module 'server.js'");
    expect(sent).not.toContain("\u001b");
  });

  it("is hidden from the child's bubble, with the explain marker after it", () => {
    const sent = withExplainMarker(
      withPreviewProblem("The preview didn't work. Can you fix it?", problem),
      false,
      true,
    );
    expect(readPointing(readExplainMarker(sent).text)).toEqual({
      text: "The preview didn't work. Can you fix it?",
      labels: [],
    });
  });

  it("sits alongside a pointing chip: both are cut from the words", () => {
    const sent = withPreviewProblem(
      withPointing("fix this", [
        {
          label: "the title",
          pageUrl: "http://localhost:1/",
          tagName: "h1",
          selector: null,
          html: "<h1>x</h1>",
        },
      ]),
      problem,
    );
    expect(readPointing(sent)).toEqual({ text: "fix this", labels: ["the title"] });
  });

  it("sends nothing extra when there is no problem, and skips an empty output", () => {
    expect(withPreviewProblem("hi", null)).toBe("hi");
    const quiet = withPreviewProblem("hi", { ...problem, output: "  " });
    expect(quiet).not.toContain("What it said");
    expect(readPointing(quiet).text).toBe("hi");
  });

  it("keeps the end of a very long output and cannot be closed early by backticks", () => {
    const long = `${"x".repeat(PROBLEM_OUTPUT_MAX)}END`;
    const sent = withPreviewProblem("hi", { ...problem, output: long });
    expect(sent).toContain("…");
    expect(sent).toContain("END");
    expect(sent.length).toBeLessThan(PROBLEM_OUTPUT_MAX + 600);
    const fenced = withPreviewProblem("hi", { ...problem, output: "a ```` b" });
    expect(fenced).toContain("`````\na ```` b\n`````");
  });
});
