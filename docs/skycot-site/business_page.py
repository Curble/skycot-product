# skycot.com/business: the page for SKYCOT Business, the Mac app for small business owners (built in
# Curble/skycot-business). Mark picked layout B2 on 3 November 2026 from
# docs/skycot-business/design-explorations/2026-11-03/business-page (in the SKYCOT folder): "What does your
# business do?" with a chooser that fills in a drawing of the app's Today page. Same sky look as the home
# page. Every claim matches the app as built (0.1.1): files on the Mac, the owner's own ChatGPT, Claude or
# Gemini plan, nothing sent without the owner's OK, files can be put back, "Stuck? Ask SKYCOT".
import html, json

# Where "Get it for Mac" points. None until Mark says the Business download is public; until then the
# button asks for early access by email.
BIZ_DOWNLOAD = None
EARLY_ACCESS = "mailto:markhallam@skycot.com?subject=SKYCOT%20Business%20early%20access"

TITLE = "SKYCOT Business · Help with the busywork, on your Mac"
DESC = ("SKYCOT Business learns how your business works, then drafts quotes, reminders, review requests and "
        "paperwork on your Mac with the AI plan you already have. Nothing is sent without your OK.")

# Three starter jobs per kind of business. They match the app's own starter briefs (nondev jobs/starters.ts).
TRADES = [
    ("Trades", "Plumbers, electricians, builders, cleaners, gardeners",
     ["Write a quote from my notes", "Remind customers about tomorrow's job", "Ask happy customers for a review"]),
    ("Salon or studio", "Hair, nails, beauty, massage, yoga, fitness",
     ["Send appointment reminders", "Write this week's specials post", "Welcome new clients"]),
    ("Clinic", "Physio, dental, chiro, psychology, vets",
     ["Write a new-patient welcome pack", "Draft a follow-up after a visit", "Tidy my notes into a list"]),
    ("Shop", "Online shops, retail, cafes, makers",
     ["Write product descriptions", "Draft a supplier order", "Plan this month's newsletter"]),
    ("Bookkeeper", "Bookkeepers, accountants, admin services",
     ["List what each client still owes me", "Chase missing receipts politely", "Write a month-end checklist"]),
    ("Club or charity", "Sports clubs, community groups, charities, schools",
     ["Write the members' newsletter", "Draft a funder update", "Make a volunteer roster"]),
]

def _ic(path):
    return (f'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>')

IC_CHAT = _ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z"/>')
IC_HAND = _ic('<path d="M8 13V6a1.5 1.5 0 0 1 3 0v6M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.2-2.3L4 14.5a1.5 1.5 0 0 1 2.5-1.7L8 15"/>')
IC_UNDO = _ic('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>')
IC_MAC = _ic('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>')
IC_KEY = _ic('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>')
IC_Q = _ic('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>')

