# Stickers, the sticker book and certificates

Each child (or, with the Family profile off, whoever uses this Mac) has a sticker book at
**My stickers** in the sidebar (`#/stickers`). A sticker arrives when something real happens:
a first creation, a picture, an Undo, the microphone, bedtime let be. Nothing rewards time
spent, nothing asks a child to come back tomorrow, and nothing is ever taken away.

When a sticker arrives it slaps onto the screen once, SKYCOT cheers, and confetti falls if the
theme is playful and the device allows motion. It waits while a safety card (personal
details, an approval still waiting), a sheet, the asleep screen or "Who's using SKYCOT?" is
up, and never shows on the sticker book itself. Several at once: the first arrives, the rest
wait in the book marked **New!**.

## The sixteen stickers

| id               | Title             | Earned when                                                                                 |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `first-creation` | First creation    | SKYCOT finishes a conversation's first turn that changed files                              |
| `first-game`     | Game maker        | a creation from the "Make a game" card, or whose first message asks for a game              |
| `animal-friend`  | Animal friend     | a creation from "A page about my pet", or about an animal                                   |
| `drew-it`        | Drew it first     | a message with a picture attached (the "Draw it" card alone does not count)                 |
| `big-question`   | Big questions     | "How did you do that?" asked three times (the button or the child's own words)              |
| `undo`           | Back in time      | Undo or Restore accepted by the engine                                                      |
| `mo-check`       | Mo's helper       | a follow-up message after Mo double-checked something in that conversation                  |
| `voice`          | Said it out loud  | voice typing heard words                                                                    |
| `together`       | Built together    | two children sent messages in the same project (Family only; both get it)                   |
| `kind-words`     | Kind words        | "please" or "thank you" in the child's own words (a starter card's "Please" never counts)   |
| `good-night`     | Good night        | SKYCOT went to sleep at bedtime and no grown-up gave more time that night (judged next day) |
| `five`, `ten`    | Five / Ten things | five or ten different creations                                                             |
| `explorer`       | Explorer          | three different starter cards used                                                          |
| `storyteller`    | Storyteller       | a creation from the comic card, or a story                                                  |
| `designer`       | Designer          | a follow-up asking to change colours, fonts or the look                                     |

The rules are one pure module shared by the engine and the client:
`packages/skycot-rules/src/badges.ts`. Message words are turned into a few booleans in the
browser (`apps/nondev/src/features/badges/facts.ts`); no message text reaches the sticker file.

## Where stickers are kept

The engine keeps them, so they survive a cleared browser, a second device and a re-paired
tablet: `<T3 home>/userdata/skycot-family-badges.json` (`~/.skycot/userdata/` for SKYCOT),
beside `skycot-family.json` and `skycot-family-activity.json`. Written by
`apps/server/src/skycot/badges/SkycotBadges.ts`; served at `/api/skycot/badges` (read, `POST
/event`, `POST /seen`).

Shape (version 1), for anything that reads it, such as the grown-ups' recap:

```json
{
  "version": 1,
  "books": {
    "<childId>": {
      "earned": {
        "first-creation": {
          "at": 1792651839537,
          "threadId": "0aff3a5e-…",
          "title": "Build Offline Falling Star Game",
          "seen": true
        }
      },
      "creations": 3,
      "madeThreads": ["…"],
      "countedMessages": ["…"],
      "bigQuestions": 2,
      "starters": ["game", "pet"],
      "night": null
    },
    "solo": { "…": "the one book used while the Family profile is off" }
  },
  "projects": { "<projectId>": ["<childId>", "<childId>"] }
}
```

- `books` is keyed by the Family child id; `solo` is the book while the profile is off.
- `earned[id].at` is epoch milliseconds; `title` is the creation's title when it was made
  (set for the creation stickers); `seen` is false until the child saw it arrive.
- Read it with `parseBadgeFile` and `bookView` from `@t3tools/skycot-rules/badges`, which
  fill missing fields and skip sticker ids they do not know. In the engine,
  `SkycotBadges.all` returns every book as a `BookView` (children first, then `solo`).
- A child the parent removes loses their book at the next write. A file that cannot be read
  is moved aside as `skycot-family-badges.json.unreadable-<ms>` and a new book starts.
  Deleting the file resets every book.

## Whose sticker it is

The engine decides: the child chosen on the device that reported it (Family limits), except a
creation, which belongs to the child who started that conversation. A message counts only if
it was sent in the last few minutes on a device showing that conversation, so an old
conversation opened later earns nothing for the reader. Two children on two devices with the
same conversation open at the same moment is the one case where a message can be credited to
the wrong one.

## Certificates

The sticker book offers **My first app** and **My 10th creation** once earned
(`#/stickers/certificate/first`, `/tenth`). "Print or save as PDF" prints one landscape page on
A4 or Letter: the child's first name only (with the profile off, a line to write a name on),
the creation's title, the date, SKYCOT, Sam and Mo signing, and "Built with a grown-up's
help". No links, codes or anything that could track. Children may print it.

## Surfaces

Web and desktop (the desktop wraps the web client). The mobile app does not show stickers yet;
nothing is lost, it simply does not report or show them.
