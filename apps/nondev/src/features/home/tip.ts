// The Home tip and the empty-list hint, in words that fit who is using SKYCOT: a child (or the
// playful Workshop look, which also shows the kids' starter cards) or a grown-up running a business.
// The plan promise is only made when plan first is on (always, in a Family profile), so it is
// true: with it off, the crew starts straight away and plans only bigger jobs (backlog F6).

export function homeTip(kids: boolean, builderName: string, planFirst: boolean): string {
  if (kids) {
    const lead = `Say what you'd like to make, like telling a friend. “A game where a cat catches falling fish” works great.`;
    return planFirst
      ? `${lead} ${builderName} will show you a plan before making anything.`
      : `${lead} ${builderName} checks with you before anything risky.`;
  }
  const lead = `Say it like you'd text a staff member. “Add a Christmas menu page” beats describing how to build one.`;
  return planFirst
    ? `${lead} ${builderName} will show you a plan before touching anything.`
    : `${lead} Turn on Plan first to see a plan before anything changes.`;
}

export function startOneHint(kids: boolean): string {
  return kids
    ? "Start one below: say what you'd like to make, like telling a friend."
    : "Start one below: say what you'd like done, like you'd text a staff member.";
}

/** An empty conversation's hint: the same plan promise as the Home tip, made only when true. */
export function emptyConversationHint(builderName: string, planFirst: boolean): string {
  return planFirst
    ? `Say what you'd like done and ${builderName} will show you a plan first.`
    : `Say what you'd like done and ${builderName} will get started.`;
}
