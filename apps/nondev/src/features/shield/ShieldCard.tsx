// The Workshop card the shield shows above the reply field: what looked private, the
// one-tap nickname rewrite, and the grown-up's way to send it as typed. Nothing is sent until
// the child picks; "Change it myself" goes back to the field with the words still there.
import { ImageOff, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { CrewAvatar } from "../../themes/CrewAvatar";
import { useCrew } from "../../themes/useCrew";
import { useChildView } from "../../app/useChildView";
import { Button } from "../../ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../ui/Card";
import { Mascot } from "../brand/Mascot";
import {
  rewriteSegments,
  segmentsOf,
  shieldCopy,
  shieldSentence,
  type ShieldFinding,
} from "./shield";
import "./shield.css";

const CATEGORY_LABEL: Record<string, string> = {
  "full-name": "full name",
  school: "school",
  address: "where you live",
  phone: "phone",
  email: "email",
  birthday: "birthday",
  login: "secret",
};

export type ShieldChoice =
  | { readonly kind: "nicknames"; readonly text: string }
  | { readonly kind: "as-typed" }
  | { readonly kind: "edit"; readonly dropPictures: boolean };

export function ShieldCard({
  finding,
  busy = false,
  onChoose,
  onAskGrownUp,
  pictureNotice,
}: {
  readonly finding: ShieldFinding;
  readonly busy?: boolean;
  readonly onChoose: (choice: ShieldChoice) => void;
  /** Resolves true once a grown-up's parent code allowed this message as typed. */
  readonly onAskGrownUp: () => Promise<boolean>;
  readonly pictureNotice?: string;
}) {
  const crew = useCrew();
  const childView = useChildView();
  // Words first; pictures get their own question once the words are settled.
  const [nicknamed, setNicknamed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const wordsStep = finding.details.length > 0 && nicknamed === null;
  const askGrownUp = async () => {
    setAsking(true);
    const ok = await onAskGrownUp();
    setAsking(false);
    if (ok) onChoose({ kind: "as-typed" });
  };
  const disabled = busy || asking;

  return (
    <div className="fm-shield" role="group" aria-label="Before this is sent">
      <p className="fm-crew-kicker">
        {crew.named ? <CrewAvatar role="checker" size="sm" /> : null}
        {childView
          ? "Sam spotted something private"
          : crew.named
            ? `${crew.checker.name} spotted something private`
            : "Something private"}
      </p>
      <Card label={wordsStep ? shieldCopy.title : shieldCopy.photoTitle}>
        <CardHeader
          icon={wordsStep ? ShieldCheck : ImageOff}
          tone="orange"
          title={wordsStep ? shieldCopy.title : shieldCopy.photoTitle}
          subtitle={wordsStep ? shieldSentence(finding) : undefined}
          trailing={<Mascot pose="thinking" size={44} decorative />}
        />
        <CardBody>
          {wordsStep ? (
            <>
              <p className="fm-shield__line">
                <span className="fm-shield__label">You wrote</span>
                <span className="fm-shield__text">
                  {segmentsOf(finding.text, finding.details).map((segment) =>
                    segment.detail ? (
                      <mark key={segment.start} className="fm-shield__caught">
                        {segment.text}
                        <span className="fm-shield__tag">
                          {CATEGORY_LABEL[segment.detail.category] ?? "private"}
                        </span>
                      </mark>
                    ) : (
                      <span key={segment.start}>{segment.text}</span>
                    ),
                  )}
                </span>
              </p>
              <p className="fm-shield__line">
                <span className="fm-shield__label">Try this</span>
                <span className="fm-shield__text">
                  {rewriteSegments(finding.text, finding.details).map((segment) =>
                    segment.detail ? (
                      <mark key={segment.start} className="fm-shield__nickname">
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={segment.start}>{segment.text}</span>
                    ),
                  )}
                </span>
              </p>
              <p className="fm-shield__why">{shieldCopy.whyPrivate}</p>
            </>
          ) : (
            <>
              <p className="fm-shield__why">{shieldCopy.photoQuestion}</p>
              {pictureNotice ? <p className="fm-shield__why">{pictureNotice}</p> : null}
            </>
          )}
        </CardBody>
        <CardFooter>
          <div className="fm-shield__actions">
            {wordsStep ? (
              <>
                <Button
                  variant="primary"
                  disabled={disabled}
                  onClick={() => {
                    if (finding.hasPictures) setNicknamed(finding.rewrite);
                    else onChoose({ kind: "nicknames", text: finding.rewrite ?? finding.text });
                  }}
                >
                  {shieldCopy.sendNicknames}
                </Button>
                <Button
                  disabled={disabled}
                  onClick={() => onChoose({ kind: "edit", dropPictures: false })}
                >
                  {shieldCopy.editMyself}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  disabled={disabled}
                  onClick={() =>
                    onChoose(
                      nicknamed === null
                        ? { kind: "as-typed" }
                        : { kind: "nicknames", text: nicknamed },
                    )
                  }
                >
                  {shieldCopy.noFaces}
                </Button>
                <Button
                  disabled={disabled}
                  onClick={() => onChoose({ kind: "edit", dropPictures: true })}
                >
                  {shieldCopy.removePictures}
                </Button>
              </>
            )}
            <span className="fm-shield__grow" />
            <Button variant="quiet" disabled={disabled} onClick={() => void askGrownUp()}>
              {asking ? "Waiting for a grown-up…" : shieldCopy.askGrownUp}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
