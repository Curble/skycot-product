import { ServerProvider, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  continuationSwitch,
  grownUpSwitchLines,
  isCarriedOnLimitItem,
  parseAssistantSwitches,
  switchLine,
  wasCarriedOn,
} from "./switches";
import { restingUntilPhrase } from "./usage";

// Saturday 24 October 2026, 8:00 pm in Melbourne (AEDT, UTC+11).
const NOW = Date.parse("2026-10-24T09:00:00.000Z");
const TZ = "Australia/Melbourne";
const HOUR = 60 * 60_000;
const TUESDAY = Date.parse("2026-10-27T03:04:00.000Z");

const decodeProvider = Schema.decodeUnknownSync(ServerProvider);
const base = {
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-24T08:58:00.000Z",
};
const PROVIDERS = [
  decodeProvider({
    ...base,
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    models: [
      {
        slug: "claude-fable-5-1",
        name: "Claude Fable 5.1",
        isCustom: false,
        isDefault: true,
        capabilities: null,
      },
      { slug: "claude-opus-5-5", name: "Claude Opus 5.5", isCustom: false, capabilities: null },
      { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", isCustom: false, capabilities: null },
    ],
  }),
  decodeProvider({
    ...base,
    instanceId: "codex",
    driver: "codex",
    models: [{ slug: "gpt-6-astra", name: "GPT-6 Astra", isCustom: false, capabilities: null }],
  }),
];

const claude = (model: string) => ({ instanceId: "claudeAgent", driver: "claudeAgent", model });
const chatgpt = { instanceId: "codex", driver: "codex", model: "gpt-6-astra" };

describe("the conversation's plain line", () => {
  it("within the company: the top helper rests, the crew carries on with the next one", () => {
    expect(
      switchLine({
        change: {
          from: claude("claude-fable-5-1"),
          to: claude("claude-sonnet-5-5"),
          until: TUESDAY,
          crossProvider: false,
        },
        providers: PROVIDERS,
        now: NOW,
        timeZone: TZ,
        crewName: "Sam",
      }),
    ).toBe("Claude's top helper is resting until Tuesday, so Sam is using Claude Sonnet for now.");
  });

  it("another company: the company's name, not the model's", () => {
    expect(
      switchLine({
        change: {
          from: claude("claude-fable-5-1"),
          to: chatgpt,
          until: TUESDAY,
          crossProvider: true,
        },
        providers: PROVIDERS,
        now: NOW,
        timeZone: TZ,
        crewName: "Sam",
      }),
    ).toBe("Claude is resting until Tuesday, so Sam is using ChatGPT for now.");
  });

  it("names a model that is not the top one, and says SKYCOT when the crew has no name", () => {
    expect(
      switchLine({
        change: {
          from: claude("claude-opus-5-5"),
          to: claude("claude-sonnet-5-5"),
          until: null,
          crossProvider: false,
        },
        providers: PROVIDERS,
        now: NOW,
        timeZone: TZ,
        crewName: null,
      }),
    ).toBe("Claude Opus is resting, so SKYCOT is using Claude Sonnet for now.");
  });

  it("says how long in words a child knows", () => {
    expect(restingUntilPhrase(NOW + 2 * HOUR, NOW, TZ)).toBe("until 10 pm");
    expect(restingUntilPhrase(NOW + 14 * HOUR, NOW, TZ)).toBe("until tomorrow");
    expect(restingUntilPhrase(TUESDAY, NOW, TZ)).toBe("until Tuesday");
    expect(restingUntilPhrase(NOW + 10 * 24 * HOUR, NOW, TZ)).toBe("until 3 Nov");
    expect(restingUntilPhrase(null, NOW, TZ)).toBe("");
    expect(restingUntilPhrase(NOW - HOUR, NOW, TZ)).toBe("");
  });

  it("reads the engine's notes, skipping anything malformed", () => {
    expect(
      parseAssistantSwitches({
        switches: [
          {
            messageId: "message-1",
            from: claude("claude-fable-5-1"),
            to: chatgpt,
            until: TUESDAY,
            crossProvider: true,
          },
          { messageId: "message-2", from: null },
        ],
      }),
    ).toEqual([
      {
        messageId: "message-1",
        from: claude("claude-fable-5-1"),
        to: chatgpt,
        until: TUESDAY,
        crossProvider: true,
        continuationOf: null,
      },
    ]);
    expect(parseAssistantSwitches({})).toBeNull();
  });
});

describe("a turn carried on half-way", () => {
  const projection = {
    runs: [
      {
        id: "run-1",
        userMessageId: "message-1",
        modelSelection: { instanceId: "claudeAgent", model: "claude-fable-5-1" },
      },
      {
        id: "run-2",
        userMessageId: "skycot-switch:run-1",
        modelSelection: { instanceId: "codex", model: "gpt-6-astra" },
      },
    ],
    turnItems: [
      {
        id: "error-1",
        type: "error",
        runId: "run-1",
        failure: {
          class: "usage_limit",
          message: "Claude usage limit reached.",
          resetAt: "2026-10-27T03:04:00.000Z",
        },
      },
      {
        id: "notice-1",
        type: "system_notice",
        runId: "run-1",
        message:
          "Claude usage limit reached. This turn is paused until the 7-day Fable limit resets in 66h 4m.",
      },
      { id: "notice-2", type: "system_notice", runId: "run-2", message: "Compacted." },
    ],
    messages: [{ id: "message-1" }, { id: "skycot-switch:run-1" }],
  } as unknown as OrchestrationV2ThreadProjection;

  it("reads the switch from the conversation itself when the engine's notes are not to hand", () => {
    const change = continuationSwitch(projection, PROVIDERS, "skycot-switch:run-1");
    expect(change).toEqual({
      messageId: "skycot-switch:run-1",
      from: claude("claude-fable-5-1"),
      to: chatgpt,
      until: TUESDAY,
      crossProvider: true,
      continuationOf: "run-1",
    });
    expect(continuationSwitch(projection, PROVIDERS, "message-1")).toBeNull();
  });

  it("hides the stopped run's limit card and notice, nothing else", () => {
    expect(wasCarriedOn(projection, "run-1")).toBe(true);
    expect(wasCarriedOn(projection, "run-2")).toBe(false);
    const [error, notice, other] = projection.turnItems;
    expect(isCarriedOnLimitItem(projection, error!)).toBe(true);
    expect(isCarriedOnLimitItem(projection, notice!)).toBe(true);
    expect(isCarriedOnLimitItem(projection, other!)).toBe(false);
  });
});

describe("what the grown-ups read", () => {
  it("one line per move, repeats counted", () => {
    const at = Date.parse("2026-10-24T04:40:00.000Z");
    expect(
      grownUpSwitchLines(
        [
          { at, from: "claudeAgent", to: "codex" },
          { at: at + HOUR, from: "claudeAgent", to: "codex" },
          { at, from: "codex", to: "claudeAgent" },
        ],
        () => "3:40 pm",
      ),
    ).toEqual([
      "Claude was resting, so SKYCOT used ChatGPT instead 2 times.",
      "ChatGPT was resting at 3:40 pm, so SKYCOT used Claude instead.",
    ]);
  });
});
