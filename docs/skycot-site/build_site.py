# Generates the SKYCOT product site (skycot.com): one home page whose light side is the calm look (was
# variant A) and whose dark side is the bold look (was variant B), switched automatically by the visitor's
# light/dark setting; privacy, terms, open-source and 404 pages; and the og.png share image.
# The output folder is copied as-is into public/ of mark-hallam/skycot-research-site (branch product-site).
import os, html, json, shutil, subprocess
OUT = "/Users/me/t3code-nondev/docs/skycot-site/draft/"
OG_DIR = "/Users/me/t3code-nondev/docs/skycot-site/og/"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LICENSE = open("/Users/me/t3code-nondev/LICENSE", encoding="utf-8").read().strip()

MARK = '''<svg class="mark" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--accent)"/><circle cx="32" cy="32" r="21" fill="none" stroke="#fff" stroke-width="2.2" opacity=".5"/><circle cx="32" cy="32" r="13" fill="none" stroke="#fff" stroke-width="2.2" opacity=".8"/><circle cx="32" cy="32" r="5" fill="#fff"/><path d="M17 32h9M38 32h9M32 17v9M32 38v9" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".9"/></svg>'''

CSS = r'''
:root{
  --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;
  --bg:#ffffff; --bg2:#f5f5f7; --card:#ffffff; --line:rgba(0,0,0,.08); --line2:#d2d2d7;
  --text:#1d1d1f; --text2:#6e6e73; --text3:#86868b;
  --accent:#0071e3; --accent-ink:#ffffff; --accent-soft:rgba(0,113,227,.10);
  --green:#1f8f3f; --red:#d70015; --orange:#b25000;
  --nav:rgba(255,255,255,.78); --nav-text:#1d1d1f;
  --shadow:0 30px 80px rgba(0,0,0,.14),0 6px 18px rgba(0,0,0,.06);
  --radius:18px;
}
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
  --bg:#000000; --bg2:#161617; --card:#1d1d1f; --line:rgba(255,255,255,.12); --line2:#424245;
  --text:#f5f5f7; --text2:#a1a1a6; --text3:#86868b;
  --accent:#2997ff; --accent-ink:#ffffff; --accent-soft:rgba(41,151,255,.18);
  --green:#30d158; --red:#ff453a; --orange:#ffb340;
  --nav:rgba(22,22,23,.8); --nav-text:#f5f5f7;
  --shadow:0 30px 80px rgba(0,0,0,.6),0 6px 18px rgba(0,0,0,.4);
}}
:root[data-theme="dark"]{
  --bg:#000000; --bg2:#161617; --card:#1d1d1f; --line:rgba(255,255,255,.12); --line2:#424245;
  --text:#f5f5f7; --text2:#a1a1a6; --text3:#86868b;
  --accent:#2997ff; --accent-ink:#ffffff; --accent-soft:rgba(41,151,255,.18);
  --green:#30d158; --red:#ff453a; --orange:#ffb340;
  --nav:rgba(22,22,23,.8); --nav-text:#f5f5f7;
  --shadow:0 30px 80px rgba(0,0,0,.6),0 6px 18px rgba(0,0,0,.4);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.5;font-size:17px;-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}
img{max-width:100%;height:auto;display:block}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3{margin:0;letter-spacing:-.02em;line-height:1.1;font-weight:700}
p{margin:0}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px}
.narrow{max-width:760px;margin:0 auto;padding:0 24px}
@media (max-width:600px){.wrap,.narrow{padding:0 16px}}

/* nav */
.nav{position:sticky;top:0;z-index:50;background:var(--nav);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--line)}
.nav .wrap{display:flex;align-items:center;height:52px;gap:28px}
.brand{display:flex;align-items:center;gap:10px;color:var(--nav-text);font-weight:700;letter-spacing:.14em;font-size:15px}
.brand:hover{text-decoration:none}
.nav ul{list-style:none;margin:0 0 0 auto;padding:0;display:flex;gap:26px;font-size:14px}
.nav ul a{color:var(--nav-text);opacity:.8}
.nav ul a:hover{opacity:1;text-decoration:none}
.nav .cta{margin-left:auto}
@media (max-width:760px){.nav ul{display:none}.nav .cta{margin-left:auto}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border-radius:980px;font-weight:600;font-size:16px;border:1px solid transparent;cursor:pointer;white-space:nowrap}
.btn:hover{text-decoration:none;filter:brightness(1.06)}
.btn-primary{background:var(--accent);color:var(--accent-ink)}
.btn-secondary{background:transparent;color:var(--accent);border-color:var(--accent)}
.btn-small{min-height:32px;padding:0 14px;font-size:13px}
.btn[aria-disabled="true"]{opacity:.55;cursor:default;filter:none}

/* hero */
.hero{padding:88px 0 40px;text-align:center}
.eyebrow{display:inline-block;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
.hero h1{font-size:clamp(38px,6.4vw,76px);max-width:16ch;margin:0 auto;text-wrap:balance}
.hero .lede{font-size:clamp(19px,2.2vw,25px);color:var(--text2);max-width:36em;margin:22px auto 0;line-height:1.4}
.actions{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:30px}
.hero-note{font-size:13px;color:var(--text3);margin-top:14px}
.frame{margin:52px auto 0;max-width:1100px;border-radius:14px;overflow:hidden;box-shadow:var(--shadow);border:1px solid var(--line);background:var(--card)}
.frame img{width:100%}
.caption{font-size:13px;color:var(--text3);text-align:center;margin-top:14px}

/* dark mode = the bold look (was variant B): black nav and hero, gradient headline, dark screenshot.
   Follows the visitor's light/dark setting automatically; there is no manual toggle. */
@media (prefers-color-scheme:dark){
.nav{background:rgba(0,0,0,.8);border-bottom-color:rgba(255,255,255,.12)}
.nav .brand,.nav ul a{color:#f5f5f7}
.brand .mark rect{fill:#fff}
.brand .mark circle,.brand .mark path{stroke:#000}
.brand .mark circle:last-of-type{fill:#000}
.hero{background:#000;color:#f5f5f7;padding:110px 0 0;overflow:hidden}
.hero h1{font-size:clamp(44px,7.6vw,96px);font-weight:700;letter-spacing:-.03em;background:linear-gradient(180deg,#fff 40%,#8a8a8f);-webkit-background-clip:text;background-clip:text;color:transparent;max-width:16ch}
.hero .lede{color:#a1a1a6;max-width:34em}
.eyebrow{color:#2997ff}
.hero .btn-primary{background:#fff;color:#000}
.hero .btn-secondary{border-color:#2997ff;color:#2997ff}
.hero-note{color:#86868b}
.hero .frame{border-radius:14px 14px 0 0;border-color:rgba(255,255,255,.14);box-shadow:0 -10px 80px rgba(41,151,255,.18)}
.hero .caption{color:#86868b;padding-bottom:0}
.hero-tail{margin-top:56px;background:linear-gradient(180deg,#000 0,#000 50%,var(--bg) 50%)}
.promise{padding-top:56px}
}

/* promise trio */
.promise{padding:56px 0 20px}
.trio{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.trio div{padding:0 8px}
.trio h3{font-size:20px;margin-bottom:6px}
.trio p{color:var(--text2);font-size:16px}
@media (max-width:760px){.trio{grid-template-columns:1fr;gap:26px}}

/* sections */
section{padding:72px 0}
section.alt{background:var(--bg2)}
.kicker{font-size:14px;font-weight:600;color:var(--accent);letter-spacing:.04em;text-transform:uppercase;margin-bottom:10px}
h2.title{font-size:clamp(30px,4.2vw,48px);max-width:20ch}
.sub{font-size:clamp(17px,1.6vw,21px);color:var(--text2);max-width:40em;margin-top:14px;line-height:1.45}
.center{text-align:center}.center .title,.center .sub{margin-left:auto;margin-right:auto}

/* moments */
.moment{display:grid;grid-template-columns:5fr 7fr;gap:48px;align-items:center;padding:36px 0}
.moment.flip .text{order:2}
.moment .text h3{font-size:clamp(26px,3vw,36px);margin-bottom:12px}
.moment .text p{color:var(--text2);font-size:18px}
.moment ul{margin:16px 0 0;padding:0;list-style:none;color:var(--text2);font-size:16px}
.moment li{padding:6px 0 6px 26px;position:relative}
.moment li::before{content:"";position:absolute;left:0;top:13px;width:14px;height:14px;border-radius:50%;background:var(--accent-soft);border:2px solid var(--accent)}
.shot{border-radius:14px;overflow:hidden;box-shadow:var(--shadow);border:1px solid var(--line);background:var(--card)}
@media (max-width:900px){.moment{grid-template-columns:1fr;gap:22px;padding:28px 0}.moment.flip .text{order:0}}

/* looks (theme library) */
.looks{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:40px}
.look{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column}
.look .pic{background:var(--bg2);border-bottom:1px solid var(--line)}
.look .pic img{width:100%}
.look .t{padding:18px 20px 22px}
.look h3{font-size:19px;margin-bottom:4px}
.look p{color:var(--text2);font-size:15px}
.look-hero{grid-column:1/-1;display:grid;grid-template-columns:7fr 5fr;align-items:stretch}
.look-hero .pic{border-bottom:0;border-right:1px solid var(--line);display:flex;align-items:center}
.look-hero .t{padding:30px 32px;display:flex;flex-direction:column;justify-content:center}
.look-hero h3{font-size:clamp(24px,2.6vw,32px);margin-bottom:10px}
.look-hero p{font-size:17px}
.tag{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);border-radius:980px;padding:3px 10px;margin-bottom:12px;width:max-content}
.quote{margin:18px 0 0;padding-left:16px;border-left:3px solid var(--accent);font-size:18px;color:var(--text);font-style:italic}
.quote cite{display:block;font-style:normal;font-size:13px;color:var(--text3);margin-top:6px}
@media (max-width:900px){.looks{grid-template-columns:1fr}.look-hero{grid-template-columns:1fr}.look-hero .pic{border-right:0;border-bottom:1px solid var(--line)}.look-hero .t{padding:22px 20px 26px}}

/* family */
.family{display:grid;grid-template-columns:5fr 7fr;gap:48px;align-items:start;margin-top:40px}
.family .lead p{color:var(--text2);font-size:18px}
.crew{width:150px;border-radius:12px;border:1px solid var(--line);margin-top:22px}
.guard{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
.guard div{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px}
.guard h3{font-size:18px;margin-bottom:6px}
.guard p{color:var(--text2);font-size:15px}
.honest{margin-top:22px;font-size:14px;color:var(--text2);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;line-height:1.5}
.honest b{color:var(--text)}
@media (max-width:900px){.family{grid-template-columns:1fr;gap:26px}}
@media (max-width:560px){.guard{grid-template-columns:1fr}}

/* steps */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:40px}
.step{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px}
.step .n{width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;margin-bottom:16px}
.step h3{font-size:21px;margin-bottom:8px}
.step p{color:var(--text2);font-size:16px}
@media (max-width:760px){.steps{grid-template-columns:1fr}}

/* works with */
.logos{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:36px}
.logo{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 12px;text-align:center}
.logo b{display:block;font-size:17px}
.logo span{display:block;font-size:13px;color:var(--text3);margin-top:4px}
.fine{font-size:13px;color:var(--text3);margin-top:22px;max-width:60em}
@media (max-width:900px){.logos{grid-template-columns:repeat(3,1fr)}}
@media (max-width:560px){.logos{grid-template-columns:repeat(2,1fr)}}

/* safety */
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:40px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px}
.card .ic{width:40px;height:40px;border-radius:11px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:16px}
.card h3{font-size:20px;margin-bottom:8px}
.card p{color:var(--text2);font-size:16px}
.rules{margin:30px 0 0;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px 26px;display:grid;grid-template-columns:1fr 2fr;gap:18px;align-items:start}
.rules h3{font-size:19px}
.rules p{color:var(--text2);font-size:15px;margin-top:6px}
.rules ul{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:8px 20px;font-size:16px}
.rules li{padding-left:26px;position:relative}
.rules li::before{content:"";position:absolute;left:2px;top:7px;width:10px;height:10px;border-radius:50%;background:var(--red)}
@media (max-width:900px){.cards{grid-template-columns:1fr}.rules{grid-template-columns:1fr}.rules ul{grid-template-columns:1fr}}

/* download */
.dl{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:48px 32px;text-align:center;margin-top:36px}
.dl h3{font-size:clamp(26px,3vw,36px)}
.dl p{color:var(--text2);margin-top:10px}
.status{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:36px;text-align:left}
.status div{padding:18px;border-radius:14px;background:var(--bg2);border:1px solid var(--line)}
.status b{display:block;font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}
.status p{font-size:15px;color:var(--text2);margin:0}
.status .done b{color:var(--green)}.status .now b{color:var(--orange)}.status .next b{color:var(--text3)}
@media (max-width:760px){.status{grid-template-columns:1fr}.dl{padding:32px 20px}}

/* faq */
.faq{max-width:760px;margin:30px auto 0}
details{border-top:1px solid var(--line2);padding:0}
details:last-child{border-bottom:1px solid var(--line2)}
summary{cursor:pointer;list-style:none;padding:20px 40px 20px 0;font-size:19px;font-weight:600;position:relative}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";position:absolute;right:4px;top:14px;font-size:28px;font-weight:300;color:var(--text3)}
details[open] summary::after{content:"–"}
details p{color:var(--text2);padding:0 0 22px;font-size:17px}
details p+p{margin-top:-10px}

/* footer */
footer{border-top:1px solid var(--line);padding:40px 0 60px;font-size:13px;color:var(--text3)}
footer .cols{display:flex;gap:40px;flex-wrap:wrap;justify-content:space-between;align-items:flex-start}
footer ul{list-style:none;margin:0;padding:0;display:flex;gap:18px;flex-wrap:wrap}
footer a{color:var(--text2)}
footer .legal{margin-top:22px;max-width:70em;line-height:1.6}

/* legal pages */
.doc{padding:70px 0 90px}
.doc h1{font-size:clamp(34px,5vw,56px)}
.doc .meta{color:var(--text3);font-size:14px;margin:14px 0 36px}
.doc h2{font-size:24px;margin:40px 0 12px}
.doc h3{font-size:18px;margin:26px 0 8px}
.doc p,.doc li{color:var(--text2);font-size:17px}
.doc p{margin:0 0 14px}
.doc ul{margin:0 0 14px;padding-left:22px}
.doc li{margin-bottom:6px}
.doc code{font:15px ui-monospace,"SF Mono",Menlo,monospace}
.notfound{padding:120px 0 140px;text-align:center}
.notfound h1{font-size:clamp(34px,5vw,56px)}
.notfound p{color:var(--text2);font-size:19px;margin-top:16px}
pre.licence{background:var(--bg2);border:1px solid var(--line);border-radius:14px;padding:22px;font:14px/1.55 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre-wrap;color:var(--text)}
.doc table{border-collapse:collapse;width:100%;font-size:15px;margin:0 0 20px}
.doc th,.doc td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--text2)}
.doc th{color:var(--text);font-weight:600}
'''

