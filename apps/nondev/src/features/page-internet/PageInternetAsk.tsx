// "This page wants to use the internet": shown above a child's page while the Family profile is
// on and the page tried an internet site no grown-up allowed yet (the engine's page rules stop
// it: packages/skycot-rules/src/pageInternet.ts). A grown-up says yes once for that
// page with the parent code; the engine keeps it, and only pictures, sounds, fonts and data from
// those sites come in (never scripts). "Not now" only hides the card: the page stays offline.
import { Globe } from "lucide-react";
import { useEffect, useState } from "react";

import { useGrownUpAnswers } from "../conversation/useGrownUpAnswers";
import { useChildView } from "../../app/useChildView";
import { useFamily } from "../family/FamilyProvider";
import { Button } from "../../ui/Button";
import { Banner } from "../../ui/Banner";
import { Card, CardBody, CardFooter, CardHeader } from "../../ui/Card";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import { allowPageInternet, askPageInternet, refreshFamily } from "../family/store";
import { grownUpAnswerLabel } from "../../plain/grownUpAnswers";

/** "dog.ceo", "dog.ceo and cataas.com", "a.org, b.org and c.org". */
export function sitesSentence(sites: ReadonlyArray<string>): string {
  if (sites.length <= 1) return sites[0] ?? "";
  return `${sites.slice(0, -1).join(", ")} and ${sites.at(-1)}`;
}

/** The page's own file name, for the grown-up ("dog.html"). */
export function pageName(page: string): string {
  return page.split("/").at(-1) ?? page;
}

export function PageInternetAsk({
  threadId,
  page,
  sites,
  onAllowed,
}: {
  readonly threadId: string;
  /** The page's path on the Mac (the engine checks it). */
  readonly page: string;
  readonly sites: ReadonlyArray<string>;
  /** After the engine kept the yes: reload the page so the sites come in. */
  readonly onAllowed: () => void;
}) {
  const childView = useChildView();
  const family = useFamily();
  const [step, setStep] = useState<"ask" | "code" | "waiting" | "hidden">("ask");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [answerText, setAnswerText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const answers = useGrownUpAnswers(
    threadId,
    `${requestId ?? ""}:${refreshKey}`,
    requestId !== null,
  );
  const entry = useParentCodeEntry(
    (code) => allowPageInternet(page, sites, code),
    () => {
      setStep("hidden");
      onAllowed();
    },
  );
  useEffect(() => {
    if (requestId === null) return;
    const timer = window.setInterval(() => setRefreshKey((value) => value + 1), 1_500);
    const expiry = window.setTimeout(
      () => {
        setRequestId(null);
        setStep("ask");
        setAnswerText("The ask expired. You can ask again.");
      },
      Math.max(0, (expiresAt ?? Date.now()) - Date.now()),
    );
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(expiry);
    };
  }, [expiresAt, requestId]);
  useEffect(() => {
    if (requestId === null) return;
    const answer = answers.get(requestId);
    if (answer === undefined) return;
    setAnswerText(grownUpAnswerLabel(answer));
    setRequestId(null);
    if (answer.decision === "accept") {
      setStep("hidden");
      void refreshFamily().finally(onAllowed);
    } else {
      setStep("hidden");
    }
  }, [answers, onAllowed, requestId]);
  const ask = async () => {
    setBusy(true);
    setAnswerText(null);
    const result = await askPageInternet({ threadId, page, sites });
    setBusy(false);
    if (!result.ok) {
      setAnswerText(result.message);
      return;
    }
    setRequestId(result.value.id);
    setExpiresAt(result.value.expiresAt);
    setStep("waiting");
  };
  if (step === "hidden") {
    return answerText === null ? null : (
      <div className="fm-preview__notice">
        <Banner tone="info">{answerText}</Banner>
      </div>
    );
  }
  const named = sitesSentence(sites);
  return (
    <div className="fm-preview__card fm-page-internet" role="region" aria-label="Internet">
      <Card>
        <CardHeader
          icon={Globe}
          tone="orange"
          title={
            step === "code"
              ? "Let this page use the internet?"
              : "This page wants to use the internet"
          }
          subtitle="Family profile"
        />
        <CardBody>
          {answerText !== null ? <Banner tone="info">{answerText}</Banner> : null}
          {step === "ask" ? (
            <p className="fm-preview__card-text">
              {childView
                ? `It wants to get things from ${named}. A grown-up says yes once for this page.`
                : `${pageName(page)} wants to get things from ${named}. It stays offline until a grown-up says yes, once for this page.`}
            </p>
          ) : step === "waiting" ? (
            <p className="fm-preview__card-text">
              {`We've let ${
                family.profile.grownUps
                  .map((grownUp) => grownUp.name)
                  .filter(Boolean)
                  .join(" and ") || "your grown-ups"
              } know. The parent code stays on this device while they decide.`}
            </p>
          ) : (
            <>
              <p className="fm-preview__card-text">
                {`${pageName(page)} may then load pictures, sounds, fonts and data from ${named}, over a secure connection. Scripts never come from the internet. Take it back any time in Settings › Family.`}
              </p>
              <div data-sober="">
                <ParentCodeEntry entry={entry} autoFocus />
              </div>
            </>
          )}
        </CardBody>
        <CardFooter>
          {step === "ask" ? (
            <>
              <Button onClick={() => setStep("hidden")}>Not now</Button>
              <Button
                variant="primary"
                onClick={() => (childView ? void ask() : setStep("code"))}
                disabled={busy}
              >
                {busy ? "Asking…" : childView ? "Get a grown-up" : "Allow…"}
              </Button>
            </>
          ) : step === "waiting" ? (
            <p className="fm-preview__card-text">Waiting for an answer.</p>
          ) : (
            <>
              <Button onClick={() => setStep("ask")} disabled={entry.busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!entry.canSubmit}
                onClick={() => void entry.submit()}
              >
                {entry.busy ? "Checking…" : "Allow for this page"}
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
