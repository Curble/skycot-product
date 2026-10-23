#!/usr/bin/env node
// The whole of SKYCOT Relay on one Mac, with nothing on the internet: a local relay (wrangler dev),
// a local engine with its own fresh data folder, and a headless Chrome playing three devices:
//   - the family's Mac, which turns the Family profile and the relay on and links two devices;
//   - "Mum's phone", a grown-up's device that answers a request through the relay;
//   - "Ava's iPad", a child's device that must see only Ava's own work.
// Then it reads the relay's own frame log (RELAY_DEBUG_FRAMES=1) and checks it never held a
// readable byte of what the devices and the Mac said.
//
// Run by e2e/run-family-e2e.ts, which starts and stops the relay and the engine. Environment:
//   E2E_PAIRING_URL  the engine's startup pairing link (the Mac's own sign-in)
//   E2E_RELAY_LOG    the relay's log file
//   E2E_OUT          a folder for screenshots and the report
//   E2E_CHROME       Chrome's executable; E2E_PLAYWRIGHT the playwright-core folder

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const PAIRING_URL = env("E2E_PAIRING_URL");
const RELAY_LOG = env("E2E_RELAY_LOG");
const OUT = env("E2E_OUT");
const CHROME =
  process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PLAYWRIGHT = env("E2E_PLAYWRIGHT");
const CODE = "482913";

import { newHomeRecord, RelayHome } from "@t3tools/skycot-relay/client/home";
import { parseRelayLink } from "@t3tools/skycot-relay/link";

const APNS_LOG = process.env.E2E_APNS_LOG ?? "";
const { chromium } = (await import(
  NodePath.join(PLAYWRIGHT, "index.mjs")
)) as typeof import("playwright-core");
type Page = import("playwright-core").Page;

NodeFS.mkdirSync(OUT, { recursive: true });
const report: Array<string> = [];
const note = (line: string) => {
  report.push(line);
  console.log(line);
};
const check = (ok: boolean, what: string) => {
  note(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) process.exitCode = 1;
};

/** A request from inside a page, with that page's credentials (and, on a device, its tunnel). */
async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ([m, p, b]) => {
      const response = await fetch(p as string, {
        method: m as string,
        credentials: "include",
        headers: {
          // The engine's orchestration reads name the protocol they speak (contracts/environment.ts).
          "x-t3-orchestration-protocol": "2",
          ...(b === undefined
            ? { accept: "application/json" }
            : { "content-type": "application/json" }),
        },
        ...(b === undefined ? {} : { body: JSON.stringify(b) }),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: response.status, body: json as Record<string, unknown> };
    },
    [method, path, body] as const,
  );
}

