// The engine's live preview over HTTP (`/api/skycot/preview`), with the same credentials as the
// Family routes. The engine decides everything that matters (whether a start needs a yes, which
// address may be shown); this file only asks and reads the answer.
import { callEngine } from "../family/api";
import { parsePreviewStatus, type PreviewStatusView } from "./model";

export const PREVIEW_API_PATH = "/api/skycot/preview";

export type PreviewAnswer =
  | { readonly ok: true; readonly status: PreviewStatusView }
  | {
      readonly ok: false;
      readonly reason: "needs-approval" | "needs-grown-up" | "not-startable" | "unreachable";
      readonly message: string;
      readonly requestId?: string;
    };

const UNREACHABLE = "SKYCOT's engine didn't answer. Check your Mac is awake and try again.";

async function ask(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<PreviewAnswer> {
  try {
    const response = await callEngine(method, `${PREVIEW_API_PATH}${path}`, body, query);
    const parsed: unknown = await response.json().catch(() => null);
    const record =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const error = record["error"];
    if (error === "needs-approval" || error === "needs-grown-up" || error === "not-startable") {
      return {
        ok: false,
        reason: error,
        message: typeof record["message"] === "string" ? record["message"] : UNREACHABLE,
        ...(typeof record["requestId"] === "string" ? { requestId: record["requestId"] } : {}),
      };
    }
    const status = response.ok ? parsePreviewStatus(parsed) : null;
    return status === null
      ? { ok: false, reason: "unreachable", message: UNREACHABLE }
      : { ok: true, status };
  } catch {
    return { ok: false, reason: "unreachable", message: UNREACHABLE };
  }
}

export const fetchPreviewStatus = (threadId: string) => ask("GET", "", undefined, { threadId });

export const startPreview = (threadId: string, approved: boolean) =>
  ask("POST", "/start", { threadId, approved });

export const stopPreview = (threadId: string) => ask("POST", "/stop", { threadId });

/** Whether the preview may go to an address; in a Family profile the internet needs a grown-up. */
export async function checkPreviewAddress(
  url: string,
): Promise<{ readonly allowed: boolean; readonly requestId?: string }> {
  try {
    const response = await callEngine("POST", `${PREVIEW_API_PATH}/address`, { url });
    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      allowed: parsed?.["allowed"] === true,
      ...(typeof parsed?.["requestId"] === "string" ? { requestId: parsed["requestId"] } : {}),
    };
  } catch {
    return { allowed: false };
  }
}
