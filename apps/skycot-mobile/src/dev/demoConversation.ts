/**
 * Development builds only: three demo conversations for screenshots and design checks, made
 * from a real conversation the pretend AI had with the test Mac (demo-thread.json, folder
 * names scrubbed), with the words a real AI would write. Opened with
 * `skycot-dev://demo/plan`, `…/ask` or `…/made`; nothing is sent anywhere from them.
 */
import type { ThreadProjection, TurnItem } from "../engine/types";
import base from "./demo-thread.json";

export type DemoName = "plan" | "ask" | "made";

const PLAN = [
  "1. Draw a dark blue sky full of twinkling stars.",
  "2. Add a little rocket you steer with the arrow keys.",
  "3. Make planets float past; touching one adds a point.",
  "4. Show your score in big letters, with a Play again button.",
].join("\n");

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function demoConversation(name: DemoName): ThreadProjection {
  const projection = clone(base) as unknown as ThreadProjection;
  const items = projection.visibleTurnItems as unknown as Array<{
    position: number;
    item: Record<string, unknown>;
  }>;
  const user = items.find((entry) => entry.item.type === "user_message")!;
  const asks = items.filter((entry) => entry.item.type === "approval_request");
  const reply = items.find((entry) => entry.item.type === "assistant_message")!;
  const checkpoint = items.find((entry) => entry.item.type === "checkpoint")!;
  const run = projection.runs[0]! as unknown as Record<string, unknown>;
  const planId = "plan:demo:space-game";
  const planItem = {
    position: 1,
    item: {
      ...clone(reply.item),
      id: "turn-item:demo:plan",
      type: "proposed_plan",
      planId,
      markdown: PLAN,
      streaming: false,
    },
  };
  const plan = {
    id: planId,
    threadId: projection.thread.id,
    runId: run.id,
    nodeId: (reply.item as { nodeId: string }).nodeId,
    status: name === "plan" ? "active" : "completed",
    kind: "proposed_plan",
    markdown: PLAN,
  };
  (projection as unknown as { plans: Array<unknown> }).plans = [plan];
  const buildIt = {
    position: 2,
    item: {
      ...clone(user.item),
      id: "turn-item:demo:build",
      text: "Build it: go ahead with the plan.",
    },
  };

  if (name === "plan") {
    run.status = "completed";
    (projection as unknown as { visibleTurnItems: unknown }).visibleTurnItems = [user, planItem];
    return projection;
  }
  if (name === "ask") {
    run.status = "waiting";
    const request = projection.runtimeRequests[1]! as unknown as Record<string, unknown>;
    request.status = "pending";
    delete request.decision;
    (projection as unknown as { visibleTurnItems: unknown }).visibleTurnItems = [
      user,
      planItem,
      buildIt,
      asks[0]!,
      asks[1]!,
    ];
    return projection;
  }
  run.status = "completed";
  (reply.item as Record<string, unknown>).text =
    "I made your space game! Fly the rocket with the arrow keys and touch the planets to score.";
  const files = [
    { path: "space-game.html", kind: "added", additions: 148, deletions: 0 },
    { path: "rocket.css", kind: "added", additions: 36, deletions: 0 },
  ];
  (checkpoint.item as Record<string, unknown>).files = files;
  const checkpoints = projection.checkpoints as unknown as Array<Record<string, unknown>>;
  checkpoints[0]!.status = "ready";
  checkpoints[1]!.status = "ready";
  checkpoints[1]!.files = files;
  (projection as unknown as { visibleTurnItems: unknown }).visibleTurnItems = [
    user,
    planItem,
    buildIt,
    asks[0]!,
    asks[1]!,
    reply,
    checkpoint,
  ] satisfies Array<{ item: unknown }> as Array<{ position: number; item: TurnItem }>;
  return projection;
}
