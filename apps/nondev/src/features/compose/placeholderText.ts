/** A name cut short elsewhere may already end in "…" or "..."; drop that so only one ellipsis shows. */
export function withoutTrailingEllipsis(name: string): string {
  return name.replace(/[\s.…]+$/u, "");
}

/** The composer's hint for a chosen project, ending in exactly one ellipsis. */
export function projectPlaceholder(title: string): string {
  return `Say what you'd like done in ${withoutTrailingEllipsis(title)}…`;
}
