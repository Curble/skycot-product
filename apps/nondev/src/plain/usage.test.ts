import { ServerProvider, UsageSummary } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  bindingWindow,
  connectedProviderUsage,
  costEstimate,
  describeProviderUsage,
  resetPhrase,
  tokenReport,
  tokensPhrase,
  updatedPhrase,
  usageTone,
  usageWarning,
  windowName,
} from "./usage";

// Thursday 22 October 2026, 2:00 pm in Melbourne (AEDT, UTC+11).
const NOW = Date.parse("2026-10-22T03:00:00.000Z");
const TZ = "Australia/Melbourne";

const decodeProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeSummary = Schema.decodeUnknownSync(UsageSummary);

function provider(fields: Record<string, unknown> = {}): ServerProvider {
  return decodeProvider({
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated", label: "ChatGPT Plus" },
    checkedAt: "2026-10-22T02:58:00.000Z",
    models: [],
    ...fields,
  });
}

// Codex as the engine publishes it after a rate-limit snapshot: a 5-hour and a weekly window.
const codexLimits = {
  checkedAt: "2026-10-22T02:58:00.000Z",
  windows: [
    {
      id: "primary",
      kind: "session",
      label: "Session",
      usedPercent: 38,
      windowDurationMins: 300,
      resetsAt: "2026-10-22T04:40:00.000Z",
    },
    {
      id: "secondary",
      kind: "weekly",
      label: "Weekly",
      usedPercent: 19,
      windowDurationMins: 10080,
      resetsAt: "2026-10-25T22:00:00.000Z",
    },
  ],
};

describe("usageTone", () => {
  it("is green above 30% left, amber from 30% to 10%, red under 10%, neutral when unknown", () => {
    expect(usageTone(62)).toBe("ok");
    expect(usageTone(31)).toBe("ok");
    expect(usageTone(30)).toBe("low");
    expect(usageTone(10)).toBe("low");
    expect(usageTone(9)).toBe("critical");
    expect(usageTone(0)).toBe("critical");
    expect(usageTone(null)).toBe("unknown");
  });
});

describe("resetPhrase", () => {
  it("counts minutes within the hour, then says the clock time, the day, the date", () => {
    expect(resetPhrase(NOW + 20_000, NOW, TZ)).toBe("resets in a moment");
    expect(resetPhrase(NOW + 60_000, NOW, TZ)).toBe("resets in 1 minute");
    expect(resetPhrase(Date.parse("2026-10-22T03:12:00Z"), NOW, TZ)).toBe("resets in 12 minutes");
    expect(resetPhrase(Date.parse("2026-10-22T04:40:00Z"), NOW, TZ)).toBe("resets 3:40 pm");
    expect(resetPhrase(Date.parse("2026-10-22T22:00:00Z"), NOW, TZ)).toBe("resets tomorrow 9 am");
    expect(resetPhrase(Date.parse("2026-10-25T22:00:00Z"), NOW, TZ)).toBe("resets Mon 9 am");
    expect(resetPhrase(Date.parse("2026-11-03T00:00:00Z"), NOW, TZ)).toBe("resets 3 Nov");
  });

  it("reads the calendar in the person's own zone", () => {
    // 11:30 pm UTC on the 22nd is already Friday morning in Melbourne.
    const late = Date.parse("2026-10-22T23:30:00Z");
    expect(resetPhrase(late, NOW, "UTC")).toBe("resets 11:30 pm");
    expect(resetPhrase(late, NOW, TZ)).toBe("resets tomorrow 10:30 am");
  });
});

describe("updatedPhrase", () => {
  it("is relative for the last hour, then a time, then a day", () => {
    expect(updatedPhrase(NOW - 10_000, NOW, TZ)).toBe("Updated just now");
    expect(updatedPhrase(NOW - 4 * 60_000, NOW, TZ)).toBe("Updated 4 minutes ago");
    expect(updatedPhrase(Date.parse("2026-10-22T00:10:00Z"), NOW, TZ)).toBe("Updated 11:10 am");
    expect(updatedPhrase(Date.parse("2026-10-21T01:00:00Z"), NOW, TZ)).toBe("Updated yesterday");
  });
});

