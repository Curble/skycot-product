import { afterEach, describe, expect, it } from "vite-plus/test";

import type { CreatedDeviceKey, SignRequest } from "../../modules/skycot-device-key";
import type { ApproverProof, FamilyResult, WatchChallenge } from "../family/api";
import type { MacTransport } from "../transport/MacTransport";
import { requestAllow, resetAllow, takeAllow } from "./allowIntent";
import {
  allowReason,
  allowWithFaceId,
  biometryLabel,
  deviceKeyErrorCode,
  faceIdReadyOn,
  fallbackNote,
  setUpFaceId,
  stopUsingFaceId,
  type FaceIdApi,
  type FaceIdSigner,
} from "./faceId";

const transport = (name: string) => ({ name }) as unknown as MacTransport;
const MAC = { macId: "mac-1", macName: "MamaBear", transport: transport("mac-1") };
const MAC_2 = { macId: "mac-2", macName: "Studio", transport: transport("mac-2") };
const REQUEST = { threadId: "thread-ava", requestId: "req-1", fingerprint: "3f2a1b0c9d8e" };

const okay = <A>(value: A): FamilyResult<A> => ({ ok: true, value });
const refused = (reason: string, message: string): FamilyResult<never> =>
  ({ ok: false, reason, message }) as FamilyResult<never>;

interface Calls {
  challenges: Array<unknown>;
  answers: Array<{ readonly decision: string; readonly proof: ApproverProof | null }>;
  options: Array<string>;
  registered: Array<{
    readonly mac: string;
    readonly signature: string;
    readonly publicKey: string;
  }>;
  forgotten: Array<string>;
  signed: Array<{ readonly reason: string; readonly requests: ReadonlyArray<SignRequest> }>;
  created: Array<{ readonly reason: string; readonly requests: ReadonlyArray<SignRequest> }>;
  removed: number;
}

/** A Mac that gives a new challenge each time and answers as told; a Secure Enclave as told. */
function world(
  options: {
    readonly challenge?: (n: number) => FamilyResult<WatchChallenge>;
    readonly answer?: FamilyResult<true>;
    readonly sign?: () => Promise<ReadonlyArray<string>>;
    readonly create?: (requests: ReadonlyArray<SignRequest>) => Promise<CreatedDeviceKey>;
    readonly code?: string;
    readonly forgetFails?: string;
  } = {},
) {
  const calls: Calls = {
    challenges: [],
    answers: [],
    options: [],
    registered: [],
    forgotten: [],
    signed: [],
    created: [],
    removed: 0,
  };
  const name = (t: MacTransport) => (t as unknown as { name: string }).name;
  const api: FaceIdApi = {
    deviceKeyChallenge: async (_t, input) => {
      calls.challenges.push(input);
      const n = calls.challenges.length;
      return (
        options.challenge?.(n) ??
        okay({
          challenge: `challenge-${n}`,
          action: `approve:${input.threadId}:${input.requestId}:${input.fingerprint}`,
          purpose: "approve",
          keyId: "key-1",
        })
      );
    },
    answerRequest: async (_t, input) => {
      calls.answers.push({ decision: input.decision, proof: input.proof });
      return options.answer ?? okay(true as const);
    },
    deviceKeyOptions: async (t, code) => {
      calls.options.push(name(t));
      if (code !== (options.code ?? "482913")) {
        return refused("wrong-code", "That's not the parent code. 4 tries left.");
      }
      return okay({
        challenge: `register-${name(t)}`,
        action: `device-key-register:${name(t)}`,
        purpose: "register",
        keyId: null,
      });
    },
    deviceKeyRegister: async (t, input) => {
      calls.registered.push({
        mac: name(t),
        signature: input.signature,
        publicKey: input.publicKey,
      });
      return okay("key-1");
    },
    deviceKeyForget: async (t) => {
      calls.forgotten.push(name(t));
      return name(t) === options.forgetFails
        ? refused("unreachable", "Not answering.")
        : okay(true as const);
    },
  };
  const signer: FaceIdSigner = {
    sign: async (reason, requests) => {
      calls.signed.push({ reason, requests });
      return options.sign ? options.sign() : requests.map((r) => `signed:${r.challenge}`);
    },
    create: async (reason, requests) => {
      calls.created.push({ reason, requests });
      return options.create
        ? options.create(requests)
        : {
            publicKey: "MFkw-public",
            biometry: "face-id",
            signatures: requests.map((r) => `signed:${r.challenge}`),
          };
    },
    remove: () => {
      calls.removed += 1;
    },
  };
  return { api, signer, calls };
}

const nativeError = (code: string) => Object.assign(new Error(code), { code });

