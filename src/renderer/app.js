// Stash behaviour engine. Acceptance criteria: Figma "02 Character" > Interaction spec.
import { squirrelSVG, stateNames } from './squirrel.js';
import { createPanel } from './panel.js';
import { createSettings } from './settings.js';
import { createKeep } from './keep.js';
import { createPong } from './pong.js';
import { createOnboarding } from './onboarding.js';
import { spotFromPos, posFromSpot, cleanSpot } from './home-spot.js';

const $ = (id) => document.getElementById(id);
const stashEl = $('stash'), flipEl = $('flip'), bobEl = $('bob'), spriteEl = $('sprite');
const toastsEl = $('toasts'), menuEl = $('menu'), fxEl = $('fx');

const DOT = { success: '#6E8B3D', accent: '#B8622E', danger: '#C2412D', peanut: '#E3B877', muted: '#8A7563' };
const PEANUT_SVG = '<svg viewBox="0 0 48 48"><g transform="rotate(-25 24 24)"><ellipse cx="24" cy="15" rx="9" ry="11" fill="#E3B877"/><ellipse cx="24" cy="31" rx="9" ry="11" fill="#E3B877"/><path d="M19 22L29 24" stroke="#B8622E" stroke-width="2" stroke-linecap="round"/></g></svg>';
const ROAM_SECS = { chill: [60, 180], normal: [20, 90], hyper: [8, 30] };
const POKE_SPEED = 3200;     // px/s at the moment the cursor enters Stash; quick but normal aiming is well below this
const STUFFED_AT = 20;       // unsent images before Stash looks stuffed
const PATROL_EVERY = 15 * 60 * 1000;
const PARK_MS = 10 * 60 * 1000;      // after you put Stash somewhere, it stays put this long before it starts roaming again
const SLEEP_AFTER = 10 * 60; // seconds of no input
const BLINKERS = new Set(['Idle', 'Roaming', 'Patrol 15 Min', 'Notice', 'Ready To Catch', 'Dodge', 'Spit Out', 'Stuffed', 'Game Mode']);

let cfg = {}, scr = { width: 1920, height: 1080, work: { x: 0, y: 0, width: 1920, height: 1040 } };
let S = 112, TS = 1;
let pos = { x: 0, y: 0 }, dir = 1;
let counts = { count: 0, unsent: 0, collection: '' };

