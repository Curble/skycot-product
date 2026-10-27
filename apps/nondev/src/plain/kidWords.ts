// Kid words for the progress lines. A child's checklist says "Testing your game" and "Got a
// tool ready", not "Running a short node program" or "Used the add-on manager". Grown-ups keep
// the ordinary words: this runs only when the narration context says the viewer is a child
// (`NarrationContext.kid`). Pure, so the mapping is tested in kidWords.test.ts.
//
// The rules read the command's plain-English step (its `infinitive`, as narration.ts words it)
// and give back the same step in three tenses, so every line still reads right while it is
// pending, running and done.

/** What the child is making, for "Testing your game" / "Testing your page". */
export type KidThing = "game" | "page";

export interface KidVerb {
  /** "test your game" */
  readonly infinitive: string;
  /** "Tested your game" */
  readonly past: string;
  /** "Testing your game" */
  readonly present: string;
}

const kidVerb = (infinitive: string, past: string, present: string): KidVerb => ({
  infinitive,
  past: past.charAt(0).toUpperCase() + past.slice(1),
  present: present.charAt(0).toUpperCase() + present.slice(1),
});

const testing = (thing: KidThing): KidVerb =>
  kidVerb(`test your ${thing}`, `tested your ${thing}`, `testing your ${thing}`);

/**
 * The child's words for one classified step, or null to keep the ordinary words.
 * `step` is the classified step's plain-English infinitive and kind.
 */
export function kidStep(
  step: { readonly infinitive: string; readonly kind: string },
  thing: KidThing,
): KidVerb | null {
  const { infinitive, kind } = step;
  if (/^create (?:the )?[\w.-]+\.html$/i.test(infinitive))
    return kidVerb("make the page", "made the page", "making the page");
  // Several steps in one command: "Ran 2 steps: …" is not for a child to read.
  if (/^run \d+ steps: /.test(infinitive))
    return kidVerb("do a few things", "did a few things", "doing a few things");
  // A short program or a script the assistant runs to see if the page works.
  if (/^run a short [\w.+-]+ program$/.test(infinitive) || /^run the ".*" script$/.test(infinitive))
    return testing(thing);
  if (kind === "test" && infinitive === "run the project's checks") return testing(thing);
  if (infinitive === "run a style check")
    return kidVerb("check it looks right", "checked it looks right", "checking it looks right");
  if (infinitive === "check the code fits together")
    return kidVerb(
      "check the pieces fit together",
      "checked the pieces fit together",
      "checking the pieces fit together",
    );
  if (kind === "install" || infinitive === "use the add-on manager")
    return kidVerb("get a tool ready", "got a tool ready", "getting a tool ready");
  if (infinitive === "work with the database")
    return kidVerb("save some information", "saved some information", "saving some information");
  if (/^look at the (agents|claude|gemini) text$/.test(infinitive))
    return kidVerb("read the instructions", "read the instructions", "reading the instructions");
  if (/['"`]|\b[\w.-]+\.(?:html?|css|js|jsx|ts|tsx|md|json)\b/i.test(infinitive)) return null;
  return null;
}

/** "(passed)" and "(found problems)" are for grown-ups; a child hears it plainly. */
export function kidTestOutcome(
  headline: string,
  status: string,
  item: {
    readonly exitCode?: number | undefined;
    readonly outputIndicatesFailure?: boolean | undefined;
  },
): string {
  if (status === "done" && ((item.exitCode ?? 0) !== 0 || item.outputIndicatesFailure === true))
    return `${headline} — found something to fix`;
  if (status === "failed") return `${headline} — it didn't finish`;
  return headline;
}

/** The instructions file is "the instructions" to a child, wherever a line names it. */
export function kidNouns(headline: string): string {
  return headline
    .split(/((?:"[^"]*"|'[^']*'|`[^`]*`)|\b[\w.-]+\.(?:html?|css|js|jsx|ts|tsx|md|json)\b)/gi)
    .map((part, index) =>
      index % 2 === 0
        ? part.replace(/\bthe (?:agents|claude|gemini) text\b/g, "the instructions")
        : part,
    )
    .join("");
}
