#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// The account id stays out of the repository: CLOUDFLARE_ACCOUNT_ID, or one line in
// ~/.config/skycot/cloudflare-account-id.
const ACCOUNT = (
  process.env.CLOUDFLARE_ACCOUNT_ID ??
  (await readFile(join(homedir(), ".config/skycot/cloudflare-account-id"), "utf8").catch(() => ""))
).trim();
if (!ACCOUNT) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID to the SKYCOT Cloudflare account id.");
  process.exit(1);
}
const ZONE = "skycot.com";
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const ANALYTICS_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`;
const localDate = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Melbourne",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const date = `${localDate.find((part) => part.type === "year")?.value}-${localDate.find((part) => part.type === "month")?.value}-${localDate.find((part) => part.type === "day")?.value}`;
const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const until = new Date().toISOString();
const args = process.argv.slice(2);
const fixturePath = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : undefined;
const outputRoot = process.env.SKYCOT_ANALYTICS_DIR ?? join(homedir(), "skycot-analytics");

type Row = {
  dimensions: Record<string, string | number | null>;
  sum: Record<string, number | null>;
  sampleInterval?: number;
};
type Data = { home: Row[]; downloads: Row[]; updates: Row[]; dailyActive: Row[] };

const query = `query Counts($zone: String!, $since: Time!, $until: Time!) {
  viewer { zones(filter: { zoneTag: $zone }) {
  home: httpRequestsAdaptiveGroups(
    limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until, clientRequestPath: "/", edgeResponseStatus: 200, requestSource: "eyeball" }
  ) { dimensions { date clientCountryName } count avg { sampleInterval } }
  downloads: httpRequestsAdaptiveGroups(
    limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: "downloads.skycot.com", clientRequestPath_like: "/mac/SKYCOT-%", edgeResponseStatus_in: [200, 206] }
  ) { dimensions { date clientRequestPath } count avg { sampleInterval } }
  updates: httpRequestsAdaptiveGroups(
    limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: "downloads.skycot.com", clientRequestPath: "/mac/latest-mac.yml", edgeResponseStatus: 200 }
  ) { dimensions { date clientCountryName } count avg { sampleInterval } }
  } }
}`;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function readGraphQL(
  payload: Record<string, unknown>,
): Pick<Data, "home" | "downloads" | "updates"> {
  const data = payload["data"] as Record<string, unknown> | undefined;
  const viewer = data?.["viewer"] as Record<string, unknown> | undefined;
  const zones = viewer?.["zones"] as Array<Record<string, unknown>> | undefined;
  const groups = (key: string) => {
    return rows(zones?.[0]?.[key]).map((row) => ({
      dimensions: row.dimensions,
      sum: { requests: Number(row["count"] ?? 0) },
      sampleInterval: Number(
        (row["avg"] as Record<string, number> | undefined)?.["sampleInterval"] ?? 1,
      ),
    }));
  };
  const downloads = groups("downloads")
    .flatMap((row) => {
      const path = String(row.dimensions["clientRequestPath"] ?? "");
      const match = /^\/mac\/SKYCOT-(.+)\.(?:dmg|zip)$/i.exec(path);
      if (!match) return [];
      const fileVersion = match[1]!;
      const version = fileVersion.replace(/-(?:arm64|x64|universal)$/i, "") || "stable download";
      return [{ ...row, dimensions: { date: row.dimensions["date"], version } }];
    })
    .reduce<Row[]>((result, row) => {
      const existing = result.find(
        (entry) =>
          entry.dimensions["date"] === row.dimensions["date"] &&
          entry.dimensions["version"] === row.dimensions["version"],
      );
      if (existing) {
        existing.sum["requests"] =
          Number(existing.sum["requests"] ?? 0) + Number(row.sum["requests"] ?? 0);
        existing.sampleInterval = Math.max(existing.sampleInterval ?? 1, row.sampleInterval ?? 1);
      } else result.push(row);
      return result;
    }, []);
  return { home: groups("home"), downloads, updates: groups("updates") };
}

function table(title: string, source: Row[], keys: string[], showSampling = true): string {
  const labels: Record<string, string> = {
    clientCountryName: "Country",
    version: "App version",
    kind: "Count type",
  };
  const headings = [
    "Day",
    ...keys.map((key) => labels[key] ?? key),
    "Count (unscaled)",
    ...(showSampling ? ["Average sampling interval"] : []),
  ];
  const body = source
    .map(
      (row) =>
        `<tr><td>${esc(row.dimensions["date"] ?? "")}</td>${keys
          .map((key) => {
            const value = row.dimensions[key] ?? "";
            const display =
              key === "clientCountryName" && typeof value === "string"
                ? (new Intl.DisplayNames(["en"], { type: "region" }).of(value) ?? value)
                : key === "kind" && typeof value === "string"
                  ? ({
                      "update-check": "Mac update checks",
                      "relay-home": "Relay home Macs",
                      "relay-device": "Relay linked devices",
                    }[value] ?? value)
                  : value;
            return `<td>${esc(display)}</td>`;
          })
          .join(
            "",
          )}<td>${esc(row.sum["requests"] ?? 0)}</td>${showSampling ? `<td>${esc(row.sampleInterval ?? 1)}</td>` : ""}</tr>`,
    )
    .join("");
  return `<h3>${title}</h3><table><thead><tr>${headings.map((heading) => `<th>${esc(heading)}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${headings.length}">No matching requests in this period.</td></tr>`}</tbody></table>`;
}

function esc(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function report(data: Data): string {
  const total = (source: Row[]) =>
    source.reduce((sum, row) => sum + Number(row.sum["requests"] ?? 0), 0);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SKYCOT counts · ${date}</title><style>
body{font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202124;max-width:1050px;margin:40px auto;padding:0 20px}h1,h2{line-height:1.2}h1{font-size:30px}h2{margin-top:38px;border-bottom:1px solid #ddd;padding-bottom:8px}h3{font-size:17px;margin:22px 0 8px}.note{background:#f3f6fa;border-left:4px solid #4b79a8;padding:12px 16px}.meaning{font-weight:600}table{border-collapse:collapse;width:100%;font-size:14px;margin:12px 0 20px}th,td{text-align:left;border:1px solid #ddd;padding:7px 9px}th{background:#f4f5f6}footer{margin-top:38px;color:#555;font-size:13px}
</style><body><h1>SKYCOT activity counts</h1><p>Prepared ${date} for the 30 days ending ${until.slice(0, 10)}. The first three sections show Cloudflare's sampled request estimates; counts are shown as returned and are not scaled. The final section shows distinct daily codes returned by Analytics Engine.</p><p class="note">Cloudflare's request grouping uses adaptive sampling, so these figures are estimates, not an exact count. “Requests” means the sampled request total Cloudflare returned. Not counted as separate families: Mark's own testing is mostly AU, so an Australia-heavy result may mostly reflect Mark's testing and is not evidence of family use. The update-feed id uses IP address plus app user-agent; two Macs with the same network address and user-agent can look like one, while a Mac whose user-agent changes can look like another.</p>
<h2>Website home page</h2>${table("Home-page views (successful human browser requests) by day and country", data.home, ["clientCountryName"])}<p>30-day Cloudflare count returned, unscaled: ${total(data.home)}.</p><p class="meaning">What this means: this estimates how often the home page was requested, not how many different people visited.</p>
<h2>Mac downloads</h2>${table("Successful Mac app downloads by day and file version", data.downloads, ["version"])}<p>30-day Cloudflare count returned, unscaled: ${total(data.downloads)}.</p><p class="meaning">What this means: each row counts sampled successful file requests; a partial download or retry can create more than one request.</p>
<h2>Update feed</h2>${table("Successful update-feed checks by day and country", data.updates, ["clientCountryName"])}<p>30-day Cloudflare count returned, unscaled: ${total(data.updates)}.</p><p class="meaning">What this means: these are checks, not different Macs; the privacy-preserving daily estimate appears below once the counter is deployed, though Macs sharing the same network address and app user-agent can look like one client.</p>
<h2>Daily active totals</h2>${table("Anonymous daily distinct totals from Analytics Engine", data.dailyActive, ["kind"], false)}<p class="meaning">What this means: each total is a daily-rotating anonymous count for the update feed or relay; it cannot link a device between days. Cloudflare may sample Analytics Engine data at high volume.</p>
<footer>Terms: Cloudflare GraphQL is Cloudflare's query interface for aggregated website requests; adaptive sampling is Cloudflare's method of estimating high-volume traffic by sampling; R2 is Cloudflare's file storage; Analytics Engine is Cloudflare's service for storing and querying simple event totals. The report contains aggregate counts only and no IP addresses or raw user-agent strings.</footer></body></html>`;
}

