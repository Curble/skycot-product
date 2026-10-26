// @effect-diagnostics preferSchemaOverJson:off
// @effect-diagnostics nodeBuiltinImport:off
// nondev-seam: skycot-playable-copy
import * as Effect from "effect/Effect";
import * as NodeCrypto from "node:crypto";

import {
  BLOCKED_REPORTER,
  sealedPolicy,
  siteOfUrl,
  pageDiagnosticsScript,
  STORAGE_SHIM,
  withHeadStart,
} from "@t3tools/skycot-rules/page-internet";
import { projectPathOf, type ReadProjectFile } from "./thumbnail.ts";

export const MAX_PLAYABLE_PAGE_BYTES = 1_000_000;
export const MAX_PLAYABLE_FILE_BYTES = 4_000_000;
export const MAX_PLAYABLE_TOTAL_BYTES = 12_000_000;
export const MAX_PLAYABLE_MODULES = 128;
export const MAX_PLAYABLE_MODULE_DEPTH = 32;
const EMPTY_DIAG = {
  packedBytes: 0,
  embeddedFiles: 0,
  modulesBundled: false,
  missingFiles: [],
} as const;

const decoder = new TextDecoder();
const mime: Readonly<Record<string, string>> = {
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  json: "application/json",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
};
const codeExt = /\.(?:m?js|cjs)$/iu;
const dir = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const safeName = (path: string) =>
  path
    .split("/")
    .every(
      (part) =>
        part &&
        !part.startsWith(".") &&
        !/secret|password|credential|\.env|id_rsa|id_ed25519|id_ecdsa|private[_-]?key|\.(?:pem|key)$/iu.test(
          part,
        ),
    );
