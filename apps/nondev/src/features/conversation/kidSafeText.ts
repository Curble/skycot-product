/** Keep technical crumbs out of the child's plan and explanation prose. */
export function kidSafeText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, "a project step")
    .replace(/`[^`\n]+`/gu, "something behind the scenes")
    .replace(/https?:\/\/[^\s)]+/giu, "a website")
    .replace(/\b(?:\/[^\s,;]+){2,}/gu, "something behind the scenes")
    .replace(
      /\b(?:files?|folders?|directories|repos?|commits?|branches|builds?|deploys?|servers?|terminals?|npm|packages?|scripts?|tokens?|apis?|json|urls?|paths?|sandboxes?|worktrees?|runtimes?|processes)\b/giu,
      "things",
    )
    .replace(/letting SKYCOT pause for approval/giu, "asking a grown-up for help")
    .replace(/\*\*|__|~~|[*_]/gu, "");
}

/** Keep only the numbered steps from a plan; headings and setup notes are for Sam. */
export function kidSafePlan(markdown: string): string {
  return markdown
    .split(/\r?\n/u)
    .filter((line) => /^\s*\d+[.)]\s+/u.test(line))
    .map((line) => kidSafeText(line.trim()))
    .join("\n");
}
