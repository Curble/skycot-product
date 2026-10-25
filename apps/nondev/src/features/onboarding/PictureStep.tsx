// First-run "Pick a picture": right after the Family profile is on, the child (and the grown-up
// setting it up) choose the picture they'll tap on "Who's using SKYCOT?". Drawn characters only
// for children, to keep them private. Saved straight away; Settings › Family changes it later.
import { useState } from "react";

import { AVATAR_CHARACTERS, CHARACTER_NAMES } from "../family/characters";
import { ChildAvatar } from "../family/ChildAvatar";
import type { ChildAvatar as Avatar } from "../family/children";
import type { FamilyResult } from "../family/family";
import { useFamily } from "../family/FamilyProvider";
import { updateChild, updateGrownUp } from "../family/store";
import { TextField } from "../../ui/TextField";

function PictureRow({
  title,
  name,
  avatar,
  onPick,
  onName,
}: {
  readonly title: string;
  readonly name: string;
  readonly avatar: Avatar;
  readonly onPick: (avatar: Avatar) => void;
  /** The grown-up's own row: a box for what the family calls them ("Mum", "Dad", "Nan"). */
  readonly onName?: (name: string) => void;
}) {
  const [draftName, setDraftName] = useState(onName ? "" : name);
  const shownName = onName ? draftName.trim() || name : name;
  return (
    <section className="fm-picture-step__row" aria-label={title}>
      <div className="fm-picture-step__tag" aria-hidden>
        <span className="fm-picker__tag-hello">
          HELLO <small>my name is</small>
        </span>
        <ChildAvatar child={{ avatar, name: shownName }} size={88} />
        <span className="fm-picture-step__name">{shownName}</span>
      </div>
      <div>
        <h3 className="fm-picture-step__title">{title}</h3>
        {onName ? (
          <div className="fm-picture-step__name-field">
            <TextField
              label="What does the family call you?"
              placeholder="Mum, Dad, Nan…"
              autoComplete="off"
              maxLength={40}
              value={draftName}
              onChange={(event) => setDraftName(event.currentTarget.value)}
              onBlur={() => {
                if (draftName.trim() !== "") onName(draftName.trim());
              }}
            />
          </div>
        ) : null}
        <div className="fm-picture-step__grid" role="radiogroup" aria-label={title}>
          {AVATAR_CHARACTERS.map((id) => {
            const chosen = avatar.kind === "character" && avatar.id === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={CHARACTER_NAMES[id]}
                className={`fm-picture-step__choice${chosen ? " fm-picture-step__choice--chosen" : ""}`}
                onClick={() => onPick({ kind: "character", id })}
              >
                <ChildAvatar child={{ avatar: { kind: "character", id }, name }} size={48} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function PictureStep() {
  const family = useFamily();
  const child = family.profile.children[0] ?? null;
  const grownUp = family.profile.grownUps[0] ?? null;
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (work: Promise<FamilyResult<unknown>>) => {
    const result = await work;
    setProblem(result.ok ? null : result.message);
  };
  return (
    <div className="fm-picture-step">
      <p className="fm-help">Change these any time in Settings › Family.</p>
      {child ? (
        <PictureRow
          title={`${child.name ?? "Your child"}'s picture`}
          name={child.name ?? "Me"}
          avatar={child.avatar}
          onPick={(avatar) => void save(updateChild(child.id, { avatar }))}
        />
      ) : null}
      {grownUp ? (
        <PictureRow
          title="Your picture"
          name={grownUp.name ?? "Grown-up"}
          avatar={grownUp.avatar}
          onPick={(avatar) => void save(updateGrownUp(grownUp.id, { avatar }))}
          onName={(name) => void save(updateGrownUp(grownUp.id, { name }))}
        />
      ) : null}
      {problem ? (
        <p className="fm-help" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