const data = (bytes: Uint8Array, type: string) =>
  `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const quote = (value: string) => value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</gu, "\\u003c");

function projectFile(from: string, reference: string): string | null {
  const raw = reference.trim().replace(/[?#].*$/su, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.split(/[\\/]/u).includes("..")) return null;
  return projectPathOf(dir(from), raw);
}

const sha256 = (value: string) =>
  NodeCrypto.createHash("sha256").update(value.replace(/\r\n?/gu, "\n")).digest("base64");
const cspHashes = (html: string) => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)].map((match) =>
    sha256(match[1] ?? ""),
  );
  const handlers = [...html.matchAll(/\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/giu)].map((match) =>
    sha256(match[2] ?? ""),
  );
  return { scripts, handlers };
};

function classicBundle(
  modules: ReadonlyMap<string, string>,
  entries: ReadonlyArray<string>,
): string {
  const records = [...modules].map(([name, source]) => {
    let code = source;
    let importIndex = 0;
    code = code.replace(
      /\bexport\s+\*\s+as\s+([\w$]+)\s+from\s*(["'])([^"']+)\2\s*;?/gu,
      (_whole, exported: string, _quote: string, target: string) =>
        `exports[${JSON.stringify(exported)}]=require(${JSON.stringify(target)});`,
    );
    code = code.replace(
      /\bexport\s+\*\s+from\s*(["'])([^"']+)\1\s*;?/gu,
      (_whole, _quote: string, target: string) =>
        `Object.assign(exports,require(${JSON.stringify(target)}));`,
    );
    code = code.replace(
      /\bexport\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\2\s*;?/gu,
      (_whole, names: string, _quote: string, target: string) => {
        const temp = `__m${importIndex++}`;
        const assignments = names
          .split(",")
          .map((part) => {
            const match = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/u.exec(part);
            return match
              ? `exports[${JSON.stringify(match[2] ?? match[1])}]=${temp}[${JSON.stringify(match[1])}];`
              : "";
          })
          .join("");
        return `const ${temp}=require(${JSON.stringify(target)});${assignments}`;
      },
    );
    code = code.replace(
      /\bimport\s+(?:([\s\S]*?)\s+from\s+)?(["'])([^"']+)\2\s*;?/gu,
      (_whole, clause: string | undefined, _quote: string, target: string) => {
        if (!clause) return `require(${JSON.stringify(target)});`;
        const temp = `__m${importIndex++}`;
        const bindings: string[] = [];
        const defaultName = /^\s*([\w$]+)\s*(?:,|$)/u.exec(clause)?.[1];
        if (defaultName) bindings.push(`${defaultName}=${temp}.default`);
        const namespace = /\*\s+as\s+([\w$]+)/u.exec(clause)?.[1];
        if (namespace) bindings.push(`${namespace}=${temp}`);
        const named = /\{([^}]*)\}/u.exec(clause)?.[1];
        if (named)
          for (const item of named.split(",")) {
            const match = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/u.exec(item);
            if (match)
              bindings.push(`${match[2] ?? match[1]}=${temp}[${JSON.stringify(match[1])}]`);
          }
        return `const ${temp}=require(${JSON.stringify(target)});${bindings.length ? `const ${bindings.join(",")};` : ""}`;
      },
    );
    code = code.replace(
      /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/gu,
      (_m, _q: string, target: string) => `Promise.resolve(require(${JSON.stringify(target)}))`,
    );
    const exported: string[] = [];
    code = code.replace(
      /\bexport\s+(const|let|var|function|class)\s+([\w$]+)/gu,
      (_m, kind: string, id: string) => {
        exported.push(id);
        return `${kind} ${id}`;
      },
    );
    code = code.replace(/\bexport\s*\{([^}]*)\}\s*;?/gu, (_m, names: string) =>
      names
        .split(",")
        .map((part) => {
          const match = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/u.exec(part);
          return match ? `exports[${JSON.stringify(match[2] ?? match[1])}]=${match[1]};` : "";
        })
        .join(""),
    );
    code = code.replace(/\bexport\s+default\s+/gu, "exports.default=");
    if (exported.length)
      code += `\n${exported.map((id) => `exports[${JSON.stringify(id)}]=${id};`).join("\n")}`;
    return `${JSON.stringify(name)}:function(exports,require){${code}\n}`;
  });
  return `(function(){var M={${records.join(",")}},C={};function R(n){if(C[n])return C[n];var e=C[n]={};if(!M[n])throw Error('Missing local module '+n);M[n](e,R);return e}function run(){${entries.map((entry) => `R(${JSON.stringify(entry)});`).join("")}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run()})();`;
}

export type PlayableResult = {
  readonly html: string | null;
  readonly reason: "too-big" | "unpackable-module" | "remote-script" | null;
  readonly needs: {
    readonly scripts: ReadonlyArray<string>;
    readonly other: ReadonlyArray<string>;
  };
  readonly diag: {
    readonly packedBytes: number;
    readonly embeddedFiles: number;
    readonly modulesBundled: boolean;
    readonly missingFiles: ReadonlyArray<string>;
  };
};

/** Packs a project's runnable page and local module graph into one sealed document. */
export const playablePage = Effect.fn("SkycotFridge.playablePage")(function* (
  page: string,
  read: ReadProjectFile,
  sites: ReadonlyArray<string>,
) {
  const pagePath = page.replace(/^\//u, "");
  if (!safeName(pagePath) || !/\.html?$/iu.test(pagePath))
    return {
      html: null,
      reason: null,
      needs: { scripts: [], other: [] },
      diag: EMPTY_DIAG,
    } as const;
  const source = yield* read(pagePath);
  if (source === null)
    return {
      html: null,
      reason: null,
      needs: { scripts: [], other: [] },
      diag: EMPTY_DIAG,
    } as const;
  if (source.byteLength > MAX_PLAYABLE_PAGE_BYTES)
    return {
      html: null,
      reason: "too-big",
      needs: { scripts: [], other: [] },
      diag: { ...EMPTY_DIAG, packedBytes: source.byteLength, embeddedFiles: 1 },
    } as const;
  let remaining = MAX_PLAYABLE_TOTAL_BYTES - source.byteLength;
  let exceeded = false;
  let graphExceeded = false;
  let unpackableModule = false;
  let remoteScript = false;
  const needsScripts = new Set<string>();
  const needsOther = new Set<string>();
  const missingFiles = new Set<string>();
  const noteSite = (value: string, list: Set<string>) => {
    const host = siteOfUrl(value);
    if (host !== null && /^https:\/\//iu.test(value.trim())) list.add(host);
  };
  const noteScript = (value: string) => {
    if (/^(?:https?:)?\/\//iu.test(value.trim())) remoteScript = true;
    noteSite(value, needsScripts);
  };
  const cache = new Map<string, Uint8Array | null>();
  const counted = new Set<string>();
  const take = (path: string) =>
    Effect.gen(function* () {
      if (!safeName(path) || path.split("/").includes("..")) return null;
      if (!cache.has(path)) cache.set(path, yield* read(path));
      const bytes = cache.get(path) ?? null;
      if (bytes === null) {
        missingFiles.add(path);
        return null;
      }
      if (
        bytes.byteLength > MAX_PLAYABLE_FILE_BYTES ||
        (!counted.has(path) && bytes.byteLength > remaining)
      ) {
        exceeded = true;
        return null;
      }
      if (!counted.has(path)) {
        counted.add(path);
        remaining -= bytes.byteLength;
      }
      return bytes;
    });
  let html = decoder.decode(source).replace(/<base\b[^>]*>/giu, "");
  for (const imported of html.matchAll(
    /\bimport\s+(?:[^'";]*?\s+from\s*)?(?:\(|)["']((?:https?:)?\/\/[^"']+)["']/giu,
  ))
    noteScript(imported[1]!);
  const modules = new Map<string, string>();
  const existingImports = new Map<string, string>();
  for (const tag of html.matchAll(
    /<script\b[^>]*type\s*=\s*(["'])importmap\1[^>]*>([\s\S]*?)<\/script\s*>/giu,
  )) {
    try {
      const parsed = JSON.parse(tag[2] ?? "") as { imports?: Record<string, unknown> };
      const visitTargets = (value: unknown) => {
        if (typeof value === "string") noteScript(value);
        else if (typeof value === "object" && value !== null)
          for (const child of Object.values(value)) visitTargets(child);
      };
      visitTargets(parsed);
      for (const [name, target] of Object.entries(parsed.imports ?? {})) {
        if (typeof target !== "string") continue;
        const path = projectFile(pagePath, target);
        if (path !== null && safeName(path)) existingImports.set(name, path);
      }
    } catch {
      /* Invalid page import maps remain unresolved. */
    }
  }
  html = html.replace(
    /<script\b[^>]*type\s*=\s*(["'])importmap\1[^>]*>[\s\S]*?<\/script\s*>/giu,
    "",
  );
  const assets = new Map<string, string>();
  const moduleName = (path: string) => `skycot-page/${path}`;
  const resolve = (from: string, spec: string): Effect.Effect<string | null> =>
    Effect.gen(function* () {
      if (/^(?:[a-z][\w+.-]*:|\/\/)/iu.test(spec)) return null;
      if (spec.startsWith(".")) return projectFile(from, spec);
      const mapped = existingImports.get(spec);
      if (mapped !== undefined) return mapped;
      if (!/^(?:@[a-z\d._-]+\/)?[a-z\d._-]+(?:\/.*)?$/iu.test(spec)) return null;
      const pieces = spec.split("/");
      const packageName = spec.startsWith("@") ? pieces.slice(0, 2).join("/") : pieces[0]!;
      const subpath = pieces.slice(packageName.startsWith("@") ? 2 : 1).join("/");
      const packageRoot = `node_modules/${packageName}`;
      const manifestBytes = yield* take(`${packageRoot}/package.json`);
      if (manifestBytes === null) {
        unpackableModule = true;
        return null;
      }
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(decoder.decode(manifestBytes)) as Record<string, unknown>;
      } catch {
        unpackableModule = true;
        return null;
      }
      const exports = manifest["exports"];
      const rootExport =
        typeof exports === "string"
          ? exports
          : typeof exports === "object" && exports !== null
            ? (exports as Record<string, unknown>)["."]
            : undefined;
      const conditions =
        typeof rootExport === "string"
          ? rootExport
          : typeof rootExport === "object" && rootExport !== null
            ? ((rootExport as Record<string, unknown>)["import"] ??
              (rootExport as Record<string, unknown>)["default"])
            : undefined;
      const entry =
        subpath ||
        (typeof conditions === "string" ? conditions : (manifest["module"] ?? manifest["main"]));
      if (typeof entry !== "string") {
        unpackableModule = true;
        return null;
      }
      const path = `${packageRoot}/${entry.replace(/^\.\//u, "")}`;
      if (!safeName(path)) unpackableModule = true;
      return safeName(path) ? path : null;
    });
  const loadModule: (
    path: string,
    initial?: string,
    depth?: number,
  ) => Effect.Effect<string | null> = (path, initial, depth = 0) =>
    Effect.gen(function* () {
      if (modules.has(path)) return moduleName(path);
      if (depth >= MAX_PLAYABLE_MODULE_DEPTH || modules.size >= MAX_PLAYABLE_MODULES) {
        graphExceeded = true;
        return null;
      }
      const bytes = initial === undefined ? yield* take(path) : null;
      if (initial === undefined && (bytes === null || !codeExt.test(path))) return null;
      modules.set(path, "");
      let text = initial ?? decoder.decode(bytes!);
      const specs =
        /((?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\()\s*)(['"])([^'"\n]+)\2/gu;
      let out = "";
      let last = 0;
      for (const match of text.matchAll(specs)) {
        const spec = match[3]!;
        if (/^(?:https?:)?\/\//iu.test(spec)) noteScript(spec);
        const target = yield* resolve(path, spec);
        if (target === null) {
          if (!/^(?:https?:|\/\/|[a-z][\w+.-]*:)/iu.test(spec)) unpackableModule = true;
          out += `${text.slice(last, match.index)};`;
          last = match.index + match[0].length;
          continue;
        }
        const name = yield* loadModule(target, undefined, depth + 1);
        if (name === null) {
          unpackableModule = true;
          continue;
        }
        out += `${text.slice(last, match.index)}${match[1]}${match[2]}${name}${match[2]}`;
        last = match.index + match[0].length;
      }
      text = out + text.slice(last);
      modules.set(path, text);
      return moduleName(path);
    });
  // Module tags become import-map names; classic scripts are copied inline.
  let out = "";
  let last = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
    const tag = match[0];
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const src = /\bsrc\s*=\s*(["'])(.*?)\1/iu.exec(attrs)?.[2];
    const isModule = /\btype\s*=\s*(["'])module\1/iu.test(attrs);
    let replacement = tag;
    if (src !== undefined) {
      if (/^(?:https?:)?\/\//iu.test(src)) noteScript(src);
      const path = projectFile(pagePath, src);
      const bytes = path === null ? null : yield* take(path);
      if (bytes !== null && isModule && path !== null) {
        const name = yield* loadModule(path);
        replacement = name === null ? "" : `<!--SKYCOT_MODULE_ENTRY:${name}-->`;
      } else if (bytes !== null && codeExt.test(path ?? ""))
        replacement = `<script>${decoder.decode(bytes).replace(/<\/script/giu, "<\\/script")}</script>`;
      else replacement = "";
    } else if (isModule) {
      const path = `${dir(pagePath)}/__inline-${modules.size}.mjs`.replace(/^\//u, "");
      const name = yield* loadModule(path, body);
      replacement = name === null ? "" : `<!--SKYCOT_MODULE_ENTRY:${name}-->`;
    }
    out += html.slice(last, match.index) + replacement;
    last = match.index + match[0].length;
  }
  html = out + html.slice(last);
  // Inline project stylesheets and their own picture/font URLs.
  out = "";
  last = 0;
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const tag = match[0];
    const isStyle = /\brel\s*=\s*(["'])stylesheet\1/iu.test(tag);
    const href = /\bhref\s*=\s*(["'])(.*?)\1/iu.exec(tag)?.[2];
    let replacement = "";
    if (isStyle && href !== undefined) {
      if (/^https:\/\//iu.test(href)) noteSite(href, needsOther);
      const cssPath = projectFile(pagePath, href);
      const bytes = cssPath === null ? null : yield* take(cssPath);
      if (cssPath !== null && bytes !== null) {
        let css = decoder.decode(bytes);
        for (const imported of css.matchAll(
          /@import\s+(?:url\(\s*)?["']?(https:\/\/[^\s"')]+)["']?\s*\)?[^;]*;?/giu,
        ))
          noteSite(imported[1]!, needsOther);
        css = css.replace(/@import\s+[^;]+;?/giu, "");
        for (const item of css.matchAll(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/giu)) {
          const assetPath = projectFile(cssPath, item[2]!);
          const type = assetPath
            ? mime[assetPath.split(".").at(-1)?.toLowerCase() ?? ""]
            : undefined;
          const assetBytes = assetPath && type ? yield* take(assetPath) : null;
          const address = assetBytes && type ? data(assetBytes, type) : "";
          css = css.replace(item[0], `url("${address}")`);
        }
        replacement = `<style>${css.replace(/<\/style/giu, "<\\/style")}</style>`;
      }
    }
    out += html.slice(last, match.index) + replacement;
    last = match.index + match[0].length;
  }
  html = out + html.slice(last);
  for (const imported of html.matchAll(
    /@import\s+(?:url\(\s*)?["']?(https:\/\/[^\s"')]+)["']?\s*\)?[^;]*;?/giu,
  ))
    noteSite(imported[1]!, needsOther);
  const refs = new Set<string>();
  for (const match of html.matchAll(/\b(?:src|poster|href)\s*=\s*(["'])([^"']+)\1/giu))
    refs.add(match[2]!);
  for (const match of html.matchAll(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/giu)) refs.add(match[2]!);
  for (const ref of refs) {
    if (/^https:\/\//iu.test(ref)) noteSite(ref, needsOther);
    const path = projectFile(pagePath, ref);
    const type = path ? mime[path.split(".").at(-1)?.toLowerCase() ?? ""] : undefined;
    if (path === null || type === undefined) continue;
    const bytes = yield* take(path);
    if (bytes !== null) assets.set(ref, data(bytes, type));
  }
  // Files a script asks for at runtime use only known project paths and known media/data types.
  const sources = [
    { path: pagePath, text: html },
    ...[...modules].map(([path, text]) => ({ path, text })),
  ];
  for (const sourceFile of sources) {
    for (const match of sourceFile.text.matchAll(
      /(["'])([^"'\n]+\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|woff2?|ttf|otf|mp3|wav|ogg|mp4|webm|json|glb|gltf)(?:[?#][^"']*)?)\1/giu,
    )) {
      const ref = match[2]!;
      const path = projectFile(sourceFile.path, ref);
      const type = path ? mime[path.split(".").at(-1)?.toLowerCase() ?? ""] : undefined;
      if (path === null || type === undefined) continue;
      const bytes = yield* take(path);
      if (bytes !== null) {
        assets.set(ref, data(bytes, type));
        assets.set(path, data(bytes, type));
      }
    }
  }
  html = html
    .replace(
      /(\b(?:src|poster|href)\s*=\s*)(["'])([^"']+)\2/giu,
      (whole, prefix: string, quoteMark: string, ref: string) => {
        const address = assets.get(ref);
        return address === undefined ? whole : `${prefix}${quoteMark}${address}${quoteMark}`;
      },
    )
    .replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/giu, (whole, _q: string, ref: string) => {
      const address = assets.get(ref);
      return address === undefined ? whole : `url("${address}")`;
    });
  const entries = [...html.matchAll(/<!--SKYCOT_MODULE_ENTRY:([^>]+)-->/gu)].map(
    (match) => match[1]!,
  );
  if (entries.length > 0) {
    const bundle = classicBundle(modules, entries);
    html = html.replace(
      /<!--SKYCOT_MODULE_ENTRY:[^>]+-->/u,
      `<script>${bundle.replace(/<\/script/giu, "<\\/script")}</script>`,
    );
    html = html.replace(/<!--SKYCOT_MODULE_ENTRY:[^>]+-->/gu, "");
  }
  const pack = (packedBytes: number) => {
    const helpers = `${STORAGE_SHIM}${BLOCKED_REPORTER}${pageDiagnosticsScript(packedBytes)}<script>${fileShim(assets)}</script>`;
    const provisional = withHeadStart(html, helpers);
    const { scripts, handlers } = cspHashes(provisional);
    const policy = `<meta http-equiv="Content-Security-Policy" content="${quote(sealedPolicy(sites, scripts, handlers))}">`;
    return withHeadStart(html, `${policy}${helpers}`);
  };
  let packed = pack(0);
  for (let i = 0; i < 2; i++) packed = pack(new TextEncoder().encode(packed).byteLength);
  const needs = { scripts: [...needsScripts].sort(), other: [...needsOther].sort() };
  const diag = {
    packedBytes: new TextEncoder().encode(packed).byteLength,
    embeddedFiles: counted.size + 1,
    modulesBundled: entries.length > 0,
    missingFiles: [...missingFiles].sort(),
  };
  if (exceeded || graphExceeded) return { html: null, reason: "too-big", needs, diag } as const;
  const reason = remoteScript ? "remote-script" : unpackableModule ? "unpackable-module" : null;
  return { html: packed, reason, needs, diag } as const;
});

function fileShim(assets: ReadonlyMap<string, string>): string {
  const map = scriptJson(Object.fromEntries(assets));
  return `(function(){var a=${map};function u(s){return typeof s==='string'&&Object.prototype.hasOwnProperty.call(a,s)?a[s]:s}var f=window.fetch;window.fetch=function(x,o){return f.call(this,u(typeof x==='string'?x:x&&x.url),o)};var X=XMLHttpRequest;window.XMLHttpRequest=function(){var x=new X(),open=x.open;x.open=function(m,s){arguments[1]=u(s);return open.apply(x,arguments)};return x};var A=window.Audio;window.Audio=function(s){var x=new A();if(arguments.length)x.src=u(s);return x};window.Audio.prototype=A.prototype;var I=window.Image;window.Image=function(){var i=new I(...arguments),d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(i,'src',{configurable:true,get:function(){return d.get.call(i)},set:function(v){d.set.call(i,u(v))}});return i};['HTMLImageElement','HTMLAudioElement','HTMLVideoElement','HTMLSourceElement'].forEach(function(n){var p=window[n]&&window[n].prototype,d=p&&Object.getOwnPropertyDescriptor(p,'src');if(d&&d.set)Object.defineProperty(p,'src',{...d,set:function(v){return d.set.call(this,u(v))}})});})();`;
}