SITE = "https://skycot.com"
LAST_UPDATED = "22 October 2026"
H1 = "The AI developer for people who don't code."
LEDE = ("Text it what you want, in plain English. SKYCOT builds it on your Mac with the AI you already pay for, "
        "shows you what changed, and nothing goes live until you say so.")
TITLE = "SKYCOT · The AI developer for people who don't code"
DESC = ("Text SKYCOT what you want, in plain English. It builds it on your Mac with the AI you already pay for "
        "(Claude Code, Codex, Cursor, Gemini and others), shows you what changed, and nothing goes live until you say so.")
OG_ALT = "SKYCOT. The AI developer for people who don't code. SKYCOT for Mac, early access, skycot.com."

# Identity metadata for search engines. Never add an address here (standing rule: no street, postal
# or registered address anywhere on skycot.com).
STRUCTURED = json.dumps({
    "@context": "https://schema.org",
    "@graph": [
        {"@type": "Organization", "@id": SITE + "/#organization", "name": "SKYCOT",
         "legalName": "Curble Pty Ltd", "url": SITE + "/", "email": "markhallam@skycot.com"},
        {"@type": "WebSite", "@id": SITE + "/#website", "name": "SKYCOT", "url": SITE + "/",
         "publisher": {"@id": SITE + "/#organization"}},
        {"@type": "SoftwareApplication", "name": "SKYCOT", "operatingSystem": "macOS",
         "applicationCategory": "DeveloperApplication", "publisher": {"@id": SITE + "/#organization"}},
    ],
}, separators=(",", ":"))

