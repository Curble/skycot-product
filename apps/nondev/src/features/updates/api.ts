// The engine's update routes (`/api/skycot/updates`, apps/server/src/skycot/updates).
import { engineRequest, type FamilyResult } from "../family/api";
import { parseEngineUpdates, type EngineUpdates } from "./updates";

const UPDATES_API_PATH = "/api/skycot/updates";

function parseAllowed(body: unknown): { readonly needed: boolean } | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  return record["allowed"] === true ? { needed: record["needed"] === true } : null;
}

export const updatesApi = {
  status: (): Promise<FamilyResult<EngineUpdates>> =>
    engineRequest("GET", UPDATES_API_PATH, undefined, parseEngineUpdates),
  /**
   * With the Family profile on, the engine writes the note the Mac app needs before it restarts
   * into `version` (after the parent code); with it off, no note is needed.
   */
  allowRestart: (version: string) =>
    engineRequest("POST", `${UPDATES_API_PATH}/allow-restart`, { version }, parseAllowed),
};
