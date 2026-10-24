import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_PROFILE,
  EMPTY_SETUP_DRAFT,
  EMPTY_VIEW,
  LOCKOUT_MS,
  MAX_ATTEMPTS,
  asksEachStep,
  attemptsLeft,
  codeComplete,
  codeStrength,
  currentChildOf,
  createProfile,
  digitsOnly,
  hashCode,
  grownUpSettingsOpen,
  familyGrantOpen,
  grownUpMinutesLeft,
  isFamilyLocked,
  LOCKED_ACTIONS,
  isValidCode,
  lockoutSentence,
  parseCachedView,
  parseCodeLength,
  parseProfile,
  parseServerStatus,
  purposeFor,
  openGrantsSentence,
  readFamilyAnswer,
  serializeCachedView,
  viewFromStatus,
  viewLockRemainingMs,
  serializeProfile,
  setupProblem,
  setupReady,
  strengthHint,
  verifyCode,
  withChildName,
  withNewCode,
  wrongCodeSentence,
} from "./family";

const T0 = 1_700_000_000_000;

describe("codes", () => {
  it("accepts 4 to 6 digits only", () => {
    expect(isValidCode("1234")).toBe(true);
    expect(isValidCode("123456")).toBe(true);
    expect(isValidCode("123")).toBe(false);
    expect(isValidCode("1234567")).toBe(false);
    expect(isValidCode("12a4")).toBe(false);
    expect(isValidCode("")).toBe(false);
  });

  it("digitsOnly strips everything else and caps at six", () => {
    expect(digitsOnly("12-34 ab 5678")).toBe("123456");
    expect(digitsOnly("")).toBe("");
  });

  it("rates repeated and counting codes weak, six mixed digits strong", () => {
    expect(codeStrength("1111")).toBe("weak");
    expect(codeStrength("1234")).toBe("weak");
    expect(codeStrength("654321")).toBe("weak");
    expect(codeStrength("2580")).toBe("ok");
    expect(codeStrength("271828")).toBe("strong");
    expect(codeStrength("112233")).toBe("ok");
    expect(codeStrength("12")).toBeNull();
  });

  it("hints count missing digits and never block a weak code", () => {
    expect(strengthHint(null, 0)).toBe("4 to 6 digits.");
    expect(strengthHint(null, 3)).toBe("1 more digit needed.");
    expect(strengthHint("weak", 4)).toMatch(/still work/);
  });
});

