import { assert, describe, it } from "@effect/vitest";

import { availabilityOf, failureScope, isReadyProvider } from "./availability.ts";
import { chooseModel } from "./choose.ts";
import {
  CLAUDE_ACCOUNT_OUT,
  FABLE_RESET,
  HOUR,
  NOW,
  claude,
  codex,
  cursor,
  window,
} from "./fixtures.test-helpers.ts";
import { rankModels } from "./ranking.ts";

const FABLE = { instanceId: "claudeAgent", model: "claude-fable-5-1" };

describe("model availability", () => {
  it("reads Fable's own weekly window: Fable rests, the rest of Claude works", () => {
    const fable = availabilityOf(claude(), "claude-fable-5-1", [], NOW);
    assert.deepStrictEqual(fable, { usable: false, until: FABLE_RESET, scope: "model" });
    // By alias too, as a thread may name it.
    assert.isFalse(availabilityOf(claude(), "fable", [], NOW).usable);
    assert.isTrue(availabilityOf(claude(), "claude-opus-5-5", [], NOW).usable);
    assert.isTrue(availabilityOf(claude(), "claude-sonnet-5-5", [], NOW).usable);
  });

  it("an account-wide window at 100% rests every model of that provider", () => {
    const sonnet = availabilityOf(claude(CLAUDE_ACCOUNT_OUT), "claude-sonnet-5-5", [], NOW);
    assert.deepStrictEqual(sonnet, { usable: false, until: NOW + 2 * HOUR, scope: "account" });
  });

  it("unknown is usable: no report, no reset time, a reset already past, a spend cap", () => {
    assert.isTrue(availabilityOf(claude([]), "claude-fable-5-1", [], NOW).usable);
    assert.isTrue(
      availabilityOf(
        claude([window("seven_day_fable", "Weekly · Fable", 100, null)]),
        "claude-fable-5-1",
        [],
        NOW,
      ).usable,
    );
    assert.isTrue(
      availabilityOf(
        claude([window("seven_day_fable", "Weekly · Fable", 100, NOW - 1)]),
        "claude-fable-5-1",
        [],
        NOW,
      ).usable,
    );
    assert.isTrue(
      availabilityOf(
        claude([window("monthly_spend", "Monthly spend", 100, NOW + HOUR)]),
        "claude-fable-5-1",
        [],
        NOW,
      ).usable,
    );
  });

  it("a usage-limit failure counts until its reset time", () => {
    const learned = [{ instanceId: "claudeAgent", model: "claude-opus-5-5", until: NOW + HOUR }];
    assert.isFalse(availabilityOf(claude([]), "claude-opus-5-5", learned, NOW).usable);
    assert.isTrue(availabilityOf(claude([]), "claude-opus-5-5", learned, NOW + 2 * HOUR).usable);
    assert.isTrue(availabilityOf(claude([]), "claude-sonnet-5-5", learned, NOW).usable);
    const account = [{ instanceId: "claudeAgent", model: null, until: NOW + HOUR }];
    assert.equal(availabilityOf(claude([]), "claude-sonnet-5-5", account, NOW).scope, "account");
  });

  it("tells a model's own limit from the account's by the failure's reset time", () => {
    assert.equal(failureScope(claude(), FABLE_RESET), "model");
    assert.equal(failureScope(claude(CLAUDE_ACCOUNT_OUT), NOW + 2 * HOUR), "account");
    // The account's week resets with Fable's but has room: still only Fable's own.
    assert.equal(
      failureScope(claude([window("seven_day", "Weekly", 85, FABLE_RESET)]), FABLE_RESET),
      "model",
    );
    // Nothing matches: the narrowest reading, so the rest of the account is tried once.
    assert.equal(failureScope(claude([]), NOW + 5 * HOUR), "model");
    assert.equal(failureScope(claude(), null), "model");
  });

  it("only installed, switched-on, signed-in providers are ready", () => {
    assert.isTrue(isReadyProvider(codex()));
    assert.isFalse(isReadyProvider(codex(undefined, { signedIn: false })));
    assert.isFalse(isReadyProvider(codex(undefined, { enabled: false })));
  });
});

describe("model ranking", () => {
  it("Claude: the default (top) model, then the current line-up; no legacy or hand-added models", () => {
    assert.deepStrictEqual(
      rankModels(claude()).map((model) => model.slug),
      ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    );
  });

  it("Codex: the default first, then the manifest's order", () => {
    assert.deepStrictEqual(
      rankModels(codex()).map((model) => model.slug),
      ["gpt-6-astra", "gpt-6.1-sol"],
    );
  });
});

describe("choosing the model for a turn", () => {
  it("keeps a usable model", () => {
    const choice = chooseModel({
      requested: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" },
      providers: [claude(), codex()],
      learned: [],
      now: NOW,
    });
    assert.deepStrictEqual(choice, { type: "keep" });
  });

  it("same company first: Fable rests, so Claude's next best model runs", () => {
    const choice = chooseModel({
      requested: FABLE,
      providers: [claude(), codex()],
      learned: [],
      now: NOW,
    });
    assert.deepStrictEqual(choice, {
      type: "switch",
      from: FABLE,
      to: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
      until: FABLE_RESET,
      crossProvider: false,
    });
  });

  it("then another company the family signed in to, when all of Claude rests", () => {
    const choice = chooseModel({
      requested: FABLE,
      providers: [claude(CLAUDE_ACCOUNT_OUT), cursor(), codex()],
      learned: [],
      now: NOW,
    });
    // Cursor reports nothing against it, but it is not signed in: never chosen.
    assert.deepStrictEqual(choice, {
      type: "switch",
      from: FABLE,
      to: { instanceId: "codex", model: "gpt-6-astra" },
      until: NOW + 2 * HOUR,
      crossProvider: true,
    });
  });

  it("never moves a child to an assistant the Family profile does not allow", () => {
    const choice = chooseModel({
      requested: FABLE,
      providers: [claude(CLAUDE_ACCOUNT_OUT), codex()],
      learned: [],
      now: NOW,
      mayRunOn: (provider) => String(provider.driver) !== "codex",
    });
    assert.deepStrictEqual(choice, { type: "wait", until: NOW + 2 * HOUR });
  });

  it("nothing usable: unchanged, and the engine waits for the reset as before", () => {
    const choice = chooseModel({
      requested: FABLE,
      providers: [
        claude(CLAUDE_ACCOUNT_OUT),
        codex([window("primary", "Session", 100, NOW + 4 * HOUR)]),
        codex(undefined, { signedIn: false }),
      ],
      learned: [],
      now: NOW,
    });
    assert.deepStrictEqual(choice, { type: "wait", until: NOW + 2 * HOUR });
  });

  it("each model is tried at most once in a turn", () => {
    const choice = chooseModel({
      requested: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
      providers: [claude([]), codex()],
      learned: [],
      now: NOW,
      tried: new Set(["claudeAgent\u0000claude-fable-5-1", "claudeAgent\u0000claude-opus-5-5"]),
    });
    assert.deepStrictEqual(choice, {
      type: "switch",
      from: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
      to: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" },
      until: null,
      crossProvider: false,
    });
  });
});
