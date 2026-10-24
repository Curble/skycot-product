export type BuildPhase = "plan" | "build";

export interface BuildSample {
  readonly kind: string;
  readonly model: string;
  readonly phase: BuildPhase;
  readonly milliseconds: number;
}

const quantile = (values: ReadonlyArray<number>, fraction: number) =>
  values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]!;

/** Uses the middle half of completed runs and backs off to broader buckets with three samples. */
export function estimateBuildTime(
  samples: ReadonlyArray<BuildSample>,
  query: Pick<BuildSample, "kind" | "model" | "phase">,
): { readonly low: number; readonly high: number } | null {
  const buckets = [
    (sample: BuildSample) =>
      sample.kind === query.kind && sample.model === query.model && sample.phase === query.phase,
    (sample: BuildSample) => sample.model === query.model && sample.phase === query.phase,
    (sample: BuildSample) => sample.phase === query.phase,
  ];
  for (const matches of buckets) {
    const values = samples
      .filter(
        (sample) =>
          matches(sample) && Number.isFinite(sample.milliseconds) && sample.milliseconds > 0,
      )
      .map((sample) => sample.milliseconds)
      .sort((a, b) => a - b);
    if (values.length >= 3) return { low: quantile(values, 0.25), high: quantile(values, 0.75) };
  }
  return null;
}

export function estimateCopy(
  phase: BuildPhase,
  range: { readonly low: number; readonly high: number } | null,
): string {
  if (range === null)
    return phase === "plan" ? "A few seconds…" : "Most builds take 1 to 3 minutes.";
  const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
  if (phase === "plan")
    return `Usually about ${Math.max(1, Math.round(range.high / 1000))} seconds.`;
  return `Usually about ${minutes(range.low)}–${minutes(range.high)} minutes.`;
}

export function elapsedCopy(
  elapsedMs: number,
  phase: BuildPhase,
  range: { readonly low: number; readonly high: number } | null,
  now: string,
): string {
  const elapsed =
    elapsedMs < 60_000
      ? `${Math.max(1, Math.floor(elapsedMs / 1000))} s`
      : `${Math.floor(elapsedMs / 60_000)} min`;
  const beyond = range !== null && elapsedMs > range.high;
  return beyond
    ? `Taking a bit longer than usual · ${elapsed} so far · now: ${now}`
    : `${estimateCopy(phase, range)} · ${elapsed} so far`;
}
