// Settings › Family › "<child>'s week": the weekly recap (or today's), behind the parent code,
// with "Print or save as PDF". The browser's own print dialog makes the PDF; SKYCOT never
// emails or uploads it.
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronLeft, KeyRound, Printer } from "lucide-react";
import { useState } from "react";

import { HOME_HREF, navigate, settingsHref } from "../../router";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { childLabel } from "../family/children";
import { useFamily } from "../family/FamilyProvider";
import type { RecapRange } from "./recap";
import { RecapReportView } from "./RecapReportView";
import { useRecap } from "./useRecap";

export function RecapScreen({
  childId,
  environmentId,
}: {
  readonly childId: string;
  readonly environmentId: EnvironmentId | null;
}) {
  const family = useFamily();
  const [range, setRange] = useState<RecapRange>("week");
  const index = family.profile.children.findIndex((child) => child.id === childId);
  const child = index < 0 ? null : family.profile.children[index]!;
  const name = child === null ? "This child" : childLabel(child, index);
  const { state, retry } = useRecap(child === null || !family.enabled ? null : childId, range);

  return (
    <section className="fm-settings__detail fm-recap-screen" aria-labelledby="fm-settings-title">
      <header className="fm-settings__header">
        <Button
          variant="plain"
          size="sm"
          icon={ChevronLeft}
          onClick={() => navigate(settingsHref("family"))}
        >
          Family
        </Button>
        <h2 id="fm-settings-title" className="fm-settings__title">
          {name}'s week
        </h2>
        <span className="fm-settings__header-spacer" />
        <Button
          size="sm"
          icon={Printer}
          disabled={state.kind !== "ready"}
          onClick={() => window.print()}
        >
          Print or save as PDF
        </Button>
        <Button variant="primary" size="sm" onClick={() => navigate(HOME_HREF)}>
          Done
        </Button>
      </header>
      <div className="fm-settings__panes">
        {child === null || !family.enabled ? (
          <EmptyState title="No one to show">
            This recap is for a child in the Family profile.
          </EmptyState>
        ) : (
          <>
            <div className="fm-recap__range">
              <SegmentedControl
                label="Which recap"
                size="sm"
                value={range}
                onChange={setRange}
                options={[
                  { value: "week", label: "This week" },
                  { value: "session", label: "Today" },
                ]}
              />
            </div>
            {state.kind === "loading" ? (
              <p className="fm-help">Putting {name}'s recap together…</p>
            ) : state.kind === "locked" ? (
              <EmptyState
                icon={KeyRound}
                title="For grown-ups"
                action={<Button onClick={retry}>Enter parent code…</Button>}
              >
                The recap shows what {name} made, asked for and needed help with, so it opens with
                the parent code.
              </EmptyState>
            ) : state.kind === "failed" ? (
              <Banner
                tone="warning"
                action={
                  <Button size="sm" onClick={retry}>
                    Try again
                  </Button>
                }
              >
                {state.message}
              </Banner>
            ) : (
              <RecapReportView
                report={state.report}
                child={child}
                name={name}
                environmentId={environmentId}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
