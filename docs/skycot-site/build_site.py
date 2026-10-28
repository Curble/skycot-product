# Generates the SKYCOT product site (skycot.com): one home page whose light side is the calm look (was
# variant A) and whose dark side is the bold look (was variant B), switched automatically by the visitor's
# light/dark setting; privacy, terms, open-source and 404 pages; and the og.png share image.
# The output folder is copied as-is into public/ of mark-hallam/skycot-research-site (branch product-site).
# Brand (22 October 2026): logos, favicons, share image and mascot come from nondev/brand/assets (see
# docs/brand/SKYCOT-brand-guide.html). The cloud is SKYCOT, like the product (brand guide section 12): say
# "SKYCOT the cloud" only where the character must be clear, never another name. Workshop is the default look.
import os, html, json, shutil
HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
OUT = HERE + "draft/"
BRAND = os.path.normpath(HERE + "../../nondev/brand/assets") + "/"
LICENSE = open(os.path.normpath(HERE + "../../LICENSE"), encoding="utf-8").read().strip()
# Day/dusk rule (brand guide section 2), inlined in every page's <head> so it runs before first paint.
DAYLIGHT = open(HERE + "daylight.js", encoding="utf-8").read().strip()

def lockup(grownup=False, h=32):
    # Horizontal lockup: light mode shows the day lockup, dark mode the dusk lockup (on dark). Legal pages
    # use the grown-up lockup (minimal mark, plain wordmark), which never changes with the time of day.
    light, dark, vw, vh = (("lockup-horizontal-minimal-light.svg", "lockup-horizontal-minimal-dark.svg", 473, 116) if grownup
                           else ("lockup-horizontal-day-light.svg", "lockup-horizontal-dusk-dark.svg", 488, 118))
    return (f'<picture class="lockup"><source media="(prefers-color-scheme: dark)" srcset="/assets/brand/{dark}">'
            f'<img src="/assets/brand/{light}" width="{round(h * vw / vh)}" height="{h}" alt="SKYCOT"></picture>')

