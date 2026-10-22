// The Home tip and the empty-list hint, in words that fit who is using SKYCOT: a child (or the
// playful Workshop look, which also shows the kids' starter cards) or a grown-up running a business.

export function homeTip(kids: boolean, builderName: string): string {
  return kids
    ? `Say what you'd like to make, like telling a friend. “A game where a cat catches falling fish” works great. ${builderName} will show you a plan before making anything.`
    : `Say it like you'd text a staff member. “Add a Christmas menu page” beats describing how to build one. ${builderName} will show you a plan before touching anything.`;
}

export function startOneHint(kids: boolean): string {
  return kids
    ? "Start one below: say what you'd like to make, like telling a friend."
    : "Start one below: say what you'd like done, like you'd text a staff member.";
}