def attr(text):
    # Attribute-safe escaping that leaves apostrophes readable (attributes use double quotes).
    return html.escape(text, quote=False).replace('"', '&quot;')

def head(title, desc, path="/", robots=None):
    url = SITE + path
    robots_meta = f'\n<meta name="robots" content="{robots}">' if robots else ""
    return f'''<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title, quote=False)}</title>
<meta name="description" content="{attr(desc)}">{robots_meta}
<link rel="canonical" href="{url}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="SKYCOT">
<meta property="og:title" content="{attr(title)}">
<meta property="og:description" content="{attr(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{attr(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{attr(title)}">
<meta name="twitter:description" content="{attr(desc)}">
<meta name="twitter:image" content="{SITE}/og.png">
<script id="skycot-structured-data" type="application/ld+json">{STRUCTURED}</script>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='15' fill='%230071e3'/%3E%3Ccircle cx='32' cy='32' r='21' fill='none' stroke='%23fff' stroke-width='2.2' opacity='.5'/%3E%3Ccircle cx='32' cy='32' r='13' fill='none' stroke='%23fff' stroke-width='2.2' opacity='.8'/%3E%3Ccircle cx='32' cy='32' r='5' fill='%23fff'/%3E%3C/svg%3E">
<style>{CSS}</style>
</head>
<body>
'''

# Links are root-relative clean URLs (/privacy, /#how) as Cloudflare Pages serves them.
# To preview the generated folder locally, serve it (e.g. `npx wrangler pages dev draft`), not file://.
def nav():
    return f'''<header class="nav"><div class="wrap">
  <a class="brand" href="/" aria-label="SKYCOT home">{MARK}<span>SKYCOT</span></a>
  <ul>
    <li><a href="/#how">How it works</a></li>
    <li><a href="/#looks">Looks</a></li>
    <li><a href="/#works-with">Works with</a></li>
    <li><a href="/#safety">Safety</a></li>
    <li><a href="/#faq">FAQ</a></li>
    <li><a href="/open-source">Open source</a></li>
  </ul>
  <a class="btn btn-primary btn-small cta" href="/#download">Get SKYCOT</a>
</div></header>
'''

FOOTER = '''<footer><div class="wrap">
  <div class="cols">
    <div class="brand" style="letter-spacing:.14em">SKYCOT</div>
    <ul>
      <li><a href="/#how">How it works</a></li>
      <li><a href="/#looks">Looks</a></li>
      <li><a href="/#family">Family</a></li>
      <li><a href="/#safety">Safety</a></li>
      <li><a href="/#faq">FAQ</a></li>
      <li><a href="/privacy">Privacy</a></li>
      <li><a href="/terms">Terms</a></li>
      <li><a href="/open-source">Open source</a></li>
      <li><a href="mailto:markhallam@skycot.com">Contact</a></li>
    </ul>
  </div>
  <p class="legal">SKYCOT is based on <a href="https://github.com/pingdotgg/t3code">T3 Code</a>, © T3 Tools Inc., used under the MIT licence. SKYCOT is not affiliated with or endorsed by T3 Tools Inc. Claude, Codex, Cursor and Gemini are products of their respective owners; SKYCOT is not affiliated with Anthropic, OpenAI, Anysphere or Google. Screenshots show an early build with a sample project.<br>
  SKYCOT is made by Curble Pty Ltd, Melbourne, Australia. © 2026 Curble Pty Ltd, trading as SKYCOT · ABN 71 605 512 776.</p>
</div></footer>
</body></html>
'''

# ---------- shared home content ----------
def ic(path):
    return f'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>'
IC_HAND = ic('<path d="M12 3v10"/><path d="M8 7l4-4 4 4"/><rect x="4" y="13" width="16" height="8" rx="2"/>')
IC_SHIELD = ic('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>')
IC_UNDO = ic('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>')
IC_STOP = ic('<rect x="4" y="4" width="16" height="16" rx="3"/>')
IC_MAC = ic('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>')
IC_WRENCH = ic('<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3l9.4-9.4z"/><path d="M14.7 6.3l3-3"/>')

# One alt text that is true of both hero screenshots (light: What changed card; dark: a conversation).
HERO_ALT = ("An early build of SKYCOT: a plain-English conversation with the assistant, its summary of what changed "
            "with buttons to keep or undo it, and the Versions list on the right showing every point you can go back to.")

