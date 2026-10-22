// Usage, in plain words: how much of each assistant's allowance is left, when it comes back,
// and what the logs say was spent. Pure functions from the engine's contract types
// (ServerProvider.usageLimits, UsageSummary) to what the ring, popover, sheet and banner say.
// Nothing here reads the clock or the time zone on its own: callers pass `now` and `timeZone`.
import type {
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageBucket,
  UsageProviderKind,
  UsageSummary,
} from "@t3tools/contracts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Above this share left the ring is green; at or below `CRITICAL_BELOW` it is red. */
export const LOW_AT_OR_BELOW = 30;
export const CRITICAL_BELOW = 10;
/** The one-time early warning shows once the binding window has this much or less left. */
export const WARN_AT_OR_BELOW = 20;

export type UsageTone = "ok" | "low" | "critical" | "unknown";

export function usageTone(leftPercent: number | null): UsageTone {
  if (leftPercent === null) return "unknown";
  if (leftPercent < CRITICAL_BELOW) return "critical";
  if (leftPercent <= LOW_AT_OR_BELOW) return "low";
  return "ok";
}

export function percentLeft(window: Pick<ServerProviderUsageWindow, "usedPercent">): number {
  const used = Number.isFinite(window.usedPercent) ? window.usedPercent : 0;
  return Math.round(100 - Math.max(0, Math.min(100, used)));
}

/** What the person pays for, keyed by engine driver: the same names Settings uses. */
const DRIVER_BRANDS: Record<string, string> = {
  codex: "ChatGPT",
  antigravity: "Google",
  claudeAgent: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  pi: "Pi",
  muse: "Muse",
};

export function brandForDriver(driver: string): string {
  return DRIVER_BRANDS[driver] ?? driver.charAt(0).toUpperCase() + driver.slice(1);
}

/** The usage log's provider kinds are not driver slugs ("claude" vs "claudeAgent"). */
const USAGE_KIND_BRANDS: Record<UsageProviderKind, string> = {
  claude: "Claude",
  codex: "ChatGPT",
  grok: "Grok",
  cursor: "Cursor",
  opencode: "OpenCode",
  antigravity: "Google",
  pi: "Pi",
};

export function brandForUsageKind(kind: UsageProviderKind): string {
  return USAGE_KIND_BRANDS[kind] ?? kind;
}

const CURSOR_NAMES: Record<string, string> = {
  totalPercentUsed: "Overall this month",
  autoPercentUsed: "Cursor's own models",
  apiPercentUsed: "Other models",
};

function durationName(mins: number): string | null {
  if (mins <= 0) return null;
  if (mins % (24 * 60) === 0) {
    const days = mins / (24 * 60);
    if (days === 7) return "This week";
    if (days >= 28 && days <= 31) return "This month";
    return days === 1 ? "Today" : `${days}-day window`;
  }
  if (mins % 60 === 0) return `${mins / 60}-hour window`;
  return mins < 60 ? `${mins}-minute window` : null;
}

/**
 * "5-hour window", "This week", "This week (Opus)", "This month". The engine's labels are
 * short developer words ("Session", "Weekly · Opus"); the duration, when reported, is what a
 * person can picture.
 */
export function windowName(window: ServerProviderUsageWindow, driver: string): string {
  if (driver === "cursor" && CURSOR_NAMES[window.id]) return CURSOR_NAMES[window.id]!;
  if (window.id === "individual") return "Your monthly credit";
  if (window.id === "monthly_spend") return "Extra spending this month";
  const scoped = /·\s*(.+)$/.exec(window.label)?.[1]?.trim();
  const base =
    (window.windowDurationMins !== undefined ? durationName(window.windowDurationMins) : null) ??
    (window.kind === "weekly"
      ? "This week"
      : window.kind === "monthly"
        ? "This month"
        : window.kind === "session"
          ? "Current session"
          : window.label);
  return scoped ? `${base} (${scoped})` : base;
}

