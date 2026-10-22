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
  password it asks for, renaming the child, opening Advanced mode, running the welcome steps
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
- **The greeting uses the child's name**, if one was given.
- **Voice.** Replies are read aloud automatically (a voice on the Mac, a little slower), and
  the child can talk instead of typing where the browser can listen. Voice typing sends the
  sound to the browser's speech service; a parent can switch it off in Settings → Family
  (parent code). See [VOICE.md](VOICE.md).

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
| `/api/skycot/family/rename`                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Grown-up: AI assistants                                          | the child's name is part of the profile                                                  |
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
- **Another browser or device** can only reach SKYCOT after it has been paired with the Mac,
  and the engine enforces the same profile for it.
- **In an Advanced-mode tab left open** after the 15 minutes run out, refused actions (a
  setting snapping back, a terminal that does not open) are not explained there; reloading
  sends it back to SKYCOT.
