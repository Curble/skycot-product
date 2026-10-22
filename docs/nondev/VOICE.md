# Talk to SKYCOT

Two things, both in the message box and on SKYCOT's replies:

- **Voice typing.** The microphone beside the message box. Tap it, talk, tap it again. The
  words appear in the box as they are heard; nothing is sent until **Send** is pressed.
  Listening stops after a minute, when the box is typed in or sent, and as soon as SKYCOT's
  window or tab goes into the background.
- **Read it to me.** A button under every reply. **Read replies aloud automatically**
  (Settings → Voice) reads a reply once it finishes, while that conversation is open; it is on
  by default for a Family profile (each child's own setting) and off otherwise.

## Where the sound goes

SKYCOT never records, uploads or keeps audio. It uses what the browser provides:

|                            | Who turns speech into text | Where the audio goes                                               |
| -------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Safari                     | Apple's dictation          | On the Mac on newer macOS; otherwise to Apple, under Apple's terms |
| Chrome                     | Google's speech service    | To Google, under Google's terms                                    |
| Edge                       | Microsoft's speech service | To Microsoft, under Microsoft's terms                              |
| SKYCOT app window, Firefox | —                          | Voice typing is not offered there yet                              |

Settings → Voice and Settings → Privacy say which applies to the browser in use. SKYCOT's
engine has no transcription service of its own: the shared voice-input module in
`packages/client-runtime` is the mobile app's on-device iOS transcriber, which browsers cannot use.

Reading aloud uses the voices installed on the Mac (`speechSynthesis`), so replies are spoken
locally and go nowhere. SKYCOT picks a friendly English voice (Australian first in an
Australian time zone, then the browser's own English, then British and American; novelty
voices such as Zarvox are skipped). Code, links, file names and anything that looks like a
password or key are not read out — they become "some code", "a link", "a file" and "a secret".

## Family profile

Each child has their own voice settings, kept by SKYCOT's engine with the rest of their profile
(Settings → Family → the child's card → **Edit…**, parent code):

- **Voice typing starts off** for every child, including profiles set up before siblings
  existed. In Chrome and Edge the browser sends the child's voice to Google or Microsoft, so a
  parent turns it on knowingly: switching it on shows where this browser sends the voice and
  recommends Safari for children (on recent Macs Apple's dictation can stay on the Mac).
- **Read aloud starts on**: it uses the Mac's own voices, so nothing leaves the Mac.

The device switch, **Voice typing on this device** in Settings → Family, still exists: it keeps
the microphone off in this browser for every child, whatever their settings say. It is kept by
the browser, not the engine (see [FAMILY.md](FAMILY.md#what-is-still-possible)).

## Starter cards

Home (and an empty conversation) shows one-tap starters. With a Family profile or the Workshop
look they are for children (a game, a page about a pet, a birthday card…); other looks show a
business set (a contact form, a price list…). A tap fills the message box — the first
`[blank]` is selected for typing over — and nothing is sent until **Send**. Children's starters
ask for one small page in one file that works offline with nothing to install. When the turn
adds or changes a page, **Open it** on the What changed card runs it inside SKYCOT in a
sandboxed frame that cannot reach the internet or SKYCOT's own data.