/** The possessive used in the early warning: "this week's", "the 5-hour". */
function allowancePhrase(window: ServerProviderUsageWindow, driver: string): string {
  const name = windowName(window, driver);
  if (name.startsWith("This ")) return `${name.replace(/^This /, "this ").replace(/ \(.*/, "")}'s`;
  if (name === "Today") return "today's";
  if (name.endsWith(" window")) return `the ${name.replace(/ window$/, "")}`;
  return "the";
}

function zoned(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    weekday: "long",
    hour12: true,
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  return {
    // Days since the epoch in that zone, for "today" / "tomorrow" without DST arithmetic.
    dayNumber: Math.round(Date.UTC(year, month - 1, day) / DAY),
    hour: Number(part("hour")),
    minute: part("minute"),
    period: part("dayPeriod").toLowerCase().replace(/\./g, ""),
    weekday: part("weekday"),
    day,
    month,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3:40 pm", "9 am". */
export function clockTime(at: number, timeZone: string): string {
  const time = zoned(at, timeZone);
  const hour = time.hour === 0 ? 12 : time.hour;
  return `${hour}${time.minute === "00" ? "" : `:${time.minute}`} ${time.period}`;
}

/**
 * When the allowance comes back: "resets in 12 minutes" within the hour, "resets 3:40 pm"
 * later today, "resets tomorrow 9 am", "resets Mon 9 am" within the week, then "resets 3 Nov".
 */
export function resetPhrase(resetsAt: number, now: number, timeZone: string): string {
  const ahead = resetsAt - now;
  if (ahead < MINUTE) return "resets in a moment";
  if (ahead < HOUR) {
    const minutes = Math.round(ahead / MINUTE);
    return `resets in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const at = zoned(resetsAt, timeZone);
  const today = zoned(now, timeZone);
  const days = at.dayNumber - today.dayNumber;
  const time = clockTime(resetsAt, timeZone);
  if (days <= 0) return `resets ${time}`;
  if (days === 1) return `resets tomorrow ${time}`;
  if (days < 7) return `resets ${at.weekday.slice(0, 3)} ${time}`;
  return `resets ${at.day} ${MONTHS[at.month - 1]}`;
}

/** "Updated just now", "Updated 4 minutes ago", "Updated 2:10 pm", "Updated yesterday". */
export function updatedPhrase(checkedAt: number, now: number, timeZone: string): string {
  const ago = now - checkedAt;
  if (ago < MINUTE) return "Updated just now";
  if (ago < HOUR) {
    const minutes = Math.round(ago / MINUTE);
    return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const days = zoned(now, timeZone).dayNumber - zoned(checkedAt, timeZone).dayNumber;
  if (days <= 0) return `Updated ${clockTime(checkedAt, timeZone)}`;
  if (days === 1) return "Updated yesterday";
  return `Updated ${days} days ago`;
}

export interface PlainUsageWindow {
  readonly id: string;
  readonly name: string;
  readonly leftPercent: number;
  readonly tone: UsageTone;
  readonly resetsAt: number | null;
  /** "resets 3:40 pm"; null when the provider did not say. */
  readonly reset: string | null;
  /** "5-hour window: 62% left · resets 3:40 pm" */
  readonly line: string;
}

export type UsageStatus =
  /** Windows reported: the ring shows a share. */
  | "reported"
  /** The account can never report windows (API key, cloud billing). */
  | "unsupported"
  /** The last check failed; the next one may work. */
  | "probeFailed"
  /** Nothing reported yet, or this assistant does not report limits to the engine. */
  | "none";

export interface ProviderUsage {
  readonly instanceId: string;
  readonly driver: string;
  readonly brand: string;
  /** "Plus", "Max 5x": the plan as the provider names it, when it does. */
  readonly plan: string | null;
  readonly status: UsageStatus;
  readonly windows: ReadonlyArray<PlainUsageWindow>;
  /** The window that runs out first; the ring and the banner speak for it. */
  readonly binding: PlainUsageWindow | null;
  readonly leftPercent: number | null;
  readonly tone: UsageTone;
  readonly checkedAt: number | null;
  /** Why there is no share to show, in a sentence; null when there is one. */
  readonly reason: string | null;
  /** The ring's accessible name: "ChatGPT allowance: 62% left". */
  readonly label: string;
}

function hasDriver(provider: Pick<ServerProvider, "driver">, driver: string): boolean {
  return String(provider.driver) === driver;
}

/** Drivers whose adapters report allowance windows to the engine today. */
const REPORTING_DRIVERS = new Set([
  "codex",
  "claudeAgent",
  "antigravity",
  "cursor",
  "grok",
  "opencode",
]);

/**
 * Honest, per assistant: why the ring has no number. Never the engine's raw message, which is
 * written for developers.
 */
export function notReportedReason(
  provider: Pick<ServerProvider, "driver" | "auth">,
  limits: ServerProviderUsageLimits | undefined,
): string {
  const driver = String(provider.driver);
  const brand = brandForDriver(driver);
  if (provider.auth.status === "unauthenticated") {
    return `${brand} isn't signed in, so there's no allowance to show.`;
  }
  if (limits?.unavailable?.reason === "unsupported") {
    if (hasDriver(provider, "codex")) {
      return "ChatGPT doesn't report an allowance when it's connected with an API key. That use is billed to the key instead.";
    }
    if (hasDriver(provider, "claudeAgent")) {
      return "Claude doesn't report an allowance for API-key or cloud accounts, only for Pro and Max plans.";
    }
    if (hasDriver(provider, "antigravity")) {
      return "Google doesn't report an allowance for this kind of account.";
    }
    return `${brand} doesn't report an allowance for this kind of account.`;
  }
  if (limits?.unavailable?.reason === "probeFailed") {
    return `Couldn't check ${brand}'s allowance just now. It tries again after the next message.`;
  }
  if (!REPORTING_DRIVERS.has(driver)) {
    return `${brand} doesn't report its allowance to SKYCOT.`;
  }
  return `${brand} hasn't reported its allowance yet. It usually appears after the first message.`;
}

/**
 * Cursor's "Overall" is the two pools combined, not a third allowance: when both pools are
 * reported it would double count, so it drops out (the stock UI does the same).
 */
function shownWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
  driver: string,
): ReadonlyArray<ServerProviderUsageWindow> {
  if (driver !== "cursor") return windows;
  const ids = new Set(windows.map((window) => window.id));
  return ids.has("autoPercentUsed") && ids.has("apiPercentUsed")
    ? windows.filter((window) => window.id !== "totalPercentUsed")
    : windows;
}

function plainWindow(
  window: ServerProviderUsageWindow,
  driver: string,
  now: number,
  timeZone: string,
): PlainUsageWindow {
  const leftPercent = percentLeft(window);
  const parsed = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
  const resetsAt = Number.isFinite(parsed) ? parsed : null;
  const reset = resetsAt === null ? null : resetPhrase(resetsAt, now, timeZone);
  const name = windowName(window, driver);
  return {
    id: window.id,
    name,
    leftPercent,
    tone: usageTone(leftPercent),
    resetsAt,
    reset,
    line: `${name}: ${leftPercent}% left${reset ? ` · ${reset}` : ""}`,
  };
}

/**
 * The window that runs out first: the least left; on a tie, the one that stays empty longer
 * (resets later), since that is the one actually holding the person back.
 */
export function bindingWindow(windows: ReadonlyArray<PlainUsageWindow>): PlainUsageWindow | null {
  let best: PlainUsageWindow | null = null;
  for (const window of windows) {
    if (
      best === null ||
      window.leftPercent < best.leftPercent ||
      (window.leftPercent === best.leftPercent &&
        (window.resetsAt ?? Number.POSITIVE_INFINITY) > (best.resetsAt ?? Number.POSITIVE_INFINITY))
    ) {
      best = window;
    }
  }
  return best;
}

export function describeProviderUsage(
  provider: ServerProvider,
  now: number,
  timeZone: string,
): ProviderUsage {
  const driver = String(provider.driver);
  const brand = brandForDriver(driver);
  const limits = provider.usageLimits;
  const reported =
    provider.auth.status !== "unauthenticated" &&
    limits !== undefined &&
    limits.unavailable === undefined &&
    limits.windows.length > 0;
  const windows = reported
    ? shownWindows(limits.windows, driver).map((window) =>
        plainWindow(window, driver, now, timeZone),
      )
    : [];
  const binding = bindingWindow(windows);
  const leftPercent = binding?.leftPercent ?? null;
  const checked = limits ? Date.parse(limits.checkedAt) : Number.NaN;
  const status: UsageStatus = reported
    ? "reported"
    : limits?.unavailable?.reason === "unsupported"
      ? "unsupported"
      : limits?.unavailable?.reason === "probeFailed"
        ? "probeFailed"
        : "none";
  return {
    instanceId: String(provider.instanceId),
    driver,
    brand,
    plan: provider.auth.label?.trim() || null,
    status,
    windows,
    binding,
    leftPercent,
    tone: usageTone(leftPercent),
    checkedAt: Number.isFinite(checked) ? checked : null,
    reason: reported ? null : notReportedReason(provider, limits),
    label:
      leftPercent === null
        ? `${brand} allowance: usage not reported`
        : `${brand} allowance: ${leftPercent}% left`,
  };
}

/**
 * Every assistant that is switched on, installed and reachable, the one in use first. Signed-out
 * ones are left out: they have nothing to report and Settings already says how to sign in.
 */
export function connectedProviderUsage(
  providers: ReadonlyArray<ServerProvider>,
  activeInstanceId: string | null,
  now: number,
  timeZone: string,
): ReadonlyArray<ProviderUsage> {
  return providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        provider.availability !== "unavailable" &&
        provider.auth.status !== "unauthenticated",
    )
    .map((provider) => describeProviderUsage(provider, now, timeZone))
    .toSorted(
      (left, right) =>
        Number(right.instanceId === activeInstanceId) -
          Number(left.instanceId === activeInstanceId) || left.brand.localeCompare(right.brand),
    );
}