describe("Allow once with Face ID", () => {
  it("signs the Mac's fresh challenge for this one request, then says yes with it", async () => {
    const { api, signer, calls } = world();
    const outcome = await allowWithFaceId({
      api,
      signer,
      transport: MAC.transport,
      request: REQUEST,
      reason: allowReason("Ava"),
    });
    expect(outcome).toEqual({ kind: "allowed" });
    expect(calls.signed).toEqual([
      {
        reason: "Allow Ava's request",
        requests: [
          {
            purpose: "approve",
            challenge: "challenge-1",
            action: "approve:thread-ava:req-1:3f2a1b0c9d8e",
          },
        ],
      },
    ]);
    expect(calls.answers).toEqual([
      {
        decision: "accept",
        proof: {
          type: "device-key",
          keyId: "key-1",
          challenge: "challenge-1",
          signature: "signed:challenge-1",
        },
      },
    ]);
  });

  it("asks the Mac for a new challenge and Face ID for a new signature every time", async () => {
    const { api, signer, calls } = world();
    const input = { api, signer, transport: MAC.transport, request: REQUEST, reason: "Allow" };
    await allowWithFaceId(input);
    await allowWithFaceId(input);
    expect(calls.challenges).toHaveLength(2);
    expect(calls.signed).toHaveLength(2);
    const proofs = calls.answers.map((answer) => answer.proof);
    expect(proofs[0]).not.toEqual(proofs[1]);
  });

  it("falls back to the parent code when Face ID is cancelled, with nothing sent", async () => {
    for (const code of ["cancelled", "fallback"]) {
      const { api, signer, calls } = world({ sign: () => Promise.reject(nativeError(code)) });
      const outcome = await allowWithFaceId({
        api,
        signer,
        transport: MAC.transport,
        request: REQUEST,
        reason: "Allow",
      });
      expect(outcome).toEqual({ kind: "use-code", note: null });
      expect(calls.answers).toEqual([]);
    }
  });

  it("says why when Face ID fails, and forgets a key iOS voided after Face ID changed", async () => {
    const locked = world({ sign: () => Promise.reject(nativeError("locked-out")) });
    const lockedOut = await allowWithFaceId({
      ...locked,
      transport: MAC.transport,
      request: REQUEST,
      reason: "Allow",
    });
    expect(lockedOut.kind).toBe("use-code");
    expect(lockedOut.kind === "use-code" ? lockedOut.note : null).toMatch(/locked/);
    expect(locked.calls.removed).toBe(0);

    const changed = world({ sign: () => Promise.reject(nativeError("key-invalid")) });
    const voided = await allowWithFaceId({
      ...changed,
      transport: MAC.transport,
      request: REQUEST,
      reason: "Allow",
    });
    expect(voided.kind === "use-code" ? voided.note : null).toMatch(/set it up again/);
    expect(changed.calls.removed).toBe(1);
    expect(changed.calls.answers).toEqual([]);
  });

  it("uses the parent code when this Mac doesn't know the key, without asking for Face ID", async () => {
    const { api, signer, calls } = world({
      challenge: () => refused("device-key", "Face ID isn't set up on this device yet."),
    });
    const outcome = await allowWithFaceId({
      api,
      signer,
      transport: MAC.transport,
      request: REQUEST,
      reason: "Allow",
    });
    expect(outcome).toEqual({ kind: "use-code", note: null });
    expect(calls.signed).toEqual([]);
  });

  it("passes on the Mac's own words when the request itself can't be answered", async () => {
    const unreachable = world({
      challenge: () => refused("unreachable", "SKYCOT's engine isn't answering."),
    });
    expect(
      await allowWithFaceId({
        ...unreachable,
        transport: MAC.transport,
        request: REQUEST,
        reason: "Allow",
      }),
    ).toEqual({ kind: "problem", message: "SKYCOT's engine isn't answering." });

    const changed = world({
      answer: refused("changed", "That request changed. Have another look before you answer."),
    });
    expect(
      await allowWithFaceId({
        ...changed,
        transport: MAC.transport,
        request: REQUEST,
        reason: "A",
      }),
    ).toEqual({
      kind: "problem",
      message: "That request changed. Have another look before you answer.",
    });

    const notConfirmed = world({
      answer: refused("device-key", "Face ID didn't confirm that. Use the parent code instead."),
    });
    expect(
      await allowWithFaceId({
        ...notConfirmed,
        transport: MAC.transport,
        request: REQUEST,
        reason: "A",
      }),
    ).toEqual({
      kind: "use-code",
      note: "Face ID didn't confirm that. Use the parent code instead.",
    });
  });
});