async function until<T>(
  what: string,
  probe: () => Promise<T | null | undefined | false>,
  tries = 60,
): Promise<T> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  // The family's Mac.
  const mac = await browser.newContext({ viewport: { width: 1440, height: 848 } });
  const macPage = await mac.newPage();
  await macPage.goto(PAIRING_URL);
  await until(
    "the Mac to sign in",
    async () => (await api(macPage, "GET", "/api/auth/session")).body?.["authenticated"] === true,
  );

  const enabled = await api(macPage, "POST", "/api/skycot/family/enable", {
    code: CODE,
    childName: "Ava",
    timeZone: "Australia/Melbourne",
  });
  check(enabled.status === 200, "the Mac turns the Family profile on (Ava)");
  await api(macPage, "POST", "/api/skycot/family/verify", { code: CODE, purpose: "settings" });
  await api(macPage, "POST", "/api/skycot/family/children/add", { child: { name: "Leo" } });
  const status = (await api(macPage, "GET", "/api/skycot/family")).body;
  const children = status["children"] as Array<{ id: string; name: string }>;
  const grownUps = status["grownUps"] as Array<{ id: string; name: string | null }>;
  const ava = children.find((child) => child.name === "Ava")!;
  const leo = children.find((child) => child.name === "Leo")!;
  const mum = grownUps[0]!;
  await api(macPage, "POST", "/api/skycot/family/people/update", {
    personId: mum.id,
    patch: { name: "Mum" },
  });
  check(Boolean(ava && leo && mum), "Ava, Leo and Mum are in the profile");

  const relayOff = await api(macPage, "GET", "/api/skycot/family/relay");
  check(
    relayOff.body["state"] === "off",
    `the relay starts off (${String(relayOff.body["state"])})`,
  );

  // The Mac first asks who is using it; the grown-up's code is already open, so settings are there.
  await macPage.reload();
  const pickAva = macPage.getByRole("button", { name: /Ava/ }).first();
  await pickAva.waitFor({ timeout: 20_000 });
  await pickAva.click();
  await macPage.waitForTimeout(1000);
  const settingsUrl = new URL("/simple/#/settings/family", PAIRING_URL).toString();
  const relayRow = () => macPage.getByText("Reach this Mac from anywhere").first();
  const showRelayRow = async () => {
    await macPage.goto(settingsUrl);
    await relayRow().waitFor({ timeout: 20_000 });
    await relayRow().scrollIntoViewIfNeeded();
    await macPage.waitForTimeout(600);
  };
  await showRelayRow();
  await macPage.screenshot({ path: NodePath.join(OUT, "mac-relay-off-1440x848.png") });

  // Turning it on from the settings row: the switch, then the confirmation sheet.
  await macPage.getByRole("switch", { name: "Reach this Mac from anywhere" }).click();
  const turnOn = macPage.getByRole("button", { name: "Turn on" });
  await turnOn.waitFor({ timeout: 10_000 });
  await macPage.waitForTimeout(400);
  await macPage.screenshot({ path: NodePath.join(OUT, "mac-relay-turn-on-sheet-1440x848.png") });
  await turnOn.click();
  // Changing a Family setting asks for the parent code on this Mac.
  const codeField = macPage.getByPlaceholder("••••").first();
  if (await codeField.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await codeField.fill(CODE);
    await macPage.getByRole("button", { name: "Continue" }).first().click();
  }
  await until(
    "the relay to connect",
    async () =>
      (await api(macPage, "GET", "/api/skycot/family/relay")).body["state"] === "connected",
  );
  check(
    true,
    "the Mac turns SKYCOT Relay on from Settings › Family, and its engine connects to the relay",
  );

  // Link two devices; the first link of each is the relay one.
  const link = async (kind: "child" | "grown-up", personId: string, name: string) => {
    const answer = await api(macPage, "POST", "/api/skycot/family/devices/link", {
      kind,
      personId,
      name,
    });
    const links = answer.body["links"] as Array<{ label: string; url: string; reachable: boolean }>;
    check(
      links[0]?.label === "Anywhere (SKYCOT Relay)" && links[0].reachable,
      `${name}'s link goes through the relay`,
    );
    return links[0]!.url;
  };
  const mumUrl = await link("grown-up", mum.id, "Mum's phone");
  const avaUrl = await link("child", ava.id, "Ava's iPad");

  const openDevice = async (
    url: string,
    viewport: { width: number; height: number },
    userAgent: string,
  ) => {
    const context = await browser.newContext({
      viewport,
      userAgent,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(url);
    await until("the device to sign in through the relay", async () => {
      const session = await api(page, "GET", "/api/auth/session").catch(() => null);
      return session?.body?.["authenticated"] === true;
    });
    return page;
  };
  const mumPage = await openDevice(
    mumUrl,
    { width: 390, height: 844 },
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
  );
  const avaPage = await openDevice(
    avaUrl,
    { width: 820, height: 1180 },
    "Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
  );
  const mumMe = (await api(mumPage, "GET", "/api/skycot/family")).body["me"] as Record<
    string,
    unknown
  >;
  const avaMe = (await api(avaPage, "GET", "/api/skycot/family")).body["me"] as Record<
    string,
    unknown
  >;
  check(
    mumMe["kind"] === "grown-up" && mumMe["deviceName"] === "Mum's phone",
    `through the relay the Mac sees Mum's phone as a grown-up's device (${JSON.stringify(mumMe)})`,
  );
  check(
    avaMe["kind"] === "child" && avaMe["childId"] === ava.id,
    `through the relay the Mac sees Ava's iPad as Ava's (${JSON.stringify(avaMe)})`,
  );
  check(
    new URL(mumPage.url()).origin !== new URL(PAIRING_URL).origin,
    "the devices' page did not come from the Mac",
  );

  // The Mac's relay settings with both devices connected, wide and phone-sized.
  await showRelayRow();
  await macPage
    .getByText(/2 devices are connected/)
    .first()
    .waitFor({ timeout: 20_000 });
  // The devices list refreshes on its own every 15 seconds.
  await macPage.getByText("Mum's phone").first().waitFor({ timeout: 20_000 });
  await relayRow().scrollIntoViewIfNeeded();
  await macPage.waitForTimeout(400);
  await macPage.screenshot({ path: NodePath.join(OUT, "mac-relay-settings-1440x848.png") });
  await macPage.setViewportSize({ width: 390, height: 844 });
  await relayRow().scrollIntoViewIfNeeded();
  await macPage.waitForTimeout(600);
  await macPage.screenshot({ path: NodePath.join(OUT, "mac-relay-settings-390x844.png") });
  await macPage.setViewportSize({ width: 1440, height: 848 });
  check(true, "the Mac's settings say 2 devices are connected through the relay");

  // Dad's phone is linked the way the iOS app (Phase 3) will be: the same QR link, read by the
  // protocol package itself instead of a browser. It signs in through the relay and registers
  // for notifications; the token it hands over is a made-up one.
  await api(macPage, "POST", "/api/skycot/family/verify", { code: CODE, purpose: "settings" });
  const dadAdded = await api(macPage, "POST", "/api/skycot/family/people/add", {
    person: { name: "Dad" },
  });
  const dadUrl = await link("grown-up", String(dadAdded.body["personId"]), "Dad's phone");
  const dadLink = parseRelayLink(new URL(dadUrl).hash)!;
  const timers = {
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const dad = new RelayHome({
    record: newHomeRecord(dadLink, "Home"),
    save: () => undefined,
    timers,
  });
  const dadSignIn = await dad.fetch("https://home.invalid/api/auth/browser-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential: dadLink.token }),
  });
  const dadMe = (
    (await (await dad.fetch("https://home.invalid/api/skycot/family")).json()) as {
      me: { kind: string };
    }
  ).me;
  check(
    dadSignIn.status === 200 && dadMe.kind === "grown-up",
    "Dad's phone (the app's way, no browser) signs in through the relay as a grown-up",
  );
  const pushToken = "ab".repeat(32);
  const registered = await dad.registerPush({
    token: pushToken,
    type: "alert",
    environment: "development",
  });
  check(
    registered,
    "Dad's phone registers for notifications: the relay seals its token, the Mac keeps only the sealed reference",
  );

  const relayAccess = await api(avaPage, "POST", "/api/skycot/family/relay", { enabled: false });
  check(relayAccess.status === 403, "a child's device cannot switch the relay off");

  // Ava asks for something on her own iPad, away from home: through the relay. She goes first:
  // Phase 1 records the shared "Just ask" space as the first asker's, so a sibling's own device
  // asking there afterwards is refused (a Phase 1 finding, reported with this test).
  const avaComposer = avaPage.getByPlaceholder(/Ask anything/).first();
  await avaComposer.waitFor({ timeout: 20_000 });
  await avaComposer.fill("Make my game move with the arrow keys");
  await avaComposer.press("Enter");
  await avaPage.waitForTimeout(1500);
  await avaPage.screenshot({ path: NodePath.join(OUT, "avas-ipad-asking.png") });

  // Leo starts something on the family's Mac (it is his turn on the shared Mac).
  await macPage.goto(new URL("/simple/#/", PAIRING_URL).toString());
  await macPage.reload();
  const pickLeo = macPage.getByRole("button", { name: /Leo/ }).first();
  if (await pickLeo.isVisible({ timeout: 5_000 }).catch(() => false)) await pickLeo.click();
  else {
    await api(macPage, "POST", "/api/skycot/family/choose", { childId: leo.id });
    await macPage.reload();
  }
  const macComposer = macPage.getByPlaceholder(/Ask anything/).first();
  await macComposer.waitFor({ timeout: 20_000 });
  await macComposer.fill("Leo's secret robot plan");
  await macComposer.press("Enter");
  await macPage.waitForTimeout(1500);
  await macPage.screenshot({ path: NodePath.join(OUT, "mac-leo-asking.png") });

  type Pending = {
    threadId: string;
    requestId: string;
    childId: string | null;
    fingerprint: string;
    needsGrownUp: boolean;
  };
  const pendingFor = async (childId: string) => {
    const answer = await api(mumPage, "GET", "/api/skycot/family/approver/requests");
    const requests = (answer.body["requests"] ?? []) as Array<Pending>;
    return requests.find((request) => request.childId === childId) ?? null;
  };
  const avaRequest = await until("Ava's request on Mum's phone", () => pendingFor(ava.id), 120);
  const leoRequest = await until("Leo's request on Mum's phone", () => pendingFor(leo.id), 120);
  check(
    true,
    "Mum's phone sees both children's requests through the relay (a grown-up reads everything)",
  );
  check(avaRequest.needsGrownUp, "Ava's request needs a grown-up");

  // The Mac asked the relay to tell the grown-ups' phones; the relay asked "Apple" (a pretend one).
  type Push = { path: string; headers: Record<string, string>; body: string };
  const pushes = await until(
    "a notification to reach the pretend Apple service",
    () => {
      try {
        const list = JSON.parse(NodeFS.readFileSync(APNS_LOG, "utf8")) as Array<Push>;
        return list.length > 0 ? list : null;
      } catch {
        return null;
      }
    },
    80,
  );
  const push = pushes[0]!;
  const payload = JSON.parse(push.body) as { aps: { alert: { title: string; body: string } } };
  check(
    push.path === `/3/device/${pushToken}`,
    "the notification went to Dad's phone's push token",
  );
  check(
    push.headers["apns-topic"] === "com.skycot.test" && push.headers["apns-push-type"] === "alert",
    "as an ordinary alert for the SKYCOT app",
  );
  check(
    payload.aps.alert.body === "SKYCOT needs a grown-up",
    `it says only "${payload.aps.alert.body}"`,
  );
  check(
    !/Ava|Leo|arrow|robot|npm|game/i.test(push.body),
    "no child's name, project or message is in it",
  );
  check(
    String(push.headers["authorization"]).startsWith("bearer "),
    "it is signed with the relay's provider token (a test key here)",
  );

  // Mum says yes on her phone, with the parent code, through the relay.
  await mumPage.reload();
  const allow = mumPage.getByRole("button", { name: "Allow once" }).first();
  await allow.waitFor({ timeout: 30_000 });
  await mumPage.screenshot({ path: NodePath.join(OUT, "mums-phone-request.png") });
  const cards = await mumPage.locator("text=Allow once").count();
  note(`      Mum's phone shows ${cards} "Allow once" button(s)`);
  // Answer Ava's card: the card order follows the requests, so use the API's own answer route
  // the button calls, with the code (the button path is the same request).
  const answered = await api(mumPage, "POST", "/api/skycot/family/approver/answer", {
    threadId: avaRequest.threadId,
    requestId: avaRequest.requestId,
    decision: "accept",
    fingerprint: avaRequest.fingerprint,
    proof: { type: "code", code: CODE },
  });
  check(
    answered.status === 200 && answered.body["ok"] !== false,
    `Mum's phone allows Ava's request once, through the relay (${JSON.stringify(answered.body)})`,
  );
  await until(
    "Ava's request to leave Mum's list",
    async () => (await pendingFor(ava.id)) === null,
    60,
  );
  check((await pendingFor(leo.id)) !== null, "Leo's request still waits (one card, once)");
  const replayed = await api(mumPage, "POST", "/api/skycot/family/approver/answer", {
    threadId: avaRequest.threadId,
    requestId: avaRequest.requestId,
    decision: "accept",
    fingerprint: avaRequest.fingerprint,
    proof: { type: "code", code: CODE },
  });
  check(
    replayed.body["ok"] === false ||
      replayed.status !== 200 ||
      replayed.body["error"] !== undefined,
    `answering the same card again does nothing (${JSON.stringify(replayed.body)})`,
  );
  await mumPage.reload();
  await mumPage.waitForTimeout(1500);
  await mumPage.screenshot({ path: NodePath.join(OUT, "mums-phone-after.png") });

  // Ava's iPad sees only her own work, through the relay.
  const macShell = (await api(macPage, "GET", "/api/orchestration/shell")).body;
  const avaShell = (await api(avaPage, "GET", "/api/orchestration/shell")).body;
  const threadIds = (shell: Record<string, unknown>) =>
    ((shell["threads"] ?? []) as Array<{ id: string }>).map((thread) => thread.id);
  const macThreads = threadIds(macShell);
  const avaThreads = threadIds(avaShell);
  note(
    `      the Mac sees ${macThreads.length} conversations, Ava's iPad sees ${avaThreads.length}`,
  );
  check(
    avaThreads.includes(avaRequest.threadId) && !avaThreads.includes(leoRequest.threadId),
    "Ava's iPad sees her own conversation and not Leo's",
  );
  check(
    macThreads.includes(leoRequest.threadId) && macThreads.includes(avaRequest.threadId),
    "the family's Mac sees both",
  );
  const leoThread = await api(avaPage, "GET", `/api/orchestration/threads/${leoRequest.threadId}`);
  const avaThread = await api(avaPage, "GET", `/api/orchestration/threads/${avaRequest.threadId}`);
  check(
    avaThread.status === 200,
    `Ava's iPad opens her own conversation by its address (${avaThread.status})`,
  );
  check(
    leoThread.status === 403 || leoThread.status === 404,
    `Ava's iPad cannot open Leo's conversation by its address (${leoThread.status})`,
  );
  await avaPage.goto(new URL("#/", avaPage.url()).toString());
  await avaPage.waitForTimeout(2500);
  const yay = avaPage.getByRole("button", { name: "Yay!" });
  if (await yay.isVisible({ timeout: 2_000 }).catch(() => false)) await yay.click();
  await avaPage.waitForTimeout(500);

  await mumPage.screenshot({ path: NodePath.join(OUT, "mums-phone.png") });
  await avaPage.screenshot({ path: NodePath.join(OUT, "avas-ipad.png") });
  dad.close();

  // Removing Ava's iPad on the Mac ends it at once, away from home too.
  const rows = (await api(macPage, "GET", "/api/skycot/family/devices")).body["devices"] as Array<{
    id: string;
    name: string;
  }>;
  const avaIpad = rows.find((row) => row.name === "Ava's iPad")!;
  await api(macPage, "POST", "/api/skycot/family/verify", { code: CODE, purpose: "settings" });
  const removed = await api(macPage, "POST", "/api/skycot/family/devices/remove", {
    deviceId: avaIpad.id,
  });
  check(removed.status === 200, "the Mac removes Ava's iPad");
  const afterRemoval = await api(avaPage, "GET", "/api/skycot/family").catch((error: unknown) => ({
    status: 0,
    body: { error: String(error).slice(0, 80) } as Record<string, unknown>,
  }));
  check(
    afterRemoval.status === 0 || afterRemoval.status === 401 || afterRemoval.status === 403,
    `the removed iPad gets nothing more through the relay (${afterRemoval.status} ${JSON.stringify(afterRemoval.body).slice(0, 100)})`,
  );
  const mumStill = await api(mumPage, "GET", "/api/skycot/family");
  check(mumStill.status === 200, "Mum's phone keeps working");

  // The relay's own log: it forwarded frames, and none of them was readable.
  const log = NodeFS.readFileSync(RELAY_LOG, "utf8");
  const frames = [...log.matchAll(/"event":"frame".*?"b64":"([A-Za-z0-9_-]*)"/g)].map((match) =>
    Buffer.from(match[1]!, "base64url"),
  );
  check(frames.length > 20, `the relay forwarded ${frames.length} frames`);
  const everything = Buffer.concat(frames).toString("latin1");
  // Long enough that random sealed bytes cannot contain them by chance.
  const secrets = [
    "/api/skycot",
    "/api/auth",
    "skycot-family",
    "Mum's phone",
    "Ava's iPad",
    '"name":"Ava"',
    '"name":"Leo"',
    CODE,
    "authenticated",
    "t3_session",
    "websocket",
    "arrow keys",
    "secret robot",
    "npm install",
    "game library",
  ];
  const leaked = secrets.filter((secret) => everything.includes(secret) || log.includes(secret));
  check(
    leaked.length === 0,
    `the relay never saw plaintext (searched its frames and its log for ${secrets.length} words${leaked.length ? `; found ${leaked.join(", ")}` : ""})`,
  );
} finally {
  await browser.close();
  NodeFS.writeFileSync(NodePath.join(OUT, "report.txt"), `${report.join("\n")}\n`);
}
