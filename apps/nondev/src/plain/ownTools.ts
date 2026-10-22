/**
 * SKYCOT's own assistant tools, in plain words.
 *
 * The engine hands the assistant a set of its own tools (opening and checking the page it
 * built, starting helpers, scheduling). Upstream names that tool server "t3-code", and the
 * assistant's service asks about it in developer words: "Allow the t3-code MCP server to run
 * tool "preview_open"?". Nobody using SKYCOT should read either name: the cards and the timeline
 * say what the step does ("Sam wants to open your page to check it") and call the server SKYCOT.
 */

/** The engine's tool server, as the assistant's service names it. */
export const ENGINE_TOOL_SERVER = "t3-code";

/** Said on every card for a tool that looks at pages: the first use may download a browser. */
export const BROWSER_DOWNLOAD_NOTE =
  "The first time, SKYCOT downloads a small browser to look at pages (about 200 MB).";

export interface OwnToolPhrase {
  /** After "wants to" / "allowed … to". */
  readonly infinitive: string;
  readonly past: string;
  readonly present: string;
  /** Drives a hidden browser (and so may download one first). */
  readonly looksAtPages: boolean;
  /** Runs the assistant's own script inside the page. */
  readonly runsScript: boolean;
}

function phrase(
  infinitive: string,
  past: string,
  present: string,
  looksAtPages: boolean,
  runsScript = false,
): OwnToolPhrase {
  return { infinitive, past, present, looksAtPages, runsScript };
}

const PRESSES = /^preview_(click|type|press|hover|select|drag|scroll|upload|dialog|wait_for)$/u;

/** What one of the engine's own tools does, in the words the cards and the timeline use. */
export function describeOwnTool(tool: string): OwnToolPhrase {
  if (tool === "preview_open" || tool === "preview_navigate")
    return phrase(
      "open your page to check it",
      "Opened your page to check it",
      "Opening your page to check it",
      true,
    );
  if (tool === "preview_snapshot")
    return phrase(
      "take a picture of your page",
      "Took a picture of your page",
      "Taking a picture of your page",
      true,
    );
  if (tool === "preview_evaluate")
    return phrase(
      "try things out on your page",
      "Tried things out on your page",
      "Trying things out on your page",
      true,
      true,
    );
  if (PRESSES.test(tool))
    return phrase(
      "try the buttons on your page",
      "Tried the buttons on your page",
      "Trying the buttons on your page",
      true,
    );
  if (tool === "preview_resize" || tool === "preview_set_appearance")
    return phrase(
      "look at your page at another size",
      "Looked at your page at another size",
      "Looking at your page at another size",
      true,
    );
  if (tool === "preview_recording_start" || tool === "preview_recording_stop")
    return phrase(
      "record a short video of your page",
      "Recorded a short video of your page",
      "Recording a short video of your page",
      true,
    );
  if (tool === "html_render" || tool === "html_preview")
    return phrase(
      "draw a picture of a page",
      "Drew a picture of a page",
      "Drawing a picture of a page",
      true,
    );
  if (tool.startsWith("preview_") || tool === "t3_preview_list" || tool === "t3_preview_close")
    return phrase("look at your page", "Looked at your page", "Looking at your page", false);
  if (tool.startsWith("device_"))
    return phrase(
      "use a phone simulator on this Mac",
      "Used a phone simulator on this Mac",
      "Using a phone simulator on this Mac",
      false,
    );
  return phrase(
    "use one of SKYCOT's own tools",
    "Used one of SKYCOT's own tools",
    "Using one of SKYCOT's own tools",
    false,
  );
}

/**
 * The tool's own name when `name` is one of the engine's tools: `t3-code.preview_open` (Codex's
 * timeline), `mcp__t3-code__preview_open` (Claude's), or a prompt that asks about one.
 */
export function ownToolName(name: string | null | undefined): string | null {
  if (!name) return null;
  const dotted = /^t3-code\.([\w-]+)$/u.exec(name.trim());
  if (dotted) return dotted[1]!;
  const claude = /mcp__t3-code__([\w-]+)/u.exec(name);
  if (claude) return claude[1]!;
  const asked = /\bt3-code\b[^"]*"([\w-]+)"/u.exec(name);
  return asked ? asked[1]! : null;
}

/** Whether a connected-app name is the engine's own tool server. */
export function isOwnToolServer(appName: string | null | undefined): boolean {
  return appName?.trim().toLowerCase() === ENGINE_TOOL_SERVER;
}

/** Developer text with the engine's internal server name replaced by SKYCOT. */
export function withSkycotName(text: string): string {
  return text
    .replace(/\bthe t3-code MCP server\b/giu, "SKYCOT")
    .replace(/\bmcp__t3-code__/gu, "skycot.")
    .replace(/\bt3-code\b/giu, "SKYCOT");
}
