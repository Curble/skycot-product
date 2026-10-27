/**
 * The sample family's whole world, as fixed data in the shapes a real Mac sends. The app's own
 * parsers read it (`familyApi`, `readShell`, `readThread`), so the sample runs through the same
 * screens as a linked Mac and cannot drift from them. No real people: Ava and Leo are the
 * children, "Sam's grown-up" the grown-up, and everything is kid-safe.
 *
 * Pure: `sampleBank` builds the answers for a moment in time and for one of the two views
 * (a grown-up's phone, or Ava's own device). Nothing here touches the network or storage.
 */
import type { ServerProvider } from "@t3tools/contracts";
import { bookView, type BadgeBook, type BadgeId } from "@t3tools/skycot-rules/badges";

import { demoConversation, type DemoName } from "../dev/demoConversation";
import type { ProjectShell, ShellSnapshot, ThreadProjection, ThreadShell } from "../engine/types";

export type SampleWho = "grown-up" | "child";

export const SAMPLE_PREFIX = "skycot-sample";
export const sampleMacId = (who: SampleWho): string => `${SAMPLE_PREFIX}-${who}`;
export const isSampleMacId = (macId: string): boolean => macId.startsWith(`${SAMPLE_PREFIX}-`);

export const SAMPLE_FAMILY_NAME = "Sample family";
export const SAMPLE_GROWN_UP_ID = "sample-grown-up";
export const SAMPLE_GROWN_UP_NAME = "Sam's grown-up";
export const AVA = "sample-ava";
export const LEO = "sample-leo";

/** The parent code box takes four digits; the sample accepts any four. */
export const SAMPLE_CODE_LENGTH = 4;

const DEMO_THREAD_ID = "f83084ef-d5b9-4ed6-81f9-c7aecc70d53f";
const DEMO_PROJECT_ID = "project-ava-space-game";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const iso = (at: number): string => new Date(at).toISOString();

interface ThreadSpec {
  readonly id: string;
  readonly projectId: string;
  readonly childId: string;
  readonly title: string;
  readonly variant: DemoName;
  readonly userText: string;
  readonly reply?: string;
  readonly plan?: string;
  readonly prompts?: ReadonlyArray<string>;
  readonly files?: ReadonlyArray<{
    path: string;
    kind: string;
    additions: number;
    deletions: number;
  }>;
  readonly ageMs: number;
}

export const THREAD = {
  space: "sample-thread-space-game",
  quiz: "sample-thread-dinosaur-quiz",
  sound: "sample-thread-rocket-sound",
  card: "sample-thread-grandma-card",
} as const;

const PROJECT = {
  space: "sample-project-space-game",
  quiz: "sample-project-dinosaur-quiz",
  card: "sample-project-grandma-card",
} as const;

const SPECS: ReadonlyArray<ThreadSpec> = [
  {
    id: THREAD.space,
    projectId: PROJECT.space,
    childId: AVA,
    title: "Space game",
    variant: "made",
    userText: "Please make a simple space game with a rocket and stars.",
    reply:
      "I made your space game! Fly the rocket with the arrow keys and touch the planets to score.",
    ageMs: 2 * DAY,
  },
  {
    id: THREAD.quiz,
    projectId: PROJECT.quiz,
    childId: LEO,
    title: "Dinosaur quiz",
    variant: "made",
    userText: "Can you make a quiz about dinosaurs?",
    reply: "I made your dinosaur quiz! Pick an answer for each question and see your score.",
    files: [
      { path: "quiz.html", kind: "added", additions: 96, deletions: 0 },
      { path: "dinosaurs.css", kind: "added", additions: 24, deletions: 0 },
    ],
    ageMs: 5 * HOUR,
  },
  {
    id: THREAD.sound,
    projectId: PROJECT.space,
    childId: AVA,
    title: "Add a rocket sound",
    variant: "ask",
    userText: "Can the rocket make a whoosh sound?",
    prompts: ["ls", "npm install three"],
    ageMs: 12 * MINUTE,
  },
  {
    id: THREAD.card,
    projectId: PROJECT.card,
    childId: AVA,
    title: "A card for Grandma",
    variant: "plan",
    userText: "Please make a birthday card for Grandma with balloons.",
    plan: [
      '1. Draw a bright card with a big "Happy Birthday" on the front.',
      "2. Add balloons that float up when you tap them.",
      "3. Write a message from Ava inside.",
    ].join("\n"),
    ageMs: 50 * MINUTE,
  },
];

