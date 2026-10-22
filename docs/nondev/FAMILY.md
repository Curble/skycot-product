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
- **A plan before anything is made (plan first).** Every request the child sends runs as a
  plan: the assistant replies with numbered steps and changes nothing. The plan card offers
  **Build it** (the assistant carries that plan out, still asking first) and **Change the plan**
  (say what's different; the answer is a new plan). The engine holds every child's turn to this,
  whatever the conversation, the browser or the developer interface says: the only turns that
  build are a **Build it** of a plan still waiting in that project, and messages from a grown-up
  working in Advanced mode. The switch is shown locked in the composer and in Settings ›
  Autonomy & safety. See [Plan first](#plan-first) for how it works and its limits.
- **The grown-up hears when they're needed.** Notifications are on by default: a short note
  when Sam finishes, needs an OK (a step, a plan or a question), **needs a grown-up** (a step
  only the parent code can allow), or something goes wrong. The words name the crew and the
  project only, never the child's message, a file or the conversation's title; clicking one
  opens that conversation. The browser asks once before the first note (Settings ›
  Notifications › **Allow…**); the desktop app needs no extra step. No code is needed to change
  them, see [What is still possible](#what-is-still-possible).
- **Some steps need a grown-up.** The child can allow ordinary work inside the project (edit
  a page, run the game). Anything that uses the internet (downloads, web searches, `git
push`), installs something (`npm install`, `pip install`, `brew`), deletes files, reaches
  outside the project folder, touches secrets, or uses a connected app shows **Ask a
  grown-up**: the Allow needs the parent code, and the engine refuses it without one. "Always
  allow" is not offered.
- **The assistant is told it is helping a child.** Every message the assistant receives
  carries short rules — the first message, a follow-up typed while it is working, and a
  message that starts with "/" alike: keep it kind, simple and age-appropriate; never ask for
  or keep personal details (name, school, address, photos); make nothing unsafe, violent,
  sexual or hateful and contact nobody — and say so plainly, without suggesting a grown-up
  could unlock it; stay in the project folder; no installs or internet without a grown-up.
  A child saying "my mum said yes" is not a grown-up's yes: only the parent code in SKYCOT's
  own grown-up box is, and the assistant must never ask for a code or password in the chat.
- **Personal details stay home (the shield).** Before a message goes, SKYCOT looks for a full
  name, a school, an address, a phone number, an email, a birthday or a password, and asks about
  any picture. A card shows what it spotted and offers **Send with nicknames** (a one-tap
  rewrite: "my name is Ava and I go to school"), **Change it myself**, or **Ask a grown-up**: the
  parent code lets that one message go as typed, once; the next message is checked again. This
  happens on the first message of a new conversation and on every reply. The engine checks too:
  whatever reaches it another way has those details hidden before the assistant sees them
  ("[hidden by SKYCOT: a full name]"), and its log names only the kind of detail, never the
  words.
- **"How did you do that?"** On by default for children (a switch in each conversation's strip):
  after a turn that changed files, the crew adds a short "How I did it" in kid language with a
  **Peek at the code** of up to 20 changed lines. Every "What changed" card has a **How did you do
  that?** button.
- **The real folder asks first.** A conversation works in a private copy of the project, which is
  what Undo restores. A step that would change the project's real folder instead (an edit there,
  or a command that writes into it) is held: Undo could not bring it back, so it is a grown-up's
  call. Looking at the real folder stays open.
- **The parent code is asked for** before: publishing (_Send for review_ and _Put it live_),
  creating or switching on an automation, opening another folder as a project, changing the
  AI assistants (connecting, signing in or out, installing), handing the assistant a key or
  password it asks for, adding, changing or removing a child (names, pictures, voice, bedtime and limits), giving more time, opening Advanced mode, running the welcome steps
  again (from Settings or by typing the address), restarting the Mac app into a new SKYCOT
  version, changing the code, and turning the profile off. The engine checks the same things, so a click elsewhere cannot skip them — see
  [What the engine checks](#what-the-engine-checks).
- **The developer tools stay closed.** "Open Advanced mode" leaves the sidebar and the
  Settings list. With the profile on, any address that would show the developer interface —
  including made-up ones such as `/picture.png` — sends the browser back to SKYCOT unless a
  parent has entered the code; the code opens it on that device for 15 minutes, and
  Settings → Family says how long is left. Its terminal, installs and AI settings need the
  code too.
- **The live preview stays on this Mac.** **Preview** (beside a conversation, or full screen on a
  phone) shows the project's site running. Starting it runs the project's own start command, so it
  asks first like any command; the child may start an ordinary one (`node server.js`), but a start
  command that installs something or uses the internet (`npx serve`) shows **Ask a grown-up** and
  the engine refuses it without the parent code. The engine only ever names this Mac's own
  addresses for the preview. In the Mac app, a link inside the page that goes to the internet is
  sent back with **Ask a grown-up**; the code allows that one site while the preview stays open.
  What the child points at with **Point at something** travels as words in their next message, so
  the shield reads it like anything they type.
- **The assistant's own SKYCOT tools are trimmed.** It cannot start other conversations,
  schedule automations or open pull requests through SKYCOT while the profile is on. Page
  previews still work.
- **The look.** Workshop (cream paper, marker pens, Sam builds and Mo checks; SKYCOT's
  default look) stays on unless a parent picked another look, and larger text comes on. Both are ordinary preferences anyone can change; looks never change what
  SKYCOT does.
- **The greeting uses the child's name**, if one was given — the child using SKYCOT on that
  device, when there are several.
- **Voice.** Replies are read aloud automatically (a voice on the Mac, a little slower). Talking
  instead of typing is **off for every child until a parent turns it on** in that child's
  settings (parent code), because Chrome and Edge send the voice to Google or Microsoft. See
  [VOICE.md](VOICE.md).

## Plan first

How the engine keeps "a plan before making anything" true:

- Each turn's mode is decided where the provider is told to start, below every way in (a first
  message, a follow-up, a queued message, a restart, a raw call). While the profile is on, a turn
  runs in the provider's plan mode (Codex's plan mode, Claude's "plan" permission mode) and the
  rules in front of the message add one line: plan only, change nothing, wait for Build it.
- Two kinds of message are let through as they are, and the engine's own check decides both:
  a **Build it** (the message names a plan that the engine confirms is still waiting, in the same
  project; it runs in the normal mode, so "Ask me first" still asks before each step), and a
  message sent while a grown-up's Advanced-mode code is open on that device.
- Building a plan uses it up: the plan is marked carried out, so the same Build it cannot run twice.

Limits, honestly:

- **The plan mode is the AI's own.** Codex and Claude have one; with the other assistants (Cursor,
  Grok, OpenCode, Antigravity) plan first is the "plan only" line in the rules, which a model can
  ignore. "Ask me first" still holds every change for an OK either way.
- **Build it builds what the Build it message asks.** SKYCOT's button sends a fixed "go ahead
  with the plan". Something that sends its own words with a plan's Build it (another client, a raw
  call) gets those words built without a second plan.
- **Automations a grown-up set up plan too**, and so does **Put it live**: in a Family profile both
  start with a plan that someone has to Build.
- **An engine restart** between pressing Build it and the build starting turns it back into a
  plan (the safe side): press Build it again.

## Several children

One parent code covers every child (up to eight). Each child has a first name (optional), a
picture (one of SKYCOT's poses, or their letter on a colour), a look, larger text on or off,
voice settings and their own limits. Settings → Family shows a card per child with today's
time and messages, and **Add another child**. Adding, removing, renaming, and changing a
child's picture, look, voice or limits all need the parent code; the engine refuses them
without it. A look the child picks for themselves in Appearance is saved to their profile
without a code (looks never change what SKYCOT does).

- **"Who's using SKYCOT?"** With more than one child, a big picker opens whenever SKYCOT is
  opened in a new window or tab, and from Settings → Family → **Switch…**. Choosing needs no
  code, so it is a convenience, not a lock: children who tap each other's pictures share each
  other's limits. One exception keeps bedtime meaningful: moving away from a child SKYCOT is
  asleep for needs the parent code.
- **Whose conversation is whose.** The engine remembers which child started each conversation
  and each project (`skycot-family-activity.json`, beside the profile). The conversation list
  shows the child's own conversations first, then everyone else's. Nothing is hidden: siblings
  can still open each other's work.
- **Each child's look and text size** follow them: choosing a child puts their look on in that
  browser.

## Tidying the list

A child can **put a conversation away** (its **…** menu, a right-click, or the **…** at the top
of the conversation), **bring it back** from **Old conversations** in the sidebar, and
**rename** it. None of these needs the parent code, because each can be undone: a toast offers
**Undo** straight away, a put-away conversation waits in Old conversations until it is brought
back, and a rename can be changed again.

- **Putting away is not deleting.** The engine keeps every message, version and page. A put-away
  conversation still has its magnet on the fridge, still counts in the grown-up recap and keeps
  the stickers it earned. Opening it from Old conversations shows it, marked _Put away_; replying
  waits until it is brought back.
- **A conversation that is still working** cannot be put away until the crew finishes or is
  stopped.
- **A new name** shows in the list, at the top of the conversation, on the fridge, in the recap
  and on a certificate. An empty name is refused. Renaming is how to fix a title the AI wrote
  that sounds like an instruction ("Create an Offline Bubbles Pet Page"); SKYCOT does not retitle
  conversations by itself.
- **Siblings share the list.** As they can open each other's conversations, they can also put
  away, bring back or rename them. Nothing is lost either way.

## Bedtime and daily limits

Per child, all optional, set in the child's card (parent code):

| Limit                   | What happens                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Bedtime**             | From the start time to the end time (it can run past midnight), SKYCOT is asleep for that child.                      |
| **Time on SKYCOT**      | Up to 30 minutes – 2 hours of active use a day.                                                                       |
| **Messages to SKYCOT**  | Up to 10–50 messages a day. Exact: the engine counts each message as it starts.                                       |
| **Leave for grown-ups** | The child's messages pause once the AI allowance (the same figure as the usage ring) is down to 20, 30 or 50 percent. |

Five minutes before SKYCOT goes to sleep (bedtime, the day's time running out, or a grown-up's
extra time ending) a calm line says so at the top of the window. When it does go to sleep:

- **The step that is running finishes; then it pauses.** The engine refuses new messages,
  follow-ups typed while the assistant works, and the child's "Allow" on the next step. Nothing
  is interrupted half-way, so a project is never left half-edited and Undo stays clean. Saying
  no, and Stop, always work.
- **"SKYCOT is asleep"** fills the screen, with the sleeping mascot, when it wakes, and **Ask a
  grown-up for more time**: the parent code, then **15 minutes**, **30 minutes**, or (at
  bedtime) **No bedtime tonight**. Extra time adds up, lifts every limit for that long, and the
  heads-up shows again before it ends. Every "more time" is kept for 30 days and today's show
  on the child's card.
- A grown-up working in Advanced mode is not held to a child's limits.

**How time is counted.** A minute counts once per child, on the engine's clock, when the
child starts a message, or when SKYCOT is on screen and the child has touched, clicked, scrolled
or typed in the last two minutes (the page tells the engine twice a minute). Several tabs or
devices in the same minute make one minute; a gap is never filled in later. The assistant
working while nobody is looking does not count. "Today" is the household's day: it starts at
midnight in the time zone of the parent's browser (saved with the limits), so bedtimes read
right even when the engine's clock is set elsewhere.

**Why messages, not "20% of the allowance each".** The AI companies report one allowance for the
whole account (ChatGPT's 5-hour and weekly windows, Claude's 5-hour and weekly windows), not
who used it. SKYCOT cannot honestly split that between children, so the per-child cap is the
number of messages, which it counts exactly, and **Leave for grown-ups** is a line on the
shared allowance: below it, that child's messages pause until the window refills.

## The grown-up recap

**Settings → Family → _Ava's week_** (on each child's card) shows, after the parent code:

- **What they made**: each conversation with the plain "What changed" sentence, and a **Most
  proud of** pick (the newest finished change, a page over anything else) with its live picture
  and **Open it**.
- **What they asked for**: their own words, shortened. A message the shield would catch is shown
  only as the kind of thing it was ("Something private (a full name)"), never the words, even
  when a grown-up let it go as typed.
- **What needed a grown-up**: steps held for the parent code (and how many were allowed), extra
  time, what the shield spotted (by kind), and messages sent as typed with a grown-up's yes.
- **Time used**: minutes and messages, the week as a bar per day.

**This week / Today** switches the range ("today" is the household's day). **Print or save as
PDF** uses the browser's print dialog. SKYCOT keeps everything on the Mac: the recap is built by
the engine from what it already keeps (who started each conversation, the conversations
themselves, past days' counters and a log of what needed a grown-up, all in
`skycot-family-activity.json`), and nothing is emailed or uploaded.

**"Here's what Ava made today"** is the same recap for one day. It comes up when a child's
session ends: on the asleep screen (**For grown-ups: what Ava made today**, then the code), and
when a parent unlocks the Family settings with the code after that child used SKYCOT today.
**Done** keeps it away for that child until tomorrow, on that browser.

The code opens the recap on that device for 10 minutes; an open Family-settings "yes" covers it
too.

## The fridge

**The fridge** (sidebar, and **On the fridge** on Home) shows everything made on this Mac: one
magnet per conversation that made a page, with a live thumbnail (drawn with no scripts running),
its title, when it was made, and the crew's sticker. Tap it to **Open it**, running offline inside
SKYCOT. With several children there is a shelf per child and a filter; children see their own
shelf and their siblings'. **Pin to the fridge** keeps a magnet at the top and **Take it down**
unpins it; neither needs the code, and neither deletes anything: the page stays in its project.
Pins are kept in `skycot-fridge.json` on the Mac. Without the Family profile the fridge is one
shelf of everything made here.

## Turning it on

- **First run:** the welcome steps start with _Who is this for?_, even when an AI assistant
  is already signed in. Choose **A child I look after**, give a first name (optional), choose
  a 4–6 digit parent code and type it twice. The profile turns on when you press **Open
  SKYCOT** on the last step; skipping half-way turns nothing on. A browser opened later on a
  Mac whose profile is already on skips the welcome steps.
- **Later:** Settings → Family → **Set up…**.

Set up the AI assistants first: once the profile is on, connecting or changing one needs the
code.

## A parent's "yes"

Entering the code allows one thing, for this device, for a short time:

| Asked for                      | Allows                                             | For        |
| ------------------------------ | -------------------------------------------------- | ---------- |
| An **Ask a grown-up** card     | that one step                                      | once       |
| Starting a preview             | that one start command                             | once       |
| A preview link to the internet | that site, while the preview stays open            | once       |
| The shield's card              | that one message, as typed                         | once       |
| A child's recap                | reading the recap                                  | 10 minutes |
| Publishing                     | sending for review or putting it live              | 5 minutes  |
| An automation                  | creating, switching on or running one              | 5 minutes  |
| Another folder                 | adding, moving or removing a project's folder      | 5 minutes  |
| The AI assistants              | connecting, signing out, installing, other changes | 10 minutes |
| A key or password, a rename    | handing one over, the child's name                 | 10 minutes |
| Restart to update              | restarting the Mac app into the downloaded version | 2 minutes  |
| Advanced mode                  | the developer interface and everything above       | 15 minutes |

Settings → Family → **Lock again now** ends them all early.

## Turning it off

Settings → Family → **Turn off…** confirms, then asks for the parent code. Off forgets the
children, their limits and today's counters, and the code. The look and the larger text stay as they are.

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
whether it is on, each child (name, picture, look, text size, voice, limits), the household's
time zone, a scrambled version of the code (scrypt, with a random salt), the wrong-try counter,
and the parent's current "yes"es. The code itself is never stored. A profile from before
siblings (file version 1) is read as one child, with voice typing off, and saved in the new
shape at its next change.

Today's counters, the last five weeks' days, who is using SKYCOT on each signed-in device, who
started each conversation and project, the "more time" log and the recap's log of what needed a
grown-up (kinds of detail only, kept 30 days) live beside it in `skycot-family-activity.json`.
The fridge's pins are in `skycot-fridge.json`. A profile
turned off and on again starts that file afresh. The browser only remembers whether it was on, so the first screen paints right.

A profile set up in an earlier version lived in the browser only. The first time the code is
asked for (or in Settings → Family), entering it moves the profile to the engine.

## What the engine checks

Every call a client can make to SKYCOT's engine was looked at, and a test keeps it that way:
a call added later fails the tests until someone decides. Calls that only read, watch, stop
or take something away (declining, pausing or deleting an automation, signing a device out)
stay open. "Grown-up" names the parent's "yes" a call needs; Advanced mode covers every one.

| Calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Needs                                                                                                                                | Why                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Allowing a held step (`runtime-request.respond` with accept), any "allow for the session/always"                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Grown-up: that one step                                                                                                              | internet, installs, deleting, outside the project, secrets, admin rights, connected apps |
| `pullRequests.runAction`, `update`, `comment`, `updateComment`, `submitReview`, `replyToThread`, `setThreadResolution`, `setReaction`, `requestReviewers`, `setLabels`; `sourceControl.publishRepository`; `git.runStackedAction` other than commit                                                                                                                                                                                                                                                                                                          | Grown-up: publishing                                                                                                                 | puts work where other people see it                                                      |
| `scheduledTasks.upsert`, `runNow`, `rotateWebhookToken`, `setEnabled` (on)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Grown-up: automations                                                                                                                | runs later, on its own                                                                   |
| `projects.add`, `projects.remove`, `projects.mutate` (anything but a rename), `sourceControl.cloneRepository`, `projectClone.start`/`retry`, `vcs.createWorktree`/`removeWorktree`, `launchThread` with a new worktree fetched from the internet or for a project SKYCOT does not have                                                                                                                                                                                                                                                                       | Grown-up: another folder                                                                                                             | the assistant would work somewhere else                                                  |
| `projects.writeFile`, `thread.create` and `launchThread` with a folder; `launchThread` making a conversation's private copy (it is what makes Undo work)                                                                                                                                                                                                                                                                                                                                                                                                     | Open inside a SKYCOT project; elsewhere Grown-up: another folder                                                                     | writes or works outside the project                                                      |
| `server.updateSettings` (anything but "Ask me first"), `server.updateProvider`, `provider.install.start`/`remove`, `provider.auth.start`/`complete`/`respond`/`logout`, `provider.chatgpt.reconnect-profile`/`import-profile`, `provider.consumeResetCredit`, `provider.uploadFeedback`, `server.upsertKeybinding`/`removeKeybinding`, `secrets.answerRequest` (save)                                                                                                                                                                                        | Grown-up: AI assistants                                                                                                              | the parent's accounts, sign-ins, settings and keys; feedback sends conversations away    |
| Deleting a conversation (`thread.delete`; putting it away stays open), `terminal.open`/`attach`/`write`/`restart`, `server.updateServer*`, `commitDesktopUpdate`, every ACP-registry change, `server.signalProcess`, `runStorageCleanup`, `checkOtlpEndpoint`, `cloud.installRelayClient`, `shell.openInEditor`, `device.configure`/`testHost`/`open`/`close`/`shutdown`/`action`, `agentSessions.import`, `mcpApps.callTool`, `vcs.pull`, `git.resolvePullRequest`/`preparePullRequestThread`, `preview.open`/`navigate` to an address that is not this Mac | Grown-up: Advanced mode                                                                                                              | developer tools, outside agents, other devices, the internet                             |
| HTTP: `/api/projects/mutate` (as `projects.mutate`), `/api/auth/pairing-token`, `/api/connect/*` changes, `/api/t3-connect/mint-credential`, `/oauth/mcp/decision` (approve)                                                                                                                                                                                                                                                                                                                                                                                 | as the call it mirrors; otherwise Advanced mode                                                                                      | letting another device or an outside agent in                                            |
| Putting a conversation away or bringing it back (`thread.archive`, `thread.unarchive`); renaming it (`thread.metadata.update` with a title)                                                                                                                                                                                                                                                                                                                                                                                                                  | Open; with a folder (`worktreePath`), Grown-up: another folder                                                                       | each can be undone; a folder is where the assistant works                                |
| `/api/skycot/family/rename`, `/children/add`, `/children/update`, `/children/remove`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Grown-up: AI assistants                                                                                                              | the children are part of the profile                                                     |
| `/api/skycot/family/recap`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Grown-up: the recap (or the Family settings' yes)                                                                                    | a child's words and what needed a grown-up are a parent's to read                        |
| `/api/skycot/preview/start` (starting a conversation's site)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The person's yes, always; Grown-up: that one start when the start command installs something, uses the internet or trips a hard rule | runs the project's own start command on the Mac                                          |
| `/api/skycot/preview/address` (where the preview may go)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | This Mac's addresses: open; anything else Grown-up: that site, once                                                                  | the internet                                                                             |
| `/api/skycot/updates/allow-restart`, then the Mac app's own install handler (it reads the profile and needs the engine's two-minute note for that version)                                                                                                                                                                                                                                                                                                                                                                                                   | Grown-up: restart to update                                                                                                          | a new version replaces SKYCOT; checking and downloading stay open                        |
| `/api/skycot/family/more-time`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The parent code, with the request                                                                                                    | wakes SKYCOT for a child; nothing stays open afterwards                                  |
| A child's turn, whatever starts it (`sourcePlanRef` marks a Build it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Runs as a plan unless it builds a waiting plan                                                                                       | a plan before making anything                                                            |
| A child's message (`message.dispatch`, `launchThread` with a first message, resuming or promoting a queued one) and a child's "Allow"                                                                                                                                                                                                                                                                                                                                                                                                                        | Refused while SKYCOT is asleep for the child                                                                                         | bedtime and the daily limits; Advanced mode is exempt                                    |
| Everything else: reading and watching (lists, diffs, files, status, searches), the fridge (and pinning), sending messages, stopping, declining, the child's own project (new project, writing inside it, saving a version, previews on this Mac), pausing or deleting an automation, cancelling a sign-in or install, revoking a device                                                                                                                                                                                                                      | Open                                                                                                                                 | the child's own work, or it only stops or takes away                                     |

## What is still possible

Honestly, so a parent can decide how nearby to stay:

- **The AI can still get things wrong.** Its instructions ask for child-appropriate answers,
  on every message, but nothing filters what it says back. Stay within earshot.
- **The rules are instructions, not a filter.** They sit in front of every message the
  assistant receives (slash or not, follow-ups too), and a child cannot close them from the
  chat, but a determined prompt could still talk a model round. The engine's checks on
  installs, the internet, deleting and publishing do not depend on what the AI agrees to.
- **Anything outside SKYCOT is outside the profile.** Other apps on the Mac — Terminal,
  Finder, other browsers, games — are not covered. Use macOS Screen Time and a separate
  macOS user for the child for that.
- **Someone who can use Terminal or Finder on this Mac account** can delete the profile file
  and turn the profile off, or run the engine's tools directly.
- **The child can allow ordinary steps inside the project**, such as editing files or running
  the project's own scripts (`npm run start`). With Codex, the engine's sandbox keeps the
  network off for those; with Claude, a project script that itself downloads something is
  not caught by name.
- **The assistant's own previews** (opened through SKYCOT's preview tool) are not checked for the
  internet; a typed preview address is.
- **The live preview's start command runs outside the assistant's safe area.** SKYCOT checks its
  words (and the script it runs) for installs and the internet, not what the program then does: a
  project server that itself downloads something is not caught.
- **A previewed page can load pictures and scripts from the internet**, as it would in any
  browser; only where the preview itself goes is checked. In the Mac app a link to the internet
  arrives before it is sent back, so the page may flash for a moment. In a web browser (not the
  Mac app) links inside the preview are not checked at all, and **Point at something** is not
  available there.
- **Other text the AI writes from the child's words** (conversation titles) is made without
  the rules; it never reaches the child as an answer.
- **Accounts and outside agents connected before the profile was turned on** keep working:
  an MCP client already approved, or another paired device, is not signed out. Check
  Settings → Connections in Advanced mode when you turn the profile on.
- **During development builds** (`vp run dev`), the developer interface is served by its own
  port and is not sent back to SKYCOT. The engine's checks (Ask me first, publishing,
  automations, installs, the terminal, grown-up cards) still apply there.
- **The voice-typing switch is kept by this browser**, not the engine (the microphone belongs
  to the browser). Changing it asks for the parent code, but clearing the browser's site
  data turns voice typing back on for that browser.
- **The shield is a word-spotter.** It catches common shapes of names, schools, addresses, phone
  numbers, emails and birthdays; a detail written in an unusual way can slip past, and an
  ordinary word can be caught. The recap hides the same things the shield catches, no more.
- **The recap needs the code, the fridge does not.** Siblings can see each other's magnets and
  open each other's pages, as they can open each other's conversations. A child who knows the code
  can read the recap.
- **Limits are counted, not watched.** Time counts while the child is touching SKYCOT, so a
  child reading a long answer without touching anything for more than two minutes is not
  counted, and SKYCOT left open but untouched is not either. A message sent before bedtime that
  was waiting its turn behind another still runs.
- **Deleting `skycot-family-activity.json`** (Terminal or Finder) resets today's counters, and
  changing the Mac's clock or time zone moves bedtime with it.
- **The picker trusts the child.** A child can pick a sibling's picture on a fresh device and
  use the sibling's time; moving away from a child who is asleep is the only switch that needs
  the code.
- **Another browser or device** can only reach SKYCOT after it has been paired with the Mac,
  and the engine enforces the same profile for it.
- **Notifications are kept by this browser**, like the voice-typing switch, and a child can switch
  them off without the code (or close SKYCOT: they only show while SKYCOT is open in the app or a
  tab). The browser, or macOS in System Settings › Notifications, can also block them; Settings ›
  Notifications says so and how to undo it. A note names the project, so a project called after a
  child shows that name on the Mac's screen.
- **Updates.** Anyone can check for and download a new SKYCOT version (nothing changes until
  the restart). Restarting into it needs the code, and the Mac app checks for itself; someone who
  can use Finder or Terminal on the Mac account could forge the two-minute note it reads. The
  Advanced-mode update button does nothing while the profile is on: restart from Settings →
  About. See [UPDATES.md](UPDATES.md).
- **In an Advanced-mode tab left open** after the 15 minutes run out, refused actions (a
  setting snapping back, a terminal that does not open) are not explained there; reloading
  sends it back to SKYCOT.