def mascot(cls, label=None):
    # The hello pose, day and dusk stacked; html[data-sky] (set by DAYLIGHT) cross-fades between them.
    # Only one drawing shows at a time, so the wrapper carries the spoken name, not the two images.
    a11y = f'role="img" aria-label="{html.escape(label)}"' if label else 'aria-hidden="true"'
    return (f'<div class="sky {cls}" {a11y}><img class="d" src="/assets/brand/mascot-hello-day.svg" width="176" height="176" alt="">'
            f'<img class="n" src="/assets/brand/mascot-hello-dusk.svg" width="176" height="176" alt=""></div>')

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
.lockup,.lockup img{display:block}
.nav .lockup img{width:132px;height:32px}
footer .lockup img{width:116px;height:28px}
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
.hero{background:#000;color:#f5f5f7;padding:110px 0 0;overflow:hidden}
.hero h1{font-size:clamp(44px,7.6vw,96px);font-weight:700;letter-spacing:-.03em;background:linear-gradient(180deg,#fff 40%,#8a8a8f);-webkit-background-clip:text;background-clip:text;color:transparent;max-width:16ch}
.hero .lede{color:#a1a1a6;max-width:34em}
.hero .lede2{color:#86868b}
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
@media (max-width:900px){.moment,.moment.flip{grid-template-columns:1fr;gap:22px;padding:28px 0}.moment.flip .text{order:0}}

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

/* family-first additions (22 October 2026) */
.hero .lede2{font-size:clamp(15px,1.5vw,17px);color:var(--text3);max-width:48em;margin:14px auto 0}
.nw{white-space:nowrap}
.moment.flip{grid-template-columns:7fr 5fr}
.crewrow{display:flex;gap:28px;align-items:center;max-width:820px;margin:40px auto 8px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px 26px}
.crewart{display:flex;align-items:flex-end;gap:6px;flex:0 0 auto}
.crewart .mate{width:56px;height:56px;margin-bottom:22px}
.crewrow h3{font-size:22px;margin-bottom:6px}
.crewrow p{color:var(--text2);font-size:16px}
@media (max-width:600px){.crewrow{flex-direction:column;align-items:flex-start;padding:20px}}
.cards.two{grid-template-columns:repeat(2,1fr)}
/* New for families: two groups of feature cards, each led by one wide card */
.fgroup{margin-top:52px}
.fgroup .gh{font-size:clamp(22px,2.4vw,28px);font-weight:700;margin:0}
.fgroup .gs{color:var(--text2);margin:6px 0 0;font-size:17px}
.fgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:22px;margin-top:22px}
.fcard{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column}
.fcard.wide{grid-column:1/-1;flex-direction:row;align-items:center}
.fcard img{display:block;width:100%;height:auto;aspect-ratio:1200/707;object-fit:cover;object-position:top center;border-bottom:1px solid var(--line)}
.fcard .t{padding:20px 22px 24px}
.fcard h3{font-size:20px;margin:0 0 6px}
.fcard p{color:var(--text2);font-size:16px;margin:0}
.fcard.wide img{width:62%;flex:none;border-bottom:0;border-right:1px solid var(--line)}
.fcard.wide .t{padding:28px 32px}
.fcard.wide h3{font-size:clamp(22px,2.4vw,30px);margin-bottom:10px}
.fcard.wide p{font-size:17px}
@media (max-width:820px){.fcard.wide{flex-direction:column;align-items:stretch}.fcard.wide img{width:100%;border-right:0;border-bottom:1px solid var(--line)}.fcard.wide .t{padding:20px 22px 24px}}
@media (max-width:600px){.fgrid{grid-template-columns:1fr}}
.card .ask{color:var(--text);font-style:italic;margin-bottom:10px}
.looks.two{grid-template-columns:repeat(2,1fr)}
.honest.center-note{text-align:center;max-width:44em;margin-left:auto;margin-right:auto}
@media (max-width:900px){.cards.two,.looks.two,.moment.flip{grid-template-columns:1fr}}

/* time-of-day mascot (brand guide): day pose from local dawn to dusk, dusk pose after dusk. Default day.
   The sky card appears only where contrast needs it: the day mascot on a dark page gets a soft day sky,
   the dusk mascot on a light page gets its dusk sky. Sizes are fixed, so nothing shifts when it swaps. */
.sky{--s:200px;position:relative;flex:0 0 auto;width:var(--s);height:calc(var(--s) * .64);overflow:hidden;border-radius:calc(var(--s) * .14)}
.sky img{position:absolute;left:0;top:calc(var(--s) * -.25);width:var(--s);max-width:none;height:var(--s);transition:opacity 1s ease}
.sky .n,:root[data-sky="dusk"] .sky .d{opacity:0}
:root[data-sky="dusk"] .sky .n{opacity:1}
:root[data-sky="dusk"] .sky{background:linear-gradient(180deg,#171a45 0%,#3c3486 60%,#8e5aa8 88%,#f4a27a 100%)}
@media (prefers-color-scheme:dark){
:root:not([data-sky="dusk"]) .sky{background:linear-gradient(180deg,#bbdfff 0%,#e8f4ff 62%,#fff6e6 100%)}
:root[data-sky="dusk"] .sky{background:none}
}
@media (prefers-reduced-motion:reduce){.sky img{transition:none}}
.sky-hero{--s:220px;margin:-30px auto 14px}
.sky-crew{--s:128px}
@media (max-width:600px){.sky-hero{--s:180px;margin:-44px auto 12px}}

/* What makes Workshop special: numbered pins on a real screenshot, callouts beside it (under it on phones) */
.tour{margin-top:40px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:30px 32px 32px}
.tour-head{max-width:46em;margin-bottom:22px}
.tour-head h3{font-size:clamp(24px,2.6vw,32px);margin-bottom:8px}
.tour-head p{color:var(--text2);font-size:17px}
.tour-main{display:grid;grid-template-columns:7fr 4fr;gap:30px;align-items:start}
.tour-fig{position:relative;margin:0;border-radius:12px;overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow)}
.tour-fig img{width:100%}
.pin{position:absolute;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;font-size:15px;line-height:1;display:grid;place-items:center;box-shadow:0 0 0 3px #fff,0 4px 12px rgba(0,0,0,.28)}
.notes{list-style:none;margin:0;padding:0;display:grid;gap:18px}
.notes li,.tile figcaption{display:grid;grid-template-columns:30px 1fr;gap:12px;align-items:start}
.num{width:30px;height:30px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-weight:700;font-size:15px;line-height:1;display:grid;place-items:center}
.tour h4{font-size:17px;margin:3px 0 4px;letter-spacing:-.01em}
.tour .notes p,.tile p{color:var(--text2);font-size:15px}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:30px}
.tile{margin:0}
.tile .pic{aspect-ratio:4/3;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--bg2)}
.tile .pic>img{width:100%;height:100%;object-fit:cover}
.tile figcaption{margin-top:14px}
.duo{display:grid;grid-template-columns:1fr 1fr;height:100%}
.duo div{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:13px;font-weight:600}
.duo .day{background:#fff6e6;color:#6b5847}
.duo .dusk{background:linear-gradient(180deg,#171a45 0%,#3c3486 60%,#8e5aa8 88%,#f4a27a 100%);color:#f5f5f7}
.duo img{width:78%;max-width:170px;margin-top:-12%}
@media (max-width:900px){.tour{padding:22px 18px 24px}.tour-main{grid-template-columns:1fr;gap:22px}.tiles{grid-template-columns:1fr;gap:26px}}
@media (max-width:600px){.pin{width:22px;height:22px;font-size:12px;box-shadow:0 0 0 2px #fff,0 2px 8px rgba(0,0,0,.28)}}

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
LAST_UPDATED = "28 October 2026"
H1 = "The family-friendly AI developer."
LEDE = ("Kids dream it up. SKYCOT builds it. Nothing goes online without a grown-up's code. "
        "Plain English, on your own Mac, with the AI you already pay for.")
LEDE2 = "Grown-ups use it for their business too: no code, no jargon, nothing live until you say so."
TITLE = "SKYCOT · The family-friendly AI developer"
DESC = ("Kids dream it up, SKYCOT builds it, and nothing goes online without a grown-up's code. A plain-English AI "
        "developer for families and small businesses, on your own Mac, with the AI you already pay for.")
OG_ALT = ("SKYCOT. Free beta, out now. The family-friendly AI developer. Kids say what they want to make, SKYCOT builds it on your Mac, "
          "asks before every change, and nothing goes online without a grown-up's code. skycot.com. Beside it, the SKYCOT app's Home screen and a cheering cloud.")

# Identity metadata for search engines. Never add an address here (standing rule: no street, postal
# or registered address anywhere on skycot.com).
STRUCTURED = json.dumps({
    "@context": "https://schema.org",
    "@graph": [
        {"@type": "Organization", "@id": SITE + "/#organization", "name": "SKYCOT",
         "legalName": "Curble Pty Ltd", "url": SITE + "/", "email": "markhallam@skycot.com"},
        {"@type": "WebSite", "@id": SITE + "/#website", "name": "SKYCOT", "url": SITE + "/",
         "publisher": {"@id": SITE + "/#organization"}},
        {"@type": "SoftwareApplication", "@id": SITE + "/#app", "name": "SKYCOT", "url": SITE + "/",
         "description": "The family-friendly AI developer. Kids dream it up, SKYCOT builds it, and nothing "
                        "goes online without a grown-up's code. Free beta for Mac.",
         "operatingSystem": "macOS 13 Ventura or later", "processorRequirements": "Apple silicon (M1 or later)",
         "applicationCategory": "DeveloperApplication", "applicationSubCategory": "Family",
         "softwareVersion": "0.1.1 beta", "releaseNotes": SITE + "/#new",
         "downloadUrl": "https://downloads.skycot.com/mac/SKYCOT-0.1.1-nondev.32.beta-arm64.dmg",
         "fileSize": "160MB", "image": SITE + "/assets/brand/og-beta.png",
         "screenshot": SITE + "/assets/hero.jpg",
         "offers": {"@type": "Offer", "price": "0", "priceCurrency": "AUD",
                    "availability": "https://schema.org/InStock"},
         "publisher": {"@id": SITE + "/#organization"}},
    ],
}, separators=(",", ":"))

def attr(text):
    # Attribute-safe escaping that leaves apostrophes readable (attributes use double quotes).
    return html.escape(text, quote=False).replace('"', '&quot;')

def head(title, desc, path="/", robots=None, css=None, open_body=True):
    css = CSS if css is None else css
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
<meta property="og:image" content="{SITE}/assets/brand/og-beta.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{attr(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{attr(title)}">
<meta name="twitter:description" content="{attr(desc)}">
<meta name="twitter:image" content="{SITE}/assets/brand/og-beta.png">
<meta name="twitter:image:alt" content="{attr(OG_ALT)}">
<script id="skycot-structured-data" type="application/ld+json">{STRUCTURED}</script>
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" id="favicon-svg" type="image/svg+xml" href="/assets/brand/favicon-day.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="mask-icon" href="/assets/brand/mask-icon.svg" color="#0071e3">
<link rel="manifest" href="/site.webmanifest">
<script>{DAYLIGHT}</script>
{('<style>' + css + '</style>') if css else ''}
{'</head>' + chr(10) + '<body>' + chr(10) if open_body else ''}'''

# Links are root-relative clean URLs (/privacy, /#how) as Cloudflare Pages serves them.
# To preview the generated folder locally, serve it (e.g. `npx wrangler pages dev draft`), not file://.
def nav(grownup=False):
    return f'''<header class="nav"><div class="wrap">
  <a class="brand" href="/" aria-label="SKYCOT home">{lockup(grownup)}</a>
  <ul>
    <li><a href="/#new">Families</a></li>
    <li><a href="/#how">How it works</a></li>
    <li><a href="/#safety">Safety</a></li>
    <li><a href="/#faq">FAQ</a></li>
  </ul>
  <a class="btn btn-primary btn-small cta" href="/#download">Download</a>
</div></header>
'''

def footer(grownup=False):
    return FOOTER.replace("<!--lockup-->", lockup(grownup, 28))

FOOTER = '''<footer><div class="wrap">
  <div class="cols">
    <a class="brand" href="/" aria-label="SKYCOT home"><!--lockup--></a>
    <ul>
      <li><a href="/#new">Families</a></li>
            <li><a href="/#make">What kids make</a></li>
      <li><a href="/#how">How it works</a></li>
      <li><a href="/#safety">Safety</a></li>
      <li><a href="/#looks">Looks</a></li>
      <li><a href="/#grown-ups">For business</a></li>
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

IC_GAME = ic('<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="15.5" cy="11.5" r="1"/><circle cx="18" cy="14" r="1"/>')
IC_FLAG = ic('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>')
IC_QUIZ = ic('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17h.01"/>')
IC_PAW = ic('<circle cx="7" cy="10" r="1.8"/><circle cx="11" cy="6.5" r="1.8"/><circle cx="15.5" cy="7.5" r="1.8"/><circle cx="18" cy="11.5" r="1.8"/><path d="M8.5 17.5c0-2.5 2-5 4.5-5s4 2 4 4-1.5 3-3.5 3-2.5-1-5 0z"/>')
IC_KEY = ic('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>')

# One alt text for the hero (light: Home by day, Family profile on for a sample child; dark: Home at dusk).
HERO_ALT = ("SKYCOT's Home in the Workshop look: SKYCOT the cloud waves beside \"SKYCOT says hello\" "
            "and a good-afternoon greeting, a sticky-note tip sits on the right, and the crew Sam, who builds things, "
            "and Mo, who checks before anything goes live, sit in the sidebar under a sample café website project.")

# "What makes Workshop special" (22 October 2026): Workshop is SKYCOT's default look. Pins 1-3 point at real
# parts of one screenshot (left/top are percentages of the 1200x707 image); 4-6 are close-ups. On phones the
# pins shrink and every callout stacks under its picture.
TOUR_PINS = [("80.5%", "47%"), ("14.4%", "36%"), ("30.3%", "9.6%")]
TOUR_NOTES = [
    ("Hand-drawn borders and sticky notes",
     "Cards look sketched on cream paper with marker pens, and tips and notes sit on sticky notes, like a workbench."),
    ("The crew",
     "SKYCOT says hello, Sam builds, Mo checks. The app says \"Sam needs your OK\" instead of \"the assistant\"."),
    ("Larger, friendly text",
     "Handwritten headings, marker underlines and roomy type. Larger text is one switch in Settings, and the Family profile turns it on."),
]
TOUR_TILES = [
    ("SKYCOT the cloud follows your sky",
     "By day it waves from a cream morning; after sunset where you live it wears its dusk colours, with a star."),
    ("Risk moments stay calm and plain",
     "Approval cards, Undo and going live drop the doodles: plain borders, plain words, nothing pre-selected."),
    ("Prefer calm? Classic is one click away",
     "Settings, Appearance: hover a look to try it on, click to keep it. A look never changes what SKYCOT does."),
]

def tour_html():
    pins = "".join(f'<span class="pin" style="left:{x};top:{y}" aria-hidden="true">{i}</span>' for i, (x, y) in enumerate(TOUR_PINS, 1))
    notes = "".join(f'<li><span class="num" aria-hidden="true">{i}</span><div><h4>{html.escape(h, quote=False)}</h4><p>{html.escape(t, quote=False)}</p></div></li>'
                    for i, (h, t) in enumerate(TOUR_NOTES, 1))
    pics = [
        '<div class="duo"><div class="day"><img src="/assets/brand/mascot-hello-day.svg" width="176" height="176" alt="SKYCOT the cloud by day, waving">By day</div>'
        '<div class="dusk"><img src="/assets/brand/mascot-hello-dusk.svg" width="176" height="176" alt="SKYCOT the cloud at dusk, waving, with a star">After sunset</div></div>',
        '<img src="assets/workshop-calm.jpg" width="800" height="600" alt="Close-up of an approval card in the Workshop look: Sam needs your OK, then a plain May I run this? card with Why it matters, Where it reaches, If you say no, and four plain buttons, none pre-selected.">',
        '<img src="assets/workshop-classic.jpg" width="800" height="600" alt="Close-up of Settings, Appearance: the Workshop card is ticked as the current look, with Classic, the Apple Messages look, right beside it.">',
    ]
    tiles = "".join(f'<figure class="tile"><div class="pic">{pic}</div><figcaption><span class="num" aria-hidden="true">{i}</span><div><h4>{html.escape(h, quote=False)}</h4><p>{html.escape(t, quote=False)}</p></div></figcaption></figure>'
                    for i, (pic, (h, t)) in enumerate(zip(pics, TOUR_TILES), 4))
    return f'''<div class="tour" id="workshop">
    <div class="tour-head"><span class="tag">SKYCOT's default look</span><h3>What makes Workshop special</h3>
      <p>Playful and hand-drawn, for kids and for grown-ups who like a bit of fun. Every look keeps the same careful app underneath.</p></div>
    <div class="tour-main">
      <figure class="tour-fig"><img src="assets/workshop-tour.jpg" width="1200" height="707" alt="A conversation in the Workshop look: the crew Sam and Mo in the sidebar, a handwritten Conversations heading with a marker underline, a sketched What changed card for a new Christmas page, and the Versions panel's restore notes on a pink sticky note.">{pins}</figure>
      <div><ol class="notes">{notes}</ol>
        <blockquote class="quote">"It makes me feel like a kid."<cite>Mark Hallam, founder, the first time he saw it</cite></blockquote></div>
    </div>
    <div class="tiles">{tiles}</div>
  </div>'''

WORKSHOP_TOUR = tour_html()

# New for families: the shipped family features (22 Oct 2026). Images come from one demo family
# (Ava and her brother Leo, both fictional) in the Workshop look. Only shipped features go here.
FEATURES_KIDS = [
    ("fam-starters.jpg", "Tap a card to start",
     "Eight one-tap ideas: a game, a page about a pet, a birthday card, a comic, a quiz and more. A tap fills in the message with blanks to change, and nothing is sent until they press Send.",
     "starters", True),
    ("fam-talk.jpg", "Talk to SKYCOT",
     "Tap the microphone and say it; the words appear in the box. Replies can be read aloud by a voice on the Mac. Voice typing stays off until a grown-up turns it on.",
     "talk", False),
    ("fam-draw.jpg", "Draw it, then build it",
     "Draw on paper, snap a photo and add it to the message. SKYCOT builds from the drawing, and Open it runs the result right inside SKYCOT, with no internet.",
     "draw", False),
    ("fam-explain.jpg", "“How did you do that?”",
     "After a build, SKYCOT explains what it did in kid-sized words, with a peek at the real code for the curious.",
     "explain", False),
    ("fam-stickers.jpg", "Stickers and a certificate",
     "Sixteen stickers for real moments, like a first creation, a first Undo or saying please. Nothing rewards time spent, and nothing is ever taken away. Print a “My first app” certificate for the fridge.",
     "stickers", False),
]
FEATURES_GROWNUPS = [
    ("fam-recap.jpg", "The grown-up recap",
     "“Ava made 4 things this week.” Time on SKYCOT, what they made, their proudest thing and anything that needed a grown-up. It opens with the parent code, is built on your Mac, and prints or saves as a PDF.",
     "recap", True),
    ("fam-shield.jpg", "Personal details stay home",
     "Before a message goes, SKYCOT spots a full name, school, address, phone number, email or birthday and suggests leaving it out. It looks for common patterns, so stay nearby.",
     "shield", False),
    ("fam-siblings.jpg", "A profile for each child",
     "Up to eight children under one parent code, each with their own name, picture, look, voice settings and limits. “Who’s using SKYCOT?” asks when it opens.",
     "siblings", False),
    ("fam-bedtime.jpg", "Bedtime and daily limits",
     "Set a bedtime and a daily time or message limit for each child. A calm heads-up comes five minutes before; the step that’s running finishes, then SKYCOT sleeps. Limits apply inside SKYCOT only.",
     "bedtime", False),
    ("fam-fridge.jpg", "The family fridge",
     "Pin the best things to the fridge, where the whole family can open them. Taking one down never deletes it.",
     "fridge", False),
]
FEATURE_ALTS = {
    "starters": "Home in the Workshop look greeting Ava, with eight colourful starter cards such as Make a game, A page about my pet and Draw it, then build it.",
    "talk": "SKYCOT listening as Ava asks, Can Bubbles blow bubbles when I click her?, with her words appearing in the message box.",
    "draw": "Ava's crayon rocket drawing, turned into a working page and opened inside SKYCOT, offline.",
    "explain": "Sam explains how he drew Bubbles the axolotl in simple words, Mo says what he checked, and the code is shown underneath.",
    "stickers": "Ava's sticker book: First creation, Game maker, Animal friend, Drew it first, Said it out loud and Kind words, with the rest still to find.",
    "recap": "The grown-up recap, Ava's week: 40 minutes on SKYCOT, 4 things made, a bar for each day and her rocket page as the thing she is most proud of.",
    "shield": "Mo spots a full name and a school in Ava's message and suggests sending Ava and school instead.",
    "siblings": "The Who's using SKYCOT? picker with big buttons for Ava and Leo.",
    "bedtime": "SKYCOT is asleep: it's bedtime, Leo, SKYCOT wakes up at 7:00 am, with Ask a grown-up for more time.",
    "fridge": "Ava's fridge with three things she made: a rocket drawing page, a star-catching game and a page about her axolotl.",
}

def feature_cards(items):
    out = []
    for img, title, body, key, wide in items:
        alt = html.escape(FEATURE_ALTS[key])
        cls = "fcard wide" if wide else "fcard"
        out.append(f'<div class="{cls}"><img src="assets/{img}" width="1200" height="707" loading="lazy" alt="{alt}">'
                   f'<div class="t"><h3>{html.escape(title, quote=False)}</h3><p>{html.escape(body, quote=False)}</p></div></div>')
    return "\n    ".join(out)

def new_for_families():
    return f'''<section id="new" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">New for families</p><h2 class="title">Made for kids. <span class="nw">Run by grown-ups.</span></h2>
  <p class="sub">Ten things that make SKYCOT a workshop for children, with a grown-up’s control behind every one. All of them are in today’s early-access build.</p></div>
  <div class="fgroup"><p class="gh">For kids</p><p class="gs">Say it, tap it or draw it, and find out how it was made.</p>
  <div class="fgrid">
    {feature_cards(FEATURES_KIDS)}
  </div></div>
  <div class="fgroup"><p class="gh">For grown-ups</p><p class="gs">See what they made, keep their details at home, and decide when the workshop closes.</p>
  <div class="fgrid">
    {feature_cards(FEATURES_GROWNUPS)}
  </div></div>
  <p class="fine center" style="margin:28px auto 0">Screens from SKYCOT’s beta build, with sample children called Ava and Leo. The free Mac beta is ready to download.</p>
</div></section>
'''

def home_body():
    hero = f'''<section class="hero"><div class="wrap">
  {mascot("sky-hero", "SKYCOT the cloud, waving hello")}
  <span class="eyebrow">SKYCOT for Mac · free beta</span>
  <h1>{html.escape(H1, quote=False).replace("family-friendly", '<span class="nw">family-friendly</span>')}</h1>
  <p class="lede">{html.escape(LEDE, quote=False)}</p>
  <p class="lede2">{html.escape(LEDE2, quote=False)} <a href="#grown-ups">See how</a></p>
  <div class="actions">
    <a class="btn btn-primary" href="#download">Get SKYCOT for Mac</a>
    <a class="btn btn-secondary" href="#family">See the Family profile</a>
  </div>
  <p class="hero-note">Works with Claude Code, Codex, Cursor, Gemini and others, signed in with a grown-up's own account. Your files stay on your Mac; only what each job needs goes to the AI you chose.</p>
  <div class="hero-tail">
  <div class="frame"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.jpg" width="1200" height="707"><img src="assets/hero.jpg" width="1200" height="707" alt="{html.escape(HERO_ALT)}"></picture></div>
  </div>
  <p class="caption">Beta build: Home in the Workshop look, SKYCOT's default. Light mode shows it by day with the Family profile on for a sample child called Ava; dark mode shows it at dusk.</p>
</div></section>
'''
    body = f'''
<section class="promise"><div class="wrap">
  <div class="trio">
    <div><h3>Kids dream it up</h3><p>A game for a friend, the school-fair website, a quiz for a little brother. Said in plain English, like a message.</p></div>
    <div><h3>Sam builds it, carefully</h3><p>The assistant shows a plan and asks before every change. Undo puts every file back, any time.</p></div>
    <div><h3>A grown-up holds the keys</h3><p>Nothing goes online without the parent code. It runs on your Mac, with your own AI account, with you nearby.</p></div>
  </div>
</div></section>

<section id="family"><div class="wrap">
  <div class="center"><p class="kicker">Made for families</p><h2 class="title">A safe first workshop for young builders.</h2>
  <p class="sub">Turn on the Family profile and SKYCOT becomes a place where a child can build real things with a grown-up's hand on the brakes. It runs on your Mac, signed in to your own AI account, and your child uses it with you nearby.</p></div>

  <div class="crewrow">
    <div class="crewart" role="img" aria-label="SKYCOT the cloud, waving hello, with Sam in a yellow hard hat, who builds things, and Mo in round glasses, who checks before anything risky.">
      {mascot("sky-crew")}<img class="mate" src="/assets/brand/sam.svg" width="56" height="56" alt=""><img class="mate" src="/assets/brand/mo.svg" width="56" height="56" alt="">
    </div>
    <div><span class="tag">Built and in testing for the first release</span>
      <h3>Meet the crew. SKYCOT says hello, Sam builds, Mo checks.</h3>
      <p>Workshop is SKYCOT's default look: cream paper, marker pens, sticky-note tips and a named crew. The app says "Sam needs your OK" instead of "the assistant". Classic is there for anyone who prefers calm, and your child can pick another look any time; a look never changes what SKYCOT does.</p></div>
  </div>

  <div class="moment">
    <div class="text"><h3>Set up in a minute, by a grown-up.</h3>
      <p>The first thing SKYCOT asks is who it's for. Choose "A child I look after", add a first name if you like, and pick a parent code of 4 to 6 digits. The set-up screen says plainly what the profile does, and what it doesn't.</p>
      <ul><li>Or turn it on later in Settings → Family.</li><li>The greeting uses your child's name: "Good evening, Ava."</li><li>Text comes up a little larger, for easier reading.</li></ul></div>
    <div class="shot"><img src="assets/family-setup.jpg" width="1200" height="707" alt="The Set up the Family profile sheet over the Workshop look: an optional first name, a parent code typed twice, and two lists, What this does and What it does not do."></div>
  </div>

  <div class="moment flip">
    <div class="text"><h3>The assistant always asks first.</h3>
      <p>In a Family profile, Ask me first is the only mode. The assistant shows a plan and asks before every command and every file change. The riskier modes aren't offered, and the developer tools are hidden from the sidebar.</p>
      <ul><li>Some things ask in every mode: deleting, putting anything live, spending money.</li><li>A red Stop button halts everything, instantly.</li><li>Undo puts every file back to any earlier version.</li></ul></div>
    <div class="shot"><img src="assets/family-always-asks.jpg" width="1200" height="707" alt="Settings, Autonomy and safety, in the Workshop look: Ask me first is fixed by the Family profile, followed by the list of what SKYCOT always asks about, such as deleting files, putting anything live and spending money."></div>
  </div>

  <div class="moment">
    <div class="text"><h3>Nothing goes online without your code.</h3>
      <p>Sending work for review or putting it live gains a Parent code step before Confirm. The same code guards new automations, the developer tools and turning the profile off. Five wrong tries locks every code prompt for five minutes.</p>
      <ul><li>Building, drafts and Undo work as normal.</li><li>You see what will happen, and what won't, before you confirm.</li><li>Change the code any time in Settings → Family.</li></ul></div>
    <div class="shot"><img src="assets/family-parent-code.jpg" width="1200" height="707" alt="The Publish sheet for a sample café website in the Workshop look, with a Parent code step: Uploading a draft line needs a parent's OK while the Family profile is on."></div>
  </div>

  <p class="honest"><b>An honest note.</b> The Family profile is a set of guardrails inside SKYCOT, not a security or parental-control product. It doesn't filter the web, lock the Mac or replace Screen Time, its bedtime and limits apply only inside SKYCOT, it can't guarantee what an AI says, and a determined teenager could get round it. SKYCOT runs on the parent's own Mac and AI account, under the parent's supervision, and each AI service's own age rules still apply (see <a href="#faq">the questions below</a>). It makes the first experience safe and kind. The rest is parenting.</p>
</div></section>

{new_for_families()}
<section id="ideas"><div class="wrap">
  <div class="center"><p class="kicker">What kids make</p><h2 class="title">If they can say it, they can build it.</h2>
  <p class="sub">Real projects, made by talking. Here are a few a child might start with, and what they end up with.</p></div>
  <div class="cards two">
    <div class="card"><div class="ic">{IC_GAME}</div><h3>A game for a friend</h3><p class="ask">"Make a game where you catch falling stars, and it gets faster."</p><p><b>What you get:</b> a little game that plays in the browser on your Mac, with a high score to beat.</p></div>
    <div class="card"><div class="ic">{IC_FLAG}</div><h3>The school-fair website</h3><p class="ask">"A page with all the stalls, the times, and a map of the oval."</p><p><b>What you get:</b> a real website, ready on your Mac. It goes online only when a grown-up types the code.</p></div>
    <div class="card"><div class="ic">{IC_QUIZ}</div><h3>A quiz for a little brother</h3><p class="ask">"A times-tables quiz that cheers when you get one right."</p><p><b>What you get:</b> a quiz that gets harder as he goes, and changes whenever you ask.</p></div>
    <div class="card"><div class="ic">{IC_PAW}</div><h3>A page for the family dog</h3><p class="ask">"A page about Biscuit, with his tricks and a countdown to his birthday."</p><p><b>What you get:</b> a page the whole family can open, and Undo if a change goes wrong.</p></div>
  </div>
  <p class="fine center" style="margin:28px auto 0">Examples of what a child might ask for. What the assistant builds depends on the AI service you use, and a grown-up checks it before anything is shared.</p>
</div></section>

<section id="how" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">How it works</p><h2 class="title">Three steps. No new vocabulary.</h2></div>
  <div class="steps">
    <div class="step"><div class="n">1</div><h3>A grown-up sets it up</h3><p>Install SKYCOT on your Mac, sign in to the AI you already pay for, and turn on the Family profile with a parent code. Your child doesn't need an account of their own.</p></div>
    <div class="step"><div class="n">2</div><h3>Dream it up, in plain English</h3><p>Your child types what they want to make, like a message. Sam shows a plan and asks before every change. Sit alongside and build it together.</p></div>
    <div class="step"><div class="n">3</div><h3>Keep it, undo it, or share it</h3><p>Read what changed, keep it, or undo all of it. When it's ready for the world, a grown-up types the code to put it online.</p></div>
  </div>
</div></section>

<section id="works-with"><div class="wrap center">
  <p class="kicker">Bring your own AI</p>
  <h2 class="title">Works with the AI you already pay for.</h2>
  <p class="sub">SKYCOT doesn't resell AI or sit between you and your account. A grown-up signs in through each assistant's own sign-in, so SKYCOT never sees the password. Use whichever is best for the job, and switch any time.</p>
  <div class="logos">
    <div class="logo"><b>Claude Code</b><span>Anthropic</span></div>
    <div class="logo"><b>Codex</b><span>OpenAI</span></div>
    <div class="logo"><b>Cursor</b><span>Anysphere</span></div>
    <div class="logo"><b>Gemini</b><span>Google · Antigravity</span></div>
    <div class="logo"><b>And more</b><span>as they're added</span></div>
  </div>
  <p class="fine" style="margin-left:auto;margin-right:auto"><b>Each AI service sets its own age rules.</b> Some, including Anthropic's Claude and Cursor, are for adults only; others allow teenagers with a parent's permission. SKYCOT runs on the parent's account under the parent's supervision, and doesn't change those rules, so check your service's terms before a child uses SKYCOT with it. Product names belong to their owners. SKYCOT is independent and not affiliated with or endorsed by Anthropic, OpenAI, Anysphere or Google.</p>
</div></section>

<section id="safety" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">Safety</p><h2 class="title">Careful by default. Kinder with a Family profile.</h2>
  <p class="sub">The serious incidents with AI coding tools share one shape: a tool running on its own, a destructive command, and no backup. SKYCOT is built so that shape can't happen by default, and the Family profile locks the settings a child could stumble into.</p></div>
  <div class="cards">
    <div class="card"><div class="ic">{IC_HAND}</div><h3>Ask me first</h3><p>The default for everyone, and the only mode in a Family profile. The assistant shows a plan and checks before every change.</p></div>
    <div class="card"><div class="ic">{IC_KEY}</div><h3>A parent code</h3><p>In a Family profile, putting work online, new automations, the developer tools and turning the profile off all need a code only the grown-up knows.</p></div>
    <div class="card"><div class="ic">{IC_SHIELD}</div><h3>Hard rules</h3><p>Some things always ask, in every mode, and can't be switched off. They're printed under the message box so nobody has to remember them.</p></div>
    <div class="card"><div class="ic">{IC_UNDO}</div><h3>Undo, always</h3><p>Work happens in a private copy of the project. Every change is a version. Restore is one click, and it says what it does and doesn't touch.</p></div>
    <div class="card"><div class="ic">{IC_STOP}</div><h3>One big Stop</h3><p>A red Stop button in the header halts everything the moment it's pressed. Nothing is pre-selected, nothing auto-confirms.</p></div>
    <div class="card"><div class="ic">{IC_MAC}</div><h3>Your files stay put</h3><p>SKYCOT runs on your Mac. It sends anonymous daily totals for update checks and, if enabled, relay connections; the totals have no name or account attached. Only what each job needs goes to the assistant you chose, under that company's terms, and it works only in the project folder you open.</p></div>
  </div>
  <div class="rules">
    <div><h3>Always asks, in every mode</h3><p>These are the hard rules. No setting turns them off.</p></div>
    <ul><li>Deleting anything</li><li>Putting anything live</li><li>Spending money</li><li>Signing up to a service</li><li>Touching bookings or orders</li><li>Touching customer details</li></ul>
  </div>
  <p class="honest center-note">Guardrails inside SKYCOT, not web filtering and not Screen Time. A grown-up stays in charge.</p>
</div></section>

<section id="looks"><div class="wrap">
  <div class="center"><p class="kicker">Choose your look</p><h2 class="title">Pick a look. Keep the same careful app.</h2>
  <p class="sub">SKYCOT ships with a library of themes. Try one on with a hover, keep it with a click, change it any time in Settings. A theme changes how things look, never what they do: asking permission, undoing and going live stay plain in every look.</p></div>
  {WORKSHOP_TOUR}
  <div class="looks">
    <div class="look"><div class="pic"><img src="assets/look-classic.jpg" width="1200" height="707" alt="SKYCOT in the Classic theme: white panels, grey sidebar and one blue accent, in the style of Apple Messages."></div>
      <div class="t"><h3>Classic</h3><p>The Apple Messages look. Calm, clean and familiar, for anyone who prefers calm. One click away in Settings.</p></div></div>
    <div class="look"><div class="pic"><img src="assets/look-paper.jpg" width="1200" height="707" alt="SKYCOT in the Paper theme: warm off-white background, serif headings and a single vermilion accent."></div>
      <div class="t"><h3>Paper</h3><p>Warm paper and ink. Serif headings, one vermilion accent, quiet everywhere else.</p></div></div>
    <div class="look"><div class="pic"><img src="assets/look-night-ops.jpg" width="1200" height="707" alt="SKYCOT in the Night Ops theme: dark navy panels with cyan highlights, like a mission-control console."></div>
      <div class="t"><h3>Night Ops</h3><p>Dark navy glass with cyan, mint and amber. Mission control, for late nights.</p></div></div>
  </div>

  <div class="moment flip" style="padding-bottom:0">
    <div class="text"><h3>Themes are files. Yours to share.</h3>
      <p>Every theme is a small, plain data file. Import one a friend sent you, export yours, or duplicate the one you're using and change the colours, the flavour and your crew's names.</p>
      <ul><li>Import, export and share from Settings → Appearance.</li><li>Duplicate and edit: the colours that matter most, a flavour (hand-drawn, serif, glass), and who's on your crew.</li><li>Every theme has a light and a dark side, and can follow your Mac's setting.</li><li>Made something good? Community themes are welcome. See <a href="/open-source#themes">how to contribute one</a>.</li></ul></div>
    <div class="shot"><img src="assets/themes-settings.jpg" width="1200" height="707" alt="Settings → Appearance in the Workshop theme: four theme cards (Classic, Workshop, Paper, Night Ops), buttons to Import a theme, Export this theme, Share, and Duplicate and edit, and a Light or Dark switch."></div>
  </div>
</div></section>

<section id="grown-ups" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">For grown-ups and small businesses too</p><h2 class="title">The same careful developer, for your business.</h2>
  <p class="sub">{html.escape(LEDE2, quote=False)} Text it what you want, like "Add a Christmas menu page", and SKYCOT builds it on your Mac, shows you what changed, and waits for your yes.</p></div>
  <div class="looks two">
    <div class="look"><div class="pic"><img src="assets/approval.jpg" width="1200" height="707" alt="Sam needs your OK: a May I run this? card explaining Why it matters, Where it reaches and If you say no, with Don't allow, Allow once, Allow for the rest of this conversation and Always allow buttons."></div>
      <div class="t"><h3>It asks before it acts.</h3><p>A card like a macOS permission prompt: what it wants, why it matters, and what happens if you say no. Nothing is pre-selected.</p></div></div>
    <div class="look"><div class="pic"><img src="assets/what-changed.jpg" width="1200" height="707" alt="At dusk in dark mode: a What changed card listing a new Christmas page and two changed pages in plain words, with Keep these changes, Undo all of it and Ask for a tweak, and the Versions list on the right."></div>
      <div class="t"><h3>See what changed, in your words.</h3><p>Which pages, what look-and-feel, what wasn't touched. The code is one click away if you ever want it.</p></div></div>
    <div class="look"><div class="pic"><img src="assets/undo.jpg" width="1200" height="707" alt="An Undo all of it? sheet listing what Restore does and does not do, with Cancel and Undo all of it buttons, over the Versions list."></div>
      <div class="t"><h3>Undo all of it. Really.</h3><p>Every change is a version in a Time Machine-style list. Restore puts every file back; the conversation stays.</p></div></div>
    <div class="look"><div class="pic"><img src="assets/publish.jpg" width="1200" height="707" alt="The Publish sheet: Mo's quick check (three files changed, nothing deleted, no settings or secret files touched), then How would you like to publish, with Upload a draft line and Put it live."></div>
      <div class="t"><h3>Publishing is one plain question at a time.</h3><p>Upload a draft, send for review, or put it live. The live option is the one that warns you.</p></div></div>
  </div>
  <p class="fine center" style="margin:28px auto 0"><b>Already a developer, or have one?</b> Advanced mode is one switch away, at the bottom of the sidebar. It shows the full developer interface SKYCOT is built on (T3 Code's), in the same window, with nothing removed. In a Family profile it's hidden and needs the parent code.</p>
</div></section>

<section id="download"><div class="wrap">
  <div class="center"><p class="kicker">Get SKYCOT</p><h2 class="title">SKYCOT for Mac.</h2>
  <p class="sub">Free during the beta. A grown-up brings their own AI account. The app is signed and notarised by Apple, and updates itself when a new version is ready.</p></div>
  <div class="dl">
    <h3>Try the beta.</h3>
    <p>For Apple silicon Macs (M1 or later) with macOS 13 Ventura or newer. About 160 MB. You'll need an account with at least one supported assistant.</p>
    <div class="actions">
      <a class="btn btn-primary" href="https://downloads.skycot.com/mac/SKYCOT-0.1.1-nondev.32.beta-arm64.dmg">Download the beta for Mac</a>
      <a class="btn btn-secondary" href="mailto:markhallam@skycot.com?subject=SKYCOT%20beta%20feedback">Tell us what you think</a>
    </div>
    <p class="hero-note">It's a beta, so some things will be rough. Tell us what breaks by email or on <a href="https://discord.gg/38gtBbywq6">Discord</a>. No newsletter, and the app sends us nothing.</p>
    <div class="status">
      <div class="done"><b>In the beta</b><p>Plain-English conversations, plans and permission cards, Undo and Versions, the Family profile with a parent code, bedtimes and limits, stickers, the fridge, the grown-up recap, the live preview, notifications and themes.</p></div>
      <div class="now"><b>Testing now</b><p>This first public beta on real family Macs, automatic updates, and "send for review" and "put it live" with a connected GitHub account.</p></div>
      <div class="next"><b>Next</b><p>A Windows build and more for families. We'd rather tell you where things stand than oversell it.</p></div>
    </div>
  </div>
</div></section>

<section id="faq" class="alt"><div class="wrap">
  <div class="center"><p class="kicker">Questions</p><h2 class="title">Frequently asked.</h2></div>
  <div class="faq">
    <details><summary>Is it safe for kids?</summary><p>It's designed to be a safe first workshop for a child using it with a grown-up nearby. With the <a href="#family">Family profile</a> on, the assistant shows a plan and asks before every change, the riskier modes and developer tools are hidden, Undo is always there, and nothing goes online without the parent code.</p><p>These are guardrails inside the app, not a security product, and the AI service's own safety settings and age rules still apply. Stay involved: build together, and look at what was made before it's shared.</p></details>
    <details><summary>Does my child need an AI account?</summary><p>No. SKYCOT runs on a parent's own Mac and the parent's own AI account, and the parent sets it up and supervises. Your child doesn't sign up for anything, with us or with an AI service, and SKYCOT has no account of its own.</p><p>What your child types goes to the AI service you chose, under your account and that company's terms, so check its rules on age and on who may use your account.</p></details>
    <details><summary>What can the parent code lock?</summary><p>Putting work online (both "send for review" and "put it live"), creating an automation, opening the developer tools (Advanced mode), running the welcome steps again, changing the code, and turning the Family profile off. Five wrong tries locks every code prompt for five minutes.</p><p>Everything else works as normal: building, drafts and Undo. The assistant still asks before every change.</p></details>
    <details><summary>What does SKYCOT not do?</summary><p>It isn't a parental-control or security product. It doesn't filter the web, lock the Mac or replace Screen Time. Its bedtime and daily limits apply only inside SKYCOT, not to other apps or the rest of the Mac. SKYCOT asks the AI to keep things child-friendly and spots personal details before a message goes, but it can't guarantee what an AI says. The parent code is kept on your Mac, and a determined teenager could get round it.</p><p>SKYCOT also doesn't create AI accounts for anyone, sell AI time, or send us your work: we count update checks and optional relay connections as anonymous daily totals that reset each UTC day and cannot be linked between days.</p></details>
    <details><summary>Which AI does it use?</summary><p>The one you already pay for. A grown-up signs in to at least one supported assistant: Claude Code (Anthropic), Codex (OpenAI), Cursor, or Gemini via Antigravity (Google). SKYCOT runs on that plan; it doesn't sell AI time or stand between you and your account.</p><p>Each service sets its own age rules. As of October 2026, Anthropic's Claude and Cursor require every user to be 18 or over, and OpenAI's terms allow 13 to 17 year olds with a parent's permission; Google sets its own rules for Gemini and Antigravity. Check your service's current terms for your child's age before they use SKYCOT with it.</p></details>
    <details><summary>Do I need to know how to code?</summary><p>No. You describe what you want in plain English, read what changed in plain English, and decide. If you have a developer, they can flip on Advanced mode and see everything in their language, in the same window.</p></details>
    <details><summary>Can I change how it looks?</summary><p>Yes. SKYCOT ships with a <a href="#looks">library of themes</a>: Workshop, the default, plus Classic for anyone who prefers calm, Paper and Night Ops, each with a light and a dark side. Themes are plain data files you can import, export and share, and you can duplicate one and edit the colours, the flavour and your crew's names. A theme changes how things look, never what they do.</p></details>
    <details><summary>Who is the little cloud?</summary><p>That's SKYCOT. It greets you by day and wears its dusk colours after sunset where you live.</p></details>
    <details><summary>What does SKYCOT cost?</summary><p>Free during the beta. You pay your AI provider as you do today. Pricing for later will be announced before it applies to anyone.</p></details>
    <details><summary>Where do my files go?</summary><p>They stay on your Mac. When you send a message, the assistant you chose receives what it needs for that task, under that company's terms. SKYCOT has no account. We count update checks and optional relay connections as anonymous daily totals; your files and messages stay out of those counts.</p></details>
    <details><summary>What if it breaks something?</summary><p>SKYCOT works in a private copy of your project and keeps a version for every change, so you can step back like Time Machine. The hard rules mean deleting, putting live and spending money always ask first, in every mode.</p></details>
    <details><summary>Does voice typing send my child's voice anywhere?</summary><p>Voice typing starts off for every child, and a grown-up turns it on with the parent code. SKYCOT never records or keeps audio; it uses the browser's own speech service. In Safari that is Apple's dictation, which on recent Macs can stay on the Mac. In Chrome it is Google's, and in Edge Microsoft's, so the voice goes to that company under its terms. SKYCOT tells you which applies before you switch it on, and recommends Safari for children. Reading replies aloud uses the Mac's own voices, so nothing leaves the Mac.</p></details>
    <details><summary>Can I get at the developer tools?</summary><p>Yes. Advanced mode is a switch at the bottom of the sidebar. It opens the full developer interface SKYCOT is built on (T3 Code's) in the same window: every panel, terminal and setting, nothing removed. Flip it back and the plain-language view returns. In a Family profile the switch is hidden and opening it needs the parent code.</p></details>
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

# The home page (redesign, 23 October 2026) is docs/skycot-site/home.html: Option E from
# design-explorations/2026-10-23 (A's keynote sky, D's day-to-bedtime sky, B's crayon rocket, C's cloud).
# Its own <style> and <script> blocks are kept; the site's shared metadata, structured data and favicons
# come from head(). Edit home.html for the page itself.
import re as _re
HOME = open(HERE + "home.html", encoding="utf-8").read()
_home_head = HOME[HOME.index("<head>") + 6:HOME.index("</head>")]
_home_extras = "\n".join(_re.findall(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>", _home_head))
_home_body = HOME[HOME.index("<body"):]
# The repo's formatter re-wraps home.html; keep each footer legal line on one line so the credits read
# (and are checked) exactly as written.
_home_body = _re.sub(r'<p class="legal">([\s\S]*?)</p>',
                    lambda m: '<p class="legal">' + " ".join(m.group(1).split()) + "</p>", _home_body)
write("index.html", head(TITLE, DESC, "/", css="", open_body=False) + _home_extras + "\n</head>\n" + _home_body)
# Variant B is now the dark side of index.html; the separate file is retired.
if os.path.exists(OUT + "index-b.html"):
    os.remove(OUT + "index-b.html")

# ---------- legal pages ----------
# Internal notes (open questions for a lawyer, and the clause-by-clause comparison with T3 Code's own
# legal pages) live in docs/legal/WEBSITE-LEGAL-NOTES.md, never on the public pages.

PRIVACY = f'''{nav(True)}
<main class="doc"><div class="narrow">
  <h1>Privacy</h1>
  <p class="meta">Last updated {LAST_UPDATED} · applies to the SKYCOT app and skycot.com</p>
  <p>SKYCOT is designed so that we hold as little about you as possible. The app runs on your Mac, your files stay on your Mac, and the only company that receives your work is the AI assistant you sign in to and choose to use. This page explains that in detail, and what the website does.</p>

  <h2>The short version</h2>
  <ul>
    <li>The app has no SKYCOT account and does not send us your work. We count update checks and optional relay connections as anonymous daily totals that reset each UTC day.</li>
    <li>Your project files stay on your Mac. When you work, the assistant you chose (for example Claude Code or Codex) receives what it needs for that task, under that company's terms and your own account.</li>
    <li>Voice typing is off until you turn it on. It uses your browser's speech service: Apple's in Safari, Google's in Chrome, Microsoft's in Edge. Reading replies aloud uses the Mac's own voices and sends nothing.</li>
    <li>We never receive your files, your messages or the assistant's replies, so we cannot use them for anything, including training AI.</li>
    <li>skycot.com uses no cookies and no advertising. It counts visits with Cloudflare Web Analytics, which doesn't use cookies or follow you to other sites, and it loads no other third-party scripts, fonts or images.</li>
    <li>We do not sell personal information or use it for advertising.</li>
    <li>If you email us or join our Discord, we hold what you send us, and Discord's own policy applies there.</li>
    <li>A child can use SKYCOT on a parent's Mac and the parent's own AI account, under the parent's supervision. We do not knowingly collect children's information. The Family profile's settings, limits, recap, stickers and fridge are kept on your Mac and send nothing to us (section 8).</li>
  </ul>

  <h2>1. Who we are</h2>
  <p>SKYCOT is a registered business name of Curble Pty Ltd (ABN 71 605 512 776), Melbourne, Australia. You can reach us at <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a>. We are bound by the Australian Privacy Act 1988 and the Australian Privacy Principles to the extent they apply to us, and we aim to meet them in any case.</p>

  <h2>2. The SKYCOT app</h2>
  <h3>What stays on your Mac</h3>
  <p>Your project folders stay where you keep them. The versions SKYCOT keeps so you can undo are stored inside each project's own folder history. Your conversations, settings and technical logs are stored in your home folder under <code>~/.skycot</code> and in the app's own data folder. Signing in to each assistant happens on that company's own sign-in page; the sign-in token that results is kept on your Mac, by SKYCOT or by the assistant's own tool, and SKYCOT never sees your password. You can delete all of this at any time by removing the app and those folders.</p>
  <h3>What is sent to the AI assistant you chose</h3>
  <p>The assistant works in the project folder you open. When you send a message, the assistant's own tool reads what it needs from that folder for the task and sends it, with your message and any pictures you add to it (such as a child's drawing), to the company that makes it, under your account: Anthropic for Claude Code, OpenAI for Codex, Anysphere for Cursor, Google for Gemini and Antigravity, or the maker of any other assistant you connect. That company's privacy policy and your agreement with them govern what happens to it, including whether it may be used to improve or train their models; you can check and change that in your account with them. SKYCOT does not add a copy for itself. In Ask me first, the assistant stops and asks before doing anything beyond the plan, and the hard rules mean touching customer details is always a question, never an assumption.</p>
  <h3>Voice typing and reading aloud</h3>
  <p>Voice typing is off until you turn it on, and in a Family profile each child's starts off and needs the parent code. SKYCOT never records, uploads or keeps audio. It uses the speech service of the browser you use it in: in Safari, Apple's dictation, which on recent Macs can run on the Mac itself and otherwise goes to Apple; in Chrome, Google's speech service; in Edge, Microsoft's. Where the sound goes to one of those companies, their terms and privacy policy apply. SKYCOT says which applies in Settings → Voice before you switch it on, and recommends Safari for children. The words appear in the message box and are sent to your assistant only when you press Send. Reading replies aloud uses the voices installed on your Mac, so nothing is sent anywhere.</p>
  <h3>What is sent to us</h3>
  <p>SKYCOT does not receive your files, messages, project details or AI replies. We count successful Mac update checks and, when a grown-up turns it on, relay connections as anonymous daily totals. For an update check, Cloudflare makes a short code from the request's IP address and app user-agent; for a relay connection, it makes a short code from the home Mac's or linked device's relay id. The count record contains only that code, the UTC day, the count type and, for update checks, the app version. The code changes each day, has no name or account attached, and the count record alone cannot tell us who made a request or connect activity between days. We do not save the source IP address, user-agent or relay id in these count records. Cloudflare processes network addresses to deliver requests. Do Not Track or Global Privacy Control turns off update-feed counting; turning off automatic updates or SKYCOT Relay stops the relevant requests. SKYCOT has no crash reporting or diagnostics switched on. One switch you control changes what the Mac connects to: if a grown-up turns on SKYCOT Relay so the family's phones can reach the Mac away from home, the Mac connects to our relay, which passes along sealed traffic it cannot read (see section 5). The online account and phone-pairing service that T3 Code offers is switched off in SKYCOT, so the app does not talk to T3 Tools Inc.'s servers either. If a future version offers optional diagnostics, it will be off until you switch it on, this page will be updated first, and it will never include your project files or conversations.</p>
  <h3>Background downloads</h3>
  <p>Like most apps, SKYCOT fetches a few public files on its own. The Mac app checks downloads.skycot.com, SKYCOT's own download site, for a new version of SKYCOT. If update checks for your AI assistants are on, it asks npm, the public software registry, whether a newer version of each assistant you installed exists. When a grown-up opens the Usage page in Advanced mode, it downloads a public list of AI prices from GitHub, at most once a day. The first time the assistant looks at a page it built, it downloads a small browser from Google (about 200 MB) and says so first; this is off in a Family profile. If you add Gemini through Antigravity, it downloads Google's connector from Google. Like any web request, these reveal your IP address and the app's version to the host. Nothing about you or your projects is included, and SKYCOT fetches nothing from T3 Code's servers.</p>
  <h3>Permissions your Mac may ask for</h3>
  <p>macOS may ask you to let SKYCOT open the folders you choose, show notifications and, if you use voice typing, use the microphone. If you turn on sharing so that another of your devices can connect to SKYCOT, that device connects to your Mac directly over your own network, with no SKYCOT or T3 server in between. You can change these at any time in System Settings and in SKYCOT's Settings.</p>
  <h3>Publishing</h3>
  <p>If you connect a code-hosting account (for example GitHub) to send work for review or put it live, SKYCOT talks to that service on your instruction only, using your own account. Their terms and privacy policy apply to what you upload there.</p>

  <h2>3. The website, skycot.com</h2>
  <p>The site is a set of plain pages served by Cloudflare. The cloud on the site switches between day and dusk using your device's own clock and time zone, worked out in your browser; nothing about that is sent anywhere. We set no cookies and run no advertising. To see how many people visit and which pages help, we use Cloudflare Web Analytics: a small script from Cloudflare that counts page views and records the page, the site that linked you here, your browser and device type, your country and how fast the page loaded. It sets no cookies, doesn't build a profile of you and doesn't follow you to other sites; we only see totals, never who you are. Cloudflare, like any host, processes the technical details of each request (such as IP address and browser type) to deliver the page and protect the site, and it may ask your browser to report failed connections so that network problems can be fixed; see Cloudflare's privacy policy for how they handle that. We do not combine it with anything else.</p>

  <h2>4. Email and Discord</h2>
  <p>If you email us (for example beta feedback sent from Settings → Help &amp; feedback, which only ever leaves your Mac when you press Send in your own email app), we keep the email for as long as we need it to help you and to keep ordinary business records, and then delete it. Emails are kept for as long as we need them to help you and to keep ordinary business records, and are then deleted. Our email runs on Google Workspace. Our community runs on Discord, a separate company with its own privacy policy; what you post there is governed by it.</p>

  <h2>5. Companies that handle information for us</h2>
  <ul>
    <li><b>Cloudflare</b> hosts skycot.com and SKYCOT's downloads and updates (downloads.skycot.com), counts visits to skycot.com with its Web Analytics, and runs SKYCOT Relay if you turn it on (see below).</li>
    <li><b>Google Workspace</b> runs our email.</li>
    <li><b>Discord</b> runs our community, if you choose to join it.</li>
  </ul>
  <p><b>SKYCOT Relay, for reaching your Mac away from home (optional, off until you turn it on).</b> If a grown-up turns on <i>Reach this Mac from anywhere</i> in SKYCOT's Family settings, your Mac keeps a connection to SKYCOT Relay, a small service we run on Cloudflare, so the family's linked phones and iPads can reach it when they are not on your home Wi-Fi. Everything between a device and your Mac is sealed on the device and opened only on your Mac; the relay passes it along and cannot read it, and it never receives names, messages, files or projects. It does see a random id for your home and for each linked device, when devices connect, roughly how much they send, and their network addresses, and it keeps only what it needs to connect them. If phone notifications are turned on, Apple delivers them, and they only ever say that SKYCOT needs a grown-up or that something has finished. The sealing follows the open Noise protocol standard (Noise_IK_25519_ChaChaPoly_SHA256) and has been checked against that standard's official test vectors, but it has not been independently audited: SKYCOT is a beta, and we make no promise that the relay is secure. Turn the switch off and your Mac stops connecting to it.</p>
  <p>These companies may store information outside Australia, including in the United States. We do not share personal information with anyone else, except where the law requires it, where it is needed to protect people or our rights against fraud or harm, or if the SKYCOT business is sold or reorganised, in which case this policy continues to apply to what we hold.</p>

  <h2>6. Security</h2>
  <p>We keep what we hold to a minimum and protect it with the security of the services above, with access limited to the people who need it. No system is perfectly secure. The security of your Mac, your AI accounts and anything you connect to SKYCOT is in your hands, so keep them up to date and protected. If you find a security problem in SKYCOT or skycot.com, please email <a href="mailto:markhallam@skycot.com?subject=Security">markhallam@skycot.com</a> with "Security" in the subject before telling anyone else, and do not include passwords or keys.</p>

  <h2>7. Your rights</h2>
  <p>You can ask us what we hold about you, ask us to correct or delete it, or complain about how we handled it, by emailing <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a>. We will respond within 30 days. If you are not satisfied you can contact the Office of the Australian Information Commissioner (oaic.gov.au). If you are in the UK or the European Union, you have equivalent rights under the UK GDPR and the EU GDPR, including the right to lodge a complaint with your local supervisory authority.</p>

  <h2>8. Children and the Family profile</h2>
  <p>SKYCOT is designed so that a child uses it only on a parent's or guardian's own Mac, signed in to that adult's own AI account, with the Family profile turned on and the adult supervising. The adult installs SKYCOT, accepts our terms and the AI service's terms, and is responsible for the child's use. A child does not need, and should not create, an account with us or with an AI service to use SKYCOT; SKYCOT has no account of its own.</p>
  <p>We do not knowingly collect personal information from children, and the Family profile does not change what we receive, which is nothing (unless a grown-up turns on SKYCOT Relay, which passes along sealed traffic it cannot read; see section 5). Everything the Family profile keeps stays in SKYCOT's own storage on your Mac and is never sent to us or to the AI service: for each child, a first name (if you give one), a picture, look, text size, voice settings, bedtime and daily limits; the household's time zone, used for bedtime; and a scrambled version of the parent code, never the code itself. To run the limits and the grown-up recap it also keeps, on the Mac, each child's time and counts for the last five weeks, who started each conversation, any extra time a grown-up gave, and a log of what needed a grown-up, which records only the kind of detail involved and is kept for 30 days. Earned stickers and the pages pinned to the family fridge are kept there too. The recap is built on the Mac and shown only after the parent code; printing it or saving it as a PDF uses your browser's print dialog, and nothing is emailed or uploaded. Turning the Family profile off forgets the children, their limits and the parent code.</p>
  <p>Before a child's message goes, SKYCOT looks for personal details such as a full name, school, address, phone number, email or birthday, and suggests leaving them out. This check runs on the Mac. It spots common patterns, so it can miss a detail written in an unusual way.</p>
  <p>We do not collect children's names or work through the counter. It records anonymous daily totals for update checks and optional relay connections, with no name or account attached. If you believe a child has sent us personal information, for example by email, tell us and we will delete it.</p>
  <p>What a child types into SKYCOT goes to the AI service the adult chose, under the adult's account and that company's privacy policy, exactly as with any other use. Each AI service sets its own minimum age and its own rules on who may use an account, and some require every user to be 18 or over. Those rules apply, and the adult is responsible for checking them before a child uses SKYCOT. The Family profile is a set of guardrails inside SKYCOT, not a parental-control product: it does not filter the web, and it asks the AI to keep things child-friendly but cannot guarantee what the AI says. Its bedtime and daily limits apply only inside SKYCOT.</p>

  <h2>9. Changes</h2>
  <p>If this policy changes, the new version will be posted here with its date before it applies, and the app will tell you on first launch after an update if the change affects what the app sends.</p>
</div></main>
'''
write("privacy.html", head("Privacy · SKYCOT", "How SKYCOT handles your information: files stay on your Mac, only what each job needs goes to the AI you chose, anonymous daily totals for update checks and optional relay connections, no cookies, no SKYCOT account.", "/privacy") + PRIVACY + footer(True))

TERMS = f'''{nav(True)}
<main class="doc"><div class="narrow">
  <h1>Terms of use</h1>
  <p class="meta">Last updated {LAST_UPDATED} · beta</p>
  <p>These terms cover the SKYCOT app and the skycot.com website, made by Curble Pty Ltd ("we", "us"), Melbourne, Australia. By installing or using SKYCOT you agree to them. If you use SKYCOT for a business, you agree to them on its behalf and confirm you are allowed to. Plain-English summaries appear in italics and are not part of the terms.</p>

  <h2>1. What SKYCOT is</h2>
  <p>SKYCOT is software that runs on your computer and helps you direct AI coding assistants made by other companies. It has no account of its own: you do not sign up with us to use it. It is a beta: features may change, be incomplete, contain mistakes, lose work or stop working between versions, so do not rely on SKYCOT as the only copy of anything important. <em>Summary: it is new, and we say so.</em></p>

  <h2>2. Who can use SKYCOT</h2>
  <p>You must be 18 or over to accept these terms. A child may use SKYCOT only on a parent's or guardian's computer, signed in to that adult's own AI account, and under that adult's supervision; we recommend turning on the Family profile first. The adult accepts these terms for the child and is responsible for that use, including what the child asks the assistant to do and anything put online. A child does not need, and should not create, an account with us or with an AI service in order to use SKYCOT.</p>
  <p>Each AI service sets its own minimum age and its own rules on who may use an account, and you must follow them; some require every user to be 18 or over. The Family profile is a set of guardrails inside SKYCOT, not a parental-control or security product: it does not filter the web, lock the Mac or limit anything outside SKYCOT, it cannot control what the AI service says, and it can be got round. <em>Summary: a grown-up sets it up, signs in, and stays in charge; the AI service's own age rules still apply.</em></p>

  <h2>3. Your AI assistant is a separate agreement</h2>
  <p>SKYCOT does not provide AI services. You need your own account with at least one supported assistant (for example Claude Code by Anthropic, Codex by OpenAI, Cursor by Anysphere, or Gemini and Antigravity by Google). Your use of those services, their charges, limits and outputs are governed by your agreement with that company, not by us. They can change, stop working or change their prices without telling us, and we are not responsible for their availability, pricing or behaviour. <em>Summary: your AI plan is between you and them.</em></p>

  <h2>4. You direct the work and own the results</h2>
  <p>You decide what to ask, what to allow, what to keep and what to publish. AI assistants can produce work that is wrong, insecure or incomplete, so check what changed before you keep it or put it live. SKYCOT's safeguards (Ask me first, hard rules, versions and undo, a confirmation before anything leaves your Mac) reduce risk; they do not remove it. You remain responsible for your projects, your backups outside SKYCOT, and anything you put live. You confirm that you have the right to use the files and information you give an assistant, and that you will check your provider's terms before giving it confidential, regulated or personal information, such as customer details. Anything you create with SKYCOT is yours, subject to your AI provider's terms. <em>Summary: you are the boss; we give you brakes, not a guarantee.</em></p>

  <h2>5. Acceptable use</h2>
  <p>Do not use SKYCOT to break the law or anyone's rights; to access systems or data you are not entitled to; to spread malicious software or attack other systems; to harass, deceive or defraud anyone; to get around the terms, limits or safeguards of the assistants you connect; or to claim that an assistant's output was made or endorsed by us. Do not remove or alter the open-source and copyright notices in the app.</p>

  <h2>6. Licence to use SKYCOT</h2>
  <p>SKYCOT is based on T3 Code, © T3 Tools Inc., licensed under the MIT licence; that licence continues to apply to that code and is reproduced in the app and on our <a href="/open-source">open source page</a>. If these terms and an open-source licence ever conflict for that code, the open-source licence wins. Our own additions are licensed to you for your use of SKYCOT under these terms during the beta. The SKYCOT name and marks are ours and are not covered by the MIT licence. <em>Summary: the engine is open source; the SKYCOT name is ours.</em></p>

  <h2>7. Price</h2>
  <p>SKYCOT is free during the beta. You pay your AI provider, and anyone else whose service you use with SKYCOT, under their own terms. If we introduce a price, we will show it before it applies, and you will not be charged unless you agree to it.</p>

  <h2>8. Privacy</h2>
  <p>How we handle information is explained on our <a href="/privacy">privacy page</a>, which forms part of these terms.</p>

  <h2>9. Feedback and themes</h2>
  <p>If you send us ideas, feedback, or a theme for us to include, you allow us to use, change, include and share it, free of charge and without any obligation to you. We credit the themes we include to their authors. You keep any rights you have in what you sent.</p>

  <h2>10. Updates and changes</h2>
  <p>The app checks for updates and may offer or install them. We may change or withdraw features, and we may change these terms; the new version will be posted here with its date, and continued use after that date means you accept it. If a change materially affects you, we will also say so in the app where we reasonably can.</p>

  <h2>11. Australian Consumer Law and warranties</h2>
  <p>Nothing in these terms excludes, restricts or modifies any guarantee, right or remedy you have under the Australian Consumer Law or other law that cannot be excluded. Subject to that, SKYCOT is provided "as is" and "as available" during the beta, without warranties of any kind, express or implied, including fitness for a particular purpose, and we do not warrant that it, or anything an AI assistant produces through it, will be uninterrupted, secure, accurate or error-free. This includes the optional SKYCOT Relay: its encryption follows the open Noise protocol standard but has not been independently audited, and we do not guarantee that it is secure. <em>Summary: your legal consumer rights stay; beyond those, early-access software comes with no promises.</em></p>

  <h2>12. Limitation of liability</h2>
  <p>To the extent permitted by law, we are not liable for any loss of data, loss of profit, business interruption, or indirect or consequential loss arising from your use of SKYCOT or of any AI assistant used with it, and our total liability for any claim is limited to the amount you paid us for SKYCOT in the twelve months before the claim (which during the free beta is nil) or, where the law requires a remedy, to re-supplying the software.</p>

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
write("terms.html", head("Terms of use · SKYCOT", "Terms of use for the SKYCOT app and the skycot.com website, made by Curble Pty Ltd, Melbourne, Australia.", "/terms") + TERMS + footer(True))

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
  <p>Every SKYCOT theme is a plain data file: a short list of colours, a few "flavour" choices (borders, headings, tip cards, button shape, motion) and optional crew names. A theme contains no code, and you can read one in any text editor. The four themes that ship with SKYCOT (Workshop, the default, plus Classic, Paper and Night Ops) are published with the app, and the format will be documented here.</p>
  <p>Community themes are welcome. Duplicate a theme in Settings → Appearance, edit it, export it, and contribute it through the SKYCOT repository (the address will be published here) or by email to <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a>. Themes we include are credited to their author. A theme changes how SKYCOT looks, never what it does: the permission, undo and publish moments stay plain in every theme.</p>

  <h2>Third-party licences</h2>
  <p>SKYCOT bundles many other open-source packages (for example React, Electron and the libraries T3 Code depends on), each under its own licence, mostly MIT, Apache 2.0, BSD and ISC. The complete list, with each licence text and copyright holder, is generated at build time and included in every download; in the app it is under Settings → About → Open-source licences. A copy for the current public version will be published at this address.</p>
  <p>The AI assistants SKYCOT works with (Codex from ChatGPT, Antigravity from Google, Claude Code, Cursor and others) are separate products that you install and sign in to under their owners' terms. They are not part of SKYCOT and are not open source unless their owners say so.</p>

  <h2>Reporting a problem</h2>
  <p>If you believe an attribution is missing or wrong, email <a href="mailto:markhallam@skycot.com">markhallam@skycot.com</a> and we will fix it.</p>
</div></main>
'''
write("open-source.html", head("Open source · SKYCOT", "SKYCOT is based on T3 Code, © T3 Tools Inc., MIT licence. Full licence text, non-affiliation statement and third-party licences.", "/open-source") + OSS + footer())

# ---------- 404 (Cloudflare Pages serves /404.html for any address it does not know) ----------
NOTFOUND = f'''{nav()}
<main class="notfound"><div class="narrow">
  <h1>That page isn't here.</h1>
  <p>The SKYCOT website was rebuilt in October 2026, so the page you were looking for may have moved or been retired.</p>
  <div class="actions"><a class="btn btn-primary" href="/">Go to the home page</a><a class="btn btn-secondary" href="mailto:markhallam@skycot.com">Email us</a></div>
</div></main>
'''
write("404.html", head("Page not found · SKYCOT", "This page is not on skycot.com.", "/404", robots="noindex") + NOTFOUND + footer())

# ---------- brand files: favicons, manifest, share image, lockups, mascot poses, Sam and Mo ----------
os.makedirs(OUT + "assets/brand", exist_ok=True)
for src in ["web/favicon-day.svg", "web/favicon-dusk.svg", "web/mask-icon.svg", "web/og-day.png",
            "web/icon-192-day.png", "web/icon-512-day.png", "web/icon-maskable-192-day.png", "web/icon-maskable-512-day.png",
            "svg/lockup-horizontal-day-light.svg", "svg/lockup-horizontal-dusk-dark.svg",
            "svg/lockup-horizontal-minimal-light.svg", "svg/lockup-horizontal-minimal-dark.svg",
            "poses/day/mascot-hello-day.svg", "poses/dusk/mascot-hello-dusk.svg",
            "svg/app-icon-day.svg", "svg/wordmark.svg", "svg/wordmark-reversed.svg",
            "poses/day/mascot-yay-day.svg", "poses/dusk/mascot-yay-dusk.svg",
            "poses/day/mascot-thinking-day.svg", "poses/dusk/mascot-thinking-dusk.svg",
            "poses/day/mascot-ask-a-grown-up-day.svg", "poses/dusk/mascot-ask-a-grown-up-dusk.svg",
            "poses/dusk/mascot-night-night-dusk.svg"]:
    shutil.copyfile(BRAND + src, OUT + "assets/brand/" + os.path.basename(src))
# Browsers ask for these at the site root.
shutil.copyfile(BRAND + "web/favicon.ico", OUT + "favicon.ico")
shutil.copyfile(BRAND + "web/apple-touch-icon-day.png", OUT + "apple-touch-icon.png")
# og.png (and /opengraph-image, which redirects to it) keeps working for old links; pages point at og-day.png.
shutil.copyfile(HERE + "../marketing/launch/skycot-og-beta.png", OUT + "og.png")
# The beta share card (23 October 2026): a new file name so X, LinkedIn and others fetch it fresh.
shutil.copyfile(HERE + "../marketing/launch/skycot-og-beta.png", OUT + "assets/brand/og-beta.png")
# The 30-second promo plays in the home page's hero. Only its poster ships with the site; the video is
# served from downloads.skycot.com/media/ because Pages ignores partial requests, which Safari needs.
os.makedirs(OUT + "assets/video", exist_ok=True)
shutil.copyfile(HERE + "../marketing/launch/video/poster-hero.jpg", OUT + "assets/video/poster-hero.jpg")
# A manifest cannot change with the time of day, so installed icons stay day (brand guide section 9).
MANIFEST = {"name": "SKYCOT", "short_name": "SKYCOT", "description": "The family-friendly AI developer.",
            "start_url": "/", "display": "minimal-ui", "background_color": "#ffffff", "theme_color": "#0071e3",
            "icons": [{"src": f"/assets/brand/icon-{k}{n}-day.png", "sizes": f"{n}x{n}", "type": "image/png",
                       "purpose": "maskable" if k else "any"} for k in ("", "maskable-") for n in (192, 512)]}
write("site.webmanifest", json.dumps(MANIFEST, separators=(",", ":")) + "\n")
# Sam and Mo, drawn exactly as in the brand guide's crew symbols.
SAM = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>Sam</title><path d="M32 7c13 0 25 9 25 24 0 16-11 27-26 27C17 58 7 46 7 31 7 17 19 7 32 7z" fill="#F26B4E" stroke="#2B2420" stroke-width="3"/><path d="M15 24c3-10 11-15 19-15 8 0 14 5 16 12" fill="#FFD166" stroke="#2B2420" stroke-width="3" stroke-linecap="round"/><rect x="12" y="22" width="40" height="6" rx="3" fill="#FFD166" stroke="#2B2420" stroke-width="3"/><circle cx="24" cy="36" r="2.6" fill="#2B2420"/><circle cx="40" cy="36" r="2.6" fill="#2B2420"/><path d="M25 45c3 3 11 3 14 0" fill="none" stroke="#2B2420" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="42" r="3" fill="#FFB4A2" opacity=".8"/><circle cx="46" cy="42" r="3" fill="#FFB4A2" opacity=".8"/></svg>
'''
MO = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>Mo</title><path d="M31 6c15 0 27 11 27 26 0 15-12 26-27 26S5 47 5 32 16 6 31 6z" fill="#3FA66F" stroke="#2B2420" stroke-width="3"/><circle cx="23" cy="33" r="7" fill="#fff" stroke="#2B2420" stroke-width="3"/><circle cx="41" cy="33" r="7" fill="#fff" stroke="#2B2420" stroke-width="3"/><path d="M30 33h4" stroke="#2B2420" stroke-width="3"/><circle cx="24" cy="34" r="2.4" fill="#2B2420"/><circle cx="42" cy="34" r="2.4" fill="#2B2420"/><path d="M25 46c3 2 11 2 14 0" fill="none" stroke="#2B2420" stroke-width="3" stroke-linecap="round"/><path d="M20 12l-4-6M44 12l4-6" stroke="#2B2420" stroke-width="3" stroke-linecap="round"/></svg>
'''
write("assets/brand/sam.svg", SAM)
write("assets/brand/mo.svg", MO)
