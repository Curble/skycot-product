// The starter cards on Home and in an empty conversation. A tap fills the message box with
// the card's prompt (editable before sending, first blank selected); nothing is sent until
// the person presses Send. Workshop draws them as taped-on sticky notes; calm themes get
// plain cards.
import {
  BookOpen,
  Brush,
  Cake,
  CircleHelp,
  Clock,
  Gamepad2,
  Gift,
  Images,
  Info,
  Laugh,
  Mail,
  PawPrint,
  Smartphone,
  SpellCheck,
  Tag,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import { useCrew } from "../../themes/useCrew";
import { useFamily } from "../family/FamilyProvider";
import { starterPrompt, startersFor, type Starter, type StarterIcon } from "./starters";

const ICONS: Record<StarterIcon, LucideIcon> = {
  game: Gamepad2,
  pet: PawPrint,
  cake: Cake,
  school: BookOpen,
  comic: Laugh,
  quiz: CircleHelp,
  draw: Brush,
  surprise: Gift,
  form: Mail,
  price: Tag,
  typo: SpellCheck,
  hours: Clock,
  phone: Smartphone,
  gallery: Images,
  about: Info,
  polish: WandSparkles,
};

/** What a tap hands the composer: a fresh object per tap, so the same card twice refills. */
export interface ComposerSeed {
  readonly text: string;
  readonly starterId: string;
  readonly wantsPicture: boolean;
}

export function seedFor(starter: Starter): ComposerSeed {
  return {
    text: starterPrompt(starter),
    starterId: starter.id,
    wantsPicture: starter.kind === "picture",
  };
}

export function useStarters(): {
  readonly starters: ReadonlyArray<Starter>;
  readonly kids: boolean;
} {
  const family = useFamily();
  const crew = useCrew();
  const starters = startersFor({ family: family.enabled, playful: crew.playful });
  return { starters, kids: starters[0]?.audience === "kids" };
}

export function StarterCards({
  onPick,
  disabled = false,
  compact = false,
}: {
  readonly onPick: (starter: Starter) => void;
  readonly disabled?: boolean;
  /** Inside an empty conversation: no heading art, smaller cards. */
  readonly compact?: boolean;
}) {
  const { starters, kids } = useStarters();
  const crew = useCrew();
  const headingId = compact ? "fm-starters-title-compact" : "fm-starters-title";
  return (
    <section
      className={`fm-starters${compact ? " fm-starters--compact" : ""}`}
      aria-labelledby={headingId}
    >
      <div className="fm-starters__head">
        <div>
          <h3 id={headingId} className="fm-starters__title">
            {kids ? "What shall we make?" : "Start with an idea"}
          </h3>
          <p className="fm-starters__sub">
            {kids
              ? `Tap a card, change the words if you like, then press Send. ${crew.builder.name} builds it right here, no internet needed.`
              : "Tap one to fill in the message. You can change every word before it's sent."}
          </p>
        </div>
      </div>
      <ul className="fm-starters__grid">
        {starters.map((starter) => {
          const Icon = ICONS[starter.icon];
          return (
            <li key={starter.id} className="fm-starters__item">
              <button
                type="button"
                className="fm-starter"
                data-tone={starter.tone}
                data-kind={starter.kind}
                disabled={disabled}
                onClick={() => onPick(starter)}
              >
                <span className="fm-starter__art" aria-hidden>
                  <Icon size={compact ? 20 : 24} strokeWidth={2} />
                </span>
                <span className="fm-starter__text">
                  <span className="fm-starter__title">{starter.title}</span>
                  <span className="fm-starter__blurb">{starter.blurb}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
