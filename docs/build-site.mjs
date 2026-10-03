// Builds docs/index.html (the download page). Run:  node docs/build-site.mjs
// The squirrels are drawn by the same code as the app, and the download link comes from package.json,
// so changing the GitHub name there and re-running this keeps the page in sync.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const { squirrelSVG } = await import(pathToFileURL(path.join(here, '..', 'src', 'renderer', 'squirrel.js')).href);

const owner = pkg.build.publish[0].owner, repo = pkg.build.publish[0].repo;
const repoUrl = `https://github.com/${owner}/${repo}`;
const download = `${repoUrl}/releases/latest/download/Stash-Setup.exe`;
const sq = (state, cls = '') => `<div class="sq ${cls}">${squirrelSVG(state)}</div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stash: the squirrel that hoards your inspo</title>
<meta name="description" content="Stash lives on your Windows desktop. Drag inspiration images onto it while you scroll, then drop them into Figma as a clean moodboard in one go.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root { --bg:#FFF8EF; --surface:#fff; --border:#EADBC6; --text:#2A1B12; --muted:#8A7563; --accent:#B8622E; --soft:#F3DCC6; --cream:#F6E7CF; --shadow:0 12px 32px rgba(41,26,18,.14); --spring:cubic-bezier(.34,1.56,.64,1); }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { margin:0; background:var(--bg); color:var(--text); font:400 17px/1.55 'DM Sans',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
a { color:inherit; }
.wrap { max-width:1080px; margin:0 auto; padding:0 24px; }
h1,h2,h3 { font-family:'Bricolage Grotesque','DM Sans',sans-serif; line-height:1.08; margin:0; letter-spacing:-.01em; }
nav { display:flex; align-items:center; justify-content:space-between; padding:18px 0; }
.brand { display:flex; align-items:center; gap:10px; font:800 22px 'Bricolage Grotesque',sans-serif; text-decoration:none; }
.brand .sq { width:40px; height:40px; background:var(--soft); border-radius:50%; overflow:hidden; position:relative; }
.brand .sq svg { position:absolute; left:-12px; top:-4px; width:64px; height:64px; }
nav .links { display:flex; gap:26px; align-items:center; font-weight:500; font-size:15px; }
nav .links a { text-decoration:none; color:var(--muted); } nav .links a:hover { color:var(--text); }
.btn { display:inline-flex; align-items:center; gap:10px; background:var(--accent); color:#fff !important; text-decoration:none; font-weight:700; font-size:16px; padding:15px 24px; border-radius:14px; transition:transform .18s var(--spring), background .15s; box-shadow:0 8px 20px rgba(184,98,46,.28); }
.btn:hover { transform:translateY(-2px) scale(1.02); background:#a9561f; } .btn:active { transform:scale(.98); }
.btn.small { padding:10px 16px; font-size:14px; border-radius:11px; box-shadow:none; }
.btn.ghost { background:transparent; color:var(--text) !important; border:1.5px solid var(--border); box-shadow:none; } .btn.ghost:hover { background:var(--surface); }
.hero { display:grid; grid-template-columns:1.1fr .9fr; gap:40px; align-items:center; padding:48px 0 72px; }
.hero h1 { font-size:clamp(40px,6.2vw,72px); font-weight:800; }
.hero h1 em { font-style:normal; color:var(--accent); }
.hero p.lead { font-size:20px; color:var(--muted); max-width:34ch; margin:22px 0 30px; }
.cta { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
.fine { color:var(--muted); font-size:14px; margin-top:14px; }
.stage { position:relative; aspect-ratio:1; max-width:460px; width:100%; justify-self:center; }
.stage .blob { position:absolute; inset:6%; background:var(--soft); border-radius:50%; }
.stage .sq { position:absolute; inset:0; }
.stage .toast { position:absolute; left:-4%; top:14%; background:var(--text); color:var(--cream); padding:11px 18px 11px 14px; border-radius:999px; font:500 14px 'DM Sans',sans-serif; display:flex; gap:10px; align-items:center; box-shadow:var(--shadow); animation:bob 4s ease-in-out infinite; }
.stage .toast i { width:10px; height:10px; border-radius:50%; background:#6E8B3D; }
.stage .toast.two { left:auto; right:-2%; top:auto; bottom:12%; animation-delay:-2s; } .stage .toast.two i { background:var(--accent); }
@keyframes bob { 50% { transform:translateY(-8px); } }
.sq svg { width:100%; height:100%; overflow:visible; display:block; }
.sq svg [data-p] { transform-box:view-box; }
.sq [data-p="body"] { animation:breathe 3.8s ease-in-out infinite; transform-origin:100px 178px; }
.sq [data-p="tail"] { animation:sway 4.6s ease-in-out infinite; transform-origin:112px 162px; }
@keyframes breathe { 50% { transform:scale(1.012,1.028); } } @keyframes sway { 0%,100% { transform:rotate(-2.5deg); } 50% { transform:rotate(3deg); } }
.sq [data-p="peanut"] { animation:nibble 2.2s ease-in infinite; transform-origin:98px 113px; } @keyframes nibble { 0%,25% { transform:scale(1); opacity:1; } 90%,100% { transform:scale(.1); opacity:0; } }
.sq [data-p="zzz"] { animation:zzz 3.4s ease-in-out infinite; } @keyframes zzz { 0%,100% { transform:translate(0,4px); opacity:.25; } 50% { transform:translate(6px,-6px); opacity:.7; } }
.sq [data-p^="sparkle"] { animation:twinkle .9s ease-in-out infinite; } .sq [data-p="sparkle-2"] { animation-delay:.2s; } .sq [data-p="sparkle-3"] { animation-delay:.4s; }
@keyframes twinkle { 50% { transform:scale(1.2) rotate(20deg); opacity:1; } } .sq [data-p^="sparkle"] { transform-origin:center; opacity:.7; }
.sq [data-p="card-1"],.sq [data-p="card-2"],.sq [data-p="card-3"] { animation:cardUp .6s ease-in-out infinite; } .sq [data-p="card-2"] { animation-delay:.1s; } .sq [data-p="card-3"] { animation-delay:.2s; }
@keyframes cardUp { 50% { transform:translateY(-4px); } } .sq [data-p="arrow"] { animation:arrow .5s ease-in-out infinite; } @keyframes arrow { 0%,100% { transform:translateY(2px); opacity:.6; } 50% { transform:translateY(-5px); opacity:1; } }
section { padding:56px 0; }
.kicker { font:700 12px 'DM Sans'; letter-spacing:.12em; color:var(--accent); text-transform:uppercase; margin-bottom:10px; }
h2 { font-size:clamp(30px,4vw,46px); font-weight:800; max-width:20ch; }
.steps { display:grid; grid-template-columns:repeat(4,1fr); gap:18px; margin-top:34px; }
.step { background:var(--surface); border:1px solid var(--border); border-radius:22px; padding:22px; }
.step .art { background:var(--bg); border-radius:16px; aspect-ratio:1.25; display:flex; align-items:center; justify-content:center; margin-bottom:16px; }
.step .art .sq { width:78%; aspect-ratio:1; }
.step .num { font:800 14px 'Bricolage Grotesque'; color:var(--accent); } .step h3 { font-size:22px; margin:4px 0 8px; font-weight:700; } .step p { margin:0; color:var(--muted); font-size:15px; }
.step code,.faq code { background:var(--soft); padding:1px 7px; border-radius:6px; font:500 13.5px 'DM Sans'; }
.grid { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:34px; }
.card { background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:24px; transition:transform .25s var(--spring), box-shadow .25s; }
.card:hover { transform:translateY(-4px); box-shadow:var(--shadow); } .card h3 { font-size:21px; font-weight:700; margin-bottom:8px; } .card p { margin:0; color:var(--muted); font-size:15px; }
.card .em { width:44px; height:44px; border-radius:13px; background:var(--soft); display:flex; align-items:center; justify-content:center; font-size:22px; margin-bottom:14px; }
.private { background:var(--text); color:var(--cream); border-radius:28px; padding:44px; display:grid; grid-template-columns:1fr 200px; gap:28px; align-items:center; }
.private h2 { color:#fff; } .private p { color:#d9c7ae; max-width:52ch; } .private .sq { width:200px; height:200px; }
.faq details { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:18px 22px; margin-top:12px; }
.faq summary { font-weight:700; cursor:pointer; list-style:none; display:flex; justify-content:space-between; gap:12px; } .faq summary::after { content:'+'; color:var(--accent); font-size:22px; line-height:1; } .faq details[open] summary::after { content:'\\2212'; }
.faq p { color:var(--muted); margin:12px 0 0; font-size:16px; }
.end { text-align:center; padding:70px 0 40px; } .end .sq { width:170px; height:170px; margin:0 auto 6px; } .end h2 { margin:0 auto 22px; max-width:16ch; }
footer { color:var(--muted); font-size:14px; padding:30px 0 50px; border-top:1px solid var(--border); display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
@media (max-width:900px) { .hero { grid-template-columns:1fr; padding-top:20px; } .stage { max-width:360px; } .steps { grid-template-columns:1fr 1fr; } .grid { grid-template-columns:1fr 1fr; } .private { grid-template-columns:1fr; } .private .sq { display:none; } nav .links a:not(.btn) { display:none; } }
@media (max-width:560px) { .steps,.grid { grid-template-columns:1fr; } body { font-size:16px; } .stage .toast { font-size:12px; } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a class="brand" href="#top">${sq('Idle')}Stash</a>
    <div class="links"><a href="#how">How it works</a><a href="#features">Features</a><a href="#faq">FAQ</a><a class="btn small" href="${download}">Download</a></div>
  </nav>

  <header class="hero" id="top">
    <div>
      <h1>The squirrel that <em>hoards</em> your inspo.</h1>
      <p class="lead">Drag images from Pinterest, Cosmos or Are.na onto Stash while you scroll. When you're done, it drops them into Figma as a clean moodboard. No more alt-tabbing.</p>
      <div class="cta"><a class="btn" href="${download}">Download for Windows</a><a class="btn ghost" href="#how">See how it works</a></div>
      <div class="fine">Free &middot; Windows 10 and 11 &middot; needs the Figma desktop app</div>
    </div>
    <div class="stage" aria-hidden="true">
      <div class="blob"></div>${sq('Eating Peanut')}
      <div class="toast"><i></i>Stashed! 13 in Brand X moodboard</div>
      <div class="toast two"><i></i>Sent 12 images to Figma</div>
    </div>
  </header>

  <section id="how">
    <div class="kicker">How it works</div>
    <h2>Four steps, and the last one is automatic.</h2>
    <div class="steps">
      <div class="step"><div class="art">${sq('Waking Up')}</div><div class="num">1</div><h3>Install</h3><p>Run the installer. Windows may say "unknown publisher" because Stash isn't code-signed yet: choose <code>More info</code> then <code>Run anyway</code>.</p></div>
      <div class="step"><div class="art">${sq('Sleeping')}</div><div class="num">2</div><h3>Connect Figma, once</h3><p>Right-click Stash in the tray and pick <code>Set up the Figma plugin</code>. In Figma desktop: Plugins, Development, Import plugin from manifest.</p></div>
      <div class="step"><div class="art">${sq('Eating Peanut')}</div><div class="num">3</div><h3>Feed it images</h3><p>Drag any image onto Stash while you browse, or copy one and it asks if you want to keep it. Every image is a peanut.</p></div>
      <div class="step"><div class="art">${sq('Sending To Figma')}</div><div class="num">4</div><h3>It lands in Figma</h3><p>With the Stash plugin open, new images appear in your file within a couple of seconds, in a tidy masonry frame.</p></div>
    </div>
  </section>

  <section id="features">
    <div class="kicker">What it does</div>
    <h2>Built for the way you moodboard.</h2>
    <div class="grid">
      <div class="card"><div class="em">&#129340;</div><h3>Catches anything</h3><p>Drag from any site, or copy an image and Stash asks first. Non-images get spat back out, with attitude.</p></div>
      <div class="card"><div class="em">&#128444;</div><h3>Full-size originals</h3><p>On Pinterest, Cosmos and Are.na it swaps thumbnails for the original image, so your moodboard isn't blurry.</p></div>
      <div class="card"><div class="em">&#128683;</div><h3>Zero duplicates</h3><p>Every image is fingerprinted. The same picture is never saved or sent to Figma twice.</p></div>
      <div class="card"><div class="em">&#128194;</div><h3>Collections</h3><p>Keep a stash per project. Reorder by dragging, delete with a click, and each collection becomes its own Figma frame.</p></div>
      <div class="card"><div class="em">&#129521;</div><h3>Your layout</h3><p>Masonry or grid, any image width and gap, with the source link as a small caption under each image.</p></div>
      <div class="card"><div class="em">&#9200;</div><h3>Break reminders &amp; ping-pong</h3><p>Every 15 minutes Stash patrols your desktop with a sign. Bored? Challenge it to ping-pong. It's on hard mode.</p></div>
    </div>
  </section>

  <section>
    <div class="private">
      <div><h2>Everything stays on your PC.</h2><p>No account, no cloud, no tracking. Your images live in a folder on your computer, and Stash talks to Figma only through a local connection on your own machine. The only thing it ever fetches from the internet is the image you dropped, and updates to Stash itself.</p></div>
      ${sq('Celebrating')}
    </div>
  </section>

  <section class="faq" id="faq">
    <div class="kicker">Questions</div>
    <h2>Good to know.</h2>
    <details><summary>Is there a Mac version?</summary><p>Not yet. Stash is Windows-only for now.</p></details>
    <details><summary>Windows says "Windows protected your PC". Is that safe?</summary><p>That warning appears for any app from a publisher Windows doesn't know yet, and Stash isn't code-signed. Choose <code>More info</code>, then <code>Run anyway</code>. You can read exactly what Stash does in the open source code on GitHub.</p></details>
    <details><summary>Can I move Stash somewhere else?</summary><p>Yes. Press on Stash and drag it anywhere on your screen, even while it's walking or napping, then let go. It remembers the spot, even after a restart. To put it back in the corner, use the tray menu or Settings.</p></details>
    <details><summary>Do I need to keep Figma open?</summary><p>Only to place images. Open the Stash plugin in your Figma file once and leave it open (minimised is fine). If it's closed, Stash keeps your images safe and sends them the moment you open it again.</p></details>
    <details><summary>Where are my images stored?</summary><p>In a Stash folder inside your Windows app-data folder (<code>%APPDATA%\\Stash</code>). Uninstalling Stash leaves them there, so nothing is lost by accident.</p></details>
    <details><summary>Does Stash start with Windows?</summary><p>Yes by default, so it's there when you open your laptop. You can turn that off in Settings.</p></details>
    <details><summary>How do I uninstall it?</summary><p>Windows Settings, Apps, Installed apps, Stash, Uninstall.</p></details>
  </section>

  <section class="end">
    ${sq('Idle')}
    <h2>Let it hoard for you.</h2>
    <a class="btn" href="${download}">Download for Windows</a>
    <div class="fine">Free &middot; about 80 MB</div>
  </section>

  <footer><span>Stash v${pkg.version}</span><span>Made with peanuts. <a href="${repoUrl}">Source and releases</a></span></footer>
</div>
</body>
</html>
`;
writeFileSync(path.join(here, 'index.html'), html);
console.log('wrote docs/index.html', Math.round(html.length / 1024) + ' KB, download link:', download);
