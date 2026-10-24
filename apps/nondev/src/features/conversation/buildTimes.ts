import type { BuildSample } from "../../plain/estimate";

const KEY = "skycot.build-times.v1";
const MAX_PER_BUCKET = 20;

export function readBuildTimes(storage?: Pick<Storage, "getItem">): ReadonlyArray<BuildSample> {
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
    if (target === null) return [];
    const parsed: unknown = JSON.parse(target.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is BuildSample =>
        row &&
        typeof row === "object" &&
        typeof row.kind === "string" &&
        typeof row.model === "string" &&
        (row.phase === "plan" || row.phase === "build") &&
        Number.isFinite(row.milliseconds) &&
        row.milliseconds > 0,
    );
  } catch {
    return [];
  }
}

export function recordBuildTime(
  sample: BuildSample,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
    if (target === null) return;
    const current = readBuildTimes(target);
    const other = current.filter(
      (row) =>
        !(row.kind === sample.kind && row.model === sample.model && row.phase === sample.phase),
    );
    const bucket = [
      ...current.filter(
        (row) =>
          row.kind === sample.kind && row.model === sample.model && row.phase === sample.phase,
      ),
      sample,
    ].slice(-MAX_PER_BUCKET);
    target.setItem(KEY, JSON.stringify([...other, ...bucket]));
  } catch {
    /* Estimates are optional; storage may be unavailable. */
  }
}
