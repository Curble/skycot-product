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
- **Files stay inside the project.** **Files** (in a conversation's header and its **…** menu as
  **See the files**, and beside **New conversation** when a project is picked in the sidebar) lists
  a project's files the way Finder does, and **Quick Look** shows any of them: pictures, pages
  (running offline, like **Open it**), PDFs, Markdown, code and text, sounds and videos. Nothing
  there edits, moves or deletes a file. The engine picks the folder (the project's own, or the
  conversation's private copy) and refuses any path that leaves it: a typed `../`, a full path, or
  a shortcut (symlink) pointing elsewhere on the Mac. Hidden and secret files (`.env`, `.git`, keys),
  installed add-ons (`node_modules`) and build output wait behind **Show everything**, which needs
  the parent code. **Show in Finder** is a grown-up's button: Finder shows the rest of the Mac, so
  children never see it, and the engine refuses it without the parent code. See
  [Files](#files).
- **The live preview stays on this Mac.** **Preview** (beside a conversation, or full screen on a
  phone) shows the project's site running. Starting it runs the project's own start command, so it
  asks first like any command; the child may start an ordinary one (`node server.js`), but a start
  command that installs something or uses the internet (`npx serve`) shows **Ask a grown-up** and
  the engine refuses it without the parent code. The engine only ever names this Mac's own
  addresses for the preview. In the Mac app, a link inside the page that goes to the internet is
  sent back with **Ask a grown-up**; the code allows that one site while the preview stays open.
  What the child points at with **Point at something** travels as words in their next message, so
  the shield reads it like anything they type.
- **The assistant's own SKYCOT tools are off.** While the profile is on, the engine does not
  connect the assistant to SKYCOT's own tool server at all, so the assistant is not even shown
  those tools' names: it cannot start other conversations, schedule automations, open pull
  requests, use other devices, open, click and take pictures of pages, or draw a page as a
  picture (`html_render`, `html_preview`; those page tools would first download a browser of
  about 200 MB). This holds for every assistant (Codex, Claude, Cursor, OpenCode, Grok and the
  other ACP agents, Muse, Pi): each one is handed SKYCOT's tool server only when the engine
  issues it a key, and in the Family profile it issues none. While the profile is on, the engine
  also refuses every key it issued before, so an assistant that was already running when the
  profile was turned on can no longer use the tools; it may still see their names until it next
  starts. The child's own **Preview** button works as before; the assistant is told to suggest
  it instead. After the profile is turned off, a conversation gets the tools back when its
  assistant next starts. Outside agents a grown-up approved (MCP clients) are not affected; see
  below.
- **The computer's own AI add-ons are off, too.** A child's assistant gets only what SKYCOT gives
  it. Whatever a grown-up installed for their own AI on this Mac — plugins such as computer use,
  browser control, Chrome or documents, apps and connectors, MCP servers, skills, hooks, and the
  program Codex runs after every turn (`notify`, which on some Macs starts computer-use helpers)
  — does not reach the child's conversation. The engine does this when it starts the assistant,
  not by asking it nicely: see [The parent's own AI add-ons](#the-parents-own-ai-add-ons).
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
- **Going back past a plan** (Undo, or changing an earlier message) takes the plan away: a Build
  it that names it runs as a new plan, because the assistant no longer has the plan it would
  build.

## Files

- **Where.** A conversation's **Files** shows its private copy (what that conversation changed);
  a project's **Files** shows the project's own folder. On the family's Mac any SKYCOT project can
  be browsed, siblings' projects too, as their conversations can be opened. On a child's own
  device only their own projects, the family's shared ones and pages pinned to the fridge (see
  [People and devices](#people-and-devices-who-is-who)). Folders open in place; a path bar
  and **Find in this folder** help; nothing is written.
- **Quick Look** shows pictures up to 10 MB, pages up to 2 MB (with the page's own styles,
  scripts and pictures put inside it, running offline in the same sandbox as **Open it**), PDFs,
  sounds and videos up to 10 MB (never playing by themselves), and the first 512 KB of Markdown,
  code and text. Code carries a short "This is the code behind your page" note. Anything bigger
  says so plainly; anything else (a `.zip`, a Word file) says "SKYCOT can't show this kind of
  file".
- **Held for a grown-up.** With the profile on, hidden and secret files, add-ons and build output
  are left out of the list and refused by the engine until a grown-up turns on **Show everything**
  with the parent code (10 minutes on that device). The same yes shows **Show in Finder**, which is
  never offered to a child: Finder would show the rest of the Mac. Without the profile, Show
  everything is an ordinary switch and Show in Finder is there on the Mac itself.
- **Reading elsewhere.** The same rule covers the engine's older ways to read a file: reading a
  file, listing or searching a folder, or making a picture address is open inside SKYCOT's projects
  and their private copies and needs the parent code anywhere else, or for a hidden or secret file.

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
  shows the child's own conversations first, then everyone else's. On the family's Mac nothing is
  hidden: siblings can still open each other's work. On a child's own linked device only their
  own work shows (see [People and devices](#people-and-devices-who-is-who)).
- **Each child's look and text size** follow them: choosing a child puts their look on in that
  browser.

## People and devices (who is who)

Phase 1 of SKYCOT on iPhone, iPad and Apple Watch: SKYCOT now knows who each device belongs to.
The family's Mac is still the brain; every other device is a window into it. The design note
for later phases is [WHO-IS-WHO.md](WHO-IS-WHO.md).

- **People.** The profile has children (as before) and **grown-ups** (a first name and a picture
  from the same set). The person who set the profile up is the first grown-up. There is still
  one parent code for everyone: grown-ups are people, not separate accounts. Settings → Family →
  **Grown-ups** adds, renames or removes one (the parent code); the last one stays.
- **Linking a phone or iPad.** On the Mac, Settings → Family → **Phones and iPads** →
  **Link a phone or iPad…** (the parent code) asks who it is for, then shows a QR code, a
  twelve-letter code to type (in groups of four; spaces and lower case are fine) and the link.
  It works once and runs out after five minutes. Opening it on the other device signs that
  device in as that person. The QR code is drawn on the Mac; nothing is sent anywhere to make it.
- **A child's device** is always that child: no "Who's using SKYCOT?", no switching to a
  brother or sister. Their limits, bedtime and plan first apply as on the Mac. It sees only that
  child's conversations and projects, their own Questions, the family's shared projects (ones a
  grown-up set up; inside them only their own conversations), and pages pinned to the fridge. It
  cannot open Advanced mode, even with the code, and cannot reach the developer tools, AI
  sign-ins, updates or pairing at all: its sign-in simply does not include them. A grown-up can
  still give more time or allow a step on it with the parent code.
- **A grown-up's device** (a phone or tablet) reads everything: every child's conversations,
  each child's week, today's time. It answers **Ask a grown-up** requests from its own
  **Requests** page: **Allow once** or **Decline**, never "for the session" or "always". It can
  give **more time** and **Lock everything** (ends every grown-up's yes on every device, such as
  Advanced mode left open on the Mac). It cannot send messages, start conversations, change
  settings or open files.
- **Face ID instead of the code.** On a grown-up's device, This device → **Use Face ID to say
  yes** (the parent code once) makes a passkey: Face ID, Touch ID or the device's own passcode
  then says yes. The phone keeps the key; the Mac keeps only its public half. The parent code
  always works instead.
- **Apple Watch.** On a grown-up's iPhone, This device → Apple Watch → **Set up** (the parent
  code once) lets their Watch say yes once, or no, while it's unlocked and on their wrist, the
  same rule as Apple Pay. The Watch shows the requests waiting, each child's time today and
  bedtime, and **Lock SKYCOT now**. It has no sign-in of its own: it asks the iPhone, and the
  iPhone asks the Mac. Children's Watches aren't part of SKYCOT yet.
- **Each yes is one-shot and on the record.** A yes names one request and a fingerprint of the
  card the phone showed; if the card changed, or it was already answered, the engine refuses.
  A request older than ten minutes waits on the Mac instead. Saying no needs no proof. The recap
  says "Approved from Mum's phone, 6:42 pm".
- **Devices list and Remove.** Phones and iPads lists every linked device with its person, its
  kind, when it was last seen and whether Face ID is on. **Remove** (the parent code) signs it
  out at once, even mid-conversation, and forgets its passkey. A grown-up's device can also
  **Unlink this device** itself. Removing a child or a grown-up removes their devices too.

How the engine enforces it:

- A linked device's sign-in is T3's own (a one-time pairing link, then a per-device session that
  can be revoked). The engine makes the link with the person's device named inside it and with
  exactly what that kind of device may do; the device cannot change either. A child's device
  gets what the plain screens need and none of the developer tools; a grown-up's device gets
  T3's read-only permission, and its yes and no go through SKYCOT's own approver routes, which
  check the device, the proof and the request every time.
- Every call a child's device makes that names a conversation, project or folder is checked
  against who started it; the conversation lists it receives are filtered by the engine before
  they leave the Mac, over the live connection and over plain web requests alike. Searching
  across every conversation is closed to it.
- A removed device is refused everything at once, and its sign-in is revoked.

Honest limits:

- **Other devices need to reach the Mac.** The engine listens on the Mac itself, so a link only
  opens in another browser on this Mac, or from another device on the same Wi-Fi or Tailscale
  when SKYCOT is set to listen there. **Away from home** (Settings › Family, the parent code)
  turns on SKYCOT Relay: links made after that work from anywhere, sealed so the relay can't
  read them, with the same rules as at home. It needs a SKYCOT version that names a relay, and
  none does yet ([RELAY.md](RELAY.md)).
- **Face ID needs a secure address.** Browsers only allow passkeys on the Mac's own address
  (`localhost`) or an `https` address. Over plain home Wi-Fi (`http://192.168.…`) the phone uses
  the parent code. A passkey also belongs to the address it was made on: a phone that later
  reaches the Mac another way sets Face ID up again.
- **Conversations from before Phase 1**, or ones a grown-up started, have no recorded child, so
  they stay off every child's device (the Mac and grown-ups' devices still show them).
- **A sign-in lasts 30 days.** After that a linked device asks to be linked again.
- **A child's device opening another child's conversation by its address** gets nothing; the
  screen says the conversation didn't load rather than explaining why.
- **No lock-screen notes yet.** A grown-up's phone shows requests while SKYCOT is open on it;
  "Sam needs a grown-up" on the lock screen comes with the app and the relay.
- **The Mac's own browser** keeps today's behaviour: the picker, and siblings' work visible
  (own first). That is decision 5: the shared Mac stays shared.

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
  and on a certificate. An empty name is refused. A title the AI wrote like an instruction
  ("Create an Offline Bubbles Pet Page") reads as the thing itself on the fridge, in the recap and
  on a certificate ("Bubbles pet page"); the list and the conversation keep the AI's words, and a
  name someone typed is shown as typed everywhere. SKYCOT never renames a conversation itself.
- **Siblings share the list on the Mac.** As they can open each other's conversations there,
  they can also put away, bring back or rename them. Nothing is lost either way. A child's own
  device lists, and may change, only that child's conversations.

### Deleting a conversation

**Delete…** is the last row of every conversation's **…** menu (and its right-click menu), set
apart in red like Delete in Mail and Notes, for a live conversation and for one in **Old
conversations**. A conversation that is still working waits, as for putting away. It opens a
sheet that says what goes and what stays, with **Cancel** chosen first:

- **Goes:** the conversation, every message, plan and picture sent in it, and its restore points
  (the engine's `thread.delete`).
- **Stays:** the project's folder and its files as they are now, with their kept versions (the
  project's history). A page it made stays in the project as a file.
- "This can't be undone." There is no Undo, so the sheet suggests putting it away instead.

**In a Family profile** the red button reads **Enter parent code…** and opens the parent-code sheet
over it. The code records a grown-up's "yes" **for that one conversation** (an `approve` grant
named `delete-conversation:<id>`), the delete spends it, and it opens nothing else. It is
deliberately not Advanced mode's 15-minute grant: that would also lift plan first and the limits
for the child's session while it lasted. The engine refuses the delete without that yes (or
Advanced mode), whatever the screen shows; a wrong code deletes nothing and counts as a wrong try.

What a deleted conversation does to the rest:

- **The fridge:** its magnet comes off (the fridge lists conversations), its pin is forgotten.
  The page file stays in the project, so a later conversation can still open it.
- **The grown-up recap:** it leaves "What … made" and the questions list, and its held cards are
  no longer counted. The day's minutes, messages and the personal-details catches already noted
  stay, because they were counted when they happened. A child can't hide anything this way: the
  parent typed the code.
- **Stickers are never taken away.** A sticker earned in it stays in the sticker book.

## Projects: name and icon

A project's **…** in the sidebar (shown on hover, always on a touch screen) and a right-click on
it offer **Rename…** and **Change icon…**. Both open one small sheet, like a list's info in
Reminders: the name (selected, so typing replaces it; Return saves, Escape or Cancel leaves it,
an empty name is refused) and a grid of icons in the style of a child's picture picker: the
name's first letters on grey (the default), the name's first letter on one of the six picture
colours, or a friendly emoji (rocket, game controller, dinosaur, cat, …). SKYCOT's own poses stay
for people, so a project never looks like a child in the sidebar.

- Both are the **engine's own fields** (`title`, `projectIcon`), so the new name and icon show
  everywhere at once: the sidebar, beside each conversation, at the top of a conversation, the
  project picker, Advanced mode, the grown-up recap and other devices. Nothing is kept in the
  browser. (Fridge magnets show the conversation's name, not the project's.)
- A letter icon follows the name, like a contact's monogram: renaming "Games" to "Pets" turns the
  G into a P in the same colour. An icon chosen in Advanced mode that the grid does not offer is
  kept unless another is picked.
- **Children may rename a project and change its icon**: each shows a toast with **Undo**, which
  puts back exactly the name and icon it had.
- The engine allows a child's project change only when it carries a new name or icon and
  nothing else. The same command with the project's scripts (they run commands), its other
  settings (which assistant, pulling from the internet, where conversations work) or a favicon
  needs Advanced mode; moving its folder needs the "another folder" yes.

## Just ask (Questions)

**Just ask** sits beside the project picker on Home: a question, or a quick job, without
choosing a folder first. It works the same with the profile on or off.

- **Where it works.** SKYCOT's engine keeps questions in its own space, shown as **Questions** in
  the sidebar and the list (T3's "Scratch" folder, `~/.skycot/scratch` in the Mac app). Every
  question gets a private folder of its own, so nothing in the family's own folders is touched,
  and the engine keeps versions there: **What changed**, **Undo**, **Open it** and the fridge work
  as in a project.
- **One space per child.** With the Family profile on, each child has a Questions space of their
  own (`~/.skycot/scratch/children/<child>`), the same way their projects are theirs: Ava's
  questions are hers, Leo's are his. A child's own device (iPad, iPhone, a linked browser) always
  asks in that child's space; on the family's Mac a question goes to the child picked in
  **Who's using SKYCOT?**. The engine decides this, not the screen: a child's device is refused a
  brother's or sister's questions exactly like their projects ("That belongs to someone else in
  the family"), and it cannot start a question anywhere but its own space. Whose a space is
  follows from its folder, so even a reset activity file can't hand it to someone else.
- **What each screen calls it.** A child's own device says **Questions**. The family's Mac and
  grown-ups' phones see every child's, labelled **Ava's questions**, **Leo's questions**. With the
  profile off there is one shared **Questions**, as before.
- **The child's own.** The engine treats a question's folder as the child's own project: writing
  and running things there is open (still **Ask me first**), and everything else, including a
  brother's or sister's question, is outside the project and shows **Ask a grown-up**.
  Plan first, the shield, bedtime and daily limits, and the code for installs and the internet
  all apply exactly as in a project.
- **Questions from before (24 October 2026).** Questions asked before each child had their own
  space stay where they are, in the shared space, shown as **Earlier questions**; nothing was
  moved, so their Undo history still works. Each stays its asker's where SKYCOT recorded who
  asked it: that child still sees it on their own device and can keep talking in it, but new
  questions go to their own space. One whose asker was never recorded is shown to grown-ups only
  (on the Mac and grown-ups' phones), the same rule as any conversation from before the profile
  knew who started what: guessing could show one child's question to another.
- **Make this a project.** When a question made something, a strip offers **Make this a project…**:
  give it a name, and the question's folder becomes a project of that name (nothing is moved or
  copied), with a first saved version. The new project is the child's who asked, like any project
  they start: a brother's or sister's device can't open it or make it theirs. The conversation keeps its history and Undo, and is listed
  with the new project from then on. No code is needed; the toast's **Undo** takes the project off
  the list again (its files stay), and the conversation goes back to Questions.
- **The recap** counts a question's messages like any other, and lists it under **What they
  made** only once it made a file.
- **Tidying.** Questions are put away, brought back and renamed like any conversation.

Honest limits:

- **A plain question still arrives as a plan.** Plan first holds every child's turn, so "Why is the
  sky blue?" comes back as a plan card whose steps are the answer; **Build it** has nothing to
  build. Telling plain questions apart reliably would need a guess, and a wrong guess would let a
  build through without a plan.
- **The folder is SKYCOT's, not a project folder you chose.** A question made into a project stays
  where SKYCOT keeps questions (`~/.skycot/scratch/children/<child>/<date-and-words>`, or
  `~/.skycot/scratch/<date-and-words>` for one from before), because moving it would break its
  Undo history.
- **On the family's Mac, the picker decides.** Siblings' work stays visible on the Mac (as for
  projects), so a question asked there is the picked child's; a question asked while nobody is
  picked (several children, the picker not answered yet) goes to the shared space.
- **The cards say "this project".** Inside a question, "Only this project" on a card means the
  question's own folder.
- **Not offered** when SKYCOT's data folder is inside a Git checkout (a developer's setup): the
  engine then has no Questions space and the picker shows projects only.

## Going back to an earlier message

"That's not what I meant": a child (or grown-up) can change something they asked earlier.
**Edit** sits under their own messages (it shows when the pointer is over the message, on a
right-click, and always on a phone or tablet). It puts the message back in the box; nothing
changes until they send it. Sending asks **Go back to here?**, which says what will be
replaced, with two choices:

- **Keep the files as they are** (chosen to start with): only the conversation goes back.
- **Put the files back too**: the files Sam changed from that message on go back to how they
  were, the same restore as Undo. Like Undo it can't itself be undone; Versions shows the later
  versions as undone.

Rules, honestly:

- **No parent code.** It is the same engine step as Undo, which a child can already use, and it
  only ever moves files back to a version SKYCOT saved in the conversation's private copy. The
  project's own folder is never touched, and nothing outside SKYCOT's version history is
  deleted. A conversation working straight in the project's folder (no private copy), or a
  restore past a version kept as a Git commit, offers only **Keep the files as they are**.
- **The changed message is a new message.** It goes through the shield, runs as a plan first and
  in Ask me first, counts as one of the day's messages and waits at bedtime, exactly like any new
  request. Going back itself is not a message, so it works at the day's cap and at bedtime (like
  Undo); the changed message then waits.
- **A taken-back plan can't be built.** Going back takes the plan's turn away and Sam forgets it.
  Its card says so and offers no Build it, and the engine plans again for a Build it that names
  such a plan, whatever sends it.
- **Not while Sam is working.** Edit then offers **Stop**; a put-away conversation offers **Bring
  back**. Either way the message then goes into the box by itself.
- **Too far back.** If the saved point from just before the message is gone (an old conversation,
  or a different AI service took over later), SKYCOT says it can't go back that far and changes
  nothing. An AI service that can't go back in a conversation is said plainly too.
- **What was replaced leaves the chat.** Until the conversation is opened again it shows as one
  folded row ("Went back: …"), which **Show** opens read-only. Sam doesn't remember it.
- **Pictures and pointing don't come back.** The words return to the box; pictures and what was
  pointed at in the preview have to be added again (the box says so).

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
magnet per conversation that made a page, with a live thumbnail (drawn with no scripts running
and nothing loaded: the engine puts the page's own stylesheets and pictures inside it), its title, when it was made, and the crew's sticker. Tap it to **Open it**, running offline inside
SKYCOT. With several children there is a shelf per child and a filter; on the family's Mac
children see their own shelf and their siblings'. A child's own device shows their own magnets
and anything pinned by anyone (a pinned page opens there, its conversation does not). **Pin to the fridge** keeps a magnet at the top and **Take it down**
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
| Show everything (Files)        | hidden and secret files, add-ons, Show in Finder   | 10 minutes |
| Advanced mode                  | the developer interface and everything above       | 15 minutes |

Settings → Family → **Lock again now** ends them all early.

## Turning it off

Settings → Family → **Turn off…** confirms, then asks for the parent code. Off forgets the
children, the grown-ups, their limits and today's counters, and the code. Every linked phone and
iPad is signed out at once (link them again after turning it back on). The look and the larger
text stay as they are.

## The parent code

- 4 to 6 digits. A repeated or counting code ("1111", "1234") is flagged as easy to guess
  but allowed.
- Five wrong tries lock every code prompt, on every device, for five minutes. The engine
  counts, not the browser.
- **Change it** in Settings → Family → Change parent code. A new code ends every "yes" the old
  one gave, and unlinks every grown-up's phone (whoever learned the old code could have linked
  one). Children's devices stay linked: they can do nothing a code is needed for.
- **Forgotten?** There is no reset inside SKYCOT. On the Mac, quit SKYCOT and delete
  `~/.skycot/userdata/skycot-family.json` (SKYCOT's data folder); that turns the profile off.

## Where it is kept

SKYCOT's engine keeps the profile in `~/.skycot/userdata/skycot-family.json` on this Mac:
whether it is on, each child (name, picture, look, text size, voice, limits), the household's
time zone, a scrambled version of the code (scrypt, with a random salt), the wrong-try counter,
the parent's current "yes"es, the grown-ups (name and picture), and the devices linked to a
person (name, kind, and for a grown-up's phone its passkey's public key only). The code itself is
never stored. A profile from before siblings (file version 1) is read as one child, with voice
typing off, and saved in the new shape at its next change. A profile from before grown-ups were
people (beta 2 and earlier) is read with one grown-up, the person who set it up, with no name
until a parent gives one; the children and the code stay exactly as they were. The file keeps
version 2, so an older SKYCOT can still read it (it just ignores the grown-ups and devices).

Today's counters, the last five weeks' days, who is using SKYCOT on each signed-in device, who
started each conversation and project, the "more time" log and the recap's log of what needed a
grown-up (kinds of detail only, kept 30 days; a yes or no from a grown-up's phone also names the
phone and the one request) live beside it in `skycot-family-activity.json`.
The fridge's pins are in `skycot-fridge.json`. A profile
turned off and on again starts that file afresh. The browser only remembers whether it was on, so the first screen paints right.

A profile set up in an earlier version lived in the browser only. The first time the code is
asked for (or in Settings → Family), entering it moves the profile to the engine.

## The parent's own AI add-ons

Codex and Claude read the AI setup a grown-up made for themselves on this Mac (`~/.codex`,
`~/.claude`). Computer use or browser control would go around everything else the engine
enforces, so while the Family profile is on the engine starts the child's assistant without
any of it. Nothing in the grown-up's own setup is changed: their files stay as they are, and
switching the profile off gives their setup back.

| Assistant                                                          | While the Family profile is on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex** (ChatGPT)                                                | A separate Codex is started for the child with Codex's own switches off on its command line, where neither the grown-up's settings nor a project can turn them back on: plugins, apps and connectors, hooks, computer use, browser use, remote plugins and plugin suggestions, memories, Codex's bundled skills, and `notify` emptied. Before every conversation starts or resumes, the engine asks that Codex which MCP servers and skills it can see and switches each one off by name, read fresh each time so one added a minute ago is included. |
| **Claude**                                                         | Every Claude session is opened reading no settings files (so no enabled plugin, hook, permission rule or the grown-up's CLAUDE.md), with only SKYCOT's MCP servers (none in the Family profile), no plugins, no skills, hooks off, claude.ai connectors off and Claude in Chrome off.                                                                                                                                                                                                                                                                 |
| Cursor, OpenCode, Grok, Antigravity, Pi, Muse and other ACP agents | Not started for a child **until a grown-up allows that assistant** (see [Other assistants: a grown-up's choice](#other-assistants-a-grown-ups-choice)). SKYCOT can't switch their own add-ons off, so until then the conversation shows a card for the child ("Ask a grown-up to say yes") with **Allow … for the Family profile…** for the grown-up. Once allowed, the assistant starts with its own add-ons, as the parent's informed choice. A provider added in a later version is refused the same way until a grown-up allows it.               |
| Titles and other text SKYCOT writes with AI                        | The same rule: Codex's `codex exec` runs with the same switches off (plugins, apps and MCP servers were already off), Claude's with hooks off (it already runs with no tools and no MCP server), and any other provider is not used for it.                                                                                                                                                                                                                                                                                                           |

**It fails closed.** Before a child's first Codex conversation starts, that Codex must report
plugins, apps, hooks, computer use and browser use off and `notify` empty, and list no enabled
plugin or app. If it cannot (an unexpected Codex version, an error), the conversation does not
start and says: _"The Family profile is on, and SKYCOT could not confirm that Codex's own add-ons
on this computer … are switched off, so it didn't start."_ If an MCP server starts for a child's
conversation anyway, the engine refuses its next turn. A Family Codex never writes the grown-up's
Codex settings, installs anything, or calls an MCP tool.

**An assistant that was already running when the profile was switched on** is stopped the moment
the child next sends anything, and a fresh one starts without the add-ons (a reply it was in the
middle of stops). Until then it refuses new conversations, turns and follow-ups. After the profile
is switched off, the child-safe assistant is replaced by the grown-up's normal one once it is idle.

### Other assistants: a grown-up's choice

Every assistant SKYCOT can drive is available in the Family profile, but the ones SKYCOT can't
lock down (everything except Codex and Claude) only start for a child once a grown-up has allowed
them, one assistant at a time, with the parent code. It's the parent's choice for their children;
SKYCOT's job is to show the terms plainly first.

- **Where.** In the conversation, the refused message shows "Ask a grown-up to say yes" for the
  child and **Allow Cursor for the Family profile…** for the grown-up. In **Settings › Family › AI
  assistants for children**, every assistant is listed as **Locked down** (Codex, Claude),
  **Allowed by a grown-up** or **Not allowed**, with **Allow…** or **Stop allowing**.
- **What the grown-up reads first** (the allow sheet, Cancel first): (1) that assistant's own age
  rules, as the site's FAQ states them ("As of October 2026, Anthropic's Claude and Cursor require
  every user to be 18 or over, and OpenAI's terms allow 13 to 17 year olds with a parent's
  permission; Google sets its own rules for Gemini and Antigravity"), or "Check …'s own terms for
  age rules" where SKYCOT states no fact, with a link to the provider's terms only where SKYCOT's
  legal notes already cite one (OpenAI, Anthropic, Cursor, Antigravity, Grok); (2) that SKYCOT can't
  switch off that assistant's own add-ons (plugins, connectors and helper tools set up on this
  computer), so a child using it may reach them, while SKYCOT's other Family rules still apply.
  Then the parent code. Codex's and Claude's age rules also show where a parent picks an assistant
  for a child (the welcome steps and Settings › AI assistants); they need no allowance.
- **How it is kept.** The allowance lives in the engine's profile file (`allowedAssistants` in
  `skycot-family.json`), next to the children and the code. Allowing takes the parent code with
  that one request; a wrong code counts towards the same five tries and five-minute wait as every
  other prompt, and leaves no "yes" open afterwards. Codex and Claude can't be put on the list (they
  are locked down anyway); a hand-edited file can't unlock them either. Allowing is for every child
  in the profile, and turning the profile off forgets it.
- **Stopping.** **Stop allowing** needs no code: it only makes the profile stricter, so a child
  pressing it loses nothing a grown-up can't give back. It counts at once: an allowed assistant's
  conversation that is still open refuses its next message and is closed, and a new one is refused
  before it starts.
- **Honest limits.** An allowed assistant runs with whatever its own add-ons can do on this Mac
  (computer use, browser control, connectors), which can go around SKYCOT's checks the same way the
  lockdown for Codex and Claude exists to prevent. Ask first and plan first are held by the engine
  for every assistant, but how faithfully an assistant asks before its own tools act depends on how
  it reports them to SKYCOT. The age facts are as of October 2026 and the providers can change them;
  SKYCOT doesn't check a child's age or the parent's account type.

## What the engine checks

Every call a client can make to SKYCOT's engine was looked at, and a test keeps it that way:
a call added later fails the tests until someone decides. Calls that only read, watch, stop
or take something away (declining, pausing or deleting an automation, signing a device out)
stay open. "Grown-up" names the parent's "yes" a call needs; Advanced mode covers every one.

| Calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Needs                                                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Allowing a held step (`runtime-request.respond` with accept), any "allow for the session/always"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Grown-up: that one step                                                                                                                                                                                                                                                                                                                                                                  | internet, installs, deleting, outside the project, secrets, admin rights, connected apps                             |
| `pullRequests.runAction`, `update`, `comment`, `updateComment`, `submitReview`, `replyToThread`, `setThreadResolution`, `setReaction`, `requestReviewers`, `setLabels`; `sourceControl.publishRepository`; `git.runStackedAction` other than commit                                                                                                                                                                                                                                                                                                                                              | Grown-up: publishing                                                                                                                                                                                                                                                                                                                                                                     | puts work where other people see it                                                                                  |
| `scheduledTasks.upsert`, `runNow`, `rotateWebhookToken`, `setEnabled` (on)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Grown-up: automations                                                                                                                                                                                                                                                                                                                                                                    | runs later, on its own                                                                                               |
| `projects.add`, `projects.remove`, `projects.mutate` (adding, removing, or moving a project's folder), `sourceControl.cloneRepository`, `projectClone.start`/`retry`, `vcs.createWorktree`/`removeWorktree`, `launchThread` with a new worktree fetched from the internet or for a project SKYCOT does not have                                                                                                                                                                                                                                                                                  | Grown-up: another folder                                                                                                                                                                                                                                                                                                                                                                 | the assistant would work somewhere else                                                                              |
| `projects.writeFile`, `thread.create` and `launchThread` with a folder; `launchThread` making a conversation's private copy (it is what makes Undo work)                                                                                                                                                                                                                                                                                                                                                                                                                                         | Open inside a SKYCOT project; elsewhere Grown-up: another folder                                                                                                                                                                                                                                                                                                                         | writes or works outside the project                                                                                  |
| `server.updateSettings` (anything but "Ask me first"), `server.updateProvider`, `provider.install.start`/`remove`, `provider.auth.start`/`complete`/`respond`/`logout`, `provider.chatgpt.reconnect-profile`/`import-profile`, `provider.consumeResetCredit`, `provider.uploadFeedback`, `server.upsertKeybinding`/`removeKeybinding`, `secrets.answerRequest` (save)                                                                                                                                                                                                                            | Grown-up: AI assistants                                                                                                                                                                                                                                                                                                                                                                  | the parent's accounts, sign-ins, settings and keys; feedback sends conversations away                                |
| `projects.mutate` changing a project's scripts, assistant, auto-pull, conversation folder mode or favicon, `terminal.open`/`attach`/`write`/`restart`, `server.updateServer*`, `commitDesktopUpdate`, every ACP-registry change, `server.signalProcess`, `runStorageCleanup`, `checkOtlpEndpoint`, `cloud.installRelayClient`, `shell.openInEditor`, `device.configure`/`testHost`/`open`/`close`/`shutdown`/`action`, `agentSessions.import`, `mcpApps.callTool`, `vcs.pull`, `git.resolvePullRequest`/`preparePullRequestThread`, `preview.open`/`navigate` to an address that is not this Mac | Grown-up: Advanced mode                                                                                                                                                                                                                                                                                                                                                                  | developer tools, outside agents, other devices, the internet                                                         |
| HTTP: `/api/projects/mutate` (as `projects.mutate`), `/api/auth/pairing-token`, `/api/connect/*` changes, `/api/t3-connect/mint-credential`, `/oauth/mcp/decision` (approve)                                                                                                                                                                                                                                                                                                                                                                                                                     | as the call it mirrors; otherwise Advanced mode                                                                                                                                                                                                                                                                                                                                          | letting another device or an outside agent in                                                                        |
| Just ask: `projects.ensureScratch`, `launchThread` into Questions, `projects.writeFile` or `thread.create` inside a question's folder; **Make this a project** (`projects.mutate` `project.create` of a question's folder) and its Undo (`project.delete`, without `force`, of a project made from a question)                                                                                                                                                                                                                                                                                   | Open; any other folder, or removing any other project, Grown-up: another folder                                                                                                                                                                                                                                                                                                          | the question's folder is SKYCOT's own space, not the family's folders; taking a project off the list keeps its files |
| Deleting a conversation (`thread.delete`; putting it away stays open)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Grown-up: that one conversation, spent by the delete                                                                                                                                                                                                                                                                                                                                     | it can't be undone                                                                                                   |
| Undo, Restore and **Go back to here** (`checkpoint.rollback`, with or without the files)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Open; works at bedtime and the day's cap (it is not a message)                                                                                                                                                                                                                                                                                                                           | only moves the private copy back to a version SKYCOT saved                                                           |
| Putting a conversation away or bringing it back (`thread.archive`, `thread.unarchive`); renaming it (`thread.metadata.update` with a title); renaming a project or changing its icon (`projects.mutate` with only `title` and `projectIcon`)                                                                                                                                                                                                                                                                                                                                                     | Open; with a folder (`worktreePath`), Grown-up: another folder                                                                                                                                                                                                                                                                                                                           | each can be undone; a folder is where the assistant works                                                            |
| `/api/skycot/family/rename`, `/children/add`, `/children/update`, `/children/remove`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Grown-up: AI assistants                                                                                                                                                                                                                                                                                                                                                                  | the children are part of the profile                                                                                 |
| `/api/skycot/family/recap`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Grown-up: the recap (or the Family settings' yes)                                                                                                                                                                                                                                                                                                                                        | a child's words and what needed a grown-up are a parent's to read                                                    |
| `/api/skycot/preview/start` (starting a conversation's site)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | The person's yes, always; Grown-up: that one start when the start command installs something, uses the internet or trips a hard rule                                                                                                                                                                                                                                                     | runs the project's own start command on the Mac                                                                      |
| `/api/skycot/preview/address` (where the preview may go)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | This Mac's addresses: open; anything else Grown-up: that site, once                                                                                                                                                                                                                                                                                                                      | the internet                                                                                                         |
| `/api/skycot/updates/allow-restart`, then the Mac app's own install handler (it reads the profile and needs the engine's two-minute note for that version)                                                                                                                                                                                                                                                                                                                                                                                                                                       | Grown-up: restart to update                                                                                                                                                                                                                                                                                                                                                              | a new version replaces SKYCOT; checking and downloading stay open                                                    |
| `/api/skycot/family/more-time`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | The parent code, with the request                                                                                                                                                                                                                                                                                                                                                        | wakes SKYCOT for a child; nothing stays open afterwards                                                              |
| A child's turn, whatever starts it (`sourcePlanRef` marks a Build it; a plan whose turn was taken back does not count)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Runs as a plan unless it builds a waiting plan                                                                                                                                                                                                                                                                                                                                           | a plan before making anything                                                                                        |
| A child's message (`message.dispatch`, `launchThread` with a first message, resuming or promoting a queued one) and a child's "Allow"                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Refused while SKYCOT is asleep for the child                                                                                                                                                                                                                                                                                                                                             | bedtime and the daily limits; Advanced mode is exempt                                                                |
| `/api/skycot/files/list`, `/api/skycot/files/read` (Files and Quick Look)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Open inside a SKYCOT project or a conversation's private copy; hidden and secret files, add-ons and build output: Grown-up: Show everything; outside the project (`../`, a full path, a symlink out): refused, code or not                                                                                                                                                               | a child's own work; secrets and the rest of the Mac stay a grown-up's                                                |
| `projects.readFile`, `projects.listEntries`, `listIgnoredFiles`, `searchEntries`, `searchContents`; `assets.createUrl` for a draft or media file                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Open inside a SKYCOT project or private copy (real paths, so a symlinked folder counts as where it is); elsewhere, or a hidden or secret file: Grown-up: Show everything                                                                                                                                                                                                                 | reading the rest of the Mac                                                                                          |
| `shell.openInEditor` as Show in Finder (`file-manager`, `reveal`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Grown-up: Show everything                                                                                                                                                                                                                                                                                                                                                                | Finder shows the rest of the Mac                                                                                     |
| A linked device's sign-in (its session's subject names the device; its scopes were fixed when the link was made)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | A removed device: refused everything. A grown-up's device: only calls T3's read permission covers. A child's device: only calls naming its own conversations, projects and folders (a page pinned to the fridge may be read); `orchestration.searchThreads`, `searchThreadStream`, `agentSessions.scan`/`import`, `server.listAcpRegistrySessions`, `pullRequests.linkedThreads` refused | who is who: a child's device is that child's, a grown-up's device only reads                                         |
| `/api/skycot/family/devices`, `/devices/link`, `/devices/remove`, `/people/add`, `/people/update`, `/people/remove`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The family's Mac only, with Grown-up: AI assistants (the Family settings' yes)                                                                                                                                                                                                                                                                                                           | linking a device lets it in                                                                                          |
| `/api/skycot/family/approver/requests`, `/approver/answer` (accept or decline only), `/approver/challenge`, `/approver/more-time`, `/approver/lock-all`, `/approver/watch/*`, `/devices/passkey/*`, `/devices/unlink-self`                                                                                                                                                                                                                                                                                                                                                                       | A grown-up's own device only; a yes needs its passkey, the parent code or its Watch's key, more time a passkey or the code, checked by the engine for that one request                                                                                                                                                                                                                   | the approval contract: one request, once, logged                                                                     |
| `/api/orchestration/threads/:id/*`, `/api/orchestration/shell`, `/api/projects`, `/api/skycot/files/*`, `/api/skycot/preview/*`, `/api/skycot/badges/*`                                                                                                                                                                                                                                                                                                                                                                                                                                          | On a child's device: only its own; the lists are filtered. On a grown-up's device: Files, previews and badges refused                                                                                                                                                                                                                                                                    | per-person visibility over HTTP                                                                                      |
| Everything else: reading and watching (lists, diffs, status, searches inside a project), the fridge (and pinning), sending messages, stopping, declining, the child's own project (new project, writing inside it, saving a version, previews on this Mac), pausing or deleting an automation, cancelling a sign-in or install, revoking a device                                                                                                                                                                                                                                                | Open                                                                                                                                                                                                                                                                                                                                                                                     | the child's own work, or it only stops or takes away                                                                 |

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
- **The live preview's start command runs outside the assistant's safe area.** SKYCOT checks its
  words (and the script it runs) for installs and the internet, not what the program then does: a
  project server that itself downloads something is not caught.
- **A previewed page can load pictures and scripts from the internet**, as it would in any
  browser; only where the preview itself goes is checked. In the Mac app a link to the internet
  arrives before it is sent back, so the page may flash for a moment. In a web browser (not the
  Mac app) links inside the preview are not checked at all, and **Point at something** is not
  available there.
- **Other text the AI writes from the child's words** (conversation titles) is made without
  the rules; it never reaches the child as an answer. It runs without the grown-up's add-ons, like
  the child's conversation.
- **The assistants' own built-in tools stay.** Switching off the grown-up's add-ons leaves what
  Codex and Claude come with: running commands and changing files in the project (each one asked
  first), web search, Codex's image generation and helper agents. The engine's checks on installs,
  the internet, deleting and publishing apply to those as before.
- **Codex still reads the grown-up's `AGENTS.md`** (instructions in words, not tools), and Codex
  itself marks a child's project folder as trusted in the grown-up's `~/.codex/config.toml`, as it
  does for any folder it works in. SKYCOT does not edit that file.
- **An assistant a grown-up allowed** (anything other than Codex and Claude) keeps its own add-ons,
  which can reach outside SKYCOT; see [Other assistants: a grown-up's choice](#other-assistants-a-grown-ups-choice).
- **Settings an administrator manages** (an organisation's managed Codex or Claude settings, which
  a family Mac does not normally have) still apply as Codex and Claude intend.
- **Checking which providers SKYCOT can use** starts Codex and Claude briefly with the grown-up's
  normal setup, as SKYCOT always has; no conversation and no child's words are involved.
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
- **Files: a shortcut changed at just the wrong moment.** The engine checks where a path really
  leads and then reads it; a program on the Mac swapping a folder for a shortcut between those two
  steps could slip past. Nothing in SKYCOT does that; a person at Terminal could.
- **Files: what a page loads by itself.** Quick Look puts a page's own styles, scripts and pictures
  inside it; pictures named inside a style sheet (`url(...)`) and anything from the internet do not
  load. PDFs use the browser's own viewer: where there is none (some Mac app builds), Quick Look
  says so and a grown-up opens it from Finder. The browser's PDF viewer has its own Download and
  Print buttons, which save a copy and never change the file.
- **Files: folder names when opening a folder.** **Open a folder…** still lists the names of
  folders on the Mac (not their files) before the parent code is asked for adding one.
- **The recap needs the code, the fridge does not.** Siblings can see each other's magnets and
  open each other's pages, as they can open each other's conversations. A child who knows the code
  can read the recap.
- **Limits are counted, not watched.** Time counts while the child is touching SKYCOT, so a
  child reading a long answer without touching anything for more than two minutes is not
  counted, and SKYCOT left open but untouched is not either. A message sent before bedtime that
  was waiting its turn behind another still runs.
- **Deleting `skycot-family-activity.json`** (Terminal or Finder) resets today's counters, and
  changing the Mac's clock or time zone moves bedtime with it.
- **The picker trusts the child, on the Mac.** A child can pick a sibling's picture on the
  family's Mac (or a browser paired the old way) and use the sibling's time and see their work;
  moving away from a child who is asleep is the only switch that needs the code there. A child's
  own linked device has no picker. See [People and devices](#people-and-devices-who-is-who).
- **Another browser or device** can only reach SKYCOT after it has been paired with the Mac,
  and the engine enforces the same profile for it. One paired the old way (the `skycot pair`
  link, or Advanced mode › Connections) is treated like the Mac, picker and all; link it from
  Settings › Family instead to make it a person's.
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
