import React from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  macs: [] as Array<unknown>,
  waiting: [] as Array<unknown>,
  answerRequest: vi.fn(async (_transport: unknown, _input: unknown) => ({ ok: true as const })),
}));

vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("../../app/grownup/GrownUpContext", () => ({
  useGrownUp: () => ({
    macs: state.macs,
    name: "Mark",
    waiting: state.waiting,
    notes: [],
    loaded: true,
  }),
}));
vi.mock("../../data/MacData", () => ({
  useCodeLength: () => 6,
  useMacData: () => ({ refresh: vi.fn() }),
}));
vi.mock("../../faceid/FaceIdProvider", () => ({
  useFaceId: () => ({ readyOn: () => false, label: "Face ID", allow: vi.fn() }),
}));
vi.mock("../../faceid/allowIntent", () => ({
  subscribeAllow: () => () => {},
  takeAllow: () => false,
}));
vi.mock("../../family/api", () => ({
  familyApi: {
    answerRequest: (transport: unknown, input: unknown) => state.answerRequest(transport, input),
  },
}));
vi.mock("../../family/noteTarget", () => ({ shownNoteTarget: () => null }));
vi.mock("../../../modules/skycot-watch", () => ({ SkycotWatch: null }));
vi.mock("../../ui/kit", async () => {
  const ReactModule = await import("react");
  const wrap = (name: string) =>
    function Mock(props: Record<string, unknown> & { children?: React.ReactNode }) {
      return ReactModule.createElement(name, props, props.children);
    };
  return {
    Avatar: wrap("Avatar"),
    Banner: wrap("Banner"),
    Button: (props: Record<string, unknown>) => ReactModule.createElement("Button", props),
    ButtonRow: wrap("ButtonRow"),
    Card: wrap("Card"),
    EmptyState: wrap("EmptyState"),
    Mascot: wrap("Mascot"),
    Page: wrap("Page"),
    ParentCodeSheet: (props: Record<string, unknown>) =>
      props.visible ? ReactModule.createElement("ParentCodeSheet", props) : null,
    Spinner: wrap("Spinner"),
    Txt: wrap("Txt"),
    haptic: vi.fn(),
  };
});

import { RequestsScreen } from "./Requests";
import type { Mac } from "../../links/store";
import type { WaitingRequest } from "../../app/grownup/GrownUpContext";

const MAC = {
  macId: "mac-1",
  macName: "MamaBear",
  transport: {} as never,
  me: { kind: "grown-up" as const, deviceId: "phone-1", personId: "mark" },
} as unknown as Mac;

const waiting: WaitingRequest = {
  mac: MAC,
  child: {
    id: "ava",
    name: "Ava",
    avatar: { kind: "emoji", value: "🐻" },
    limits: { dailyMinutes: 120, bedtime: null },
  } as never,
  request: {
    target: "runtime-request",
    threadId: "thread-1",
    requestId: "request-1",
    childId: "ava",
    threadTitle: "Birthday card",
    projectTitle: "My project",
    createdAt: 1_798_000_000_000,
    lapsed: false,
    needsGrownUp: true,
    why: null,
    what: "Install a package",
    kind: "command",
    fingerprint: "request-fingerprint",
    projectFingerprint: "project-fingerprint",
    projectCovers: ["addOns"],
  },
};

function setup() {
  state.macs = [MAC];
  state.waiting = [waiting];
  state.answerRequest.mockClear();
  return create(React.createElement(RequestsScreen));
}

function button(screen: ReturnType<typeof setup>, title: string) {
  return screen.root.findAll(
    (node) => (node.type as unknown) === "Button" && node.props.title === title,
  )[0];
}

function silenceRendererDeprecation() {
  const report = console.error;
  return vi.spyOn(console, "error").mockImplementation((...args: Array<unknown>) => {
    if (
      String(args[0]).startsWith("react-test-renderer is deprecated") ||
      String(args[0]).startsWith("The current testing environment is not configured to support act")
    )
      return;
    report(...args);
  });
}

describe("a waiting request on the grown-up Requests screen", () => {
  it("shows each choice and requires parent proof for Allow", async () => {
    using _deprecation = silenceRendererDeprecation();
    let screen!: ReturnType<typeof create>;
    await act(async () => {
      screen = setup();
    });
    expect(button(screen, "Allow once")).toBeDefined();
    expect(button(screen, "Allow for this project")).toBeDefined();
    expect(button(screen, "Not now")).toBeDefined();

    await act(async () => {
      button(screen, "Allow once")!.props.onPress();
    });
    const codeSheet = screen.root.findAll(
      (node) => (node.type as unknown) === "ParentCodeSheet",
    )[0]!;
    expect(codeSheet.props.visible).toBe(true);
    expect(codeSheet.props.actionLabel).toBe("Allow once");
    await act(async () => {
      await codeSheet.props.onCode("123456");
    });
    expect(state.answerRequest).toHaveBeenCalledWith(
      MAC.transport,
      expect.objectContaining({ decision: "accept", proof: { type: "code", code: "123456" } }),
    );
    await act(async () => screen.unmount());
  });

  it("lets Not now through without proof", async () => {
    using _deprecation = silenceRendererDeprecation();
    let screen!: ReturnType<typeof create>;
    await act(async () => {
      screen = setup();
    });
    await act(async () => {
      await button(screen, "Not now")!.props.onPress();
    });
    expect(state.answerRequest).toHaveBeenCalledWith(
      MAC.transport,
      expect.objectContaining({ decision: "decline", proof: null }),
    );
    await act(async () => screen.unmount());
  });
});
