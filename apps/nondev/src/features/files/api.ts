// The engine's Files routes (`/api/skycot/files`, apps/server/src/skycot/files), with the same
// credentials as every other request this client makes. Read-only.
import type { ProjectId, ThreadId } from "@t3tools/contracts";

import { engineRequest, type FamilyResult } from "../family/api";
import {
  inlinePageAssets,
  pageAssetKey,
  pageAssetRefs,
  parseFileRead,
  parseListing,
  type FileRead,
  type FilesListing,
} from "./model";

export const FILES_API_PATH = "/api/skycot/files";

export interface FilesPlace {
  readonly projectId: ProjectId;
  /** The conversation whose private copy to look in; the project's own folder without one. */
  readonly threadId: ThreadId | null;
}

function query(place: FilesPlace, path: string): Record<string, string> {
  return {
    projectId: place.projectId,
    ...(place.threadId === null ? {} : { threadId: place.threadId }),
    path,
  };
}

export const filesApi = {
  list: (place: FilesPlace, path: string): Promise<FamilyResult<FilesListing>> =>
    engineRequest("GET", `${FILES_API_PATH}/list`, undefined, parseListing, query(place, path)),
  read: (place: FilesPlace, path: string): Promise<FamilyResult<FileRead>> =>
    engineRequest("GET", `${FILES_API_PATH}/read`, undefined, parseFileRead, query(place, path)),
};

// nondev-seam: skycot-playable-copy
export async function playablePage(
  threadId: ThreadId | null,
  page: string,
): Promise<string | null> {
  if (threadId === null) return null;
  const answer = await engineRequest(
    "GET",
    "/api/skycot/family/fridge/play",
    undefined,
    (body) => {
      if (typeof body !== "object" || body === null) return null;
      const value = body as { html?: unknown; reason?: unknown };
      return (typeof value.html === "string" || value.html === null) &&
        (value.reason === null || value.reason === "too-big")
        ? { html: value.html, reason: value.reason as "too-big" | null }
        : null;
    },
    { threadId, page },
  );
  return answer.ok && answer.value.html !== null ? answer.value.html : null;
}

/**
 * A page with its own files (styles, scripts, pictures) put inside it, read through the same
 * engine route: what the sealed, offline frame shows (Quick Look, and "Open it" when the Preview
 * can't show the page). Only files inside the project are read; one that can't be is left out.
 */
export async function pageWithAssets(place: FilesPlace, file: FileRead): Promise<string> {
  const html = file.contents ?? "";
  const refs = pageAssetRefs(file.path, html);
  const reads = await Promise.all(refs.map((ref) => filesApi.read(place, ref.path)));
  const assets = new Map<string, string>();
  refs.forEach((ref, index) => {
    const answer = reads[index];
    if (!answer?.ok || answer.value.contents === null) return;
    const asset = answer.value;
    if (ref.kind === "picture") {
      if (asset.encoding === "base64") {
        assets.set(pageAssetKey(ref), `data:${asset.mimeType};base64,${asset.contents}`);
      }
    } else if (asset.encoding === "utf8" && !asset.truncated) {
      assets.set(pageAssetKey(ref), asset.contents!);
    }
  });
  return inlinePageAssets(file.path, html, assets);
}