/** A recorded conversation, made from the development demo thread with the sample's words. */
function buildThread(spec: ThreadSpec, now: number): ThreadProjection {
  const base = demoConversation(spec.variant);
  const projection = JSON.parse(
    JSON.stringify(base)
      .split(DEMO_THREAD_ID)
      .join(spec.id)
      .split(DEMO_PROJECT_ID)
      .join(spec.projectId),
  ) as ThreadProjection;
  const loose = projection as unknown as {
    thread: Record<string, unknown>;
    messages: Array<Record<string, unknown>>;
    plans: Array<Record<string, unknown>>;
    visibleTurnItems: Array<{ item: Record<string, unknown> }>;
    turnItems: Array<Record<string, unknown>>;
    checkpoints: Array<Record<string, unknown>>;
  };
  const updatedAt = iso(now - spec.ageMs);
  loose.thread.title = spec.title;
  loose.thread.createdAt = iso(now - spec.ageMs - 20 * MINUTE);
  loose.thread.updatedAt = updatedAt;
  loose.thread.lastVisitedAt = updatedAt;
  (projection as unknown as { updatedAt: string }).updatedAt = updatedAt;
  for (const message of loose.messages) if (message.role === "user") message.text = spec.userText;
  if (spec.plan !== undefined) for (const plan of loose.plans) plan.markdown = spec.plan;
  let prompt = 0;
  const edit = (item: Record<string, unknown>) => {
    if (item.type === "user_message") item.text = spec.userText;
    if (item.type === "proposed_plan" && spec.plan !== undefined) item.markdown = spec.plan;
    if (item.type === "assistant_message" && spec.reply !== undefined) item.text = spec.reply;
    if (item.type === "approval_request" && spec.prompts !== undefined) {
      item.prompt = spec.prompts[Math.min(prompt, spec.prompts.length - 1)];
      prompt += 1;
    }
    if (item.type === "checkpoint" && spec.files !== undefined) item.files = spec.files;
  };
  for (const entry of loose.visibleTurnItems) edit(entry.item);
  for (const item of loose.turnItems) edit(item);
  if (spec.files !== undefined)
    for (const checkpoint of loose.checkpoints) {
      if (Array.isArray(checkpoint.files) && checkpoint.files.length > 0)
        checkpoint.files = spec.files;
    }
  return projection;
}

function shellThread(projection: ThreadProjection, spec: ThreadSpec, now: number): ThreadShell {
  const loose = projection as unknown as {
    thread: Record<string, unknown>;
    runs: Array<{ id: string }>;
    plans: Array<{ status: string }>;
    runtimeRequests: Array<{ id: string; kind: string; status: string }>;
    messages: Array<{ id: string; role: string; text: string }>;
  };
  const pending = loose.runtimeRequests.find((request) => request.status === "pending") ?? null;
  const last = loose.messages.at(-1);
  const updatedAt = iso(now - spec.ageMs);
  const status = pending !== null ? "waiting" : "completed";
  return {
    ...loose.thread,
    latestRunId: loose.runs[0]?.id ?? null,
    activeRunId: null,
    status,
    pendingRuntimeRequest:
      pending === null ? null : { id: pending.id, kind: pending.kind, createdAt: updatedAt },
    latestVisibleMessage:
      last === undefined ? null : { id: last.id, role: last.role, text: last.text, updatedAt },
    latestUserMessageAt: updatedAt,
    hasActionableProposedPlan: loose.plans.some((plan) => plan.status === "active"),
    itemCount: 8,
    visibleItemCount: 8,
    archivedAt: null,
    deletedAt: null,
    updatedAt,
  } as unknown as ThreadShell;
}

const PROJECT_ROWS: ReadonlyArray<{ id: string; title: string; root: string }> = [
  { id: PROJECT.space, title: "Space game", root: "/sample/space-game" },
  { id: PROJECT.quiz, title: "Dinosaur quiz", root: "/sample/dinosaur-quiz" },
  { id: PROJECT.card, title: "A card for Grandma", root: "/sample/grandma-card" },
];

