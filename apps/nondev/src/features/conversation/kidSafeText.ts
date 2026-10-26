/** Keep technical crumbs out of the child's plan and explanation prose. */
export function kidSafeText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, "a project step")
    .replace(/`[^`\n]+`/gu, "a project file")
    .replace(/https?:\/\/[^\s)]+/giu, "a website")
    .replace(/\b(?:\/[^\s,;]+){2,}/gu, "a project file")
    .replace(/letting SKYCOT pause for approval/giu, "asking a grown-up for help");
}