def home_body():
    hero = f'''<section class="hero"><div class="wrap">
  <span class="eyebrow">SKYCOT for Mac · early access</span>
  <h1>{html.escape(H1, quote=False)}</h1>
  <p class="lede">{html.escape(LEDE, quote=False)}</p>
  <div class="actions">
    <a class="btn btn-primary" href="#download">Get SKYCOT for Mac</a>
    <a class="btn btn-secondary" href="#how">See how it works</a>
  </div>
  <p class="hero-note">Works with Claude Code, Codex, Cursor, Gemini and others. Your files stay on your Mac; only what each job needs goes to the AI you chose.</p>
  <div class="hero-tail">
  <div class="frame"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/conversation-dark.jpg" width="1200" height="707"><img src="assets/what-changed.jpg" width="1200" height="707" alt="{html.escape(HERO_ALT)}"></picture></div>
  </div>
  <p class="caption">Early build, sample café website. Nothing live was touched.</p>
</div></section>
'''
    body = f'''
<section class="promise"><div class="wrap">
  <div class="trio">
    <div><h3>See it before it's live</h3><p>Every change is listed in your words: which pages, what look-and-feel, what was not touched. The code is one click away if you want it.</p></div>
    <div><h3>Undo like Time Machine</h3><p>Each change is a version you can step back to. Restore puts every file back; your conversation stays.</p></div>
    <div><h3>Your files stay on your Mac</h3><p>SKYCOT runs on your computer. Only what each job needs goes to the AI you chose, under your own account.</p></div>
  </div>
</div></section>

<section id="moments"><div class="wrap">
  <div class="center"><p class="kicker">What it feels like</p><h2 class="title">Like texting a very careful colleague.</h2>
  <p class="sub">No commands. No Terminal. You talk in a Messages-style conversation, and the important moments arrive as plain cards you can say yes or no to.</p></div>

  <div class="moment">
    <div class="text"><h3>Say it like you'd say it to staff.</h3>
      <p>Open a project folder, type what you want, and press Return. "Add a Christmas menu page" beats describing how to build one.</p>
      <ul><li>You choose how much it does on its own: <b>Ask me first</b> is the default.</li><li>The rules that always ask are printed right under the box, every time.</li><li>Lots of jobs at once, each in its own conversation.</li></ul></div>
    <div class="shot"><img src="assets/home.jpg" width="1200" height="707" alt="SKYCOT home: a Good evening greeting, a list of conversations, and a message box with the Autonomy control set to Ask me first and the hard rules printed underneath."></div>
  </div>

  <div class="moment flip">
    <div class="text"><h3>It asks before it acts.</h3>
      <p>When the assistant wants to run something, you get a card like a macOS permission prompt: what it wants, why it matters, where it reaches, and what happens if you say no. Nothing is pre-selected.</p>
      <ul><li>Allow once, allow for this conversation, or always allow this kind of thing.</li><li>"Don't allow" tells the assistant to find another way.</li><li>A red Stop button halts everything, instantly.</li></ul></div>
    <div class="shot"><img src="assets/approval.jpg" width="1200" height="707" alt="A May I run this? card explaining Why it matters, Where it reaches and If you say no, with Don't allow, Allow once and Always allow buttons."></div>
  </div>

  <div class="moment">
    <div class="text"><h3>Undo all of it. Really.</h3>
      <p>SKYCOT works in a private copy of your project, so Undo is always possible. Before it undoes, it tells you exactly what comes back and what it will not touch.</p>
      <ul><li>Every change becomes a version in a Time Machine-style list.</li><li>Restore puts every file back to that point; the conversation stays.</li><li>It never reaches into anything already sent for review or put live.</li></ul></div>
    <div class="shot"><img src="assets/undo.jpg" width="1200" height="707" alt="An Undo all of it? sheet listing what Restore does and does not do, with Cancel and Undo all of it buttons, over the Versions list."></div>
  </div>

  <div class="moment flip">
    <div class="text"><h3>Publishing is one plain question at a time.</h3>
      <p>Nothing leaves your Mac until you press a button. A quick safety check, then one question: upload a draft, send for review, or put it live. The live option is the one that warns you.</p>
      <ul><li>SKYCOT never uploads straight to the live version by default.</li><li>"What will happen" and "What won't" are spelled out before you confirm.</li><li>The developer words are there in small print, if you ever need them.</li></ul></div>
    <div class="shot"><img src="assets/publish.jpg" width="1200" height="707" alt="The Publish sheet: Quick safety check, How would you like to publish, Upload a draft line with What will happen and What won't, then Not yet and Upload a draft line buttons."></div>
  </div>
</div></section>

<section id="looks" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">Choose your look</p><h2 class="title">Pick a look. Keep the same careful app.</h2>
  <p class="sub">SKYCOT ships with a library of themes. Try one on with a hover, keep it with a click, change it any time in Settings. A theme changes how things look, never what they do: asking permission, undoing and going live stay plain in every look.</p></div>
  <div class="looks">
    <div class="look look-hero">
      <div class="pic"><img src="assets/look-workshop.jpg" width="1200" height="707" alt="SKYCOT in the Workshop theme: cream paper, hand-drawn borders, a yellow sticky-note tip, and a crew list in the sidebar showing Sam, who builds things, and Mo, who checks before anything risky."></div>
      <div class="t"><span class="tag">The one for the kid in you</span><h3>Workshop</h3>
        <p>Playful and hand-drawn: cream paper, marker pens, sticky-note tips, and a named crew. Sam builds things. Mo checks before anything risky. The app says "Sam needs your OK" instead of "the assistant".</p>
        <blockquote class="quote">"It makes me feel like a kid."<cite>Mark Hallam, founder, the first time he saw it</cite></blockquote></div>
    </div>
    <div class="look"><div class="pic"><img src="assets/look-classic.jpg" width="1200" height="707" alt="SKYCOT in the Classic theme: white panels, grey sidebar and one blue accent, in the style of Apple Messages."></div>
      <div class="t"><h3>Classic</h3><p>The Apple Messages look. Calm, clean and familiar. The default.</p></div></div>
    <div class="look"><div class="pic"><img src="assets/look-paper.jpg" width="1200" height="707" alt="SKYCOT in the Paper theme: warm off-white background, serif headings and a single vermilion accent."></div>
      <div class="t"><h3>Paper</h3><p>Warm paper and ink. Serif headings, one vermilion accent, quiet everywhere else.</p></div></div>
    <div class="look"><div class="pic"><img src="assets/look-night-ops.jpg" width="1200" height="707" alt="SKYCOT in the Night Ops theme: dark navy panels with cyan highlights, like a mission-control console."></div>
      <div class="t"><h3>Night Ops</h3><p>Dark navy glass with cyan, mint and amber. Mission control, for late nights.</p></div></div>
  </div>

  <div class="moment flip" style="padding-bottom:0">
    <div class="text"><h3>Themes are files. Yours to share.</h3>
      <p>Every theme is a small, plain data file. Import one a friend sent you, export yours, share it, or duplicate the one you are using and change the colours, the flavour and your crew's names.</p>
      <ul><li>Import, export and share from Settings → Appearance.</li><li>Duplicate and edit: pick the colours that matter most, a flavour (hand-drawn, serif, glass), and who is on your crew.</li><li>Every theme has a light and a dark side, and can follow your Mac's setting.</li><li>Made something good? Community themes are welcome. See <a href="/open-source#themes">how to contribute one</a>.</li></ul></div>
    <div class="shot"><img src="assets/themes-settings.jpg" width="1200" height="707" alt="Settings → Appearance in the Workshop theme: four theme cards (Classic, Workshop, Paper, Night Ops), buttons to Import a theme, Export this theme, Share, and Duplicate and edit, and a Light or Dark switch."></div>
  </div>
</div></section>

<section id="family"><div class="wrap">
  <div class="center"><p class="kicker">Family</p><h2 class="title">Set up SKYCOT for a child.</h2>
  <p class="sub">A Family profile turns SKYCOT into a safe first workshop: a place to build the website for the school fair or a little game for a friend, with a grown-up's hand on the brakes.</p></div>
  <div class="family">
    <div class="lead"><span class="tag">Coming in the first release</span>
      <p>The Family profile is designed and is in the next build. It is not in the early-access version you can try today, and we will mark it done here when it ships rather than before. Here is what it does, as designed.</p>
      <img class="crew" src="assets/crew.jpg" width="204" height="92" alt="Sam, who builds things, and Mo, who checks before anything risky: the crew characters from the Workshop theme."></div>
    <div>
      <div class="guard">
        <div><h3>The Workshop look, on by default</h3><p>Sam and Mo, sticky notes and marker pens. A child gets the friendliest face of the app from the first minute.</p></div>
        <div><h3>The assistant always asks first</h3><p>Ask me first is the only mode on offer. The assistant shows a plan and checks before every change, every time.</p></div>
        <div><h3>The riskier modes and developer tools are hidden</h3><p>"Just do it" and "Fully hands-off" are not shown, and the Advanced mode switch is gone from the sidebar. Nothing to fall into by accident.</p></div>
        <div><h3>Publishing needs a parent code</h3><p>Nothing leaves the Mac without a code only you know. Drafts and undo work as normal; the internet is a question for a grown-up.</p></div>
      </div>
      <p class="honest"><b>An honest note.</b> These are guardrails inside SKYCOT, on your child's own computer. They are not a security product: they do not filter the web, lock the Mac, or replace Screen Time, and they only apply inside SKYCOT. They make the first experience safe and kind. The rest is parenting.</p>
    </div>
  </div>
</div></section>

<section id="how" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">How it works</p><h2 class="title">Three steps. No new vocabulary.</h2></div>
  <div class="steps">
    <div class="step"><div class="n">1</div><h3>Open a folder</h3><p>Point SKYCOT at the folder that holds your website, app or documents. It becomes a project. Sign in to the assistant you already use.</p></div>
    <div class="step"><div class="n">2</div><h3>Say what you want changed</h3><p>Plain English, like a message. The assistant shows a plan, asks before anything risky, and gets on with it while you do something else.</p></div>
    <div class="step"><div class="n">3</div><h3>Keep, undo, or publish</h3><p>Read what changed. Keep it, undo all of it, or ask for a tweak. When you're happy, publish through one plain question at a time.</p></div>
  </div>
  <p class="fine center" style="margin:28px auto 0"><b>Already a developer, or have one?</b> Advanced mode is one switch away, at the bottom of the sidebar. It shows the full developer interface SKYCOT is built on (T3 Code's), in the same window, with nothing removed. Flip it back and the plain-language view returns.</p>
</div></section>

<section id="works-with"><div class="wrap center">
  <p class="kicker">Bring your own AI</p>
  <h2 class="title">Works with the AI you already pay for.</h2>
  <p class="sub">SKYCOT does not resell AI or sit between you and your account. You sign in through each assistant's own sign-in, so SKYCOT never sees your password. Use whichever is best for the job, and switch any time.</p>
  <div class="logos">
    <div class="logo"><b>Claude Code</b><span>Anthropic</span></div>
    <div class="logo"><b>Codex</b><span>OpenAI</span></div>
    <div class="logo"><b>Cursor</b><span>Anysphere</span></div>
    <div class="logo"><b>Gemini</b><span>Google · Antigravity</span></div>
    <div class="logo"><b>And more</b><span>as they're added</span></div>
  </div>
  <p class="fine" style="margin-left:auto;margin-right:auto">Product names belong to their owners. SKYCOT is independent and not affiliated with or endorsed by Anthropic, OpenAI, Anysphere or Google. You need your own subscription or account with at least one assistant.</p>
</div></section>

<section id="safety" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">You stay in charge</p><h2 class="title">Careful by default. Not as an option.</h2>
  <p class="sub">The serious incidents with AI coding tools all share one shape: a tool running on its own, a destructive command, and no backup. SKYCOT is built so that shape cannot happen by default.</p></div>
  <div class="cards">
    <div class="card"><div class="ic">{IC_HAND}</div><h3>Ask me first</h3><p>The default. The assistant shows a plan and checks before every change. "Just do it, carefully" and "Fully hands-off" exist, labelled honestly, and hands-off is time-boxed.</p></div>
    <div class="card"><div class="ic">{IC_SHIELD}</div><h3>Hard rules</h3><p>Some things always ask, in every mode, and cannot be switched off. They are printed under the message box so you never have to remember them.</p></div>
    <div class="card"><div class="ic">{IC_UNDO}</div><h3>Undo, always</h3><p>Work happens in a private copy of your project. Every change is a version. Restore is one click, and it tells you what it does and does not touch.</p></div>
    <div class="card"><div class="ic">{IC_STOP}</div><h3>One big Stop</h3><p>A red Stop button in the header halts everything the moment you press it. Nothing is pre-selected, nothing auto-confirms.</p></div>
    <div class="card"><div class="ic">{IC_MAC}</div><h3>Your files stay put</h3><p>SKYCOT runs on your Mac. No analytics are switched on. Only what each job needs goes to the assistant you chose, under that company's terms, and it works only in the project folder you open.</p></div>
    <div class="card"><div class="ic">{IC_WRENCH}</div><h3>Advanced mode when you want it</h3><p>The full developer interface SKYCOT is built on (T3 Code's) is one switch away, in the same window, for you or the developer who helps you. Nothing is removed. Flip it back any time.</p></div>
  </div>
  <div class="rules">
    <div><h3>Always asks, in every mode</h3><p>These are the hard rules. No setting turns them off.</p></div>
    <ul><li>Deleting anything</li><li>Putting anything live</li><li>Spending money</li><li>Signing up to a service</li><li>Touching bookings or orders</li><li>Touching customer details</li></ul>
  </div>
</div></section>

<section id="download"><div class="wrap">
  <div class="center"><p class="kicker">Get SKYCOT</p><h2 class="title">SKYCOT for Mac.</h2>
  <p class="sub">Free during early access. You bring your own AI account. A signed, notarised Mac download is being prepared; leave your email and you will be first to know.</p></div>
  <div class="dl">
    <h3>Be first to try it.</h3>
    <p>Apple silicon Macs recommended. You will need an account with at least one supported assistant.</p>
    <div class="actions">
      <span class="btn btn-primary" aria-disabled="true" title="A signed, notarised Mac download is being prepared">Download for Mac · coming soon</span>
      <a class="btn btn-secondary" href="mailto:markhallam@skycot.com?subject=SKYCOT%20early%20access">Notify me</a>
    </div>
    <p class="hero-note">Or join the conversation on <a href="https://discord.gg/krA4DQgD27">Discord</a>. No newsletter, no tracking; we email you once when it is ready.</p>
    <div class="status">
      <div class="done"><b>Built</b><p>Conversation, permission cards, What changed, Keep and Undo, Versions, Publish to a draft line, Settings, scheduled jobs. Exercised end to end on a real project with Codex.</p></div>
      <div class="now"><b>Testing now</b><p>The signed Mac installer, one-click Claude sign-in, and "send for review" and "put it live" with a connected GitHub account.</p></div>
      <div class="next"><b>Next</b><p>First invites, a proper app icon, and a Windows build. We would rather tell you where things stand than oversell it.</p></div>
    </div>
  </div>
</div></section>

<section id="faq" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">Questions</p><h2 class="title">Frequently asked.</h2></div>
  <div class="faq">
    <details><summary>Do I need to know how to code?</summary><p>No. You describe what you want in plain English, read what changed in plain English, and decide. If you have a developer, they can flip on Advanced mode and see everything in their language, in the same window.</p></details>
    <details><summary>Can I get at the developer tools?</summary><p>Yes. Advanced mode is a switch at the bottom of the sidebar. It opens the full developer interface SKYCOT is built on (T3 Code's) in the same window: every panel, terminal and setting, nothing removed. Flip it back and the plain-language view returns. In a Family profile the switch is hidden.</p></details>
    <details><summary>Can I change how it looks?</summary><p>Yes. SKYCOT ships with a <a href="#looks">library of themes</a> (Classic, Workshop, Paper and Night Ops), each with a light and a dark side. Themes are plain data files you can import, export and share, and you can duplicate one and edit the colours, the flavour and your crew's names. A theme changes how things look, never what they do.</p></details>
    <details><summary>Is it suitable for children?</summary><p>A <a href="#family">Family profile</a> is designed and coming in the first release: the Workshop look, the assistant always asks first, the riskier modes and developer tools are hidden, and publishing needs a parent code. These are guardrails inside the app on your child's own computer, not a security product, and they are not in the early-access build you can try today.</p></details>
    <details><summary>Which AI do I need?</summary><p>An account with at least one supported assistant: Claude Code (Anthropic), Codex (OpenAI), Cursor, or Gemini via Antigravity (Google). SKYCOT runs on your plan; it does not sell AI time or stand between you and your account.</p></details>
    <details><summary>What does SKYCOT cost?</summary><p>Free during early access. You pay your AI provider as you do today. Pricing for later will be announced before it applies to anyone.</p></details>
    <details><summary>Where do my files go?</summary><p>They stay on your Mac. When you send a message, the assistant you chose receives what it needs for that task, under that company's terms. SKYCOT has no analytics switched on and no account of its own to send things to.</p></details>
    <details><summary>What if it breaks something?</summary><p>SKYCOT works in a private copy of your project and keeps a version for every change, so you can step back like Time Machine. The hard rules mean deleting, putting live and spending money always ask first, in every mode.</p></details>
    <details><summary>Is it open source?</summary><p>SKYCOT is built on T3 Code, an open-source project by T3 Tools Inc. released under the MIT licence. We say so in the app and on our <a href="/open-source">open source page</a>. SKYCOT is not affiliated with T3 Tools.</p></details>
    <details><summary>Does it work on Windows or iPhone?</summary><p>Mac first. The engine SKYCOT is built on also runs on Windows and has a phone companion, so both are on the list; dates will be honest ones.</p></details>
    <details><summary>Who makes it?</summary><p>SKYCOT is a registered business name of Curble Pty Ltd, a Melbourne company run by Mark Hallam. Questions: <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a>.</p></details>
  </div>
</div></section>
'''
    return hero + body

