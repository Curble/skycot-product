// The builder's and checker's faces. With `avatars: "characters"` they are the
// sticker blobs from the Workshop mockup, drawn inline (no images) in the
// theme's crew colours; otherwise the plain Crew avatar from ui/Avatar.
import { Avatar, type AvatarSize } from "../ui/Avatar";
import { useCrew } from "./useCrew";

export type CrewRole = "builder" | "checker";

const px: Record<AvatarSize, number> = { sm: 24, md: 32, lg: 40, xl: 44 };

export function CrewAvatar({
  role = "builder",
  size = "md",
}: {
  readonly role?: CrewRole;
  readonly size?: AvatarSize;
}) {
  const crew = useCrew();
  const member = crew[role];
  if (!crew.characters) return <Avatar kind="crew" size={size} label={member.name} />;
  const dimension = px[size];
  return (
    <svg
      className={`fm-character fm-character--${role} fm-avatar--${size}`}
      width={dimension}
      height={dimension}
      viewBox="0 0 64 64"
      role="img"
      aria-label={member.name}
      style={{ color: member.color }}
    >
      {role === "builder" ? <BuilderFace /> : <CheckerFace />}
    </svg>
  );
}

/* Both faces: fill = currentColor (the member colour), lines = --fm-ink. */
function BuilderFace() {
  return (
    <>
      <path
        d="M32 7c13 0 25 9 25 24 0 16-11 27-26 27C17 58 7 46 7 31 7 17 19 7 32 7z"
        fill="currentColor"
        stroke="var(--fm-ink)"
        strokeWidth="3"
      />
      <path
        d="M15 24c3-10 11-15 19-15 8 0 14 5 16 12"
        fill="var(--fm-marker)"
        stroke="var(--fm-ink)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect
        x="12"
        y="22"
        width="40"
        height="6"
        rx="3"
        fill="var(--fm-marker)"
        stroke="var(--fm-ink)"
        strokeWidth="3"
      />
      <circle cx="24" cy="36" r="2.6" fill="var(--fm-ink)" />
      <circle cx="40" cy="36" r="2.6" fill="var(--fm-ink)" />
      <path
        d="M25 45c3 3 11 3 14 0"
        fill="none"
        stroke="var(--fm-ink)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="18" cy="42" r="3" fill="#ffb4a2" opacity=".8" />
      <circle cx="46" cy="42" r="3" fill="#ffb4a2" opacity=".8" />
    </>
  );
}

function CheckerFace() {
  return (
    <>
      <path
        d="M31 6c15 0 27 11 27 26 0 15-12 26-27 26S5 47 5 32 16 6 31 6z"
        fill="currentColor"
        stroke="var(--fm-ink)"
        strokeWidth="3"
      />
      <circle
        cx="23"
        cy="33"
        r="7"
        fill="var(--fm-bg-card)"
        stroke="var(--fm-ink)"
        strokeWidth="3"
      />
      <circle
        cx="41"
        cy="33"
        r="7"
        fill="var(--fm-bg-card)"
        stroke="var(--fm-ink)"
        strokeWidth="3"
      />
      <path d="M30 33h4" stroke="var(--fm-ink)" strokeWidth="3" />
      <circle cx="24" cy="34" r="2.4" fill="var(--fm-ink)" />
      <circle cx="42" cy="34" r="2.4" fill="var(--fm-ink)" />
      <path
        d="M25 46c3 2 11 2 14 0"
        fill="none"
        stroke="var(--fm-ink)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M20 12l-4-6M44 12l4-6"
        stroke="var(--fm-ink)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </>
  );
}
