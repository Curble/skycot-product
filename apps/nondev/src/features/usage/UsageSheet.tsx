import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ServerProvider, UsageSummaryInput } from "@t3tools/contracts";
import { makeWindow } from "@t3tools/shared/usageFormat";
import { Gauge } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";

import { AdvancedModeSheet } from "../../app/AdvancedModeSheet";
import { ADVANCED_MODE_LABEL } from "../../brand";
import {
  connectedProviderUsage,
  costEstimate,
  tokenReport,
  tokensPhrase,
  updatedPhrase,
  type ProviderUsage,
  type TokenRow,
  type UsageTone,
} from "../../plain/usage";
import { serverEnvironment } from "../../state/server";
import { Button } from "../../ui/Button";
import { ProgressBar, type ProgressTone } from "../../ui/ProgressBar";
import { Sheet } from "../../ui/Sheet";
import { useFamily } from "../family/FamilyProvider";
import { UsageRing } from "./UsageRing";
import {
  closeUsageSheet,
  localTimeZone,
  useActiveUsage,
  useGentleUsageRefresh,
  useUsageSheetOpen,
} from "./useUsage";

const BAR_TONE: Record<UsageTone, ProgressTone> = {
  ok: "green",
  low: "orange",
  critical: "red",
  unknown: "accent",
};

/** The one Usage sheet, mounted once by the shell. Hidden from a child's view in Family mode. */
export function UsageSheetHost() {
  const open = useUsageSheetOpen();
  const family = useFamily();
  const { environmentId, providers, active } = useActiveUsage();
  if (family.enabled || !open) return null;
  return (
    <Sheet
      open
      onClose={closeUsageSheet}
      icon={Gauge}
      iconTone="blue"
      title="Usage"
      description="How much of each assistant's allowance is left, and what the last week used."
      wide
      actions={
        <Button variant="primary" onClick={closeUsageSheet}>
          Done
        </Button>
      }
    >
      {environmentId === null ? (
        <p className="fm-usage-muted">Connecting to your Mac…</p>
      ) : (
        <UsageDetails
          environmentId={environmentId}
          providers={providers}
          activeInstanceId={active ? String(active.instanceId) : null}
        />
      )}
    </Sheet>
  );
}

/**
 * Every connected assistant's allowance, then tokens and estimated cost from the usage log.
 * Shared by the sheet and Settings › AI assistants. Mounting it is what fetches the log
 * summary and asks for a (throttled) fresh limits check; nothing polls while it is open.
 */
