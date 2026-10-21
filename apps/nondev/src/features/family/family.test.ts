import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_PROFILE,
  EMPTY_SETUP_DRAFT,
  LOCKOUT_MS,
  MAX_ATTEMPTS,
  attemptsLeft,
  codeStrength,
  createProfile,
  digitsOnly,
  hashCode,
  isFamilyLocked,
  isValidCode,
  lockoutSentence,
  parseProfile,
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
  it("locks every action except picking a look, and only while the profile is on", async () => {
    const on = await createProfile({ childName: null, code: "2580", now: T0 });
    const off = { ...on, enabled: false };
    for (const action of [
      "publish",
      "advancedMode",
      "disableFamily",
      "changeCode",
      "createAutomation",
      "changeAutonomy",
      "rerunOnboarding",
    ] as const) {
      expect(isFamilyLocked(on, action)).toBe(true);
      expect(isFamilyLocked(off, action)).toBe(false);
      expect(isFamilyLocked(EMPTY_PROFILE, action)).toBe(false);
    }
    expect(isFamilyLocked(on, "changeTheme")).toBe(false);
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