CSS = r'''
:root{--font:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;
--accent:#0071e3;--h1:#0066d6;--ink:#15171c;--ink2:#3a3d46;--ink3:#55586a;--glass:rgba(255,255,255,.74);--glass2:rgba(255,255,255,.94);
--edge:rgba(255,255,255,.85);--hair:rgba(18,32,64,.1);--sky1:#c4e2fa;--sky2:#a9d5f8;--sky3:#dcebf7;--navbg:rgba(196,226,250,.78)}
@media (prefers-color-scheme:dark){:root{--h1:#8cc8ff;--ink:#f2f3f8;--ink2:#d0d3e0;--ink3:#a9adc2;--accent:#2b8cff;
--glass:rgba(30,34,84,.72);--glass2:rgba(40,44,100,.94);--edge:rgba(140,150,230,.25);--hair:rgba(200,210,255,.14);
--sky1:#2e2b72;--sky2:#21235e;--sky3:#131641;--navbg:rgba(33,35,94,.78)}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;font-family:var(--font);color:var(--ink);line-height:1.45;
background:linear-gradient(180deg,var(--sky1),var(--sky2) 900px,var(--sky3) 2200px,var(--sky3))}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:12px;z-index:20;background:#fff;padding:8px 12px;border-radius:8px}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
.bnav{position:sticky;top:0;z-index:10;background:var(--navbg);backdrop-filter:saturate(1.6) blur(14px);-webkit-backdrop-filter:saturate(1.6) blur(14px);border-bottom:1px solid var(--hair)}
.bnav .wrap{display:flex;align-items:center;gap:22px;height:56px;font-size:14px}
.bnav .brand img{display:block}.bnav .brand .rev{display:none}
@media (prefers-color-scheme:dark){.bnav .brand .day{display:none}.bnav .brand .rev{display:block}}
.seg{display:inline-flex;background:var(--glass);border:1px solid var(--edge);border-radius:999px;padding:3px}
.seg a{padding:5px 14px;border-radius:999px;color:var(--ink2);font-weight:500;text-decoration:none}
.seg a[aria-current]{background:var(--glass2);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.bnav ul{display:flex;gap:22px;list-style:none;margin:0 0 0 auto;padding:0}.bnav ul a{color:var(--ink2)}
.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:999px;padding:14px 26px;font-weight:600;font-size:17px;text-decoration:none!important}
.btn:hover{filter:brightness(1.08)}.btn.s{padding:7px 16px;font-size:14px;white-space:nowrap}
h1{font-size:clamp(42px,5.6vw,68px);line-height:1.03;letter-spacing:-.035em;margin:0;font-weight:800}
h1 em,h2 em{font-style:normal;color:var(--h1)}
h2{font-size:clamp(32px,4.4vw,50px);letter-spacing:-.03em;line-height:1.06;margin:0 0 14px;font-weight:800}
.lede{font-size:clamp(19px,2.2vw,23px);color:var(--ink2);margin:16px 0 0;font-weight:500}
.fine{font-size:13.5px;color:var(--ink3);margin-top:14px}
.center{text-align:center}.center .lede{margin-left:auto;margin-right:auto;max-width:720px}
.hero{padding:56px 0 24px}.hero .grid{display:grid;grid-template-columns:5fr 6fr;gap:44px;align-items:center}
.chips{margin:22px 0 0 -4px}
.chip{display:inline-block;padding:9px 16px;border-radius:999px;background:var(--glass);border:1px solid var(--edge);font:500 15px var(--font);margin:4px;color:var(--ink);cursor:pointer}
.chip[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
.chip:focus-visible{outline:3px solid rgba(0,113,227,.45);outline-offset:2px}
.win{background:#f5f5f7;border-radius:14px;border:1px solid rgba(0,0,0,.1);box-shadow:0 24px 60px rgba(20,40,90,.22);overflow:hidden;color:#1d1d1f}
.win .bar{display:flex;align-items:center;gap:7px;padding:10px 14px;background:#ececee;border-bottom:1px solid #ddd;font-size:13px;font-weight:600}
.win .bar i{width:11px;height:11px;border-radius:50%;background:#ff5f57}.win .bar i:nth-child(2){background:#febc2e}.win .bar i:nth-child(3){background:#28c840;margin-right:8px}
.win .body{display:grid;grid-template-columns:150px 1fr;min-height:360px}
.win .side{background:#e9e9ee;padding:12px 8px;font-size:13px}.win .side div{padding:6px 10px;border-radius:7px}.win .side .on{background:#d3e1f5}
.win .main{background:#fff;padding:22px 24px}.win .hello{margin:0;font-size:24px;font-weight:700}.win .sub{color:#6e6e73;font-size:13px;margin-bottom:16px}
.win .lbl{font-size:12.5px;color:#6e6e73;margin:4px 0 10px;display:flex;gap:8px;align-items:center}
.idea{border:1px solid #e5e5ea;border-radius:12px;padding:12px 14px;margin-bottom:10px;font-size:14px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.idea b{display:block}.idea span{color:#6e6e73;font-size:12.5px}.idea .go{background:#0071e3;color:#fff;border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:600;white-space:nowrap}
section{padding:72px 0}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.card{background:var(--glass);border:1px solid var(--edge);border-radius:22px;box-shadow:0 18px 50px rgba(30,60,110,.12);padding:24px}
.card h3{margin:0 0 6px;font-size:19px;letter-spacing:-.01em}.card p{margin:0;color:var(--ink2);font-size:15.5px}
.ico{width:40px;height:40px;border-radius:12px;background:rgba(0,113,227,.12);display:grid;place-items:center;color:var(--accent);margin-bottom:12px}
.shot{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--hair);box-shadow:0 20px 60px rgba(20,40,90,.22)}
.split h3{font-size:24px;margin:0 0 8px;letter-spacing:-.015em}.split p{color:var(--ink2);font-size:17px;margin:0 0 24px}
.faq{max-width:760px}details{border-top:1px solid var(--hair);padding:16px 0}details:last-child{border-bottom:1px solid var(--hair)}
details summary{font-weight:600;font-size:17px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:16px}
details summary::-webkit-details-marker{display:none}details summary::after{content:"+";color:var(--ink3)}details[open] summary::after{content:"\2212"}
details p{color:var(--ink2);margin:10px 0 0}
.get img{width:150px;height:auto}
footer{padding:40px 0 60px;font-size:13px;color:var(--ink3);border-top:1px solid var(--hair)}
footer .cols{display:flex;gap:24px;align-items:center;flex-wrap:wrap}footer ul{display:flex;flex-wrap:wrap;gap:6px 18px;list-style:none;margin:0;padding:0}
footer ul a{color:var(--ink2)}footer .legal{margin-top:18px;max-width:900px}footer .lockup img{display:block}
@media (max-width:860px){.hero .grid,.split,.grid3,.grid2{grid-template-columns:1fr}.bnav ul{display:none}.bnav .s{margin-left:auto}.bnav .wrap{gap:12px}.seg a{padding:5px 11px}
.win .body{grid-template-columns:1fr}.win .side{display:none}section{padding:52px 0}}
@media (max-width:430px){.bnav .m{display:none}}
'''