export interface UsageWarning {
  /** Stable for one window period, so a dismissed warning stays dismissed until it resets. */
  readonly key: string;
  /** "About 20% of the 5-hour ChatGPT allowance left · resets 3:40 pm" */
  readonly text: string;
  readonly tone: "low" | "critical";
}

export function usageWarning(
  usage: ProviderUsage,
  limits: ServerProviderUsageLimits | undefined,
): UsageWarning | null {
  const binding = usage.binding;
  if (binding === null || binding.leftPercent > WARN_AT_OR_BELOW) return null;
  const window = limits?.windows.find((entry) => entry.id === binding.id);
  const phrase = window ? allowancePhrase(window, usage.driver) : "the";
  const reset = binding.reset ? ` · ${binding.reset}` : "";
  const text =
    binding.leftPercent === 0
      ? `${capitalise(phrase)} ${usage.brand} allowance is used up${reset}`
      : `About ${binding.leftPercent}% of ${phrase} ${usage.brand} allowance left${reset}`;
  return {
    key: `${usage.instanceId}:${binding.id}:${binding.resetsAt ?? "open"}`,
    text,
    tone: binding.leftPercent < CRITICAL_BELOW ? "critical" : "low",
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface TokenTotals {
  readonly tokens: number;
  readonly costUsd: number;
  /** Some records had no price: the figure is a floor. */
  readonly partlyPriced: boolean;
  /** No record had a price: there is no dollar figure at all. */
  readonly costUnknown: boolean;
}

export interface TokenRow extends TokenTotals {
  readonly key: string;
  readonly name: string;
  readonly detail: string | null;
}

export interface TokenReport {
  readonly today: TokenTotals;
  readonly week: TokenTotals;
  readonly byProvider: ReadonlyArray<TokenRow>;
  readonly byModel: ReadonlyArray<TokenRow>;
  readonly empty: boolean;
}

function bucketTokens(bucket: UsageBucket): number {
  const totals = bucket.totals;
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    totals.uncachedInputTokens +
    totals.cachedInputTokens +
    totals.cacheCreationTokens +
    totals.outputTokens
  );
}

function totalsOf(buckets: ReadonlyArray<UsageBucket>): TokenTotals {
  let tokens = 0;
  let costUsd = 0;
  let records = 0;
  let unpriced = 0;
  for (const bucket of buckets) {
    tokens += bucketTokens(bucket);
    costUsd += bucket.costUsd;
    records += bucket.records;
    unpriced += bucket.unpricedRecords;
  }
  return {
    tokens,
    costUsd,
    partlyPriced: unpriced > 0 && unpriced < records,
    costUnknown: records > 0 && unpriced >= records,
  };
}

function rows(
  buckets: ReadonlyArray<UsageBucket>,
  keyOf: (bucket: UsageBucket) => string,
  describe: (bucket: UsageBucket) => { name: string; detail: string | null },
  limit: number,
): ReadonlyArray<TokenRow> {
  const groups = new Map<string, UsageBucket[]>();
  for (const bucket of buckets) {
    const key = keyOf(bucket);
    const list = groups.get(key);
    if (list) list.push(bucket);
    else groups.set(key, [bucket]);
  }
  return [...groups]
    .map(([key, list]) => ({ key, ...describe(list[0]!), ...totalsOf(list) }))
    .filter((row) => row.tokens > 0)
    .toSorted((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
    .slice(0, limit);
}

/** Today and the whole window (the sheet asks for the last 7 days), by assistant and by model. */
export function tokenReport(summary: UsageSummary): TokenReport {
  // Hourly summaries repeat each bucket per hour; days are what this view adds up.
  const buckets = summary.buckets;
  const week = totalsOf(buckets);
  return {
    today: totalsOf(buckets.filter((bucket) => bucket.day === summary.untilDay)),
    week,
    byProvider: rows(
      buckets,
      (bucket) => bucket.provider,
      (bucket) => ({ name: brandForUsageKind(bucket.provider), detail: null }),
      8,
    ),
    byModel: rows(
      buckets,
      (bucket) => `${bucket.provider}:${bucket.model}`,
      (bucket) => ({ name: bucket.model, detail: brandForUsageKind(bucket.provider) }),
      5,
    ),
    empty: week.tokens === 0,
  };
}

/** "1.2M tokens", "8,400 tokens". */
export function tokensPhrase(tokens: number): string {
  if (tokens >= 1e9) return `${trimNumber(tokens / 1e9)}B tokens`;
  if (tokens >= 1e6) return `${trimNumber(tokens / 1e6)}M tokens`;
  if (tokens >= 1e4) return `${trimNumber(tokens / 1e3)}K tokens`;
  return `${new Intl.NumberFormat("en-AU").format(Math.round(tokens))} token${tokens === 1 ? "" : "s"}`;
}

function trimNumber(value: number): string {
  const digits = value >= 100 ? 0 : 1;
  return value.toFixed(digits).replace(/\.0$/, "");
}

/**
 * Always reads as an estimate: the engine prices the logs from a public rate card, and plans
 * that include usage are not charged per token at all.
 */
export function costEstimate(totals: TokenTotals): string {
  if (totals.tokens === 0) return "Nothing yet";
  if (totals.costUnknown) return "Cost not known";
  const more = totals.partlyPriced ? " or more" : "";
  if (totals.costUsd > 0 && totals.costUsd < 0.01) return `Under US$0.01${more} (estimate)`;
  return `About US$${totals.costUsd.toFixed(2)}${more} (estimate)`;
}
