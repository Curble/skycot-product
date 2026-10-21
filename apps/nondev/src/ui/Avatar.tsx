import { Hammer, type LucideIcon } from "lucide-react";

export type AvatarSize = "sm" | "md" | "lg" | "xl";
export type AvatarKind = "initials" | "emoji" | "crew" | "person" | "icon" | "image";

interface AvatarProps {
  readonly kind: AvatarKind;
  /** Initials text, the emoji, the image URL, or ignored for `crew`. */
  readonly value?: string;
  readonly icon?: LucideIcon;
  readonly size?: AvatarSize;
  readonly square?: boolean;
  /** Accessible name; defaults to the value. */
  readonly label?: string;
}

const iconSize: Record<AvatarSize, number> = { sm: 12, md: 16, lg: 20, xl: 22 };

/** The contact picture: project emoji or initials, the Crew's hammer, or the user. */
export function Avatar({
  kind,
  value,
  icon: Icon,
  size = "md",
  square = false,
  label,
}: AvatarProps) {
  const classes = [
    "fm-avatar",
    `fm-avatar--${size}`,
    kind === "emoji" ? "fm-avatar--emoji" : "",
    kind === "crew" ? "fm-avatar--crew" : "",
    kind === "person" ? "fm-avatar--person" : "",
    square ? "fm-avatar--square" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const name = label ?? (kind === "crew" ? "Crew" : (value ?? ""));
  if (kind === "image" && value) {
    return (
      <span className={classes}>
        <img src={value} alt={name} />
      </span>
    );
  }
  return (
    <span className={classes} role="img" aria-label={name}>
      {kind === "crew" ? (
        <Hammer size={iconSize[size]} strokeWidth={1.9} aria-hidden />
      ) : kind === "icon" && Icon ? (
        <Icon size={iconSize[size]} strokeWidth={1.8} aria-hidden />
      ) : (
        <span aria-hidden>
          {kind === "initials" || kind === "person" ? initials(value ?? "") : value}
        </span>
      )}
    </span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}