def _cta(label):
    if BIZ_DOWNLOAD:
        return f'<a class="btn" href="{BIZ_DOWNLOAD}">{label}</a>'
    return f'<a class="btn" href="{EARLY_ACCESS}">Ask for early access</a>'

def _chips():
    return "".join(f'<button class="chip" type="button" data-t="{i}" aria-pressed="{str(i == 0).lower()}">{html.escape(t)}</button>'
                   for i, (t, _, _) in enumerate(TRADES))

def _ideas(jobs):
    return "".join(f'<div class="idea"><div><b>{html.escape(j)}</b><span>A natural fit for what you do.</span></div>'
                   f'<span class="go" aria-hidden="true">Start</span></div>' for j in jobs)

def _card(icon, title, text):
    return f'<div class="card"><div class="ico">{icon}</div><h3>{title}</h3><p>{text}</p></div>'

FAQ = [
    ("What kind of business is it for?",
     "Any small business or sole trader: trades, salons, clinics, shops, bookkeepers, clubs and charities. It asks about your business first, then suggests jobs that fit."),
    ("Do I need to be good with computers?",
     "No. You answer a few questions by tapping or typing, and every screen has a “?” button where you can ask SKYCOT what to do. Larger text is one tap away."),
    ("Which AI do I need?",
     "A paid ChatGPT, Claude or Google Gemini plan that you sign in to, the same way you sign in on the web. No API keys. If you don't have a plan yet, SKYCOT shows you which ones work. SKYCOT adds no fee."),
    ("Is my clients' information safe?",
     "It stays on your Mac. There is no SKYCOT account and no SKYCOT cloud. When a job needs your files, only what that job needs goes to your own AI, under that company's terms and your plan's settings. SKYCOT asks you first before using anything outside your business folder."),
    ("Can it send emails or lodge my tax for me?",
     "Not on its own. It drafts messages, quotes, lists and documents for you to check and send yourself. When something is outside what it can do, it says so plainly and offers the nearest thing it can."),
    ("What do I need to run it?",
     "A Mac with Apple silicon (M1 or newer) and macOS 13 or newer."),
]

