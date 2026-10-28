import { describe, expect, it } from "vite-plus/test";

import { renderToStaticMarkup } from "react-dom/server";

import { linkHost, parseMarkdown, plainFirstLine, renderInline } from "./Markdown";

describe("parseMarkdown", () => {
  it("splits paragraphs, headings, lists and fenced code", () => {
    const blocks = parseMarkdown(
      [
        "## Plan",
        "Here is what I'll do.",
        "",
        "1. Save a restore point",
        "2. Add the page",
        "   with a nav link",
        "",
        "- check desktop",
        "- check phone",
        "",
        "```html",
        '<li><a href="christmas.html">Christmas</a></li>',
        "```",
        "> nothing changes until you say go",
        "---",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["h", "p", "ol", "ul", "code", "quote", "hr"]);
    const ol = blocks[2]!;
    expect(ol.kind === "ol" && ol.items).toEqual([
      "Save a restore point",
      "Add the page with a nav link",
    ]);
    const code = blocks[4]!;
    expect(code.kind === "code" && code.lang).toBe("html");
    expect(code.kind === "code" && code.text).toContain("<li>");
  });

  it("joins wrapped lines into one paragraph and keeps blank lines as breaks", () => {
    const blocks = parseMarkdown("first line\nsecond line\n\nnext paragraph");
    expect(blocks).toEqual([
      { kind: "p", text: "first line second line" },
      { kind: "p", text: "next paragraph" },
    ]);
  });

  it("never produces raw html blocks", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>");
    expect(blocks).toEqual([{ kind: "p", text: "<script>alert(1)</script>" }]);
  });
});

describe("plainFirstLine", () => {
  it("strips markers and truncates", () => {
    expect(plainFirstLine("## **Bold** plan\nmore")).toBe("Bold plan");
    expect(plainFirstLine("- a very long line ".repeat(20), 20).endsWith("…")).toBe(true);
  });
});

describe("linkHost", () => {
  it("names the site for web links and nothing for the rest", () => {
    expect(linkHost("https://www.littleferncafe.example/menu")).toBe("littleferncafe.example");
    expect(linkHost("mailto:hi@example.com")).toBeNull();
    expect(linkHost("javascript:alert(1)")).toBeNull();
    expect(linkHost("not a url")).toBeNull();
  });
});

describe("renderInline links", () => {
  it("shows the label only for targets that are not web links", () => {
    const html = renderToStaticMarkup(<>{renderInline("[click me](javascript:alert(1)) done")}</>);
    expect(html).toContain("click me done");
    expect(html).not.toContain("<a");
    const link = renderToStaticMarkup(
      <>{renderInline("[Menu](https://littleferncafe.example/menu)")}</>,
    );
    expect(link).toContain('href="https://littleferncafe.example/menu"');
    expect(link).toContain("littleferncafe.example");
  });
});
