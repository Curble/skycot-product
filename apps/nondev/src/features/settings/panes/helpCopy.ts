// Three short help cards for a grown-up. A card links to skycot.com only when that page exists
// (today the site has Privacy, Terms and Open source, none of which is one of these topics),
// so none of them carries a link yet.
export interface HelpCard {
  readonly title: string;
  readonly body: string;
  readonly href?: string;
}

export const helpCards: ReadonlyArray<HelpCard> = [
  {
    title: "Getting started",
    body: "Set up the Family profile in Settings › Family, add a picture and a reading level for each child, and choose a parent code. After that, your child picks their name and starts making things. You can leave at any time with “Done — hand back” in the grown-up menu.",
  },
  {
    title: "When your child asks for a grown-up",
    body: "Safe steps run by themselves. Anything riskier waits, and your child sees “Needs a grown-up”. Use the grown-up menu, enter your parent code, and you will see what they asked for. You can say yes once or say no. Nothing risky happens without you.",
  },
  {
    title: "Siblings and the fridge",
    body: "The family fridge shows everything each child has made, one magnet for each page. Children see their own shelf and their brothers' and sisters'. Pinning a favourite and taking it down need no code, nothing is deleted, and nothing leaves this Mac. Each child keeps their own settings and reading level.",
  },
];
