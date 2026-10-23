// The engine's Files routes (`/api/skycot/files`, apps/server/src/skycot/files), with the same
// credentials as every other request this client makes. Read-only.
import type { ProjectId, ThreadId } from "@t3tools/contracts";

import { engineRequest, type FamilyResult } from "../family/api";
import { parseFileRead, parseListing, type FileRead, type FilesListing } from "./model";

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