describe("windowName", () => {
  const decoded = provider({ usageLimits: codexLimits }).usageLimits!.windows;

  it("names a window by how long it lasts, not the engine's slot name", () => {
    expect(windowName(decoded[0]!, "codex")).toBe("5-hour window");
    expect(windowName(decoded[1]!, "codex")).toBe("This week");
  });

  it("keeps Claude's model-scoped weekly allowance distinct", () => {
    const claude = provider({
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      usageLimits: {
        checkedAt: "2026-10-22T02:58:00.000Z",
        windows: [
          {
            id: "seven_day_opus",
            kind: "weekly",
            label: "Weekly · Opus",
            usedPercent: 50,
            windowDurationMins: 10080,
          },
          { id: "monthly_spend", kind: "monthly", label: "Monthly spend", usedPercent: 5 },
        ],
      },
    }).usageLimits!.windows;
    expect(windowName(claude[0]!, "claudeAgent")).toBe("This week (Opus)");
    expect(windowName(claude[1]!, "claudeAgent")).toBe("Extra spending this month");
  });
});

describe("describeProviderUsage", () => {
  it("speaks for the window that runs out first", () => {
    const usage = describeProviderUsage(provider({ usageLimits: codexLimits }), NOW, TZ);
    expect(usage).toMatchObject({
      brand: "ChatGPT",
      plan: "ChatGPT Plus",
      status: "reported",
      leftPercent: 62,
      tone: "ok",
      label: "ChatGPT allowance: 62% left",
      reason: null,
      checkedAt: Date.parse("2026-10-22T02:58:00.000Z"),
    });
    expect(usage.binding?.id).toBe("primary");
    expect(usage.windows.map((window) => window.line)).toEqual([
      "5-hour window: 62% left · resets 3:40 pm",
      "This week: 81% left · resets Mon 9 am",
    ]);
  });

  it("lets a spent weekly allowance win over a fresh 5-hour one", () => {
    const usage = describeProviderUsage(
      provider({
        usageLimits: {
          ...codexLimits,
          windows: [
            { ...codexLimits.windows[0], usedPercent: 4 },
            { ...codexLimits.windows[1], usedPercent: 100 },
          ],
        },
      }),
      NOW,
      TZ,
    );
    expect(usage).toMatchObject({ leftPercent: 0, tone: "critical" });
    expect(usage.binding?.name).toBe("This week");
  });

  it("drops Cursor's combined figure when both of its pools are reported", () => {
    const usage = describeProviderUsage(
      provider({
        instanceId: "cursor",
        driver: "cursor",
        usageLimits: {
          checkedAt: "2026-10-22T02:58:00.000Z",
          windows: [
            { id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 99 },
            { id: "autoPercentUsed", kind: "monthly", label: "Cursor Models", usedPercent: 40 },
            { id: "apiPercentUsed", kind: "monthly", label: "Other Models", usedPercent: 75 },
          ],
        },
      }),
      NOW,
      TZ,
    );
    expect(usage.windows.map((window) => window.name)).toEqual([
      "Cursor's own models",
      "Other models",
    ]);
    expect(usage.leftPercent).toBe(25);
  });

  it("says honestly why there is no number", () => {
    const apiKey = describeProviderUsage(
      provider({
        usageLimits: {
          checkedAt: "2026-10-22T02:58:00.000Z",
          windows: [],
          unavailable: { reason: "unsupported" },
        },
      }),
      NOW,
      TZ,
    );
    expect(apiKey).toMatchObject({
      status: "unsupported",
      leftPercent: null,
      tone: "unknown",
      label: "ChatGPT allowance: usage not reported",
    });
    expect(apiKey.reason).toMatch(/API key/);

    const failed = describeProviderUsage(
      provider({
        usageLimits: {
          checkedAt: "2026-10-22T02:58:00.000Z",
          windows: [],
          unavailable: { reason: "probeFailed", message: "app-server rateLimits/read timed out" },
        },
      }),
      NOW,
      TZ,
    );
    expect(failed.status).toBe("probeFailed");
    // The engine's developer message never reaches the person.
    expect(failed.reason).not.toMatch(/app-server/);

    expect(describeProviderUsage(provider(), NOW, TZ)).toMatchObject({
      status: "none",
      reason:
        "ChatGPT hasn't reported its allowance yet. It usually appears after the first message.",
    });
    expect(
      describeProviderUsage(provider({ instanceId: "pi", driver: "pi" }), NOW, TZ).reason,
    ).toBe("Pi doesn't report its allowance to SKYCOT.");
  });
});