def write(name, content):
    with open(OUT + name, "w", encoding="utf-8") as f:
        f.write(content)
    print("wrote", name, len(content))

write("index.html", head(TITLE, DESC, "/") + nav() + home_body() + FOOTER)
# Variant B is now the dark side of index.html; the separate file is retired.
if os.path.exists(OUT + "index-b.html"):
    os.remove(OUT + "index-b.html")

# ---------- legal pages ----------
# Internal notes (open questions for a lawyer, and the clause-by-clause comparison with T3 Code's own
# legal pages) live in docs/legal/WEBSITE-LEGAL-NOTES.md, never on the public pages.

PRIVACY = f'''{nav()}
<main class="doc"><div class="narrow">
  <h1>Privacy</h1>
  <p class="meta">Last updated {LAST_UPDATED} · applies to the SKYCOT app and skycot.com</p>
  <p>SKYCOT is designed so that we hold as little about you as possible. The app runs on your Mac, your files stay on your Mac, and the only company that receives your work is the AI assistant you sign in to and choose to use. This page explains that in detail, and what the website does.</p>

  <h2>The short version</h2>
  <ul>
    <li>The SKYCOT app has no SKYCOT account, no SKYCOT servers that process your work, and no analytics switched on.</li>
    <li>Your project files stay on your Mac. When you work, the assistant you chose (for example Claude Code or Codex) receives what it needs for that task, under that company's terms and your own account.</li>
    <li>We never receive your files, your messages or the assistant's replies, so we cannot use them for anything, including training AI.</li>
    <li>skycot.com uses no cookies, no analytics and no third-party scripts, fonts or images.</li>
    <li>We do not sell personal information or use it for advertising.</li>
    <li>If you email us or join our Discord, we hold what you send us, and Discord's own policy applies there.</li>
  </ul>

  <h2>1. Who we are</h2>
  <p>SKYCOT is a registered business name of Curble Pty Ltd (ABN 71 605 512 776), Melbourne, Australia. You can reach us at <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a>. We are bound by the Australian Privacy Act 1988 and the Australian Privacy Principles to the extent they apply to us, and we aim to meet them in any case.</p>

  <h2>2. The SKYCOT app</h2>
  <h3>What stays on your Mac</h3>
  <p>Your project folders stay where you keep them. The versions SKYCOT keeps so you can undo are stored inside each project's own folder history. Your conversations, settings and technical logs are stored in your home folder under <code>~/.skycot</code> and in the app's own data folder. Signing in to each assistant happens on that company's own sign-in page; the sign-in token that results is kept on your Mac, by SKYCOT or by the assistant's own tool, and SKYCOT never sees your password. You can delete all of this at any time by removing the app and those folders.</p>
  <h3>What is sent to the AI assistant you chose</h3>
  <p>The assistant works in the project folder you open. When you send a message, the assistant's own tool reads what it needs from that folder for the task and sends it, with your message, to the company that makes it, under your account: Anthropic for Claude Code, OpenAI for Codex, Anysphere for Cursor, Google for Gemini and Antigravity, or the maker of any other assistant you connect. That company's privacy policy and your agreement with them govern what happens to it, including whether it may be used to improve or train their models; you can check and change that in your account with them. SKYCOT does not add a copy for itself. In Ask me first, the assistant stops and asks before doing anything beyond the plan, and the hard rules mean touching customer details is always a question, never an assumption.</p>
  <h3>What is sent to us</h3>
  <p>Nothing. SKYCOT has no usage analytics, crash reporting or diagnostics switched on, and in our builds the parts of the engine that could send them point nowhere. The online account and phone-pairing service that T3 Code offers is switched off in SKYCOT, so the app does not talk to T3 Tools Inc.'s servers either. If a future version offers optional diagnostics, it will be off until you switch it on, this page will be updated first, and it will never include your project files or conversations.</p>
  <h3>Background downloads</h3>
  <p>Like most apps, SKYCOT fetches a few public files on its own: it checks GitHub for new versions of SKYCOT, and it downloads public lists of AI models and their prices, also hosted on GitHub. If you add Gemini through Antigravity, it downloads Google's connector from Google. Like any web request, these reveal your IP address and the app's version to the host. Nothing about you or your projects is included.</p>
  <h3>Permissions your Mac may ask for</h3>
  <p>macOS may ask you to let SKYCOT open the folders you choose and show notifications. If you turn on sharing so that another of your devices can connect to SKYCOT, that device connects to your Mac directly over your own network, with no SKYCOT or T3 server in between. You can change these at any time in System Settings and in SKYCOT's Settings.</p>
  <h3>Publishing</h3>
  <p>If you connect a code-hosting account (for example GitHub) to send work for review or put it live, SKYCOT talks to that service on your instruction only, using your own account. Their terms and privacy policy apply to what you upload there.</p>

  <h2>3. The website, skycot.com</h2>
  <p>The site is a set of plain pages served by Cloudflare. We set no cookies and run no analytics, advertising or tracking, so there is nothing for a browser's "Do Not Track" setting to switch off. Cloudflare, like any host, processes the technical details of each request (such as IP address and browser type) to deliver the page and protect the site, and it may ask your browser to report failed connections so that network problems can be fixed; see Cloudflare's privacy policy for how they handle that. We do not combine it with anything else.</p>

  <h2>4. Email, Discord and early access</h2>
  <p>If you email us to be notified when SKYCOT is ready, we keep your email address for that purpose only, email you when it is, and delete the list afterwards unless you ask to stay in touch. Other emails are kept for as long as we need them to help you and to keep ordinary business records, and are then deleted. Our email runs on Google Workspace. Our community runs on Discord, a separate company with its own privacy policy; what you post there is governed by it.</p>

  <h2>5. Companies that handle information for us</h2>
  <ul>
    <li><b>Cloudflare</b> hosts skycot.com.</li>
    <li><b>Google Workspace</b> runs our email.</li>
    <li><b>GitHub</b> hosts SKYCOT's updates and the public files the app downloads.</li>
    <li><b>Discord</b> runs our community, if you choose to join it.</li>
  </ul>
  <p>These companies may store information outside Australia, including in the United States. We do not share personal information with anyone else, except where the law requires it, where it is needed to protect people or our rights against fraud or harm, or if the SKYCOT business is sold or reorganised, in which case this policy continues to apply to what we hold.</p>

  <h2>6. Security</h2>
  <p>We keep what we hold to a minimum and protect it with the security of the services above, with access limited to the people who need it. No system is perfectly secure. The security of your Mac, your AI accounts and anything you connect to SKYCOT is in your hands, so keep them up to date and protected. If you find a security problem in SKYCOT or skycot.com, please email <a href="mailto:markhallam@skycot.com?subject=Security">markhallam@skycot.com</a> with "Security" in the subject before telling anyone else, and do not include passwords or keys.</p>

  <h2>7. Your rights</h2>
  <p>You can ask us what we hold about you, ask us to correct or delete it, or complain about how we handled it, by emailing <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a>. We will respond within 30 days. If you are not satisfied you can contact the Office of the Australian Information Commissioner (oaic.gov.au). If you are in the UK or the European Union, you have equivalent rights under the UK GDPR and the EU GDPR, including the right to lodge a complaint with your local supervisory authority.</p>

  <h2>8. Children</h2>
  <p>SKYCOT is a work tool and is not designed for children to use on their own. We do not knowingly collect information from children under 16. A Family profile, for a child using SKYCOT on a parent's Mac under the parent's supervision, is planned for the first release; because SKYCOT holds no account and sends nothing to us, this does not change what we collect, and this section will be revised before that profile ships. Each AI assistant sets its own minimum age, and some require users to be adults; those rules apply too.</p>

  <h2>9. Changes</h2>
  <p>If this policy changes, the new version will be posted here with its date before it applies, and the app will tell you on first launch after an update if the change affects what the app sends.</p>
</div></main>
'''
write("privacy.html", head("Privacy · SKYCOT", "How SKYCOT handles your information: files stay on your Mac, only what each job needs goes to the AI you chose, no analytics, no cookies, no SKYCOT account.", "/privacy") + PRIVACY + FOOTER)

