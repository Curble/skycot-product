// The recap itself, Apple-summary style: who and when, three numbers, the week as bars, the
// "Most proud of" pick with its live picture, then what they made, what they asked for and what
// needed a grown-up. The same view prints: recap.css drops the app around it on paper.
import type { EnvironmentId } from "@t3tools/contracts";
import { Clock, MessageCircle, Play, ShieldCheck, Sparkles, Star } from "lucide-react";

import { threadHref } from "../../router";
import { Button } from "../../ui/Button";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { List, ListRow } from "../../ui/ListRow";
import { ChildAvatar } from "../family/ChildAvatar";
import type { FamilyChild } from "../family/children";
import { MagnetThumb } from "../fridge/MagnetThumb";
import { useOpenIt } from "../starters/PreviewSheet";
import {
  askLine,
  grownUpLines,
  madeSummary,
  minutesPhrase,
  rangeLabel,
  nothingBuiltSentence,
  recapHeadline,
  weekBars,
  type RecapReport,
} from "./recap";
import "./recap.css";
import { displayTitle } from "../tidy/renamedTitles";

const timeOf = (at: number, timeZone: string, withDay: boolean) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone,
    ...(withDay ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  })
    .format(at)
    .replace(/\s+/g, " ");

export function RecapReportView({
  report,
  child,
  name,
  environmentId,
  compact = false,
  hero = true,
}: {
  readonly report: RecapReport;
  readonly child: FamilyChild;
  readonly name: string;
  readonly environmentId: EnvironmentId | null;
  /** The end-of-session card: the highlights only. */
  readonly compact?: boolean;
  /** Off where a sheet's own title already says who and when. */
  readonly hero?: boolean;
}) {
  const openIt = useOpenIt(environmentId);
  const week = report.range === "week";
  const lines = grownUpLines(report, name);
  const made = compact ? report.made.slice(0, 3) : report.made;
  const asks = compact ? report.asks.slice(0, 3) : report.asks;
  const last = report.range === "last-session";
  const span = week ? "this week" : last ? "last time" : "today";
  const proud =
    report.proudOf === null
      ? null
      : { ...report.proudOf, title: displayTitle(report.proudOf.threadId, report.proudOf.title) };
  // "Open it" reads the page through its project: the made entry for that conversation names it.
  const proudProjectId =
    proud === null
      ? null
      : (report.made.find((entry) => entry.threadId === proud.threadId)?.projectId ?? null);
  const proudPage = proud?.page ?? null;
  const openProud =
    proud !== null && proudPage !== null && proud.cwd !== null && proudProjectId !== null
      ? () =>
          openIt.openIt({ threadId: proud.threadId, projectId: proudProjectId, page: proudPage })
      : null;

  return (
    <div className={`fm-recap${compact ? " fm-recap--compact" : ""}`} data-range={report.range}>
      {hero ? (
        <header className="fm-recap__hero">
          <ChildAvatar child={child} size={compact ? 48 : 64} />
          <div className="fm-recap__hero-text">
            <p className="fm-recap__kicker">{rangeLabel(report)}</p>
            <h2 className="fm-recap__title">{recapHeadline(report, name)}</h2>
          </div>
        </header>
      ) : null}

      <div className="fm-recap__stats" role="list" aria-label="At a glance">
        <Stat icon={Clock} value={minutesPhrase(report.minutes)} label={`on SKYCOT ${span}`} />
        <Stat
          icon={Sparkles}
          value={String(report.made.length)}
          label={report.made.length === 1 ? "thing made" : "things made"}
        />
        <Stat
          icon={MessageCircle}
          value={String(report.messages)}
          label={report.messages === 1 ? "message" : "messages"}
        />
      </div>

      {week ? <WeekBars report={report} /> : null}

      {proud !== null ? (
        <Card label="Most proud of">
          <CardHeader icon={Star} tone="orange" title="Most proud of" subtitle={proud.title} />
          <CardBody>
            <div className="fm-recap__proud">
              {openProud !== null && proudPage !== null ? (
                <button
                  type="button"
                  className="fm-recap__proud-picture"
                  onClick={openProud}
                  aria-label={`Open ${proud.title}`}
                >
                  <MagnetThumb
                    threadId={proud.threadId}
                    page={proudPage}
                    version={proud.at}
                    title={proud.title}
                  />
                </button>
              ) : null}
              <div className="fm-recap__proud-text">
                <p>
                  The newest thing {name} finished
                  {week ? " this week" : last ? " last time" : " today"}, at{" "}
                  {timeOf(proud.at, report.timeZone, week)}.
                </p>
                {openProud !== null ? (
                  <span className="fm-recap__noprint">
                    <Button size="sm" icon={Play} onClick={openProud}>
                      Open it
                    </Button>
                  </span>
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card label={`What ${name} made`}>
        <CardHeader
          icon={Sparkles}
          tone="blue"
          title={`What ${name} made`}
          subtitle={
            report.made.length === 0
              ? (nothingBuiltSentence(report, name, span) ?? undefined)
              : compact && report.made.length > made.length
                ? `The newest ${made.length} of ${report.made.length}.`
                : undefined
          }
        />
        {made.length > 0 ? (
          <CardBody>
            <List label={`What ${name} made`}>
              {made.map((entry) => (
                <ListRow
                  key={entry.threadId}
                  title={displayTitle(entry.threadId, entry.title)}
                  subtitle={[
                    entry.projectTitle,
                    // The sentence's own full stop would clash with the separators.
                    (madeSummary(entry) ?? "Talked it through; no files changed").replace(
                      /\.$/,
                      "",
                    ),
                    `${entry.startedInRange ? "Started" : "Carried on"} ${timeOf(entry.lastAt, report.timeZone, week)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  chevron={environmentId !== null}
                  {...(environmentId !== null
                    ? { href: threadHref(environmentId, entry.threadId as never) }
                    : {})}
                />
              ))}
            </List>
          </CardBody>
        ) : null}
      </Card>

      {asks.length > 0 ? (
        <Card label={`What ${name} asked for`}>
          <CardHeader
            icon={MessageCircle}
            tone="grey"
            title={`What ${name} asked for`}
            subtitle="In their own words, shortened. Anything private shows only as the kind of thing it was."
          />
          <CardBody>
            <ul className="fm-recap__asks">
              {asks.map((ask) => (
                <li
                  key={`${ask.threadId}:${ask.at}`}
                  data-hidden={ask.text === null ? "" : undefined}
                >
                  <span className="fm-recap__ask-when">
                    {timeOf(ask.at, report.timeZone, week)}
                  </span>
                  <span className="fm-recap__ask-text">{askLine(ask)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card label="What needed a grown-up">
        <CardHeader
          icon={ShieldCheck}
          tone={lines.length === 0 ? "green" : "orange"}
          title="What needed a grown-up"
          subtitle={lines.length === 0 ? `Nothing needed a grown-up ${span}.` : undefined}
        />
        {lines.length > 0 ? (
          <CardBody>
            <ul className="fm-recap__lines">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </CardBody>
        ) : null}
      </Card>

      <p className="fm-recap__privacy">
        Made on this Mac from what SKYCOT keeps here. Nothing is emailed or uploaded; print it or
        save it as a PDF if you'd like a copy.
      </p>

      {openIt.sheet}
    </div>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
}: {
  readonly icon: typeof Clock;
  readonly value: string;
  readonly label: string;
}) {
  return (
    <div className="fm-recap__stat" role="listitem">
      <Icon size={16} strokeWidth={1.9} aria-hidden />
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function WeekBars({ report }: { readonly report: RecapReport }) {
  const bars = weekBars(report.days);
  return (
    <div
      className="fm-recap__week"
      role="img"
      aria-label={bars.map((bar) => `${bar.label} ${minutesPhrase(bar.minutes)}`).join(", ")}
    >
      {bars.map((bar) => (
        <div key={bar.date} className="fm-recap__bar">
          <span className="fm-recap__bar-value">{bar.minutes > 0 ? `${bar.minutes}m` : ""}</span>
          <span className="fm-recap__bar-track">
            {bar.minutes > 0 ? (
              <span
                className="fm-recap__bar-fill"
                style={{ height: `${Math.max(6, Math.round(bar.share * 100))}%` }}
              />
            ) : null}
          </span>
          <span className="fm-recap__bar-label">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}
