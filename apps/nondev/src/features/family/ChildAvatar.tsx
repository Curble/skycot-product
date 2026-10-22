// A child's picture: the mascot in a pose they picked, or their first letter on a colour.
// Artwork, so themes never restyle it; the colour swatches are tuned for light and dark.
import { Mascot } from "../brand/Mascot";
import { avatarLetter, type FamilyChild } from "./children";

export function ChildAvatar({
  child,
  size = 48,
  decorative = true,
}: {
  readonly child: Pick<FamilyChild, "avatar" | "name">;
  readonly size?: number;
  /** The name is almost always printed beside it. */
  readonly decorative?: boolean;
}) {
  if (child.avatar.kind === "mascot") {
    return (
      <span
        className="fm-child-avatar fm-child-avatar--mascot"
        style={{ width: size, height: size }}
      >
        <Mascot pose={child.avatar.pose} size={size} decorative={decorative} />
      </span>
    );
  }
  return (
    <span
      className={`fm-child-avatar fm-child-avatar--${child.avatar.color}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": child.name ?? "Child" })}
    >
      {avatarLetter(child)}
    </span>
  );
}
