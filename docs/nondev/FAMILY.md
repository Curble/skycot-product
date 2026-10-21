# The Family profile

The **Family profile** is a safer way to set SKYCOT up for a child you look after, on
your Mac. SKYCOT's engine (the part that runs the assistant) keeps it and enforces it, and a
**parent code** is the only way past it. It is built for a curious child who clicks around
and types addresses, not for someone determined to break it — see
[What is still possible](#what-is-still-possible).

## What it does

When the Family profile is on:

- **The assistant always asks first.** Every conversation runs in "Ask me first", whatever
  the conversation, the default setting or the developer interface says. "Just do it,
  carefully" and "Fully hands-off" are not offered, and the engine would run them as "Ask me
  first" anyway. Nothing is approved on the child's behalf.
- **Some steps need a grown-up.** The child can allow ordinary work inside the project (edit
  a page, run the game). Anything that uses the internet (downloads, web searches, `git
push`), installs something (`npm install`, `pip install`, `brew`), deletes files, reaches
  outside the project folder, touches secrets, or uses a connected app shows **Ask a
  grown-up**: the Allow needs the parent code, and the engine refuses it without one. "Always
  allow" is not offered.
- **The assistant is told it is helping a child.** Every message the assistant receives
  carries short rules: keep it kind, simple and age-appropriate; never ask for or keep
  personal details (name, school, address, photos); nothing unsafe, violent, sexual or that
  contacts people; stay in the project folder; no installs or internet without a grown-up;
  and say gently when something needs a grown-up.
- **The parent code is asked for** before: publishing (_Send for review_ and _Put it live_),
  creating or switching on an automation, opening another folder as a project, changing the
  AI assistants (connecting, signing out, installing), opening Advanced mode, running the
  welcome steps again, changing the code, and turning the profile off. The engine checks the
  same things, so a click elsewhere cannot skip them.
- **The developer tools stay closed.** "Open Advanced mode" leaves the sidebar and the
  Settings list. With the profile on, the developer interface's address sends the browser back
  to SKYCOT unless a parent has entered the code; the code opens it on that device for
  15 minutes. Its terminal, installs and AI settings need the code too.
- **The assistant's own SKYCOT tools are trimmed.** It cannot start other conversations,
  schedule automations or open pull requests through SKYCOT while the profile is on. Page
  previews still work.
- **The look.** Workshop (cream paper, marker pens, Sam builds and Mo checks) and larger
  text come on. Both are ordinary preferences anyone can change; looks never change what
  SKYCOT does.
- **The greeting uses the child's name**, if one was given.

## Turning it on

- **First run:** the welcome steps start with _Who is this for?_ Choose **A child I look
  after**, give a first name (optional), choose a 4–6 digit parent code and type it twice.
  The profile turns on when you press **Open SKYCOT** on the last step; skipping half-way
  turns nothing on.
- **Later:** Settings → Family → **Set up…**.

Set up the AI assistants first: once the profile is on, connecting or changing one needs the
code.

## A parent's "yes"

Entering the code allows one thing, for this device, for a short time:

| Asked for                  | Allows                                             | For        |
| -------------------------- | -------------------------------------------------- | ---------- |
| An **Ask a grown-up** card | that one step                                      | once       |
| Publishing                 | sending for review or putting it live              | 5 minutes  |
| An automation              | creating, switching on or running one              | 5 minutes  |
| Another folder             | adding, moving or removing a project's folder      | 5 minutes  |
| The AI assistants          | connecting, signing out, installing, other changes | 10 minutes |
| Advanced mode              | the developer interface and everything above       | 15 minutes |

Settings → Family → **Lock again now** ends them all early.

## Turning it off

Settings → Family → **Turn off…** confirms, then asks for the parent code. Off forgets the
child's name and the code. The look and the larger text stay as they are.

## The parent code

- 4 to 6 digits. A repeated or counting code ("1111", "1234") is flagged as easy to guess
  but allowed.
- Five wrong tries lock every code prompt, on every device, for five minutes. The engine
  counts, not the browser.
- **Change it** in Settings → Family → Change parent code. A new code ends every "yes" the old
  one gave.
- **Forgotten?** There is no reset inside SKYCOT. On the Mac, quit SKYCOT and delete
  `~/.skycot/userdata/skycot-family.json` (SKYCOT's data folder); that turns the profile off.

## Where it is kept

SKYCOT's engine keeps the profile in `~/.skycot/userdata/skycot-family.json` on this Mac:
whether it is on, the child's name, a scrambled version of the code (scrypt, with a random
salt), the wrong-try counter, and the parent's current "yes"es. The code itself is never
stored. The browser only remembers whether it was on, so the first screen paints right.

A profile set up in an earlier version lived in the browser only. The first time the code is
asked for (or in Settings → Family), entering it moves the profile to the engine.

## What is still possible

Honestly, so a parent can decide how nearby to stay:

- **The AI can still get things wrong.** Its instructions ask for child-appropriate answers,
  but nothing filters what it says. Stay within earshot.
- **Anything outside SKYCOT is outside the profile.** Other apps on the Mac — Terminal,
  Finder, other browsers, games — are not covered. Use macOS Screen Time and a separate
  macOS user for the child for that.
- **Someone who can use Terminal or Finder on this Mac account** can delete the profile file
  and turn the profile off, or run the engine's tools directly.
- **The child can allow ordinary steps inside the project**, such as editing files or running
  the project's own scripts (`npm run start`). With Codex, the engine's sandbox keeps the
  network off for those; with Claude, a project script that itself downloads something is
  not caught by name.
- **During development builds** (`vp run dev`), the developer interface is served by its own
  port and is not sent back to SKYCOT. The engine's checks (Ask me first, publishing,
  automations, installs, the terminal, grown-up cards) still apply there.
- **Another browser or device** can only reach SKYCOT after it has been paired with the Mac,
  and the engine enforces the same profile for it.
- **Follow-up messages typed while the assistant is already working** reach it without the
  rules repeated; the rules came with the message that started the work.
