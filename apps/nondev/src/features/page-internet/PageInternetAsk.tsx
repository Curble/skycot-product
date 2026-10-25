// "This page wants to use the internet": shown above a child's page while the Family profile is
// on and the page tried an internet site no grown-up allowed yet (the engine's page rules stop
// it: packages/skycot-rules/src/pageInternet.ts). A grown-up says yes once for that
// page with the parent code; the engine keeps it, and only pictures, sounds, fonts and data from
// those sites come in (never scripts). "Not now" only hides the card: the page stays offline.
import { Globe } from "lucide-react";
import { useState } from "react";

import { useChildView } from "../../app/useChildView";
import { Button } from "../../ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../ui/Card";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import { allowPageInternet } from "../family/store";

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
  page,
  sites,
  onAllowed,
}: {
  /** The page's path on the Mac (the engine checks it). */
  readonly page: string;
  readonly sites: ReadonlyArray<string>;
  /** After the engine kept the yes: reload the page so the sites come in. */
  readonly onAllowed: () => void;
}) {
  const childView = useChildView();
  const [step, setStep] = useState<"ask" | "code" | "hidden">("ask");
  const entry = useParentCodeEntry(
    (code) => allowPageInternet(page, sites, code),
    () => {
      setStep("hidden");
      onAllowed();
    },
  );
  if (step === "hidden") return null;
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
          {step === "ask" ? (
            <p className="fm-preview__card-text">
              {childView
                ? `It wants to get things from ${named}. A grown-up says yes once for this page.`
                : `${pageName(page)} wants to get things from ${named}. It stays offline until a grown-up says yes, once for this page.`}
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
              <Button variant="primary" onClick={() => setStep("code")}>
                {childView ? "Get a grown-up" : "Allow…"}
              </Button>
            </>
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
