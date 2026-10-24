import { describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../app/useChildView", () => ({ useChildView: () => true }));

import { Disclosure } from "./Disclosure";

describe("Disclosure in the child view", () => {
  it("does not render developer details or their contents", () => {
    const html = renderToStaticMarkup(
      <Disclosure>
        <code>/Users/parent/private.txt</code>
      </Disclosure>,
    );
    expect(html).toBe("");
  });
});
