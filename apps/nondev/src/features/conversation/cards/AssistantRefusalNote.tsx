// The chat's card when the engine refused to start an assistant SKYCOT can't lock down,
// because no grown-up has allowed it for the Family profile (SkycotFamilyLockdown). The child
// reads a friendly "ask a grown-up"; the grown-up gets one sentence and "Allow … for the Family
// profile…", which opens the allow sheet (its age rules, its add-ons, then the parent code).
// Once allowed, here or in Settings › Family, the card says to send the message again.
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { CircleCheck, HandHeart } from "lucide-react";
import { useState } from "react";

import { Mascot } from "../../brand/Mascot";
import { AllowAssistantSheet } from "../../family/AllowAssistantSheet";
import { assistantFamilyState, refusalCardCopy } from "../../family/assistantAllowance";
import { familyCopy } from "../../family/copy";
import { useFamily } from "../../family/FamilyProvider";
import { Banner } from "../../../ui/Banner";
import { Bubble } from "../../../ui/Bubble";
import { Button } from "../../../ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../../ui/Card";
import { Disclosure } from "./Disclosure";
import type { TimelineRenderContext } from "./registry";
import { shortTime } from "./time";

type ErrorItem = Extract<OrchestrationV2TurnItem, { type: "error" }>;

/** Which assistant the refused turn was for: the provider thread the error belongs to. */
export function refusedDriver(
  item: Pick<ErrorItem, "providerThreadId">,
  projection: Pick<TimelineRenderContext["projection"], "providerThreads"> | null | undefined,
): string | null {
  if (item.providerThreadId === null || projection == null) return null;
  const thread = projection.providerThreads.find(
    (candidate) => candidate.id === item.providerThreadId,
  );
  return thread === undefined ? null : String(thread.driver);
}

export function AssistantRefusalNote({
  item,
  context,
}: {
  readonly item: ErrorItem;
  readonly context: TimelineRenderContext;
}) {
  const family = useFamily();
  const [allowing, setAllowing] = useState(false);
  const driver = refusedDriver(item, context.projection);
  const copy = refusalCardCopy(driver);
  // Allowed since (here or in Settings), or the profile is off now: sending again works.
  const resolved =
    !family.enabled ||
    (driver !== null &&
      assistantFamilyState(driver, family.profile.allowedAssistants) !== "not-allowed");

  return (
    <Bubble author="crew" full meta={shortTime(item.updatedAt)}>
      {resolved ? null : (
        <p className="fm-mascot-kicker">
          <Mascot pose="ask-a-grown-up" size={40} decorative />
          {familyCopy.fetchGrownUp}
        </p>
      )}
      <div className="fm-approval" data-sober="">
        <Card label={resolved ? copy.allowedTitle : copy.title}>
          <CardHeader
            icon={resolved ? CircleCheck : HandHeart}
            tone={resolved ? "green" : "orange"}
            title={resolved ? copy.allowedTitle : copy.title}
            subtitle={resolved ? undefined : `${familyCopy.needsGrownUp} · waiting for a parent`}
          />
          <CardBody>
            <p className="fm-approval__what">{resolved ? copy.allowedBody : copy.body}</p>
            {resolved ? null : <Banner tone="info">{copy.grownUp}</Banner>}
            <Disclosure>
              <pre className="fm-details__pre">
                <code>{item.failure.message}</code>
              </pre>
            </Disclosure>
          </CardBody>
          {resolved || driver === null ? null : (
            <CardFooter>
              <div className="fm-approval__actions">
                <Button size="md" onClick={() => setAllowing(true)}>
                  {copy.allow}
                </Button>
              </div>
            </CardFooter>
          )}
        </Card>
      </div>
      {allowing && driver !== null ? (
        <AllowAssistantSheet driver={driver} onClose={() => setAllowing(false)} />
      ) : null}
    </Bubble>
  );
}