TERMS = f'''{nav()}
<main class="doc"><div class="narrow">
  <h1>Terms of use</h1>
  <p class="meta">Last updated {LAST_UPDATED} · early access</p>
  <p>These terms cover the SKYCOT app and the skycot.com website, made by Curble Pty Ltd ("we", "us"), Melbourne, Australia. By installing or using SKYCOT you agree to them. If you use SKYCOT for a business, you agree to them on its behalf and confirm you are allowed to. Plain-English summaries appear in italics and are not part of the terms.</p>

  <h2>1. What SKYCOT is</h2>
  <p>SKYCOT is software that runs on your computer and helps you direct AI coding assistants made by other companies. It has no account of its own: you do not sign up with us to use it. It is in early access: features may change, be incomplete, contain mistakes, lose work or stop working between versions, so do not rely on SKYCOT as the only copy of anything important. <em>Summary: it is new, and we say so.</em></p>

  <h2>2. Who can use SKYCOT</h2>
  <p>You must be 18 or over to accept these terms. A child may use SKYCOT only on a parent's or guardian's computer and under that adult's supervision; the adult accepts these terms for the child and is responsible for that use. Each AI assistant also sets its own minimum age, which you must meet. <em>Summary: adults sign up for it; children use it with a grown-up.</em></p>

  <h2>3. Your AI assistant is a separate agreement</h2>
  <p>SKYCOT does not provide AI services. You need your own account with at least one supported assistant (for example Claude Code by Anthropic, Codex by OpenAI, Cursor by Anysphere, or Gemini and Antigravity by Google). Your use of those services, their charges, limits and outputs are governed by your agreement with that company, not by us. They can change, stop working or change their prices without telling us, and we are not responsible for their availability, pricing or behaviour. <em>Summary: your AI plan is between you and them.</em></p>

  <h2>4. You direct the work and own the results</h2>
  <p>You decide what to ask, what to allow, what to keep and what to publish. AI assistants can produce work that is wrong, insecure or incomplete, so check what changed before you keep it or put it live. SKYCOT's safeguards (Ask me first, hard rules, versions and undo, a confirmation before anything leaves your Mac) reduce risk; they do not remove it. You remain responsible for your projects, your backups outside SKYCOT, and anything you put live. You confirm that you have the right to use the files and information you give an assistant, and that you will check your provider's terms before giving it confidential, regulated or personal information, such as customer details. Anything you create with SKYCOT is yours, subject to your AI provider's terms. <em>Summary: you are the boss; we give you brakes, not a guarantee.</em></p>

  <h2>5. Acceptable use</h2>
  <p>Do not use SKYCOT to break the law or anyone's rights; to access systems or data you are not entitled to; to spread malicious software or attack other systems; to harass, deceive or defraud anyone; to get around the terms, limits or safeguards of the assistants you connect; or to claim that an assistant's output was made or endorsed by us. Do not remove or alter the open-source and copyright notices in the app.</p>

  <h2>6. Licence to use SKYCOT</h2>
  <p>SKYCOT is based on T3 Code, © T3 Tools Inc., licensed under the MIT licence; that licence continues to apply to that code and is reproduced in the app and on our <a href="/open-source">open source page</a>. If these terms and an open-source licence ever conflict for that code, the open-source licence wins. Our own additions are licensed to you for your use of SKYCOT under these terms during early access. The SKYCOT name and marks are ours and are not covered by the MIT licence. <em>Summary: the engine is open source; the SKYCOT name is ours.</em></p>

  <h2>7. Price</h2>
  <p>SKYCOT is free during early access. You pay your AI provider, and anyone else whose service you use with SKYCOT, under their own terms. If we introduce a price, we will show it before it applies, and you will not be charged unless you agree to it.</p>

  <h2>8. Privacy</h2>
  <p>How we handle information is explained on our <a href="/privacy">privacy page</a>, which forms part of these terms.</p>

  <h2>9. Feedback and themes</h2>
  <p>If you send us ideas, feedback, or a theme for us to include, you allow us to use, change, include and share it, free of charge and without any obligation to you. We credit the themes we include to their authors. You keep any rights you have in what you sent.</p>

  <h2>10. Updates and changes</h2>
  <p>The app checks for updates and may offer or install them. We may change or withdraw features, and we may change these terms; the new version will be posted here with its date, and continued use after that date means you accept it. If a change materially affects you, we will also say so in the app where we reasonably can.</p>

  <h2>11. Australian Consumer Law and warranties</h2>
  <p>Nothing in these terms excludes, restricts or modifies any guarantee, right or remedy you have under the Australian Consumer Law or other law that cannot be excluded. Subject to that, SKYCOT is provided "as is" and "as available" during early access, without warranties of any kind, express or implied, including fitness for a particular purpose, and we do not warrant that it, or anything an AI assistant produces through it, will be uninterrupted, secure, accurate or error-free. <em>Summary: your legal consumer rights stay; beyond those, early-access software comes with no promises.</em></p>

  <h2>12. Limitation of liability</h2>
  <p>To the extent permitted by law, we are not liable for any loss of data, loss of profit, business interruption, or indirect or consequential loss arising from your use of SKYCOT or of any AI assistant used with it, and our total liability for any claim is limited to the amount you paid us for SKYCOT in the twelve months before the claim (which during free early access is nil) or, where the law requires a remedy, to re-supplying the software.</p>

  <h2>13. Ending</h2>
  <p>You can stop using SKYCOT at any time by deleting it; your files remain yours and on your Mac. We may end your right to use SKYCOT if you breach these terms. The parts of these terms that by their nature should continue after that (including the licence notices, sections 11 and 12, and governing law) continue.</p>

  <h2>14. Problems and governing law</h2>
  <p>If something goes wrong, please email us first; we will try in good faith to sort it out within 30 days. These terms are governed by the laws of Victoria, Australia, and you submit to the non-exclusive jurisdiction of its courts. Nothing here stops you from going to a consumer protection regulator or tribunal.</p>

  <h2>15. General</h2>
  <p>These terms and the privacy page are the whole agreement between you and us about SKYCOT. If any part is found unenforceable, the rest still applies. If we do not enforce a term straight away, we have not given it up. We are not responsible for delays or failures caused by events outside our reasonable control.</p>

  <h2>16. Contact</h2>
  <p>Curble Pty Ltd (ABN 71 605 512 776, ACN 605 512 776), trading as SKYCOT, Melbourne, Australia. <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a>.</p>
</div></main>
'''
write("terms.html", head("Terms of use · SKYCOT", "Terms of use for the SKYCOT app and the skycot.com website, made by Curble Pty Ltd, Melbourne, Australia.", "/terms") + TERMS + FOOTER)