function projectShell(row: (typeof PROJECT_ROWS)[number], now: number): ProjectShell {
  return {
    id: row.id,
    title: row.title,
    workspaceRoot: row.root,
    defaultModelSelection: null,
    scripts: [],
    createdAt: iso(now - 9 * DAY),
    updatedAt: iso(now - DAY),
  } as unknown as ProjectShell;
}

function limitsFor(now: number, usedMinutes: number, turns: number) {
  return {
    asleep: false,
    reason: null,
    minutesLeft: 60 - usedMinutes,
    headsUp: false,
    wakesAt: null,
    changesAt: now + 3 * HOUR,
    usedMinutes,
    turns,
    passUntil: null,
    bedtime: { inside: false, startsAt: now + 3 * HOUR, endsAt: now + 13 * HOUR },
    allowance: null,
  };
}

function child(id: string, name: string, pose: string, look: string) {
  return {
    id,
    name,
    avatar: { kind: "mascot", pose },
    look,
    largerText: true,
    voice: { typing: false, readAloud: true },
    limits: {
      bedtime: { start: "19:30", end: "07:00" },
      dailyMinutes: 60,
      dailyTurns: null,
      keepAllowancePercent: null,
    },
    askEachStep: false,
    readingLevel: "makers",
  };
}

const SPACE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Space game</title><style>html,body{margin:0;height:100%;background:#0b1d3a;color:#fff;font-family:-apple-system,sans-serif;overflow:hidden}#s{position:absolute;top:10px;left:14px;font-size:22px;font-weight:700}#r{position:absolute;bottom:40px;left:50%;font-size:48px;transform:translateX(-50%)}.p{position:absolute;font-size:40px}</style></head><body><div id="s">Score: 0</div><div id="r">&#128640;</div><script>var s=0,x=50,r=document.getElementById("r"),sc=document.getElementById("s");function mk(){var e=document.createElement("div");e.className="p";e.textContent="\\uD83E\\uDE90";e.style.left=Math.random()*85+"%";e.style.top="-50px";document.body.appendChild(e);var y=-50;var t=setInterval(function(){y+=4;e.style.top=y+"px";if(y>innerHeight-110&&Math.abs(parseFloat(e.style.left)-x)<10){s++;sc.textContent="Score: "+s;e.remove();clearInterval(t)}else if(y>innerHeight){e.remove();clearInterval(t)}},30)}setInterval(mk,1200);addEventListener("touchmove",function(v){x=v.touches[0].clientX/innerWidth*100;r.style.left=x+"%"});addEventListener("mousemove",function(v){x=v.clientX/innerWidth*100;r.style.left=x+"%"});</script></body></html>`;

const QUIZ_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dinosaur quiz</title><style>body{margin:0;padding:24px;background:#fff7e0;color:#2b2b2b;font-family:-apple-system,sans-serif}h1{font-size:26px}button{display:block;width:100%;margin:10px 0;padding:14px;font-size:18px;border:0;border-radius:14px;background:#ffd25e}#m{font-size:20px;margin-top:16px;font-weight:700}</style></head><body><h1>Dinosaur quiz</h1><p id="q">Which dinosaur had three horns on its face?</p><button onclick="a(1)">Triceratops</button><button onclick="a(0)">Stegosaurus</button><button onclick="a(0)">Brachiosaurus</button><div id="m"></div><script>function a(ok){document.getElementById("m").textContent=ok?"Yes! Triceratops!":"Not this time. Try again!"}</script></body></html>`;

const card = (background: string, title: string, emoji: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${background}"/><text x="160" y="92" font-size="56" text-anchor="middle">${emoji}</text><text x="160" y="140" font-size="20" font-family="-apple-system,sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${title}</text></svg>`;

/** The one pretend assistant the sample "has", so New conversation can be tried. */
export const SAMPLE_PROVIDER = {
  instanceId: "sample",
  enabled: true,
  installed: true,
  availability: "available",
  models: [{ slug: "sample", name: "Sample", isDefault: true }],
} as unknown as ServerProvider;

/** Starting something in the sample opens a recorded plan; nothing is started. */
export const SAMPLE_NEW_CONVERSATION = THREAD.card;

export interface SampleBank {
  readonly who: SampleWho;
  readonly macId: string;
  readonly status: unknown;
  readonly today: unknown;
  readonly shell: ShellSnapshot;
  readonly threads: Readonly<Record<string, ThreadProjection>>;
  readonly requests: unknown;
  readonly notes: unknown;
  readonly fridge: unknown;
  readonly pages: Readonly<Record<string, string>>;
  readonly cards: Readonly<Record<string, string>>;
  readonly answers: unknown;
  readonly book: unknown;
  readonly recap: (childId: string, range: string) => unknown;
  /** What a new conversation opens on in the sample (a recorded one, never a real start). */
  readonly newConversationId: string;
}

export function sampleBank(who: SampleWho, now: number): SampleBank {
  const macId = sampleMacId(who);
  const visible = SPECS.filter((spec) => who === "grown-up" || spec.childId === AVA);
  const threads: Record<string, ThreadProjection> = {};
  const shellThreads: Array<ThreadShell> = [];
  for (const spec of visible) {
    const projection = buildThread(spec, now);
    threads[spec.id] = projection;
    shellThreads.push(shellThread(projection, spec, now));
  }
  const projectIds = new Set(visible.map((spec) => spec.projectId));
  const shell = {
    schemaVersion: 1,
    snapshotSequence: 1,
    threads: shellThreads,
    archivedThreads: [],
    projects: PROJECT_ROWS.filter((row) => projectIds.has(row.id)).map((row) =>
      projectShell(row, now),
    ),
  } as unknown as ShellSnapshot;

  const me =
    who === "grown-up"
      ? {
          kind: "grown-up",
          deviceId: "sample-phone",
          deviceName: "Sample iPhone",
          personId: SAMPLE_GROWN_UP_ID,
        }
      : { kind: "child", deviceId: "sample-ipad", deviceName: "Sample iPad", childId: AVA };
  const status = {
    enabled: true,
    childName: null,
    createdAt: iso(now - 30 * DAY),
    attemptsLeft: 5,
    lockedForMs: 0,
    children: [child(AVA, "Ava", "hello", "workshop"), child(LEO, "Leo", "yay", "workshop")],
    timeZone: "Australia/Melbourne",
    session:
      who === "child"
        ? {
            childId: AVA,
            needsChoice: false,
            device: "child",
            limits: limitsFor(now, 25, 6),
            sentence: null,
          }
        : { childId: null, needsChoice: false, device: "grown-up", limits: null, sentence: null },
    allowedAssistants: [],
    pageInternet: [],
    grownUps: [
      {
        id: SAMPLE_GROWN_UP_ID,
        name: SAMPLE_GROWN_UP_NAME,
        avatar: { kind: "initial", color: "sky" },
      },
    ],
    devices: [],
    me,
    codeLength: SAMPLE_CODE_LENGTH,
  };
  const today = {
    children: [
      { childId: AVA, limits: limitsFor(now, 25, 6), switches: [] },
      { childId: LEO, limits: limitsFor(now, 40, 9), switches: [] },
    ],
    threads: Object.fromEntries(visible.map((spec) => [spec.id, spec.childId])),
  };

  const askSpec = SPECS.find((spec) => spec.variant === "ask")!;
  const askProjection = buildThread(askSpec, now) as unknown as {
    runtimeRequests: Array<{ id: string; status: string }>;
  };
  const pendingRequestId = askProjection.runtimeRequests.find((r) => r.status === "pending")!.id;
  const requests = {
    requests: [
      {
        threadId: askSpec.id,
        requestId: pendingRequestId,
        childId: AVA,
        threadTitle: askSpec.title,
        projectTitle: "Space game",
        createdAt: now - 12 * MINUTE,
        lapsed: false,
        needsGrownUp: true,
        why: "To add the whoosh sound to the rocket.",
        what: "npm install three",
        kind: "command",
        fingerprint: "sample-fingerprint-1",
      },
    ],
    batches: [],
  };
  const notes = {
    notes: [
      {
        id: "sample-note-1",
        kind: "shown",
        childId: LEO,
        createdAt: iso(now - 5 * HOUR),
        status: "open",
        threadId: THREAD.quiz,
        title: "Dinosaur quiz",
      },
    ],
  };

  const fridge = {
    items: [
      {
        threadId: THREAD.space,
        projectId: PROJECT.space,
        title: "Space game",
        childId: AVA,
        madeAt: now - 2 * DAY,
        page: "space-game.html",
        contentHash: "sample-hash-space",
        cardHash: "sample-card-space",
        cwd: "/sample/space-game",
        pinnedAt: now - DAY,
      },
      {
        threadId: THREAD.quiz,
        projectId: PROJECT.quiz,
        title: "Dinosaur quiz",
        childId: LEO,
        madeAt: now - 5 * HOUR,
        page: "quiz.html",
        contentHash: "sample-hash-quiz",
        cardHash: "sample-card-quiz",
        cwd: "/sample/dinosaur-quiz",
        pinnedAt: null,
      },
    ],
  };

  const answers = {
    answers: [
      {
        requestId: "sample-earlier-request",
        decision: "accept",
        by: "Sam's grown-up",
        at: now - DAY,
      },
    ],
  };

  const earned = (at: number, threadId: string, title: string) => ({
    at,
    threadId,
    title,
    seen: true,
  });
  const bookData: BadgeBook = {
    earned: {
      "first-creation": earned(now - 2 * DAY, THREAD.space, "Space game"),
      "first-game": earned(now - 2 * DAY, THREAD.space, "Space game"),
    } as Partial<Record<BadgeId, ReturnType<typeof earned>>>,
    creations: 2,
    madeThreads: [THREAD.space, THREAD.quiz],
    countedMessages: [],
    bigQuestions: 0,
    starters: [],
    night: null,
  };
  const book = { book: bookView(AVA, bookData) };

  const recap = (childId: string, range: string) => {
    const leo = childId === LEO;
    const days = Array.from({ length: 7 }, (_, index) => {
      const at = now - (6 - index) * DAY;
      return {
        date: iso(at).slice(0, 10),
        minutes: leo ? 20 + index * 4 : 15 + index * 3,
        turns: 4 + index,
      };
    });
    const spec = SPECS.find((entry) => entry.childId === childId && entry.variant === "made")!;
    return {
      childId,
      range,
      from: now - 7 * DAY,
      to: now,
      timeZone: "Australia/Melbourne",
      days,
      minutes: days.reduce((sum, day) => sum + day.minutes, 0),
      messages: leo ? 18 : 14,
      made: [
        {
          threadId: spec.id,
          projectId: spec.projectId,
          projectTitle: spec.title,
          title: spec.title,
          startedAt: now - spec.ageMs - 20 * MINUTE,
          startedInRange: true,
          lastAt: now - spec.ageMs,
          changes: [
            {
              checkpointId: `sample-checkpoint-${spec.id}`,
              at: now - spec.ageMs,
              files: spec.files ?? [
                { path: "space-game.html", kind: "added", additions: 148, deletions: 0 },
              ],
            },
          ],
          page: leo ? "quiz.html" : "space-game.html",
          cwd: leo ? "/sample/dinosaur-quiz" : "/sample/space-game",
        },
      ],
      asks: [],
      grownUp: { held: 1, approved: 1, moreTime: [], shield: {}, shieldAllowed: 0 },
      proudOf: {
        threadId: spec.id,
        title: spec.title,
        at: now - spec.ageMs,
        page: leo ? "quiz.html" : "space-game.html",
        cwd: leo ? "/sample/dinosaur-quiz" : "/sample/space-game",
      },
    };
  };

  return {
    who,
    macId,
    status,
    today,
    shell,
    threads,
    requests,
    notes,
    fridge,
    pages: { "space-game.html": SPACE_PAGE, "quiz.html": QUIZ_PAGE },
    cards: {
      "sample-card-space": card("#0b1d3a", "Space game", "\u{1F680}"),
      "sample-card-quiz": card("#3f8f5b", "Dinosaur quiz", "\u{1F995}"),
    },
    answers,
    book,
    recap,
    newConversationId: THREAD.card,
  };
}