def business_page(head, footer):
    t0, who0, jobs0 = TRADES[0]
    data = json.dumps([{"name": t.lower(), "who": w, "jobs": j} for t, w, j in TRADES], separators=(",", ":"))
    faq = "".join(f"<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>" for q, a in FAQ)
    body = f'''<a class="skip" href="#main">Skip to content</a>
<header class="bnav"><div class="wrap">
  <a class="brand" href="/" aria-label="SKYCOT home"><img class="day" src="/assets/brand/wordmark.svg" width="65" height="24" alt=""><img class="rev" src="/assets/brand/wordmark-reversed.svg" width="65" height="24" alt=""></a>
  <nav class="seg" aria-label="Choose SKYCOT"><a href="/">Families</a><a href="/business" aria-current="page">Business</a></nav>
  <ul><li><a href="#how">How it works</a></li><li><a href="#safety">Your information</a></li><li><a href="#faq">Questions</a></li></ul>
  <a class="btn s" href="#get">Get it<span class="m"> for Mac</span></a>
</div></header>
<main id="main">
<section class="hero" aria-labelledby="biz-title"><div class="wrap grid">
  <div>
    <h1 id="biz-title">What does your <em>business do?</em></h1>
    <p class="lede">Tap one, and see your SKYCOT on day one.</p>
    <div class="chips" role="group" aria-label="Kinds of business">{_chips()}</div>
    <p style="margin-top:26px">{_cta("Get it for Mac")}</p>
    <p class="fine">For Mac &middot; Uses your own ChatGPT, Claude or Gemini plan &middot; Nothing goes to your customers without your OK</p>
  </div>
  <div class="win" role="img" aria-label="A drawing of the SKYCOT Business Today page, showing three suggested jobs for the kind of business you picked">
    <div class="bar"><i></i><i></i><i></i>SKYCOT Business</div>
    <div class="body"><div class="side"><div class="on">Today</div><div>Jobs</div><div>Done</div><div>About my business</div></div>
    <div class="main"><p class="hello">Good morning.</p><div class="sub">Nothing is waiting on you.</div>
      <div class="lbl"><img src="/assets/brand/mascot-hello-day.svg" width="26" height="26" alt=""><span>I could help with these, for your <b id="biz-kind">{html.escape(t0.lower())}</b> business</span></div>
      <div id="biz-ideas" aria-live="polite">{_ideas(jobs0)}</div></div></div>
  </div>
</div></section>

<section id="how" aria-labelledby="how-title"><div class="wrap">
  <div class="center"><h2 id="how-title">Set up in <em>one cup of coffee.</em></h2></div>
  <div class="grid3" style="margin-top:34px">
    {_card(IC_CHAT, "1. Tell it about your business", "A few questions, one at a time. Tap an answer, type your own, or say “Not sure”. Paste your price list to skip ahead.")}
    {_card(IC_HAND, "2. Pick a first job", "It suggests three that fit what you do. Or just type what you need, in your own words.")}
    {_card(IC_UNDO, "3. Check it, then send it", "It asks before it changes a file, and nothing goes to your customers until you send it.")}
  </div>
  <div class="split" style="margin-top:64px">
    <img class="shot" src="/assets/biz-interview.jpg" width="1280" height="800" alt="SKYCOT Business asking a plumber who they do work for, with tap-to-answer choices and what it has learned so far">
    <div><h3>It learns your business first.</h3><p>Then every job sounds like you: your spelling, your currency, your tax and the way you talk to people. You can change anything it learned, any time.</p>
    <h3>Then a home page for your day.</h3><p>What's waiting on you, what's done, and ideas that fit what you do.</p></div>
  </div>
  <div style="max-width:980px;margin:56px auto 0"><img class="shot" src="/assets/biz-today.jpg" width="1280" height="800" alt="The SKYCOT Business Today page: a finished quote, and an idea to ask happy customers for a review"></div>
</div></section>

<section id="safety" aria-labelledby="safety-title"><div class="wrap">
  <div class="center"><h2 id="safety-title">Careful by <em>design.</em></h2><p class="lede">Built for people who can't afford a mistake with a client's details.</p></div>
  <div class="grid2" style="margin-top:36px">
    {_card(IC_MAC, "Your files stay on your Mac.", "No SKYCOT account and no SKYCOT cloud. What it learns about your business is kept in a folder you can open and read.")}
    {_card(IC_HAND, "You say when anything goes out.", "SKYCOT drafts. You check it and send it. Each change shows what it is and what happens if you say no.")}
    {_card(IC_UNDO, "Files can always be put back.", "Changed your mind? Put a file back the way it was. Messages can't be unsent, so you always see them first.")}
    {_card(IC_KEY, "Uses the AI you already pay for.", "Sign in with your own ChatGPT, Claude or Google Gemini plan. No API keys and no technical setup.")}
  </div>
</div></section>

<section aria-labelledby="help-title"><div class="wrap split">
  <div><div class="ico">{IC_Q}</div><h2 id="help-title">Stuck? <em>Just ask.</em></h2>
  <p class="lede" style="margin:0">Every screen has a “?” button. Ask “What do I do here?” or “Is my information safe?” and SKYCOT answers in plain words.</p></div>
  <img class="shot" src="/assets/biz-help.jpg" width="1280" height="820" alt="The Stuck? Ask SKYCOT panel answering: Is my information safe?">
</div></section>

<section id="faq" aria-labelledby="faq-title"><div class="wrap faq"><h2 id="faq-title" class="center">Questions</h2>{faq}</div></section>

<section id="get" class="get center" aria-labelledby="get-title"><div class="wrap">
  <img src="/assets/brand/mascot-yay-day.svg" width="150" height="150" alt="">
  <h2 id="get-title">Hand it the <em>busywork.</em></h2>
  <p class="lede">SKYCOT Business for Mac. Apple silicon, macOS 13 or newer, signed by Apple.</p>
  <p style="margin-top:28px">{_cta("Download for Mac")}</p>
  <p class="fine">Looking for SKYCOT for your family? <a href="/">It's here.</a></p>
</div></section>
</main>
<script>
(function () {{
  var T = {data}, kind = document.getElementById("biz-kind"), ideas = document.getElementById("biz-ideas");
  var chips = document.querySelectorAll(".chip");
  function esc(s) {{ return s.replace(/[&<>"]/g, function (c) {{ return {{"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}}[c]; }}); }}
  chips.forEach(function (b) {{
    b.addEventListener("click", function () {{
      var d = T[+b.dataset.t];
      chips.forEach(function (c) {{ c.setAttribute("aria-pressed", String(c === b)); }});
      kind.textContent = d.name;
      ideas.innerHTML = d.jobs.map(function (j) {{
        return '<div class="idea"><div><b>' + esc(j) + '</b><span>A natural fit for what you do.</span></div><span class="go" aria-hidden="true">Start</span></div>';
      }}).join("");
    }});
  }});
}})();
</script>
'''
    return head(TITLE, DESC, "/business", css=CSS) + body + footer()