async function tokenFromWrangler(): Promise<string> {
  const paths = [
    join(homedir(), "Library/Preferences/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/default.toml"),
  ];
  for (const path of paths) {
    try {
      const content = await readFile(path, "utf8");
      const match = /(?:oauth_token|oauthToken|token)\s*=\s*["']([^"']+)["']/.exec(content);
      if (match?.[1]) return match[1];
    } catch {
      // Try the other documented Wrangler config location without exposing file contents.
    }
  }
  throw new Error("Wrangler OAuth credential is unavailable in the documented config locations.");
}

async function fetchData(): Promise<Data> {
  const token = await tokenFromWrangler();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const zoneResponse = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${ZONE}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const zonePayload = (await zoneResponse.json()) as { result?: Array<{ id?: string }> };
  const zoneId = zonePayload.result?.[0]?.id;
  if (!zoneResponse.ok || !zoneId)
    throw new Error("Cloudflare zone lookup failed; response details omitted.");
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables: { zone: zoneId, since, until } }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload["errors"]) {
    const errors = Array.isArray(payload["errors"])
      ? payload["errors"]
          .map((entry) => String((entry as Record<string, unknown>)["message"] ?? "query error"))
          .join("; ")
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare GraphQL query failed: ${errors}`);
  }
  const http = readGraphQL(payload);
  let dailyActive: Row[] = [];
  try {
    const sql = `SELECT toDate(timestamp) AS date, blob1 AS kind, COUNT(DISTINCT index1) AS requests FROM skycot_counts WHERE timestamp >= NOW() - INTERVAL '30' DAY GROUP BY toDate(timestamp), blob1 ORDER BY date, kind`;
    const analytics = await fetch(ANALYTICS_URL, { method: "POST", headers, body: sql });
    if (analytics.ok) {
      const result = (await analytics.json()) as { data?: Array<Record<string, string | number>> };
      dailyActive = (result.data ?? []).map((entry) => ({
        dimensions: { date: entry["date"], kind: entry["kind"] },
        sum: { requests: Number(entry["requests"] ?? 0) },
      }));
    }
  } catch {
    // The report still works before Analytics Engine is provisioned.
  }
  return { ...http, dailyActive };
}

function csv(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  const data: Data = fixturePath
    ? (JSON.parse(await readFile(fixturePath, "utf8")) as Data)
    : await fetchData();
  const reportDir = join(outputRoot, "reports");
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, `${date}.html`), report(data), { mode: 0o600 });
  await writeFile(
    join(reportDir, `${date}.json`),
    `${JSON.stringify({ date, sampled: true, data }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const history = join(outputRoot, "history.csv");
  await mkdir(dirname(history), { recursive: true });
  let header = false;
  try {
    header = (await readFile(history, "utf8")).length === 0;
  } catch {
    header = true;
  }
  const active = data.dailyActive
    .map((row) => `${row.dimensions["date"]}/${row.dimensions["kind"]}:${row.sum["requests"]}`)
    .join(";");
  const total = (list: Row[]) =>
    list.reduce((sum, row) => sum + Number(row.sum["requests"] ?? 0), 0);
  await appendFile(
    history,
    `${header ? "date,home_views_sampled_unscaled,mac_downloads_sampled_unscaled,update_checks_sampled_unscaled,daily_active_distinct\n" : ""}${[date, total(data.home), total(data.downloads), total(data.updates), active].map(csv).join(",")}\n`,
    { mode: 0o600 },
  );
}

main().catch((error: unknown) => {
  // Never print API responses, request headers or credential values.
  process.stderr.write(`${error instanceof Error ? error.message : "Counts report failed."}\n`);
  process.exitCode = 1;
});