describe("hashing", () => {
  it("is deterministic for salt+code and differs across salts and codes", async () => {
    const a = await hashCode("1234", "salt-a");
    expect(a).toBe(await hashCode("1234", "salt-a"));
    expect(a).not.toBe(await hashCode("1234", "salt-b"));
    expect(a).not.toBe(await hashCode("1235", "salt-a"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("createProfile never stores the code itself", async () => {
    const profile = await createProfile({ childName: " Ava ", code: "2580", now: T0 });
    const raw = serializeProfile(profile);
    expect(raw).not.toContain("2580");
    expect(profile.enabled).toBe(true);
    expect(profile.childName).toBe("Ava");
    expect(profile.createdAt).toBe(new Date(T0).toISOString());
    expect(parseProfile(raw)).toEqual(profile);
  });

  it("refuses to create a profile with a bad code", async () => {
    await expect(createProfile({ childName: null, code: "12", now: T0 })).rejects.toThrow();
  });
});

describe("parseProfile", () => {
  it("falls back to the empty profile on missing or corrupt storage", () => {
    expect(parseProfile(null)).toEqual(EMPTY_PROFILE);
    expect(parseProfile("{not json")).toEqual(EMPTY_PROFILE);
    expect(parseProfile("42")).toEqual(EMPTY_PROFILE);
  });

  it("treats enabled-without-a-code as off", () => {
    const parsed = parseProfile(JSON.stringify({ enabled: true, childName: "Ava" }));
    expect(parsed.enabled).toBe(false);
    expect(parsed.childName).toBe("Ava");
  });
});

describe("verifyCode", () => {
  it("accepts the right code and clears the counters", async () => {
    const profile = {
      ...(await createProfile({ childName: null, code: "2580", now: T0 })),
      failedAttempts: 2,
    };
    const outcome = await verifyCode(profile, "2580", T0 + 1000);
    expect(outcome.ok).toBe(true);
    expect(outcome.profile.failedAttempts).toBe(0);
    expect(outcome.profile.lockedUntil).toBeNull();
  });

  it("counts wrong tries and locks for five minutes on the fifth", async () => {
    let profile = await createProfile({ childName: null, code: "2580", now: T0 });
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      const outcome = await verifyCode(profile, "0000", T0 + attempt);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("wrong");
      if (outcome.kind === "wrong") expect(outcome.attemptsLeft).toBe(MAX_ATTEMPTS - attempt);
      profile = outcome.profile;
    }
    const fifth = await verifyCode(profile, "0000", T0 + 10);
    expect(fifth.ok).toBe(false);
    if (fifth.ok) throw new Error("unreachable");
    expect(fifth.kind).toBe("locked");
    expect(fifth.profile.lockedUntil).toBe(T0 + 10 + LOCKOUT_MS);
    expect(attemptsLeft(fifth.profile)).toBe(0);

    // While locked, even the right code is refused and nothing is compared.
    const during = await verifyCode(fifth.profile, "2580", T0 + 10 + LOCKOUT_MS - 1);
    expect(during.ok).toBe(false);
    if (during.ok) throw new Error("unreachable");
    expect(during.kind).toBe("locked");
    if (during.kind === "locked") expect(during.remainingMs).toBe(1);

    // Once the wait is over, the count starts again from zero.
    const after = await verifyCode(fifth.profile, "0000", T0 + 10 + LOCKOUT_MS);
    expect(after.ok).toBe(false);
    if (after.ok) throw new Error("unreachable");
    expect(after.kind).toBe("wrong");
    expect(after.profile.failedAttempts).toBe(1);
    expect(after.profile.lockedUntil).toBeNull();

    const good = await verifyCode(fifth.profile, "2580", T0 + 10 + LOCKOUT_MS);
    expect(good.ok).toBe(true);
  });

  it("passes when no code was ever set", async () => {
    const outcome = await verifyCode(EMPTY_PROFILE, "anything", T0);
    expect(outcome.ok).toBe(true);
  });

  it("withNewCode keeps the child but resets counters and salt", async () => {
    const before = await createProfile({ childName: "Ava", code: "2580", now: T0 });
    const after = await withNewCode({ ...before, failedAttempts: 3 }, "907142");
    expect(after.childName).toBe("Ava");
    expect(after.salt).not.toBe(before.salt);
    expect(after.failedAttempts).toBe(0);
    expect((await verifyCode(after, "2580", T0)).ok).toBe(false);
    expect((await verifyCode(after, "907142", T0)).ok).toBe(true);
    expect(withChildName(after, "  ").childName).toBeNull();
    expect(withChildName(after, " Max ").childName).toBe("Max");
  });
});

describe("isFamilyLocked", () => {
  it("locks every action except picking a look, while the engine says on or a browser profile waits to move", () => {
    const on = { ...EMPTY_VIEW, enabled: true };
    const waiting = { ...EMPTY_VIEW, legacy: true };
    for (const action of [
      "publish",
      "advancedMode",
      "disableFamily",
      "changeCode",
      "createAutomation",
      "changeAutonomy",
      "rerunOnboarding",
      "openFolder",
      "approve",
      "aiSettings",
    ] as const) {
      expect(isFamilyLocked(on, action)).toBe(true);
      expect(isFamilyLocked(waiting, action)).toBe(true);
      expect(isFamilyLocked(EMPTY_VIEW, action)).toBe(false);
    }
    expect(isFamilyLocked(on, "changeTheme")).toBe(false);
  });

  it("names the engine grant each action asks for", () => {
    expect(purposeFor("publish")).toBe("publish");
    expect(purposeFor("createAutomation")).toBe("automation");
    expect(purposeFor("advancedMode")).toBe("advanced");
    expect(purposeFor("openFolder")).toBe("openFolder");
    expect(purposeFor("approve")).toBe("approve");
    expect(purposeFor("aiSettings")).toBe("settings");
    // Deleting a conversation: a yes for that one conversation, never Advanced mode's grant
    // (which would also lift plan first and the limits while it lasts).
    expect(purposeFor("deleteConversation")).toBe("approve");
    expect(LOCKED_ACTIONS.has("deleteConversation")).toBe(true);
    // The code goes with the request itself for these.
    expect(purposeFor("disableFamily")).toBeNull();
    expect(purposeFor("changeCode")).toBeNull();
  });
});

describe("the engine's answers", () => {
  it("reads the status and never invents an on", () => {
    expect(parseServerStatus(null)).toBeNull();
    expect(parseServerStatus({ childName: "Ava" })).toBeNull();
    expect(
      parseServerStatus({
        enabled: true,
        childName: "Ava",
        createdAt: "2026-10-22T09:00:00.000Z",
        attemptsLeft: 3,
        lockedForMs: 0,
      }),
    ).toEqual({
      enabled: true,
      childName: "Ava",
      createdAt: "2026-10-22T09:00:00.000Z",
      attemptsLeft: 3,
      lockedForMs: 0,
      children: [],
      timeZone: null,
      allowedAssistants: [],
      grownUps: [],
      devices: [],
    });
  });

  it("knows a linked device only from the engine's own answer", () => {
    const base = {
      enabled: true,
      childName: null,
      createdAt: null,
      attemptsLeft: 5,
      lockedForMs: 0,
    };
    expect(parseServerStatus(base)?.me).toBeUndefined();
    expect(
      parseServerStatus({
        ...base,
        me: { kind: "child", deviceId: "d1", deviceName: "Ava's iPad", childId: "c1" },
      })?.me,
    ).toEqual({ kind: "child", deviceId: "d1", deviceName: "Ava's iPad", childId: "c1" });
    expect(parseServerStatus({ ...base, me: { kind: "grown-up" } })?.me).toEqual({
      kind: "shared",
    });
    // A linked device is never asked "Who's using SKYCOT?", whatever else it knows.
    const children = [{ id: "a" }, { id: "b" }] as never;
    expect(
      currentChildOf(children, { childId: null, needsChoice: false, device: "grown-up" }, null)
        .needsChoice,
    ).toBe(false);
    expect(
      currentChildOf(children, { childId: null, needsChoice: true, device: "shared" }, null)
        .needsChoice,
    ).toBe(true);
  });

  it("learns the code's length (never the code) and keeps it across answers that leave it out", () => {
    const base = {
      enabled: true,
      childName: null,
      createdAt: null,
      attemptsLeft: 5,
      lockedForMs: 0,
    };
    // An older engine, or a child's device: no length, so the box waits for its button.
    expect(parseServerStatus(base)).not.toHaveProperty("codeLength");
    expect(parseServerStatus({ ...base, codeLength: 6 })?.codeLength).toBe(6);
    expect(parseServerStatus({ ...base, codeLength: null })?.codeLength).toBeNull();
    for (const odd of [3, 7, 4.5, "6", Number.NaN]) expect(parseCodeLength(odd)).toBeNull();

    const known = viewFromStatus(parseServerStatus({ ...base, codeLength: 4 })!, T0, false);
    expect(known.codeLength).toBe(4);
    // A change's answer carries no length: keep what the status read said.
    expect(viewFromStatus(parseServerStatus(base)!, T0, false, known).codeLength).toBe(4);
    // A new code's answer says its own length.
    expect(
      viewFromStatus(parseServerStatus({ ...base, codeLength: 6 })!, T0, false, known).codeLength,
    ).toBe(6);
    // Off: nothing to know.
    expect(
      viewFromStatus(parseServerStatus({ ...base, enabled: false })!, T0, false, known).codeLength,
    ).toBeNull();
    // Never in the first-paint cache: a stale length must not send a code too soon.
    expect(serializeCachedView(known)).not.toContain("codeLength");
    expect(parseCachedView(serializeCachedView(known), false).codeLength).toBeNull();
  });

  it("takes the code on its last digit only when the length is known", () => {
    expect(codeComplete("1234", 4)).toBe(true);
    expect(codeComplete("123", 4)).toBe(false);
    expect(codeComplete("12345", 4)).toBe(false);
    expect(codeComplete("123456", null)).toBe(false);
    expect(codeComplete("123456", undefined)).toBe(false);
    expect(codeComplete("12a4", 4)).toBe(false);
  });

  it("turns a lock into a local deadline and retires a moved browser profile", () => {
    const view = viewFromStatus(
      {
        enabled: true,
        childName: null,
        createdAt: null,
        attemptsLeft: 0,
        lockedForMs: 60_000,
        children: [],
        timeZone: null,
      },
      T0,
      true,
    );
    expect(view.lockedUntil).toBe(T0 + 60_000);
    expect(view.legacy).toBe(false);
    expect(view.source).toBe("engine");
    expect(viewLockRemainingMs(view, T0 + 59_000)).toBe(1_000);
    const off = viewFromStatus(
      {
        enabled: false,
        childName: null,
        createdAt: null,
        attemptsLeft: 5,
        lockedForMs: 0,
        children: [],
        timeZone: null,
      },
      T0,
      true,
    );
    expect(off.legacy).toBe(true);
  });

  it("caches only what first paint needs", () => {
    const view = { ...EMPTY_VIEW, enabled: true, childName: "Ava", attemptsLeft: 2 };
    const raw = serializeCachedView(view);
    expect(raw).not.toContain("attemptsLeft");
    const cached = parseCachedView(raw, false);
    expect(cached.enabled).toBe(true);
    expect(cached.childName).toBe("Ava");
    expect(cached.source).toBe("cache");
    expect(parseCachedView("{oops", false)).toEqual(EMPTY_VIEW);
  });

  it("passes the engine's own sentence through, and the counters with it", () => {
    expect(readFamilyAnswer(200, { enabled: false }, parseServerStatus)).toMatchObject({
      ok: true,
    });
    expect(
      readFamilyAnswer(
        403,
        {
          error: "wrong-code",
          message: "That's not the parent code. 2 tries left.",
          attemptsLeft: 2,
        },
        parseServerStatus,
      ),
    ).toEqual({
      ok: false,
      reason: "wrong-code",
      message: "That's not the parent code. 2 tries left.",
      attemptsLeft: 2,
    });
    expect(
      readFamilyAnswer(429, { error: "locked", remainingMs: 1_000 }, parseServerStatus),
    ).toMatchObject({
      ok: false,
      reason: "locked",
      remainingMs: 1_000,
    });
    expect(readFamilyAnswer(200, "nonsense", parseServerStatus)).toMatchObject({ ok: false });
    // QA FK-14: the engine answers a wrong code with 200 so the console stays quiet.
    expect(
      readFamilyAnswer(
        200,
        { error: "wrong-code", message: "That's not the parent code.", attemptsLeft: 3 },
        parseServerStatus,
      ),
    ).toMatchObject({ ok: false, reason: "wrong-code", attemptsLeft: 3 });
  });
});

describe("sentences", () => {
  it("round minutes up and name the single try", () => {
    expect(lockoutSentence(LOCKOUT_MS)).toBe("Too many tries. Try again in 5 minutes.");
    expect(lockoutSentence(61_000)).toBe("Too many tries. Try again in 2 minutes.");
    expect(lockoutSentence(1_000)).toBe("Too many tries. Try again in a minute.");
    expect(wrongCodeSentence(3)).toBe("That's not the parent code. 3 tries left.");
    expect(wrongCodeSentence(1)).toMatch(/One more try/);
  });
});

describe("setup draft", () => {
  it("is ready only when both codes are valid and match", () => {
    expect(setupReady(EMPTY_SETUP_DRAFT)).toBe(false);
    expect(setupProblem({ childName: "", code: "12", confirm: "" })).toMatch(/4 to 6 digits/);
    expect(setupProblem({ childName: "", code: "2580", confirm: "" })).toBe(
      "Type the code a second time.",
    );
    expect(setupProblem({ childName: "", code: "2580", confirm: "2581" })).toBe(
      "The two codes don't match yet.",
    );
    expect(setupReady({ childName: "Ava", code: "2580", confirm: "2580" })).toBe(true);
  });
});

// QA FK-16: Settings → Family looked the same with Advanced mode open as locked.
describe("open grants", () => {
  const now = 1_000_000;
  it("reads this device's open grants from the engine's status", () => {
    const status = parseServerStatus({
      enabled: true,
      childName: "Ava",
      createdAt: null,
      attemptsLeft: 5,
      lockedForMs: 0,
      grants: [
        { purpose: "advanced", remainingMs: 14 * 60_000 },
        { purpose: "nonsense", remainingMs: 1 },
        { purpose: "publish", remainingMs: -5 },
      ],
    });
    expect(status?.grants).toEqual([{ purpose: "advanced", remainingMs: 14 * 60_000 }]);
    const view = viewFromStatus(status!, now, false);
    expect(view.openUntil).toEqual({ advanced: now + 14 * 60_000 });
    // An answer without grants keeps what the last status said.
    const { grants: _grants, ...rest } = status!;
    expect(viewFromStatus(rest, now, false, view).openUntil).toEqual(view.openUntil);
  });

  it("says what is open and for how long, or nothing", () => {
    expect(openGrantsSentence({ openUntil: {} }, now)).toBeNull();
    expect(openGrantsSentence({ openUntil: { advanced: now + 14 * 60_000 - 1 } }, now)).toBe(
      "Open on this device: Advanced mode for 14 more minutes.",
    );
    expect(
      openGrantsSentence(
        { openUntil: { publish: now + 60_000, settings: now + 9 * 60_000, advanced: now - 1 } },
        now,
      ),
    ).toBe(
      "Open on this device: Family and AI settings for 9 more minutes and publishing for 1 more minute.",
    );
  });
});

describe("several children", () => {
  const child = (id: string, name: string | null) => ({
    id,
    name,
    avatar: { kind: "initial", color: "sky" },
    look: "workshop",
    largerText: true,
    voice: { typing: false, readAloud: true },
    limits: { bedtime: null, dailyMinutes: null, dailyTurns: null, keepAllowancePercent: null },
  });
  const status = (session?: unknown) =>
    parseServerStatus({
      enabled: true,
      childName: "Ava",
      createdAt: "2026-10-22T09:00:00.000Z",
      attemptsLeft: 5,
      lockedForMs: 0,
      children: [child("a", "Ava"), child("l", "Leo"), { id: 3 }],
      timeZone: "Australia/Melbourne",
      ...(session === undefined ? {} : { session }),
    })!;

  it("reads the children, dropping one it cannot read", () => {
    const read = status();
    expect(read.children.map((entry) => entry.id)).toEqual(["a", "l"]);
    expect(read.children[1]!.voice).toEqual({ typing: false, readAloud: true });
    expect(read.timeZone).toBe("Australia/Melbourne");
  });

  it("greets the child using this device, and asks who it is when nobody is chosen", () => {
    const chosen = viewFromStatus(
      status({ childId: "l", needsChoice: false, limits: null, sentence: null }),
      T0,
      false,
    );
    expect(chosen.currentChildId).toBe("l");
    expect(chosen.childName).toBe("Leo");
    expect(chosen.needsChoice).toBe(false);
    const unknown = viewFromStatus(
      status({ childId: null, needsChoice: true, limits: null, sentence: null }),
      T0,
      false,
    );
    expect(unknown.currentChildId).toBeNull();
    expect(unknown.needsChoice).toBe(true);
    expect(unknown.childName).toBeNull();
  });

  it("keeps the last choice when an answer carries no session", () => {
    const view = viewFromStatus(status(), T0, false, { openUntil: {}, currentChildId: "a" });
    expect(view.currentChildId).toBe("a");
    expect(
      viewFromStatus(status(), T0, false, { openUntil: {}, currentChildId: "gone" }).needsChoice,
    ).toBe(true);
  });

  it("caches the children for first paint", () => {
    const view = viewFromStatus(
      status({ childId: "a", needsChoice: false, limits: null, sentence: null }),
      T0,
      false,
    );
    const cached = parseCachedView(serializeCachedView(view), false);
    expect(cached.children.map((entry) => entry.name)).toEqual(["Ava", "Leo"]);
    expect(cached.currentChildId).toBe("a");
  });

  it("guards managing children with the settings grant", () => {
    expect(purposeFor("manageChildren")).toBe("settings");
    expect(purposeFor("switchChild")).toBe("settings");
  });
});

describe("Ask before each step", () => {
  const child = (id: string, askEachStep: boolean) =>
    ({
      id,
      name: id,
      avatar: { kind: "initial", color: "sky" },
      look: "workshop",
      largerText: true,
      voice: { typing: false, readAloud: true },
      limits: { bedtime: null, dailyMinutes: null, dailyTurns: null, keepAllowancePercent: null },
      askEachStep,
    }) as const;
  it("follows the child using SKYCOT here, and is off while the profile is off", () => {
    const children = [child("ava", false), child("leo", true)];
    expect(asksEachStep({ enabled: true, children, currentChildId: "leo" })).toBe(true);
    expect(asksEachStep({ enabled: true, children, currentChildId: "ava" })).toBe(false);
    expect(asksEachStep({ enabled: true, children, currentChildId: null })).toBe(false);
    expect(asksEachStep({ enabled: false, children, currentChildId: "leo" })).toBe(false);
  });
});

describe("grownUpSettingsOpen", () => {
  it("is open only while a settings or Advanced grant has time left", () => {
    expect(grownUpSettingsOpen({ openUntil: {} }, 1_000)).toBe(false);
    expect(grownUpSettingsOpen({ openUntil: { settings: 2_000 } }, 1_000)).toBe(true);
    expect(grownUpSettingsOpen({ openUntil: { advanced: 2_000 } }, 1_000)).toBe(true);
    expect(grownUpSettingsOpen({ openUntil: { settings: 500 } }, 1_000)).toBe(false);
    expect(grownUpSettingsOpen({ openUntil: { publish: 2_000 } }, 1_000)).toBe(false);
  });
});

describe("grown-up grants", () => {
  it("lets a settings grant cover later settings actions until it ends", () => {
    const view = { openUntil: { settings: 10_000 } };
    expect(familyGrantOpen(view, "aiSettings", 9_999)).toBe(true);
    expect(familyGrantOpen(view, "manageChildren", 10_000)).toBe(false);
    expect(familyGrantOpen({ openUntil: { advanced: 10_000 } }, "publish", 9_999)).toBe(true);
    expect(familyGrantOpen({ openUntil: { recap: 10_000 } }, "seeRecap", 10_000)).toBe(false);
    expect(familyGrantOpen({ openUntil: { settings: 10_000 } }, "seeRecap", 9_999)).toBe(true);
    expect(familyGrantOpen(view, "approve", 1)).toBe(false);
  });

  it("shows whole minutes remaining in grown-up mode", () => {
    expect(grownUpMinutesLeft({ openUntil: { settings: 7 * 60_000 + 1 } }, 0)).toBe(8);
    expect(grownUpMinutesLeft({ openUntil: { settings: 5 } }, 5)).toBe(0);
  });
});