describe("Setting Face ID up", () => {
  it("checks the code on every Mac, then one key and one Face ID check for all of them", async () => {
    const { api, signer, calls } = world();
    const problem = await setUpFaceId({ api, signer, macs: [MAC, MAC_2], code: "482913" });
    expect(problem).toBeNull();
    expect(calls.options).toEqual(["mac-1", "mac-2"]);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]!.reason).toBe("Use Face ID to say yes");
    expect(calls.created[0]!.requests).toEqual([
      { purpose: "register", challenge: "register-mac-1", action: "device-key-register:mac-1" },
      { purpose: "register", challenge: "register-mac-2", action: "device-key-register:mac-2" },
    ]);
    expect(calls.registered).toEqual([
      { mac: "mac-1", signature: "signed:register-mac-1", publicKey: "MFkw-public" },
      { mac: "mac-2", signature: "signed:register-mac-2", publicKey: "MFkw-public" },
    ]);
  });

  it("makes no key when the code is wrong", async () => {
    const { api, signer, calls } = world();
    const problem = await setUpFaceId({ api, signer, macs: [MAC], code: "000000" });
    expect(problem).toBe("That's not the parent code. 4 tries left.");
    expect(calls.created).toEqual([]);
    expect(calls.registered).toEqual([]);
  });

  it("registers nothing when Face ID is cancelled while setting up", async () => {
    const { api, signer, calls } = world({
      create: () => Promise.reject(nativeError("cancelled")),
    });
    const problem = await setUpFaceId({ api, signer, macs: [MAC], code: "482913" });
    expect(problem).toMatch(/wasn't set up/);
    expect(calls.registered).toEqual([]);
  });

  it("stops: the key leaves this phone first, even when a Mac is asleep", async () => {
    const { api, signer, calls } = world({ forgetFails: "mac-2" });
    const problem = await stopUsingFaceId({ api, signer, macs: [MAC, MAC_2] });
    expect(calls.removed).toBe(1);
    expect(calls.forgotten).toEqual(["mac-1", "mac-2"]);
    expect(problem).toMatch(/Studio didn't answer/);
    const quiet = world();
    expect(await stopUsingFaceId({ ...quiet, macs: [MAC] })).toBeNull();
  });
});

describe("Face ID's words and when it is used", () => {
  it("is used only with a key here, Face ID on, and the Mac keeping the key", () => {
    const native = { available: true, hasKey: true };
    expect(faceIdReadyOn({ native, macKnowsKey: true })).toBe(true);
    expect(faceIdReadyOn({ native, macKnowsKey: false })).toBe(false);
    expect(faceIdReadyOn({ native: { ...native, hasKey: false }, macKnowsKey: true })).toBe(false);
    expect(faceIdReadyOn({ native: { ...native, available: false }, macKnowsKey: true })).toBe(
      false,
    );
    expect(faceIdReadyOn({ native: null, macKnowsKey: true })).toBe(false);
  });

  it("names the child in Face ID's sheet, and Touch ID on an iPad", () => {
    expect(allowReason("Ava")).toBe("Allow Ava's request");
    expect(allowReason(null)).toBe("Allow this request");
    expect(biometryLabel("touch-id")).toBe("Touch ID");
    expect(biometryLabel("face-id")).toBe("Face ID");
    expect(biometryLabel(null)).toBe("Face ID");
    expect(deviceKeyErrorCode(nativeError("cancelled"))).toBe("cancelled");
    expect(deviceKeyErrorCode(new Error("odd"))).toBe("failed");
    expect(fallbackNote("cancelled")).toBeNull();
    expect(fallbackNote("no-key", "Touch ID")).toMatch(/^Touch ID isn't set up/);
  });
});

describe("Allow once on a notification", () => {
  afterEach(() => resetAllow());

  it("starts Face ID on that card, once", () => {
    requestAllow("mac-1:req-1", 1_000);
    expect(takeAllow("mac-1:req-2", ["mac-1:req-1", "mac-1:req-2"], 1_100)).toBe(false);
    expect(takeAllow("mac-1:req-1", ["mac-1:req-1", "mac-1:req-2"], 1_200)).toBe(true);
    expect(takeAllow("mac-1:req-1", ["mac-1:req-1"], 1_300)).toBe(false);
  });

  it("from the relay's push, only when exactly one request waits", () => {
    requestAllow("", 1_000);
    expect(takeAllow("mac-1:req-1", ["mac-1:req-1", "mac-2:req-9"], 1_100)).toBe(false);
    expect(takeAllow("mac-1:req-1", ["mac-1:req-1"], 1_200)).toBe(true);
  });

  it("not a minute later", () => {
    requestAllow("mac-1:req-1", 1_000);
    expect(takeAllow("mac-1:req-1", ["mac-1:req-1"], 62_000)).toBe(false);
  });
});