describe("connectedProviderUsage", () => {
  it("lists switched-on, signed-in assistants with the one in use first", () => {
    const list = connectedProviderUsage(
      [
        provider({ instanceId: "claudeAgent", driver: "claudeAgent" }),
        provider({ usageLimits: codexLimits }),
        provider({
          instanceId: "antigravity",
          driver: "antigravity",
          auth: { status: "unauthenticated" },
        }),
        provider({ instanceId: "cursor", driver: "cursor", enabled: false }),
      ],
      "codex",
      NOW,
      TZ,
    );
    expect(list.map((entry) => entry.brand)).toEqual(["ChatGPT", "Claude"]);
  });
});

describe("bindingWindow", () => {
  it("breaks a tie toward the window that stays empty longer", () => {
    const short = { leftPercent: 0, resetsAt: NOW + 60_000 };
    const long = { leftPercent: 0, resetsAt: NOW + 86_400_000 };
    const pick = bindingWindow([short, long].map((w, i) => ({ ...w, id: `${i}` }) as never));
    expect(pick?.id).toBe("1");
  });
});

describe("Claude's model-only allowance", () => {
  it("shows in the list but does not empty the ring while the main allowance has room", () => {
    const usage = describeProviderUsage(
      provider({
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        usageLimits: {
          checkedAt: "2026-10-22T02:58:00.000Z",
          windows: [
            { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 56 },
            { id: "seven_day_fable", kind: "weekly", label: "Weekly · Fable", usedPercent: 100 },
          ],
        },
      }),
      NOW,
      TZ,
    );
    expect(usage.windows.map((window) => window.line)).toEqual([
      "This week: 44% left",
      "This week (Fable): 0% left",
    ]);
    expect(usage).toMatchObject({ leftPercent: 44, tone: "ok" });
  });
});

describe("a window whose reset has already passed", () => {
  it("says it refilled instead of showing a stale share, and never decides the ring", () => {
    const usage = describeProviderUsage(
      provider({
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        usageLimits: {
          checkedAt: "2026-10-21T22:00:00.000Z",
          windows: [
            {
              id: "five_hour",
              kind: "session",
              label: "Session",
              usedPercent: 97,
              windowDurationMins: 300,
              resetsAt: "2026-10-22T02:12:00.000Z",
            },
            {
              id: "seven_day",
              kind: "weekly",
              label: "Weekly",
              usedPercent: 56,
              windowDurationMins: 10080,
              resetsAt: "2026-10-26T17:59:00.000Z",
            },
          ],
        },
      }),
      NOW,
      TZ,
    );
    expect(usage.windows[0]).toMatchObject({
      expired: true,
      tone: "unknown",
      line: "5-hour window: refilled 1:12 pm, new figure after the next message",
    });
    expect(usage).toMatchObject({ leftPercent: 44, tone: "ok" });
    expect(usage.binding?.id).toBe("seven_day");
  });
});

