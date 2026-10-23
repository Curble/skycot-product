// "Allow Cursor for the Family profile?": the two points a grown-up reads first (the
// assistant's own age rules, and the add-ons SKYCOT can't switch off), then the parent code.
// The engine checks the code (same five tries as every prompt) and keeps the allowance; this
// sheet only shows its answer. Opened from the chat's refusal card and from Settings › Family.
import { ExternalLink, ShieldQuestion, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { allowSheetCopy } from "./assistantAllowance";
import { ParentCodeEntry, useParentCodeEntry } from "./ParentCodeEntry";
import { allowAssistant } from "./store";

export function AllowAssistantSheet({
  driver,
  onClose,
  onAllowed,
}: {
  readonly driver: string;
  readonly onClose: () => void;
  /** After the engine kept the allowance; the sheet closes itself. */
  readonly onAllowed?: () => void;
}) {
  const copy = allowSheetCopy(driver);
  const [step, setStep] = useState<"read" | "code">("read");
  // Cancel comes first and holds the focus, so Return never allows anything by accident. The
  // sheet focuses itself on open (its own effect runs first), then this moves it to Cancel.
  useEffect(() => {
    if (step !== "read") return;
    document.querySelector<HTMLElement>("[data-allow-assistant-cancel]")?.focus();
  }, [step]);
  const entry = useParentCodeEntry(
    (code) => allowAssistant(driver, code),
    () => {
      onAllowed?.();
      onClose();
    },
  );
  return (
    <Sheet
      open
      onClose={onClose}
      icon={step === "read" ? ShieldQuestion : Users}
      iconTone="grey"
      title={copy.title}
      description={step === "read" ? copy.description : copy.codeHelp}
      sober
      dismissOnBackdrop={false}
      actions={
        step === "read" ? (
          <>
            <Button onClick={onClose} data-allow-assistant-cancel="">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setStep("code")}>
              Continue…
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={entry.busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!entry.canSubmit}
              onClick={() => void entry.submit()}
            >
              {entry.busy ? "Checking…" : copy.confirm}
            </Button>
          </>
        )
      }
    >
      {step === "read" ? (
        <ol className="fm-allow-points">
          <li>
            <h3>{copy.ageTitle}</h3>
            <p>{copy.age.sentence}</p>
            {copy.age.link ? (
              <a
                className="fm-allow-points__link"
                href={copy.age.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.linkLabel}
                <ExternalLink size={12} strokeWidth={1.8} aria-hidden />
              </a>
            ) : null}
          </li>
          <li>
            <h3>{copy.addOnsTitle}</h3>
            <p>{copy.addOns}</p>
            <p className="fm-allow-points__still">{copy.stillApplies}</p>
          </li>
        </ol>
      ) : (
        <ParentCodeEntry entry={entry} autoFocus />
      )}
    </Sheet>
  );
}
