import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as DateTime from "effect/DateTime";
import { Mail } from "lucide-react";
import { useMemo, useState } from "react";

import { APP_VERSION } from "~/branding";

import { PRODUCT_NAME } from "../../../brand";
import { useChildView } from "../../../app/useChildView";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../../ui/Button";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { Switch } from "../../../ui/Switch";
import { Disclosure } from "../../conversation/cards/Disclosure";
import { useFamily } from "../../family/FamilyProvider";
import { currentChild } from "../../family/family";
import {
  FEEDBACK_EMAIL,
  FEEDBACK_TYPES,
  MAX_LOG_LINES,
  buildReport,
  mailtoUrl,
  type FeedbackDetails,
  type FeedbackType,
} from "../../feedback/report";
import { CopyButton } from "../CopyButton";
import { SettingsGroup } from "../SettingsGroup";
import { helpCards } from "./helpCopy";

async function openLink(url: string): Promise<boolean> {
  if (window.desktopBridge) return (await window.desktopBridge.openExternal(url)) === true;
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}

/**
 * Settings › Help & feedback. Grown-ups only. Nothing here sends anything: "Send" opens the
 * Mac's Mail app with the message already written, and the grown-up presses Send there.
 */
export function HelpPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const childView = useChildView();
  const family = useFamily();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const diagnostics = useAtomValue(
    serverEnvironment.traceDiagnostics({ environmentId, input: {} }),
  );
  const [type, setType] = useState<FeedbackType>("broke");
  const [message, setMessage] = useState("");
  const [includeDetails, setIncludeDetails] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const logLines = useMemo(() => {
    if (!AsyncResult.isSuccess(diagnostics)) return [];
    return [...diagnostics.value.latestWarningAndErrorLogs]
      .sort((a, b) => DateTime.toEpochMillis(a.seenAt) - DateTime.toEpochMillis(b.seenAt))
      .slice(-MAX_LOG_LINES)
      .map((event) => `${event.level} ${event.spanName}: ${event.message}`);
  }, [diagnostics]);

  if (childView) return null;

  const child = currentChild(family.profile);
  const platform = config?.environment.platform;
  const details: FeedbackDetails = {
    appVersion: APP_VERSION,
    engineVersion: config?.environment.serverVersion ?? null,
    computer: platform
      ? `${platform.os === "darwin" ? "macOS" : platform.os} (${platform.arch})`
      : null,
    familyProfileOn: family.enabled,
    readingLevel: family.enabled ? (child?.readingLevel ?? null) : null,
    logLines,
  };
  const childNames = family.profile.children.flatMap((entry) => (entry.name ? [entry.name] : []));
  const report = buildReport({
    type,
    message,
    details: includeDetails ? details : null,
    childNames,
  });

  const send = async () => {
    const opened = await openLink(mailtoUrl(type, report)).catch(() => false);
    if (opened) {
      setNote("Your Mail app is open with the message ready. Press Send there when you're happy.");
      return;
    }
    await navigator.clipboard?.writeText(report).catch(() => undefined);
    setNote(
      `Mail wouldn't open, so the message is copied. Paste it into an email to ${FEEDBACK_EMAIL}.`,
    );
  };

  return (
    <>
      <SettingsGroup title="Help">
        <div className="fm-form" style={{ padding: "4px 14px 10px" }}>
          {helpCards.map((card) => (
            <Disclosure key={card.title} summary={card.title}>
              <p style={{ margin: 0 }}>{card.body}</p>
              {card.href ? (
                <p style={{ margin: "8px 0 0" }}>
                  <Button size="sm" onClick={() => void openLink(card.href!)}>
                    Read more on skycot.com
                  </Button>
                </p>
              ) : null}
            </Disclosure>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Send feedback"
        footer={`Nothing is sent by ${PRODUCT_NAME} itself. Sending opens your Mail app with this message ready; you press Send there. Your child never sees this page.`}
      >
        <div className="fm-form" style={{ padding: "12px 14px" }}>
          <SegmentedControl
            label="What kind of feedback is it?"
            value={type}
            onChange={setType}
            options={FEEDBACK_TYPES.map((entry) => ({ value: entry.id, label: entry.label }))}
          />
          <div>
            <label htmlFor="fm-feedback-text" className="fm-field-label">
              What happened, or what would help?
            </label>
            <textarea
              id="fm-feedback-text"
              className="fm-field fm-textarea"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.currentTarget.value)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Switch
              checked={includeDetails}
              onChange={setIncludeDetails}
              label="Include details"
              labelledBy="fm-feedback-details-label"
            />
            <span id="fm-feedback-details-label">
              Include details to help us fix it (your child's name is never included)
            </span>
          </div>
          <div>
            <p className="fm-field-label">This is exactly what will be sent</p>
            <pre
              aria-label="The message that will be sent"
              style={{
                margin: 0,
                padding: "10px 12px",
                whiteSpace: "pre-wrap",
                fontFamily: "var(--fm-mono)",
                fontSize: "calc(12px * var(--fm-text-scale))",
                lineHeight: 1.5,
                maxHeight: 260,
                overflow: "auto",
                background: "var(--fm-bg-soft, rgba(0, 0, 0, 0.04))",
                borderRadius: 10,
              }}
            >
              {report}
            </pre>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="primary"
              icon={Mail}
              disabled={message.trim().length === 0}
              onClick={() => void send()}
            >
              Open in Mail
            </Button>
            <CopyButton text={report} label="Copy instead" size="md" />
          </div>
          {note ? (
            <p role="status" className="fm-group__footer" style={{ margin: 0 }}>
              {note}
            </p>
          ) : null}
        </div>
      </SettingsGroup>
    </>
  );
}