describe("usageWarning", () => {
  const at = (primaryUsed: number) => {
    const limits = {
      ...codexLimits,
      windows: [{ ...codexLimits.windows[0], usedPercent: primaryUsed }, codexLimits.windows[1]],
    };
    const decoded = provider({ usageLimits: limits });
    return usageWarning(describeProviderUsage(decoded, NOW, TZ), decoded.usageLimits);
  };

  it("stays quiet until 20% or less is left", () => {
    expect(at(79)).toBeNull();
  });

  it("names the allowance, the share left and when it comes back", () => {
    expect(at(80)).toEqual({
      key: `codex:primary:${Date.parse("2026-10-22T04:40:00.000Z")}`,
      text: "About 20% of the 5-hour ChatGPT allowance left · resets 3:40 pm",
      tone: "low",
    });
    expect(at(95)?.tone).toBe("critical");
    expect(at(100)?.text).toBe("The 5-hour ChatGPT allowance is used up · resets 3:40 pm");
  });

  it("says this week's when the weekly allowance is the one running out", () => {
    const limits = {
      ...codexLimits,
      windows: [codexLimits.windows[0], { ...codexLimits.windows[1], usedPercent: 85 }],
    };
    const decoded = provider({ usageLimits: limits });
    expect(usageWarning(describeProviderUsage(decoded, NOW, TZ), decoded.usageLimits)?.text).toBe(
      "About 15% of this week's ChatGPT allowance left · resets Mon 9 am",
    );
  });
});

describe("tokenReport", () => {
  const bucket = (fields: Record<string, unknown>) => ({
    day: "2026-10-22",
    provider: "codex",
    model: "gpt-5.5",
    totals: {
      uncachedInputTokens: 1000,
      cachedInputTokens: 4000,
      cacheCreationTokens: 0,
      outputTokens: 500,
      reasoningTokens: 200,
    },
    costUsd: 0.25,
    cacheSavingsUsd: 0,
    costSource: "modelPriced",
    records: 4,
    unpricedRecords: 0,
    sessions: 1,
    ...fields,
  });
  const summary = decodeSummary({
    contractVersion: 6,
    readAt: "2026-10-22T03:00:00.000Z",
    timeZone: TZ,
    sinceDay: "2026-10-16",
    untilDay: "2026-10-22",
    buckets: [
      bucket({}),
      bucket({ day: "2026-10-20", costUsd: 1.5 }),
      bucket({
        provider: "claude",
        model: "claude-opus-5",
        costUsd: 0,
        costSource: "unpriced",
        unpricedRecords: 4,
      }),
    ],
    sources: [],
    pricing: { status: "fresh", source: "rate card", fetchedAt: null, knownModels: 10 },
    scanDurationMs: 12,
  });

  it("adds today and the week without counting reasoning twice", () => {
    const report = tokenReport(summary);
    expect(report.today.tokens).toBe(11_000);
    expect(report.week.tokens).toBe(16_500);
    expect(report.week.costUsd).toBeCloseTo(1.75);
    expect(report.week.partlyPriced).toBe(true);
    expect(report.byProvider.map((row) => [row.name, row.tokens])).toEqual([
      ["ChatGPT", 11_000],
      ["Claude", 5_500],
    ]);
    expect(report.byModel[0]).toMatchObject({ name: "gpt-5.5", detail: "ChatGPT" });
    expect(report.empty).toBe(false);
  });

  it("labels every dollar figure as an estimate and never invents one", () => {
    const report = tokenReport(summary);
    expect(costEstimate(report.week)).toBe("About US$1.75 or more if paid per use");
    expect(costEstimate(report.byProvider[1]!)).toBe("Cost not known");
    expect(
      costEstimate({ tokens: 10, costUsd: 0.001, partlyPriced: false, costUnknown: false }),
    ).toBe("Under US$0.01 if paid per use");
    expect(costEstimate({ tokens: 0, costUsd: 0, partlyPriced: false, costUnknown: false })).toBe(
      "Nothing yet",
    );
  });

  it("writes token counts a person can read", () => {
    expect(tokensPhrase(8_400)).toBe("8,400 tokens");
    expect(tokensPhrase(16_500)).toBe("16.5K tokens");
    expect(tokensPhrase(1_234_567)).toBe("1.2M tokens");
    expect(tokensPhrase(1)).toBe("1 token");
  });
});