OSS = f'''{nav()}
<main class="doc"><div class="narrow">
  <h1>Open source</h1>
  <p class="meta">Attribution and licences</p>
  <p><strong>SKYCOT is based on T3 Code, © T3 Tools Inc., used under the MIT licence.</strong> T3 Code is an open-source control plane for AI coding assistants, published at <a href="https://github.com/pingdotgg/t3code">github.com/pingdotgg/t3code</a>. SKYCOT adds a plain-language interface on top of it and keeps the original interface available as "Advanced mode".</p>
  <p>SKYCOT is an independent product of Curble Pty Ltd. <strong>SKYCOT is not affiliated with, sponsored by or endorsed by T3 Tools Inc.</strong> "T3" and "T3 Code" are names and marks of T3 Tools Inc.; the MIT licence covers the code, not those marks, and SKYCOT does not use them in its name or logo.</p>
  <p>We are grateful to the T3 Code team. Their README says they want people to have everything they need to fork and build the editor they want. That is exactly what SKYCOT is.</p>

  <h2>The MIT licence (T3 Code)</h2>
  <p>Reproduced in full, as the licence requires, from the LICENSE file that ships with SKYCOT:</p>
  <pre class="licence">{html.escape(LICENSE)}</pre>

  <h2>What this means for you</h2>
  <ul>
    <li>The licence notice above ships inside every copy of SKYCOT (in the installer and under Settings → About → Open-source licences) and must stay there.</li>
    <li>The MIT licence applies to the T3 Code portions. SKYCOT's own additions, and the SKYCOT name, are © 2026 Curble Pty Ltd (trading as SKYCOT); see the <a href="/terms">terms of use</a>. Whether our additions will also be published under an open licence is a decision still to be made and will be announced here.</li>
    <li>SKYCOT does not ship T3 Code's release pipeline, install scripts or telemetry configuration; our builds are published by Curble Pty Ltd from our own repository.</li>
  </ul>

  <h2 id="themes">Themes are open</h2>
  <p>Every SKYCOT theme is a plain data file: a short list of colours, a few "flavour" choices (borders, headings, tip cards, button shape, motion) and optional crew names. A theme contains no code, and you can read one in any text editor. The four themes that ship with SKYCOT (Classic, Workshop, Paper and Night Ops) are published with the app, and the format will be documented alongside the first download.</p>
  <p>Community themes are welcome. Duplicate a theme in Settings → Appearance, edit it, export it, and contribute it through the SKYCOT repository (the address will be published here with the first download) or by email to <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a>. Themes we include are credited to their author. A theme changes how SKYCOT looks, never what it does: the permission, undo and publish moments stay plain in every theme.</p>

  <h2>Third-party licences</h2>
  <p>SKYCOT bundles many other open-source packages (for example React, Electron and the libraries T3 Code depends on), each under its own licence, mostly MIT, Apache 2.0, BSD and ISC. The complete list, with each licence text and copyright holder, is generated at build time and included in every download; in the app it is under Settings → About → Open-source licences. A copy for the current public version will be published at this address when the first download is released.</p>
  <p>The AI assistants SKYCOT works with (Claude Code, Codex, Cursor, Gemini and Antigravity) are separate products that you install and sign in to under their owners' terms. They are not part of SKYCOT and are not open source unless their owners say so.</p>

  <h2>Reporting a problem</h2>
  <p>If you believe an attribution is missing or wrong, email <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a> and we will fix it.</p>
</div></main>
'''
write("open-source.html", head("Open source · SKYCOT", "SKYCOT is based on T3 Code, © T3 Tools Inc., MIT licence. Full licence text, non-affiliation statement and third-party licences.", "/open-source") + OSS + FOOTER)

