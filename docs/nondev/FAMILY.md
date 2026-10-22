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
  carries short rules — the first message, a follow-up typed while it is working, and a
  message that starts with "/" alike: keep it kind, simple and age-appropriate; never ask for
  or keep personal details (name, school, address, photos); make nothing unsafe, violent,
  sexual or hateful and contact nobody — and say so plainly, without suggesting a grown-up
  could unlock it; stay in the project folder; no installs or internet without a grown-up.
  A child saying "my mum said yes" is not a grown-up's yes: only the parent code in SKYCOT's
  own grown-up box is, and the assistant must never ask for a code or password in the chat.
- **The parent code is asked for** before: publishing (_Send for review_ and _Put it live_),
  creating or switching on an automation, opening another folder as a project, changing the
  AI assistants (connecting, signing in or out, installing), handing the assistant a key or
  password it asks for, adding, changing or removing a child (names, pictures, voice, bedtime and limits), giving more time, opening Advanced mode, running the welcome steps
  again (from Settings or by typing the address), changing the code, and turning the profile
  off. The engine checks the same things, so a click elsewhere cannot skip them — see
  [What the engine checks](#what-the-engine-checks).
- **The developer tools stay closed.** "Open Advanced mode" leaves the sidebar and the
  Settings list. With the profile on, any address that would show the developer interface —
  including made-up ones such as `/picture.png` — sends the browser back to SKYCOT unless a
  parent has entered the code; the code opens it on that device for 15 minutes, and
  Settings → Family says how long is left. Its terminal, installs and AI settings need the
  code too.
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

| Asked for                   | Allows                                             | For        |
| --------------------------- | -------------------------------------------------- | ---------- |
| An **Ask a grown-up** card  | that one step                                      | once       |
| Publishing                  | sending for review or putting it live              | 5 minutes  |
| An automation               | creating, switching on or running one              | 5 minutes  |
| Another folder              | adding, moving or removing a project's folder      | 5 minutes  |
| The AI assistants           | connecting, signing out, installing, other changes | 10 minutes |
| A key or password, a rename | handing one over, the child's name                 | 10 minutes |
| Advanced mode               | the developer interface and everything above       | 15 minutes |

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

Today's counters, who is using SKYCOT on each signed-in device, who started each conversation
and project, and the "more time" log live beside it in `skycot-family-activity.json`. A profile
turned off and on again starts that file afresh. The browser only remembers whether it was on, so the first screen paints right.

A profile set up in an earlier version lived in the browser only. The first time the code is
asked for (or in Settings → Family), entering it moves the profile to the engine.

## What the engine checks

Every call a client can make to SKYCOT's engine was looked at, and a test keeps it that way:
a call added later fails the tests until someone decides. Calls that only read, watch, stop
or take something away (declining, pausing or deleting an automation, signing a device out)
stay open. "Grown-up" names the parent's "yes" a call needs; Advanced mode covers every one.

| Calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Needs                                                            | Why                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Allowing a held step (`runtime-request.respond` with accept), any "allow for the session/always"                                                                                                                                                                                                                                                                                                                                                                                      | Grown-up: that one step                                          | internet, installs, deleting, outside the project, secrets, admin rights, connected apps |
| `pullRequests.runAction`, `update`, `comment`, `updateComment`, `submitReview`, `replyToThread`, `setThreadResolution`, `setReaction`, `requestReviewers`, `setLabels`; `sourceControl.publishRepository`; `git.runStackedAction` other than commit                                                                                                                                                                                                                                   | Grown-up: publishing                                             | puts work where other people see it                                                      |
| `scheduledTasks.upsert`, `runNow`, `rotateWebhookToken`, `setEnabled` (on)                                                                                                                                                                                                                                                                                                                                                                                                            | Grown-up: automations                                            | runs later, on its own                                                                   |
| `projects.add`, `projects.remove`, `projects.mutate` (anything but a rename), `sourceControl.cloneRepository`, `projectClone.start`/`retry`, `vcs.createWorktree`/`removeWorktree`, `launchThread` with a new worktree fetched from the internet or for a project SKYCOT does not have                                                                                                                                                                                                | Grown-up: another folder                                         | the assistant would work somewhere else                                                  |
| `projects.writeFile`, `thread.create` and `launchThread` with a folder; `launchThread` making a conversation's private copy (it is what makes Undo work)                                                                                                                                                                                                                                                                                                                              | Open inside a SKYCOT project; elsewhere Grown-up: another folder | writes or works outside the project                                                      |
| `server.updateSettings` (anything but "Ask me first"), `server.updateProvider`, `provider.install.start`/`remove`, `provider.auth.start`/`complete`/`respond`/`logout`, `provider.chatgpt.reconnect-profile`/`import-profile`, `provider.consumeResetCredit`, `provider.uploadFeedback`, `server.upsertKeybinding`/`removeKeybinding`, `secrets.answerRequest` (save)                                                                                                                 | Grown-up: AI assistants                                          | the parent's accounts, sign-ins, settings and keys; feedback sends conversations away    |
| `terminal.open`/`attach`/`write`/`restart`, `server.updateServer*`, `commitDesktopUpdate`, every ACP-registry change, `server.signalProcess`, `runStorageCleanup`, `checkOtlpEndpoint`, `cloud.installRelayClient`, `shell.openInEditor`, `device.configure`/`testHost`/`open`/`close`/`shutdown`/`action`, `agentSessions.import`, `mcpApps.callTool`, `vcs.pull`, `git.resolvePullRequest`/`preparePullRequestThread`, `preview.open`/`navigate` to an address that is not this Mac | Grown-up: Advanced mode                                          | developer tools, outside agents, other devices, the internet                             |
| HTTP: `/api/projects/mutate` (as `projects.mutate`), `/api/auth/pairing-token`, `/api/connect/*` changes, `/api/t3-connect/mint-credential`, `/oauth/mcp/decision` (approve)                                                                                                                                                                                                                                                                                                          | as the call it mirrors; otherwise Advanced mode                  | letting another device or an outside agent in                                            |
| `/api/skycot/family/rename`, `/children/add`, `/children/update`, `/children/remove`                                                                                                                                                                                                                                                                                                                                                                                                  | Grown-up: AI assistants                                          | the children are part of the profile                                                     |
| `/api/skycot/family/more-time`                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The parent code, with the request                                | wakes SKYCOT for a child; nothing stays open afterwards                                  |
| A child's message (`message.dispatch`, `launchThread` with a first message, resuming or promoting a queued one) and a child's "Allow"                                                                                                                                                                                                                                                                                                                                                 | Refused while SKYCOT is asleep for the child                     | bedtime and the daily limits; Advanced mode is exempt                                    |
| Everything else: reading and watching (lists, diffs, files, status, searches), sending messages, stopping, declining, the child's own project (new project, writing inside it, saving a version, previews on this Mac), pausing or deleting an automation, cancelling a sign-in or install, revoking a device                                                                                                                                                                         | Open                                                             | the child's own work, or it only stops or takes away                                     |

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
- **The assistant's own previews** (opened through SKYCOT's preview tool, and links clicked
  inside a preview) are not checked for the internet; a typed preview address is.
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
- **In an Advanced-mode tab left open** after the 15 minutes run out, refused actions (a
  setting snapping back, a terminal that does not open) are not explained there; reloading
  sends it back to SKYCOT.
