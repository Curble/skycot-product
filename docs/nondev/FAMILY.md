# The Family profile

The **Family profile** is a safer way to set SKYCOT up for a child you look after.
It is a set of guardrails inside the app, kept in place by a **parent code**. It is
not a security product, and it says so on every screen where it matters.

## What it does

When the Family profile is on:

- **The Workshop look is used.** Cream paper, marker pens, and a named crew: Sam
  builds, Mo checks. The child can still pick any other look in Settings → Appearance;
  looks never change what SKYCOT does.
- **The assistant always asks first.** Autonomy is fixed at "Ask me first" everywhere:
  the compose box shows a small padlock instead of the choice, and Settings → Autonomy
  & safety is read-only. "Just do it, carefully" and "Fully hands-off" are not offered.
- **The developer tools are hidden.** "Open Advanced mode" leaves the sidebar and the
  Settings list. A parent can still open it from Settings → Family with the code.
- **The parent code is asked for** before: publishing (both _Send for review_ and
  _Put it live_ gain a "Parent code" step before Confirm), creating an automation,
  opening Advanced mode, running the welcome steps again, changing the code, and
  turning the profile off.
- **Text is larger.** Settings → Appearance → "Larger text" is switched on (about an
  eighth bigger, everything together). Anyone can switch it off again.
- **The greeting uses the child's name**, if one was given: "Good evening, Ava."

## What it does not do

- It does not filter the web or decide what the AI may talk about.
- It does not lock the Mac, limit screen time, or replace Screen Time.
- It does not stop a determined teenager. The code lives in this browser and can be
  cleared from the browser's developer tools or by clearing site data.

These are guardrails for a child who isn't trying to get round them, not a security
product.

## Turning it on

- **First run:** the welcome steps start with _Who is this for?_ Choose **A child I
  look after**, give a first name (optional), choose a 4–6 digit parent code and type
  it twice. The rest of the steps follow as usual; _Pick a look_ comes with Workshop
  already chosen and the autonomy step is replaced by "Always asks first". The profile
  only turns on when you press **Open SKYCOT** on the last step. Skipping half-way
  turns nothing on.
- **Later:** Settings → Family → **Set up…** shows the same form in its own sheet.

## Turning it off

Settings → Family → **Turn off…** asks for the parent code, then confirms. Turning it
off forgets the child's name and the code. The look and the larger text stay as they
are; autonomy, Advanced mode and publishing open up again.

## The parent code

- 4 to 6 digits. A repeated or counting code ("1111", "1234") is flagged as easy to
  guess but still allowed.
- Five wrong tries in a row lock every code prompt for five minutes. The prompt says
  how many tries are left, and how long to wait.
- **Change it** in Settings → Family → Change parent code: enter the current code,
  then the new one twice.
- **Forgotten?** There is no reset. The way back is Advanced mode (if a parent can
  still reach it) or clearing this browser's site data for SKYCOT, which also turns
  the profile off.

## Where the code is stored

SKYCOT keeps a scrambled version of the code (a salted SHA-256 hash) in this
browser's local storage, under the key `skycot:family`, together with the child's
name, when the profile was set up, and the wrong-try counter. The code itself is
never written anywhere. Nobody can read it back, including SKYCOT. Nothing about the
profile is sent to the engine or anywhere else; the one engine setting it changes is
the default autonomy ("approval-required"), which is also what SKYCOT uses when no
profile is on.

Because it is per browser: a second browser, or the Mac's own developer interface,
does not have the profile. Set it up in each browser the child uses.