let stateName = 'Idle';
let holdToken = 0, moveToken = 0;
let busy = false, moving = false, sleeping = false, wakeArmed = true;
let menuOpen = false, hovering = false, dragNear = false, debugHold = false, panelOpen = false;
let dodgeCooldown = 0, spriteOver = false, patrolTimer = null;
let drag = null, selfDragging = false, suppressClick = false, parkUntil = 0;   // picking Stash up and carrying it
let panel, settingsUI, keep, pong, onboarding;   // created at boot
let pongOpen = false, moodToken = 0;
const cur = { x: -999, y: -999, t: 0, v: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- geometry ----------
const floorY = () => scr.work.y + scr.work.height;
const restY = () => floorY() - S * 0.94;
const defaultHome = () => ({ x: scr.work.x + scr.work.width - S - 28, y: restY() });
// home is where you last put Stash down, or the bottom-right corner until you do
const home = () => { const sp = cleanSpot(cfg.homeSpot); return sp ? clampFree(posFromSpot(sp, S, scr.work, restY())) : defaultHome(); };
const clampPos = (p) => ({ x: clamp(p.x, scr.work.x + 8, scr.work.x + scr.work.width - S - 8), y: clamp(p.y, scr.work.y + 8, restY()) });
const center = () => ({ x: pos.x + S / 2, y: pos.y + S / 2 });

let lastReport = 0;
function applyPos(force) {
  stashEl.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
  const now = performance.now();
  if (force || now - lastReport > 60) { lastReport = now; window.stash.spriteBox({ x: pos.x, y: pos.y, w: S, h: S }); }
  toastsEl.classList.toggle('left', pos.x + S < 330);
  toastsEl.classList.toggle('below', pos.y < 140);
  if (force && panel) { panel.reposition(); keep.reposition(); }   // follow the squirrel once it settles
}
const anchor = () => ({ x: pos.x, y: pos.y + S * 0.08, w: S, h: S * 0.86, screenW: scr.width, screenH: scr.height });
function setDir(dx) {
  if (Math.abs(dx) < 4) return;
  dir = dx > 0 ? 1 : -1;
  flipEl.style.setProperty('--dir', dir);
}

// ---------- state ----------
function setState(name) {
  stateName = name;
  spriteEl.innerHTML = squirrelSVG(name);
  spriteEl.dataset.state = name;
}
const restName = () => (sleeping ? 'Sleeping' : counts.unsent >= STUFFED_AT ? 'Stuffed' : 'Idle');
function toRest() { if (!debugHold) setState(restName()); }

// Run a timed animation state, then go back to rest unless something newer took over.
function activity(name, ms) {
  const t = ++holdToken;
  busy = true; setState(name);
  return new Promise((res) => setTimeout(() => {
    if (t === holdToken) { busy = false; toRest(); }
    res(t === holdToken);
  }, ms));
}
function lock(name) { ++holdToken; busy = true; setState(name); }
function unlock() { busy = false; toRest(); }

function applyCounts(c) {
  counts = { count: c.count, unsent: c.unsent, collection: c.collection };
  spriteEl.style.setProperty('--belly', 1 + Math.min(counts.unsent, STUFFED_AT) * 0.011);
  if (!busy && !moving && (stateName === 'Idle' || stateName === 'Stuffed')) toRest();
}

// ---------- toasts ----------
function toast(text, kind = 'success', ms = 3000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<i style="--dot:${DOT[kind] || DOT.success}"></i><span></span>`;
  el.lastChild.textContent = text;
  toastsEl.appendChild(el);
  while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, ms);
}

// ---------- movement ----------
function cancelMove() {
  moveToken++;
  if (moving) { moving = false; bobEl.classList.remove('moving'); }
}
function land() { bobEl.classList.remove('land'); void bobEl.offsetWidth; bobEl.classList.add('land'); }

async function hopOnce(from, to, ms, height, token) {
  const t0 = performance.now();
  for (;;) {
    if (token !== moveToken) return false;
    const u = Math.min(1, (performance.now() - t0) / ms);
    pos.x = from.x + (to.x - from.x) * u;
    pos.y = from.y + (to.y - from.y) * u - height * 4 * u * (1 - u);
    applyPos();
    if (u >= 1) break;
    await frame();
  }
  pos = { ...to }; applyPos(true); land();
  return true;
}

// Hop-walk to a spot in 2-4 hops (spec: Roam = hop-walk, springy, never linear).
async function hopTo(target, o = {}) {
  const token = ++moveToken;
  moving = true; bobEl.classList.add('moving');
  if (o.state !== null) setState(o.state || 'Roaming');
  target = clampPos(target);
  const start = { ...pos };
  const dist = Math.hypot(target.x - start.x, target.y - start.y);
  const n = o.hops ?? clamp(Math.round(dist / 240), 1, 4);
  for (let i = 1; i <= n; i++) {
    const a = { ...pos };
    const b = { x: start.x + (target.x - start.x) * (i / n), y: start.y + (target.y - start.y) * (i / n) };
    setDir(b.x - a.x);
    if (!(await hopOnce(a, b, (o.ms || 420) / Math.min(TS, 4), o.height ?? 34, token))) return false;
    if (i < n) await sleep((o.pause ?? 110) / Math.min(TS, 4));
    if (token !== moveToken) return false;
  }
  moving = false; bobEl.classList.remove('moving');
  if (!o.keepState && !busy) toRest();
  return true;
}

async function walkTo(x, ms) {
  const token = ++moveToken;
  moving = true; bobEl.classList.add('moving');
  const from = { ...pos }, y = restY(), t0 = performance.now();
  setDir(x - from.x);
  for (;;) {
    if (token !== moveToken) return false;
    const u = Math.min(1, (performance.now() - t0) / ms);
    pos.x = from.x + (x - from.x) * u;
    pos.y = y + (from.y - y) * (1 - u) - Math.abs(Math.sin(u * ms / 95)) * 7;
    applyPos();
    if (u >= 1) break;
    await frame();
  }
  pos.y = y; applyPos(true);
  moving = false; bobEl.classList.remove('moving');
  return true;
}

function randomSpot() {
  const w = scr.work;
  const x = rand(w.x + 24, w.x + w.width - S - 24);
  const up = Math.pow(Math.random(), 1.7) * (w.height * 0.75);   // biased toward the bottom of the screen
  return { x, y: restY() - up };
}

// ---------- roaming, patrol, sleep ----------
let roamTimer;
function scheduleRoam() {
  clearTimeout(roamTimer);
  if (!cfg.roamEnabled) return;
  const [a, b] = ROAM_SECS[cfg.roam] || ROAM_SECS.normal;
  roamTimer = setTimeout(roamNow, (rand(a, b) * 1000) / TS);
}
const calm = () => !busy && !drag && performance.now() >= parkUntil && !moving && !sleeping && !menuOpen && !panelOpen && !hovering && !dragNear && !debugHold && !(keep && keep.isOpen()) && !pongOpen && !(onboarding && onboarding.isOpen()) && (stateName === 'Idle' || stateName === 'Stuffed' || stateName === 'Notice');
async function roamNow() {
  if (calm()) await hopTo(randomSpot());
  scheduleRoam();
}

async function patrol() {
  if (!cfg.patrolReminder || debugHold) return;
  if (pongOpen) { toast('15 min up. Stretch a bit?', 'peanut', 3600); pong.pause(); return; }   // no lap while you are mid-game: just the reminder, and the game pauses
  if (busy || menuOpen) { setTimeout(patrol, 10000 / TS); return; }
  sleeping = false; cancelMove();
  lock('Roaming');
  toast('15 min up. Stretch a bit?', 'peanut', 3600);
  const w = scr.work;
  await hopTo({ x: w.x + 12, y: restY() }, { hops: 3, ms: 300, keepState: true });
  setState('Patrol 15 Min');
  await walkTo(w.x + w.width - S - 12, Math.max(2200, 5600 / TS));
  setState('Roaming');
  await hopTo(home(), { keepState: true, hops: 3 });
  unlock();
}

async function napNow() {
  cancelMove(); sleeping = true; wakeArmed = false; lock('Sleeping'); busy = false; // asleep is a rest state
}
async function wake() {
  if (!sleeping) return;
  sleeping = false;
  await activity('Waking Up', 900);
}

setInterval(async () => {
  if (sleeping || busy || moving || menuOpen || pongOpen || debugHold || (window.__stash && window.__stash.noIdleSleep) || !(stateName === 'Idle' || stateName === 'Stuffed')) return;
  const idle = await window.stash.idleSeconds();
  if (idle >= SLEEP_AFTER / TS) {
    const c = center();
    wakeArmed = Math.hypot(cur.x - c.x, cur.y - c.y) > 300;
    sleeping = true; cancelMove(); toRest();
  }
}, 5000);

// ---------- reactions ----------
const hitRect = () => {
  const x0 = pos.x + S * 0.2, x1 = pos.x + S * 0.95;
  return { x0: dir < 0 ? 2 * (pos.x + S / 2) - x1 : x0, x1: dir < 0 ? 2 * (pos.x + S / 2) - x0 : x1, y0: pos.y + S * 0.08, y1: pos.y + S * 0.94 };
};
const overSprite = (x, y) => { const r = hitRect(); return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; };

let lastInteractive = false;
function syncInteractive() {
  const want = hovering || menuOpen || selfDragging || !!drag;
  if (want !== lastInteractive) { lastInteractive = want; (window.__ilog = window.__ilog || []).push([Math.round(performance.now()), want]); if (window.__ilog.length > 60) window.__ilog.shift(); window.stash.setInteractive(want); }
}

async function dodge() {
  const now = performance.now();
  if (now < dodgeCooldown || debugHold) return;
  dodgeCooldown = now + 1300;
  cancelMove();
  const c = center();
  let dashDir = cur.x < c.x ? 1 : -1;                   // run away from the cursor
  let to = clampPos({ x: pos.x + dashDir * 170, y: pos.y });
  if (Math.abs(to.x - pos.x) < 60) {                     // cornered against the screen edge: escape the other way
    dashDir = -dashDir;
    to = clampPos({ x: pos.x + dashDir * 170, y: pos.y });
  }
  dir = -dashDir; flipEl.style.setProperty('--dir', dir); // Dodge art has its cursor + lines on the right
  const t = ++holdToken; busy = true; setState('Dodge');
  const from = { ...pos }, t0 = performance.now(), ms = 130, mt = moveToken;
  for (;;) {
    if (mt !== moveToken) return;                       // picked up (or sent elsewhere) mid-dash
    const u = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - Math.pow(1 - u, 3);
    pos.x = from.x + (to.x - from.x) * e; applyPos();
    if (u >= 1) break;
    await frame();
  }
  applyPos(true);
  setTimeout(() => { if (t === holdToken) { busy = false; toRest(); } }, 1000);
}

function onMove(x, y, ts) {
  const dt = Math.max(1, ts - cur.t);
  const sp = cur.fresh ? 0 : (Math.hypot(x - cur.x, y - cur.y) / dt) * 1000;
  cur.fresh = false;
  cur.v = cur.v * 0.4 + sp * 0.6; cur.x = x; cur.y = y; cur.t = ts;

  if (drag) { dragMove(x, y, ts); return; }
  const over = overSprite(x, y);
  const overUi = (() => { const t = document.elementFromPoint(x, y); return !!(t && t.closest && t.closest('.hit')); })();
  const entered = over && !spriteOver;
  spriteOver = over;
  hovering = over || overUi;
  syncInteractive();

  if (sleeping) {
    const c = center(), d = Math.hypot(x - c.x, y - c.y);
    if (d > 300) wakeArmed = true;
    if (wakeArmed && d < 240) wake();
    return;
  }
  if (entered && cur.v > POKE_SPEED) { dodge(); return; }    // poke = flicked fast into it (ordinary quick aiming at Stash must NOT count)
  if (entered && !busy && !moving && (stateName === 'Idle' || stateName === 'Stuffed')) { setState('Notice'); return; }
  if (!over && stateName === 'Notice' && !busy) toRest();
}
// Real mouse movement arrives from the main process (see startCursorFeed); the page's own mousemove events
// are only used for synthetic input, so one movement is never counted twice.
document.addEventListener('mousemove', (e) => {
  if (e.isTrusted) return;
  onMove(e.clientX, e.clientY, e.timeStamp);
});
window.stash.on('cursor', (x, y) => {
  if (window.__stash && window.__stash.ignoreReal) return;   // self-test drives a fake cursor
  onMove(x, y, performance.now());
  if (pong) pong.cursor(x, y);
});

// ---------- catching ----------
window.stash.on('drag-near', async (v) => {
  if (selfDragging || drag) return;                     // we are carrying Stash ourselves, nothing is being dropped on it
  dragNear = v;
  document.body.classList.toggle('near', v);
  if (v) {
    cancelMove();
    if (sleeping) { sleeping = false; }
    if (!busy) setState('Ready To Catch');
  } else if (stateName === 'Ready To Catch' && !busy) toRest();
});

const toFileUrl = (p) => encodeURI('file:///' + p.replace(/\\/g, '/'));
function flyIn(from, src) {
  return new Promise((res) => {
    const c = center();
    const to = { x: c.x + (S * 0.0) * dir, y: pos.y + S * 0.5 };
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 80 };
    const el = document.createElement('div');
    el.className = 'flyer';
    el.innerHTML = (src ? `<img src="${src}" alt="">` : '') + PEANUT_SVG;
    fxEl.appendChild(el);
    const T = (p, sc, rot) => `translate(${p.x - 24}px, ${p.y - 24}px) scale(${sc}) rotate(${rot}deg)`;
    const opt = { duration: 600, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' };
    el.animate([{ transform: T(from, 1, 0) }, { transform: T(mid, .85, -14), offset: .5 }, { transform: T(to, .22, 28) }], opt);
    const img = el.querySelector('img');
    if (img) img.animate([{ opacity: 1 }, { opacity: 1, offset: .38 }, { opacity: 0, offset: .66 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
    el.querySelector('svg').animate([{ opacity: 0 }, { opacity: 0, offset: .38 }, { opacity: 1, offset: .66 }, { opacity: 1 }], { duration: 600, fill: 'forwards' });
    setTimeout(() => { el.remove(); res(); }, 600);
  });
}

async function handleDrop(payload, at) {
  handleResult(await window.stash.ingest(payload), at);
}

// Shared by drops, the clipboard prompt and auto-keep. `at` is where the image flies in from (null = no flight).
async function handleResult(r, at) {
  applyCounts(r);
  if (r.status === 'stashed') {
    if (!busy) setState('Ready To Catch');
    if (at) await flyIn(at, r.filePath ? toFileUrl(r.filePath) : null);
    activity('Eating Peanut', 1250);
    toast(`Stashed! ${r.count} in ${r.collection}`, 'success');
  } else if (r.status === 'duplicate') {
    activity('Confused', 1100); toast('Already stashed. Skipped.', 'muted');
  } else if (r.status === 'not-image') {
    activity('Spit Out', 1300); toast("That's not an image. ptoo!", 'danger');
  } else {
    activity('Confused', 1200); toast("Couldn't fetch that image.", 'danger', 3600);
  }
}

document.addEventListener('dragenter', (e) => e.preventDefault());
document.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('near');
  const dt = e.dataTransfer;
  handleDrop({
    files: [...dt.files].map((f) => window.stash.pathFor(f)).filter(Boolean),
    html: dt.getData('text/html'), uriList: dt.getData('text/uri-list'), text: dt.getData('text/plain'),
  }, { x: e.clientX, y: e.clientY });
});

// ---------- sync with Figma ----------
window.stash.on('counts', (c) => applyCounts(c));
window.stash.on('sync', async (e) => {
  if (e.phase === 'start') { sleeping = false; cancelMove(); lock('Sending To Figma'); return; }
  applyCounts(e);
  await activity('Celebrating', 1800);
  if (e.n === 1) toast('Synced 1 new image to Figma', 'success');
  else toast(`Sent ${e.n} images to Figma`, 'accent');
});

// ---------- pick Stash up and put it down ----------
// Press on Stash and drag: it is lifted and follows the cursor (any state, any place on screen).
// A press without movement is still a normal click (panel / menu).
const CARRY_AFTER = 5;                                     // px of movement before a press becomes a carry
const clampFree = (p) => ({ x: clamp(p.x, scr.work.x, scr.work.x + scr.work.width - S), y: clamp(p.y, scr.work.y, restY()) });

stashEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || pongOpen || debugHold || drag) return;
  if (!overSprite(e.clientX, e.clientY)) return;
  drag = { sx: e.clientX, sy: e.clientY, offX: e.clientX - pos.x, offY: e.clientY - pos.y, started: false, vx: 0, vy: 0, t: performance.now(), id: e.pointerId };
  try { stashEl.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
  syncInteractive();
});
window.addEventListener('pointerup', () => dragEnd());
window.addEventListener('pointercancel', () => dragEnd());
window.stash.on('mouse-up', () => dragEnd());               // real release, even if the page never saw it

function startCarry() {
  drag.started = true; selfDragging = true; window.stash.selfDrag(true);
  cancelMove(); closeMenu(); sleeping = false;
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  document.body.classList.remove('near');
  lock('Ready To Catch');                                   // surprised, arms up: "I'm being picked up!"
  stashEl.classList.add('held'); document.body.classList.add('carrying');
}

function dragMove(x, y, ts) {
  const d = drag;
  if (!d.started) { if (Math.hypot(x - d.sx, y - d.sy) < CARRY_AFTER) return; startCarry(); }
  const to = clampFree({ x: x - d.offX, y: y - d.offY });
  const dt = Math.max(0.001, (ts - d.t) / 1000);
  d.vx = d.vx * 0.6 + ((to.x - pos.x) / dt) * 0.4;           // smoothed speed, used for the sway now and the toss on release
  d.vy = d.vy * 0.6 + ((to.y - pos.y) / dt) * 0.4;
  d.t = ts;
  bobEl.style.setProperty('--sway', clamp(d.vx / 45, -24, 24).toFixed(1) + 'deg');   // hangs from the scruff, swings with the movement
  pos = to; applyPos(true);
}

function dragEnd() {
  const d = drag;
  if (!d) return;
  drag = null;
  try { stashEl.releasePointerCapture(d.id); } catch (_) { /* already released */ }
  if (!d.started) { syncInteractive(); return; }             // never moved: it was just a click
  selfDragging = false; window.stash.selfDrag(false);
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 120);
  stashEl.classList.remove('held'); document.body.classList.remove('carrying');
  bobEl.style.setProperty('--sway', '0deg');
  spriteOver = overSprite(cur.x, cur.y); hovering = spriteOver;      // keep hover bookkeeping honest after the carry
  putDown(d);
}

// Set Stash down where it was let go: a small toss from the release speed, a landing squash, then it remembers the spot.
async function putDown(d) {
  cancelMove();
  const token = ++moveToken;
  if (performance.now() - d.t > 90) { d.vx = 0; d.vy = 0; }       // held still before letting go: no toss
  const from = { ...pos };
  const to = clampFree({ x: from.x + clamp(d.vx * 0.12, -120, 120), y: from.y + clamp(d.vy * 0.12, -120, 120) });
  const t0 = performance.now(), ms = 220;
  for (;;) {
    if (token !== moveToken) return;                               // picked up again mid-toss
    const u = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - u, 3);
    pos = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; applyPos();
    if (u >= 1) break;
    await frame();
  }
  applyPos(true);
  land(); unlock(); activity('Notice', 700);
  syncInteractive();
  rememberSpot();
}

// The spot becomes home (saved, so it survives a restart) and Stash stays parked there for a while.
function rememberSpot() {
  const sp = spotFromPos(pos, S, scr.work, restY());
  cfg.homeSpot = sp; window.stash.setSetting('homeSpot', sp);
  parkUntil = performance.now() + PARK_MS / TS;
  if (!cfg.pickedUpHint) {
    cfg.pickedUpHint = true; window.stash.setSetting('pickedUpHint', true);
    toast('This is my spot now. Tray menu > Put Stash back in the corner undoes it.', 'accent', 5200);
  }
}

async function resetHome() {
  cfg.homeSpot = null; window.stash.setSetting('homeSpot', null); parkUntil = 0;
  if (pongOpen || drag) return;
  cancelMove(); sleeping = false; lock('Roaming');
  await hopTo(home(), { keepState: true, hops: 3 });
  unlock();
  toast('Back in the corner.', 'success', 2400);
}

// ---------- click + menu ----------
let clickTimer = null;
stashEl.addEventListener('click', () => {
  if (menuOpen || suppressClick) return;
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; openMenu(); return; }   // double click
  clickTimer = setTimeout(() => { clickTimer = null; openPanel(); }, 260);                // single click
});

function openPanel() {
  if (sleeping) { wake(); return; }
  cancelMove();
  panel.toggle();
}

const MENU = [
  { id: 'open', label: 'Open stash', kbd: 'Ctrl+Shift+S' },
  { id: 'pong', label: 'Play ping-pong', badge: 'NEW' },
  { id: 'send', label: 'Send to Figma' },
  { id: 'nap', label: 'Nap time' },
  { sep: true },
  { id: 'settings', label: 'Settings' },
  { id: 'quit', label: 'Quit Stash', danger: true },
];

function openMenu() {
  menuEl.innerHTML = '';
  for (const m of MENU) {
    if (m.sep) { menuEl.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); continue; }
    const d = document.createElement('div');
    d.className = 'item' + (m.danger ? ' danger' : '');
    d.innerHTML = `<span></span>${m.kbd ? `<kbd>${m.kbd}</kbd>` : ''}${m.badge ? `<span class="badge">${m.badge}</span>` : ''}`;
    d.firstChild.textContent = m.label;
    d.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); runMenu(m.id); });
    menuEl.appendChild(d);
  }
  menuEl.hidden = false;
  const h = menuEl.offsetHeight || 243;
  const right = pos.x + S + 230 + 12 < scr.width;
  const left = right ? pos.x + S - 8 : pos.x - 230 + 8;
  const top = clamp(pos.y + S - h, 8, scr.height - h - 8);
  menuEl.style.left = left + 'px'; menuEl.style.top = top + 'px';
  menuEl.style.setProperty('--ox', right ? '0' : '100%'); menuEl.style.setProperty('--oy', '100%');
  menuOpen = true; cancelMove(); syncInteractive();
}
function closeMenu() { if (!menuOpen) return; menuOpen = false; menuEl.hidden = true; syncInteractive(); }
document.addEventListener('pointerdown', (e) => { if (menuOpen && !menuEl.contains(e.target)) closeMenu(); });

async function runMenu(id) {
  if (id === 'open') { if (!panel.isOpen()) openPanel(); }
  else if (id === 'pong') openPong();
  else if (id === 'settings') settingsUI.open();
  else if (id === 'nap') napNow();
  else if (id === 'quit') window.stash.quit();
  else if (id === 'send') {
    if (counts.unsent === 0) return toast('Nothing to send yet.', 'muted');
    if (await window.stash.pluginUp()) { await window.stash.sendNow(); toast(`Sending ${counts.unsent} to Figma...`, 'accent'); }
    else { activity('Confused', 1300); toast("Figma isn't listening. Open the Stash plugin in Figma.", 'danger', 4800); }
  }
}
// installing the Figma plugin (one time): the plugin file was just revealed in Explorer
const PLUGIN_STEPS = 'In Figma desktop: Plugins > Development > Import plugin from manifest... and pick the file that just opened.';
window.stash.on('update', (e) => {
  if (e.type === 'available') toast('Downloading a Stash update' + (e.version ? ' (v' + e.version + ')' : '') + '...', 'accent', 3600);
  else if (e.type === 'downloaded') toast('Stash v' + e.version + ' is ready. Tray menu > Restart to update.', 'success', 5200);
  else if (e.type === 'current') toast('Stash is up to date.', 'muted', 2800);
  else if (e.type === 'off') toast('Updates switch on once Stash is published (see RELEASING.md).', 'muted', 4200);
  else if (e.type === 'error') toast("Couldn't check for updates right now.", 'danger', 3200);
});
window.stash.on('menu-action', (a) => {
  if (a === 'open-stash' && !panel.isOpen()) openPanel();
  if (a === 'settings') settingsUI.open();
  if (a === 'onboarding') onboarding.open();
  if (a === 'reset-home') resetHome();
  if (a === 'plugin-setup') toast(PLUGIN_STEPS, 'accent', 8000);
});

// ---------- panel, plugin and clipboard events ----------
window.stash.on('panel-dirty', () => panel && panel.refresh());
window.stash.on('plugin', (up) => {
  panel && panel.refresh();
  if (up) toast('Figma is connected', 'success', 2400);
  else if (counts.unsent > 0) toast('Figma went quiet. Your images are queued.', 'muted', 3200);
});
window.stash.on('clip-prompt', (p) => {
  if (debugHold) return;
  cancelMove();
  if (!busy && !sleeping) setState('Notice');
  keep.show(p);
});
window.stash.on('ingested', (r) => handleResult(r, null));

// ---------- misc events ----------
window.stash.on('settings', (s) => { cfg = s; scheduleRoam(); settingsUI && settingsUI.setConfig(s); });
window.stash.on('screen', (s) => { scr = s; pos = clampPos(pos); applyPos(true); onboarding && onboarding.reposition(); });
window.stash.on('summon', async () => {
  cancelMove(); menuOpen && closeMenu();
  if (sleeping) { sleeping = false; }
  lock('Roaming');
  await hopTo(home(), { keepState: true, hops: 3 });
  await activity('Notice', 900);
});

// ---------- ping-pong ----------
function openPong() {
  if (pongOpen) return;
  pongOpen = true;
  panel.close(); settingsUI.close(); if (keep.isOpen()) keep.finish(false);
  closeMenu();
  pong.open();
}
// brief reaction (Celebrating / Confused) while the squirrel is in Game Mode; a newer reaction replaces an older one
function gameMood(name, ms) {
  if (!pongOpen) return;
  const t = ++moodToken;
  setState(name);
  setTimeout(() => { if (pongOpen && t === moodToken) setState('Game Mode'); }, ms);
}
async function onPong(e) {
  if (e.type === 'aim') { if (pongOpen) spriteEl.style.setProperty('--aim', e.value.toFixed(2)); return; }
  if (e.type === 'open') {
    pongOpen = true; cancelMove(); sleeping = false;
    lock('Roaming');
    await hopTo({ x: Math.max(8, e.left - S - 28), y: restY() }, { keepState: true, hops: 3 });
    if (pongOpen) { lock('Game Mode'); setDir(1); flipEl.style.setProperty('--dir', 1); dir = 1; }
    return;
  }
  if (e.type === 'aiPoint') return gameMood('Celebrating', 1100);
  if (e.type === 'youPoint') return gameMood('Confused', 1000);
  if (e.type === 'win') return gameMood('Confused', 3000);
  if (e.type === 'lose') return gameMood('Celebrating', 3000);
  if (e.type === 'close') {
    pongOpen = false; moodToken++;
    spriteEl.style.setProperty('--aim', 0);
    cancelMove(); lock('Roaming');
    await hopTo(home(), { keepState: true, hops: 3 });
    unlock();
  }
}

// ---------- first-run intro ----------
function maybeOnboard() {
  if (cfg.onboarded || onboarding.isOpen()) return;
  setTimeout(() => { if (!cfg.onboarded && !onboarding.isOpen()) onboarding.open(); }, 1400);
}

// ---------- life: blink + ear twitch ----------
(function lifeLoop() {
  setTimeout(() => {
    if (BLINKERS.has(stateName) && !debugHold) { spriteEl.classList.add('blink'); setTimeout(() => spriteEl.classList.remove('blink'), 130); }
    lifeLoop();
  }, rand(2400, 6200));
})();
(function twitchLoop() {
  setTimeout(() => {
    if ((stateName === 'Idle' || stateName === 'Stuffed') && !debugHold) {
      const c = Math.random() < .5 ? 'twitch-l' : 'twitch-r';
      spriteEl.classList.add(c); setTimeout(() => spriteEl.classList.remove(c), 360);
    }
    twitchLoop();
  }, rand(6000, 14000));
})();

// ---------- test hooks ----------
window.__stash = {
  stateNames: () => stateNames,
  show(name) { debugHold = true; cancelMove(); setState(name); },
  box: () => ({ x: pos.x, y: pos.y, w: S, h: S }),
  info: () => ({ stateName, pos: { ...pos }, dir, sleeping, moving, busy, counts }),
  fire: { dodge, patrol, roam: roamNow, nap: napNow, wake },
  stopPatrolTimer: () => clearInterval(patrolTimer),
  geom: () => ({ S, work: scr.work, restY: restY(), home: home(), defaultHome: defaultHome() }),
  clearPark: () => { parkUntil = 0; },
  resetCursor: () => { cur.v = 0; cur.fresh = true; spriteOver = false; hovering = false; },
  dbg: () => ({ stateName, pos: { ...pos }, dir, spriteOver, hovering, busy, moving, sleeping, panelOpen, menuOpen, keepOpen: !!(keep && keep.isOpen()), debugHold, dragNear, cur: { ...cur }, hit: hitRect() }),
  drop: handleDrop,
  toast,
  get panel() { return panel; },
  get settings() { return settingsUI; },
  get keep() { return keep; },
  get pong() { return pong; },
  get onboarding() { return onboarding; },
  maybeOnboard: () => maybeOnboard(),
};

// ---------- boot ----------
(async () => {
  const b = await window.stash.boot();
  cfg = b.settings; scr = b.screen; TS = b.timeScale || 1; S = b.spriteSize || 112;
  document.documentElement.style.setProperty('--s', S + 'px');
  counts = { count: b.count, unsent: b.unsent, collection: b.collection };
  spriteEl.style.setProperty('--belly', 1 + Math.min(counts.unsent, STUFFED_AT) * 0.011);
  const stage = $('stage');
  // toasts normally stack above the squirrel; while the panel or the clipboard prompt is there, they move to its side
  let keepShown = false;
  const placeToasts = () => toastsEl.classList.toggle('beside', panelOpen || keepShown);
  panel = createPanel({ root: stage, anchor, toast, hint: (o) => { panelOpen = o; placeToasts(); } });
  settingsUI = createSettings({ root: stage, toast, getVersion: () => b.version, onResetHome: () => resetHome() });
  settingsUI.setConfig(cfg);
  pong = createPong({ root: stage, getScreen: () => scr, onEvent: onPong });
  onboarding = createOnboarding({ root: stage, onDone: () => {
    cfg.onboarded = true; window.stash.setSetting('onboarded', true);
    activity('Celebrating', 1500); toast("You're all set. Drag an image onto me!", 'success', 3800);
  } });
  keep = createKeep({
    root: stage, anchor, hint: (o) => { keepShown = o; placeToasts(); },
    timeScale: () => (window.__stash && window.__stash.keepScale) || 1,
    onKeep: async (from) => { handleResult(await window.stash.clipKeep(), from); },
    onNah: () => { window.stash.clipDrop(); if (!busy && stateName === 'Notice') toRest(); },
  });
  pos = home(); applyPos(true);
  setState('Waking Up');
  spriteEl.classList.add('pop-in');
  await sleep(900);
  toRest();
  scheduleRoam();
  maybeOnboard();
  patrolTimer = setInterval(patrol, PATROL_EVERY / TS);
})();
