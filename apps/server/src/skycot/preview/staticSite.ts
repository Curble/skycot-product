// The live preview for a plain web page: a project with an index.html and nothing to start
// (very often a child's first site). SKYCOT shows the folder itself with Node's own web server,
// inside the engine, on 127.0.0.1 only: nothing is installed, nothing of the project's runs on
// this Mac, and it works without the internet. It only ever hands out files inside the folder:
// no `..`, no links that lead outside, no hidden or secret files (.env, .git, keys), and no
// folder listings. It stops with the preview, like a dev server's terminal does.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

/** Folders (inside the project) whose index.html is shown, best first. "" is the folder itself. */
export const STATIC_ROOTS = ["", "public", "dist"] as const;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".weba": "audio/webm",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".pdf": "application/pdf",
};

/** The Content-Type a file is served with; unknown kinds are plain bytes. */
export function mimeTypeFor(fileName: string): string {
  return MIME_TYPES[NodePath.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

/** Names that are secrets even without a leading dot. Matched on the file's own name. */
const SECRET_NAME =
  /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|keychain))$/i;

/** True for a hidden (".env", ".git", ".DS_Store") or secret-looking name: never served. */
export function isPrivateName(name: string): boolean {
  return name.startsWith(".") || SECRET_NAME.test(name);
}

export type RequestTarget =
  /** The segments of a path inside the site, already decoded and checked. */
  | { readonly kind: "path"; readonly segments: ReadonlyArray<string>; readonly isFolder: boolean }
  | { readonly kind: "refused" };

/**
 * Reads the path of a request ("/games/space%20race.html?x=1") into checked segments. Anything
 * that could lead outside the folder or to a private file is refused: `..`, backslashes, NUL,
 * encoded slashes, hidden or secret names, and malformed escapes.
 */
export function readRequestPath(rawUrl: string): RequestTarget {
  if (!rawUrl.startsWith("/") || rawUrl.startsWith("//")) return { kind: "refused" };
  const pathPart = rawUrl.split(/[?#]/, 1)[0] ?? "/";
  const segments: Array<string> = [];
  for (const raw of pathPart.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return { kind: "refused" };
    }
    if (segment === "" || segment === ".") continue;
    if (
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0") ||
      isPrivateName(segment)
    ) {
      return { kind: "refused" };
    }
    segments.push(segment);
  }
  return { kind: "path", segments, isFolder: pathPart.endsWith("/") };
}

/** True when `target` is `root` itself or inside it, and nothing on the way there is private. */
export function isInside(root: string, target: string): boolean {
  const relative = NodePath.relative(root, target);
  if (relative === "") return true;
  if (relative.startsWith("..") || NodePath.isAbsolute(relative)) return false;
  return !relative.split(NodePath.sep).some((part) => part === ".." || isPrivateName(part));
}

export interface StaticSite {
  readonly port: number;
  /** Always `http://127.0.0.1:<port>/`: an address on this Mac only. */
  readonly url: string;
  readonly close: () => Promise<void>;
}

const NOT_FOUND_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Not found</title>' +
  '<p style="font-family:-apple-system,system-ui,sans-serif;padding:2rem;color:#555">' +
  "This page isn't in the project.</p>";

/**
 * Serves `root` (an absolute folder) on 127.0.0.1 at a free port. Rejects when the folder is
 * missing or the port cannot be opened.
 */
export async function serveStaticSite(root: string): Promise<StaticSite> {
  const realRoot = await NodeFSP.realpath(root);
  if (!(await NodeFSP.stat(realRoot)).isDirectory()) {
    throw new Error("The preview folder is not a folder.");
  }
  let port = 0;

  const answer = (
    response: NodeHttp.ServerResponse,
    status: number,
    body: string,
    headers: Record<string, string> = {},
  ) => {
    response.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(Buffer.byteLength(body)),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    });
    response.end(response.req.method === "HEAD" ? undefined : body);
  };
  const notFound = (response: NodeHttp.ServerResponse) => answer(response, 404, NOT_FOUND_PAGE);

  /** The real file for these segments, or null: links are followed, then checked again. */
  const findFile = async (segments: ReadonlyArray<string>, isFolder: boolean) => {
    const asked = NodePath.join(realRoot, ...segments);
    let real: string;
    try {
      real = await NodeFSP.realpath(asked);
    } catch {
      return null;
    }
    if (!isInside(realRoot, real)) return null;
    const stat = await NodeFSP.stat(real).catch(() => null);
    if (stat === null) return null;
    if (stat.isDirectory()) {
      // A folder asked for without its slash: send the browser to it, so its page's own
      // relative links ("style.css") resolve inside the folder.
      if (!isFolder) return { kind: "folder-redirect" } as const;
      const index = await NodeFSP.realpath(NodePath.join(real, "index.html")).catch(() => null);
      if (index === null || !isInside(realRoot, index)) return null;
      const indexStat = await NodeFSP.stat(index).catch(() => null);
      return indexStat?.isFile()
        ? ({ kind: "file", path: index, size: indexStat.size } as const)
        : null;
    }
    return stat.isFile() ? ({ kind: "file", path: real, size: stat.size } as const) : null;
  };

  const handle = async (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      answer(response, 405, "", { allow: "GET, HEAD" });
      return;
    }
    // Only this Mac's own names for it: a web page elsewhere that points its own name at
    // 127.0.0.1 (DNS rebinding) cannot read the project through the browser.
    const host = (request.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      answer(response, 403, "");
      return;
    }
    const target = readRequestPath(request.url ?? "/");
    if (target.kind === "refused") {
      notFound(response);
      return;
    }
    const found = await findFile(target.segments, target.isFolder || target.segments.length === 0);
    if (found === null) {
      notFound(response);
      return;
    }
    if (found.kind === "folder-redirect") {
      const query = (request.url ?? "").slice((request.url ?? "").split(/[?#]/, 1)[0]!.length);
      const location = `/${target.segments.map(encodeURIComponent).join("/")}/${query}`;
      answer(response, 301, "", { location });
      return;
    }
    response.writeHead(200, {
      "content-type": mimeTypeFor(found.path),
      "content-length": String(found.size),
      // The child edits and presses Reload: always the newest file.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = NodeFS.createReadStream(found.path);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  };

  const server = NodeHttp.createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) answer(response, 500, "");
      else response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