# ---------- 404 (Cloudflare Pages serves /404.html for any address it does not know) ----------
NOTFOUND = f'''{nav()}
<main class="notfound"><div class="narrow">
  <h1>That page isn't here.</h1>
  <p>The SKYCOT website was rebuilt in October 2026, so the page you were looking for may have moved or been retired.</p>
  <div class="actions"><a class="btn btn-primary" href="/">Go to the home page</a><a class="btn btn-secondary" href="mailto:markhallam@skycot.com">Email us</a></div>
</div></main>
'''
write("404.html", head("Page not found · SKYCOT", "This page is not on skycot.com.", "/404", robots="noindex") + NOTFOUND + FOOTER)

# ---------- og.png share image (1200x630), rendered by headless Chrome from a tiny HTML card ----------
OG_HTML = f'''<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>SKYCOT share card</title>
<style>
html,body{{margin:0;width:1200px;height:630px;overflow:hidden;background:#fff}}
body{{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;color:#1d1d1f;-webkit-font-smoothing:antialiased}}
.card{{box-sizing:border-box;width:1200px;height:630px;padding:76px 88px 64px;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(180deg,#ffffff 0%,#f5f5f7 100%)}}
.brand{{display:flex;align-items:center;gap:18px;font-weight:700;letter-spacing:.16em;font-size:30px}}
.brand svg{{width:64px;height:64px}}
h1{{margin:0;font-size:86px;line-height:1.02;letter-spacing:-.035em;font-weight:700;max-width:16ch}}
.foot{{display:flex;justify-content:space-between;align-items:center;font-size:26px;color:#6e6e73}}
.foot b{{color:#0071e3;font-weight:600}}
</style></head>
<body><div class="card">
  <div class="brand">{MARK.replace('width="28" height="28"', 'width="64" height="64"').replace('var(--accent)', '#0071e3')}<span>SKYCOT</span></div>
  <h1>{html.escape(H1, quote=False)}</h1>
  <div class="foot"><b>SKYCOT for Mac · early access</b><span>skycot.com</span></div>
</div></body></html>
'''
os.makedirs(OG_DIR, exist_ok=True)
with open(OG_DIR + "og-card.html", "w", encoding="utf-8") as f:
    f.write(OG_HTML)
if os.path.exists(CHROME):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--window-size=1200,630", "--screenshot=" + OUT + "og.png", "file://" + OG_DIR + "og-card.html"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("wrote og.png")
else:
    print("Chrome not found; og.png not regenerated")
