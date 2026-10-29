// "How shall we build it?": the first time a child taps a starter card they see three big taped
// cards (Pictures, Words, Builder), each with a tiny preview of how it feels. Their pick is
// remembered. "Change how I build" in every level's header opens this again. The age band's
// level wears a "Good start" tape until the child has chosen; after that their own pick says
// "Your pick".
import { Sheet } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { BUILD_HELP_INFO, type BuildHelp } from "./buildHelp";
import { SamArt, TypeMyselfLink } from "./BuildHelpParts";

function Preview({ level }: { readonly level: BuildHelp }) {
  if (level === "pictures") {
    return (
      <div className="fm-bh__preview fm-bh__preview--pictures" aria-hidden>
        {["⭐", "🧩", "🐍", "🏎️"].map((art) => (
          <span key={art}>{art}</span>
        ))}
      </div>
    );
  }
  if (level === "words") {
    return (
      <div className="fm-bh__preview fm-bh__preview--words" aria-hidden>
        <span data-on>catch the stars</span>
        <span data-on>in space</span>
        <span>a maze</span>
        <span>snake</span>
      </div>
    );
  }
  return (
    <div className="fm-bh__preview fm-bh__preview--builder" aria-hidden>
      <span data-on>Score</span>
      <span data-on>Levels</span>
      <span>Timer</span>
    </div>
  );
}

export function ChooserSheet({
  crewName,
  stored,
  suggested,
  onPick,
  onTypeMyself,
  onClose,
}: {
  readonly crewName: string;
  /** What the child already chose, or null the first time. */
  readonly stored: BuildHelp | null;
  /** The level the age band suggests. */
  readonly suggested: BuildHelp;
  readonly onPick: (level: BuildHelp) => void;
  readonly onTypeMyself: () => void;
  readonly onClose: () => void;
}) {
  const marked = stored ?? suggested;
  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title="How shall we build it?"
      description="Pick the way you like best. You can change your mind any time."
      art={<SamArt />}
      initialFocus="title"
      actions={
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="fm-bh" data-screen="chooser">
        <ul className="fm-bh__paths">
          {BUILD_HELP_INFO.map((info) => (
            <li key={info.level}>
              <button
                type="button"
                className="fm-bh__path"
                data-level={info.level}
                data-marked={marked === info.level ? "" : undefined}
                aria-label={`${info.name}. ${info.blurb}`}
                onClick={() => onPick(info.level)}
              >
                {marked === info.level ? (
                  <span className="fm-bh__stamp">
                    {stored === null ? "Good start" : "Your pick"}
                  </span>
                ) : null}
                <Preview level={info.level} />
                <span className="fm-bh__path-name">{info.name}</span>
                <span className="fm-bh__path-blurb">{info.blurb}</span>
                <span className="fm-bh__path-go" aria-hidden>
                  Pick this →
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="fm-bh__remember">{crewName} will remember your pick.</p>
        <TypeMyselfLink onClick={onTypeMyself} />
      </div>
    </Sheet>
  );
}
