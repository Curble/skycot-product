import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { Avatar, type AvatarSize } from "../ui/Avatar";

/** The project's contact picture: its emoji or monogram if set, else initials of its title. */
export function ProjectAvatar({
  project,
  size = "xl",
}: {
  readonly project: Pick<EnvironmentProject, "title" | "projectIcon"> | null;
  readonly size?: AvatarSize;
}) {
  if (project === null)
    return <Avatar kind="initials" value="?" size={size} label="Unknown project" />;
  const icon = project.projectIcon ?? null;
  if (icon?.kind === "emoji") {
    return <Avatar kind="emoji" value={icon.emoji} size={size} label={project.title} />;
  }
  if (icon?.kind === "monogram") {
    return <Avatar kind="initials" value={icon.text} size={size} label={project.title} />;
  }
  return <Avatar kind="initials" value={project.title} size={size} label={project.title} />;
}