export function UsageDetails({
  environmentId,
  providers,
  activeInstanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyArray<ServerProvider> | null;
  readonly activeInstanceId: string | null;
}) {
  const refresh = useGentleUsageRefresh(environmentId);
  // Captured once per opening: the words ("resets in 12 minutes") describe that moment.
  const [now] = useState(() => Date.now());
  // Throttled per environment (five minutes), so a re-render never probes twice.
  useEffect(() => {
    refresh();
  }, [refresh]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const timeZone = localTimeZone();
  const list = connectedProviderUsage(providers ?? [], activeInstanceId, now, timeZone);

  return (
    <div className="fm-usage-details">
      <section aria-labelledby="fm-usage-allowance">
        <h3 id="fm-usage-allowance" className="fm-usage-heading">
          Allowance left
        </h3>
        {providers === null ? (
          <p className="fm-usage-muted">Checking your assistants…</p>
        ) : list.length === 0 ? (
          <p className="fm-usage-muted">
            No assistant is connected yet. Connect one in Settings › AI assistants.
          </p>
        ) : (
          <div className="fm-usage-cards">
            {list.map((usage) => (
              <ProviderCard
                key={usage.instanceId}
                usage={usage}
                inUse={usage.instanceId === activeInstanceId}
                now={now}
                timeZone={timeZone}
              />
            ))}
          </div>
        )}
      </section>
      <TokensSection environmentId={environmentId} />
      <div className="fm-usage-advanced">
        <Button variant="plain" size="sm" onClick={() => setAdvancedOpen(true)}>
          Open the full Usage page ({ADVANCED_MODE_LABEL})
        </Button>
      </div>
      <AdvancedModeSheet
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        path="usage"
        reason="Charts by day and hour, every model, and price settings live on the full Usage page."
      />
    </div>
  );
}

function ProviderCard({
  usage,
  inUse,
  now,
  timeZone,
}: {
  readonly usage: ProviderUsage;
  readonly inUse: boolean;
  readonly now: number;
  readonly timeZone: string;
}) {
  return (
    <article
      className="fm-usage-card"
      aria-label={`${usage.brand} allowance`}
      data-sober={usage.tone === "critical" ? "" : undefined}
    >
      <header className="fm-usage-card__head">
        <UsageRing leftPercent={usage.leftPercent} tone={usage.tone} size={28} />
        <div className="fm-usage-card__title">
          <b>{usage.brand}</b>
          <span>
            {[usage.plan, inUse ? "In use" : null].filter(Boolean).join(" · ") || "Connected"}
          </span>
        </div>
        <span className={`fm-usage-card__figure fm-usage-card__figure--${usage.tone}`}>
          {usage.leftPercent === null ? "Not reported" : `${usage.leftPercent}% left`}
        </span>
      </header>
      {usage.windows.length > 0 ? (
        <ul className="fm-usage-card__windows">
          {usage.windows.map((window) => (
            <li key={window.id}>
              <div className="fm-usage-card__row">
                <span>{window.name}</span>
                {window.expired ? (
                  <span>{window.reset}, new figure after the next message</span>
                ) : (
                  <span>
                    <b>{window.leftPercent}% left</b>
                    {window.reset ? ` · ${window.reset}` : ""}
                  </span>
                )}
              </div>
              {window.expired ? null : (
                <ProgressBar
                  value={window.leftPercent}
                  max={100}
                  tone={BAR_TONE[window.tone]}
                  thin
                  label={`${usage.brand}, ${window.line}`}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="fm-usage-card__reason">{usage.reason}</p>
      )}
      {usage.checkedAt !== null && usage.windows.length > 0 ? (
        <p className="fm-usage-card__updated">{updatedPhrase(usage.checkedAt, now, timeZone)}</p>
      ) : null}
    </article>
  );
}

function TokensSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  // The last 7 days in the person's zone, asked once per opening. The engine scans the
  // assistants' own logs for this, so it is never fetched until someone looks.
  const [input] = useState<UsageSummaryInput>(() => makeWindow(7));
  const result = useAtomValue(serverEnvironment.usageSummary({ environmentId, input }));
  const summary = Option.getOrNull(AsyncResult.value(result));

  return (
    <section aria-labelledby="fm-usage-tokens" className="fm-usage-tokens">
      <h3 id="fm-usage-tokens" className="fm-usage-heading">
        Tokens and cost
      </h3>
      {summary === null ? (
        <p className="fm-usage-muted">
          {AsyncResult.isFailure(result)
            ? "Couldn't read the usage log from this device."
            : "Adding up the last 7 days…"}
        </p>
      ) : (
        <TokenTables report={tokenReport(summary)} />
      )}
    </section>
  );
}

function TokenTables({ report }: { readonly report: ReturnType<typeof tokenReport> }) {
  if (report.empty) {
    return <p className="fm-usage-muted">Nothing used in the last 7 days.</p>;
  }
  return (
    <>
      <div className="fm-usage-totals">
        <div>
          <span>Today</span>
          <b>{tokensPhrase(report.today.tokens)}</b>
          <small>{costEstimate(report.today)}</small>
        </div>
        <div>
          <span>Last 7 days</span>
          <b>{tokensPhrase(report.week.tokens)}</b>
          <small>{costEstimate(report.week)}</small>
        </div>
      </div>
      <TokenTable title="By assistant, last 7 days" rows={report.byProvider} />
      <TokenTable title="Busiest models, last 7 days" rows={report.byModel} />
      <p className="fm-usage-note">
        Counted from the assistants' own logs on this Mac, including use outside SKYCOT. Costs are
        estimates from public price lists; a Plus, Pro or Max plan is not charged per token.
      </p>
    </>
  );
}

function TokenTable({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: ReadonlyArray<TokenRow>;
}) {
  if (rows.length === 0) return null;
  return (
    <table className="fm-usage-table">
      <caption>{title}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">
              {row.name}
              {row.detail ? <small>{row.detail}</small> : null}
            </th>
            <td>{tokensPhrase(row.tokens)}</td>
            <td>{costEstimate(row)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
