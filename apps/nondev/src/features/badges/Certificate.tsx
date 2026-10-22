// The printable certificate: "My first app" (or "My 10th creation"), landscape, for A4 or Letter.
// Made here in the browser from what the sticker book already knows; nothing is uploaded and
// there is no link or code on the paper, only the child's first name, what they made, the date,
// and SKYCOT, Sam and Mo signing it. Children may print it: printing is harmless.
//
// On screen it is a preview with "Print or save as PDF". The paper copy is a second render
// portalled to <body>, so print styles can hide the whole app (badges.css, @media print).
import { useAtomValue } from "@effect/atom-react";
import type { EarnedBadge } from "@t3tools/skycot-rules/badges";
import { ChevronLeft, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import mascotYay from "../../assets/brand/mascot-yay-day.svg";
import { STICKERS_HREF, navigate } from "../../router";
import { conversationRowsAtom } from "../../state/conversations";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Mascot } from "../brand/Mascot";
import { useFamily } from "../family/FamilyProvider";
import { firstName } from "./catalog";
import { Mo, Sam } from "./stickers/parts";
import { Sticker } from "./stickers/Sticker";
import { useBadges } from "./store";

export type CertificateKind = "first" | "tenth";

const TITLE_MAX = 60;

function clampTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length <= TITLE_MAX ? clean : `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

function longDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(at);
}

export interface CertificateFacts {
  readonly kind: CertificateKind;
  /** First name only; null leaves a line to write it on. */
  readonly name: string | null;
  readonly work: string | null;
  readonly at: number;
}

/** The creation's title as the conversation list shows it now, else as it was when made. */
function useWorkTitle(earned: EarnedBadge | null): string | null {
  const rows = useAtomValue(conversationRowsAtom);
  if (earned === null) return null;
  const live =
    earned.threadId === null
      ? undefined
      : rows.find((row) => row.shell.id === earned.threadId)?.title;
  const title = live ?? earned.title;
  return title ? clampTitle(title) : null;
}

export function CertificateScreen({ kind }: { readonly kind: CertificateKind }) {
  const family = useFamily();
  const { book, status } = useBadges();
  const earned =
    book?.badges.find((badge) => badge.id === (kind === "first" ? "first-creation" : "ten"))
      ?.earned ?? null;
  const work = useWorkTitle(earned);
  const name = family.enabled ? firstName(family.profile.childName) : null;

  if (earned === null) {
    return (
      <div className="fm-cert-page">
        <EmptyState
          art={<Mascot pose="thinking" size={72} />}
          title={status === "loading" ? "Finding your certificate…" : "Not yet!"}
        >
          {status === "loading"
            ? null
            : kind === "first"
              ? "Your certificate is ready as soon as you make your first thing with SKYCOT."
              : "This one arrives with your tenth creation."}
        </EmptyState>
        <div className="fm-cert-page__bar">
          <Button icon={ChevronLeft} onClick={() => navigate(STICKERS_HREF)}>
            Sticker book
          </Button>
        </div>
      </div>
    );
  }

  const facts: CertificateFacts = { kind, name, work, at: earned.at };
  return (
    <div className="fm-cert-page">
      <div className="fm-cert-page__bar">
        <Button icon={ChevronLeft} onClick={() => navigate(STICKERS_HREF)}>
          Sticker book
        </Button>
        <span className="fm-cert-page__hint">Landscape, on A4 or Letter paper.</span>
        <Button variant="primary" icon={Printer} onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>
      <div className="fm-cert-page__preview">
        <Certificate facts={facts} />
      </div>
      {createPortal(
        <div className="fm-cert-print" aria-hidden>
          <Certificate facts={facts} />
        </div>,
        document.body,
      )}
    </div>
  );
}

export function Certificate({ facts }: { readonly facts: CertificateFacts }) {
  const first = facts.kind === "first";
  return (
    <article
      className="fm-cert"
      aria-label={first ? "My first app certificate" : "My 10th creation certificate"}
    >
      <div className="fm-cert__paper">
        <span className="fm-cert__sticker fm-cert__sticker--a" aria-hidden>
          <Sticker id={first ? "first-creation" : "ten"} size={120} />
        </span>
        <span className="fm-cert__sticker fm-cert__sticker--b" aria-hidden>
          <Sticker id={first ? "explorer" : "five"} size={84} />
        </span>
        <img className="fm-cert__mascot" src={mascotYay} alt="" />

        <p className="fm-cert__kicker">Certificate</p>
        <h1 className="fm-cert__title">{first ? "My first app" : "My 10th creation"}</h1>

        <p className="fm-cert__lead">This is to say that</p>
        <p className={`fm-cert__name${facts.name ? "" : " fm-cert__name--blank"}`}>
          {facts.name ?? "write your name here"}
        </p>
        <p className="fm-cert__lead">
          {first ? "made their very first app," : "made their tenth creation,"}
        </p>
        <p className="fm-cert__work">
          {facts.work ? `“${facts.work}”` : "a thing all of their own"}
        </p>
        <p className="fm-cert__date">with SKYCOT on {longDate(facts.at)}</p>

        <div className="fm-cert__signatures">
          <Signature name="SKYCOT" role="your cloud">
            <img src={mascotYay} alt="" width={64} height={64} />
          </Signature>
          <Signature name="Sam" role="builds things">
            <svg viewBox="0 0 64 64" width={56} height={56} aria-hidden>
              <Sam x={32} y={33} size={50} />
            </svg>
          </Signature>
          <Signature name="Mo" role="checks things">
            <svg viewBox="0 0 64 64" width={56} height={56} aria-hidden>
              <Mo x={32} y={34} size={50} />
            </svg>
          </Signature>
        </div>

        <p className="fm-cert__footer">Built with a grown-up's help</p>
      </div>
    </article>
  );
}

function Signature({
  name,
  role,
  children,
}: {
  readonly name: string;
  readonly role: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="fm-cert__sig">
      <span className="fm-cert__sig-face">{children}</span>
      <span className="fm-cert__sig-name">{name}</span>
      <span className="fm-cert__sig-line" />
      <span className="fm-cert__sig-role">
        {name}, {role}
      </span>
    </div>
  );
}
