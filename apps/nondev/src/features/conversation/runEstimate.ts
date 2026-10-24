// One time estimate for the run going on now, shared by the conversation strip, the working
// card and the Build Journey, so a child never sees two different answers to "how long?".
// A build is a run that carries out a plan (`sourcePlanRef`); anything else is the plan's few
// seconds. The family's own past runs give the range (plain/estimate.ts).
import { estimateBuildTime, type BuildPhase } from "../../plain/estimate";
import { readBuildTimes } from "./buildTimes";

export interface RunEstimate {
  readonly phase: BuildPhase;
  readonly range: { readonly low: number; readonly high: number } | null;
}

export function estimateForRun(
  run:
    | {
        readonly sourcePlanRef?: unknown;
        readonly modelSelection: { readonly model: string };
      }
    | null
    | undefined,
): RunEstimate {
  const phase: BuildPhase = run?.sourcePlanRef ? "build" : "plan";
  return {
    phase,
    range: estimateBuildTime(readBuildTimes(), {
      kind: "other",
      model: run?.modelSelection.model ?? "unknown",
      phase,
    }),
  };
}
