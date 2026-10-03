// Stash Pong: the retro game that slides in from the right edge (Figma "05 Ping Pong").
// Screen layout and colours follow the design; the rules and the squirrel's AI live in pong-engine.mjs.
import { createGame, W, H, PW, PH, BALL, AI_Y, YOU_Y } from './pong-engine.mjs';
import { squirrelSVG } from './squirrel.js';
import { h } from './ui.js';

const C = { bg: '#1B120C', header: '#2A1B12', cream: '#F6E7CF', tan: '#D99A5B', danger: '#C2412D' };
const pad2 = (n) => String(n).padStart(2, '0');

export function createPong({ root, getScreen, onEvent }) {
  let game = null, open = false, raf = 0, last = 0, acc = 0;
  let screen = 'start';
  const input = { targetX: null, dir: 0 };
  const keys = new Set();
  const dbg = { speed: 1, bot: null };
  let flashAI = 0, flashYou = 0, moodTimer = null, shakeTimer = null;

  // ---------- DOM ----------
  const canvas = h('canvas', { class: 'pg-canvas', width: W, height: H });
  const ctx = canvas.getContext('2d');
  const mini = h('div', { class: 'pg-mini' });
  const header = h('div', { class: 'pg-header' },
    h('span', { class: 'pg-title' }, 'STASH PONG'), mini,
    h('span', { class: 'pg-esc', onclick: () => api.close() }, 'ESC'));
  const hint = h('div', { class: 'pg-hint' }, 'MOUSE OR A/D    SPACE PAUSE');
  const sq = (state, x, y) => h('div', { class: 'pg-sq', style: { left: x + 'px', top: y + 'px' }, html: squirrelSVG(state) });
  const txt = (cls, text, y, extra = {}) => h('div', { class: 'pg-t ' + cls, style: { top: y + 'px', ...extra } }, text);
  const scoreTxt = txt('s10', '', 470);
  const loseTxt = txt('s10', '', 206);
  const screens = {
    start: h('div', { class: 'pg-screen', 'data-screen': 'start' },
      txt('s28', 'STASH', 130), txt('s28 tan', 'PONG', 172), txt('s9', 'YOU VS SQUIRREL', 240), txt('s8 red', 'HARD MODE', 262),
      sq('Game Mode', 95, 300), txt('s10 blink', 'CLICK TO SERVE', 500)),
    scores: h('div', { class: 'pg-screen', 'data-screen': 'scores' },
      txt('s20 tan', 'SQUIRREL', 140), txt('s20', 'SCORES', 176), sq('Celebrating', 95, 240), scoreTxt),
    win: h('div', { class: 'pg-screen', 'data-screen': 'win' },
      txt('s22', 'YOU WON?!', 140), txt('s7 tan', 'THE SQUIRREL IS IN SHOCK', 186), sq('Confused', 95, 240),
      h('div', { class: 'pg-t s8 pg-keys', style: { top: '500px' } }, h('span', { 'data-act': 'rematch', onclick: () => api.rematch() }, 'R REMATCH'), '   ', h('span', { 'data-act': 'quit', onclick: () => api.close() }, 'ESC QUIT'))),
    lose: h('div', { class: 'pg-screen', 'data-screen': 'lose' },
      txt('s20 tan', 'SQUIRREL', 130), txt('s20', 'WINS', 166), loseTxt, sq('Celebrating', 95, 250),
      h('div', { class: 'pg-t s8 pg-keys', style: { top: '500px' } }, h('span', { 'data-act': 'rematch', onclick: () => api.rematch() }, 'R REMATCH'), '   ', h('span', { 'data-act': 'quit', onclick: () => api.close() }, 'ESC QUIT'))),
    paused: h('div', { class: 'pg-screen', 'data-screen': 'paused' },
      txt('s24', 'PAUSED', 190), txt('s8 tan', 'SPACE RESUME', 240), txt('s8 tan', 'ESC QUIT', 260), sq('Sleeping', 95, 320)),
  };
  const el = h('div', { id: 'pong', class: 'hit', hidden: true }, canvas, ...Object.values(screens), header, hint, h('div', { class: 'pg-scan' }));
  root.appendChild(el);
  el.addEventListener('pointerdown', () => { if (screen === 'start') api.begin(); });

  const setMini = (state) => { mini.innerHTML = squirrelSVG(state); };
  const mood = (state, ms) => { setMini(state); clearTimeout(moodTimer); moodTimer = setTimeout(() => setMini('Game Mode'), ms); };

  function showScreen(name) {
    if (name === screen) return;
    screen = name;
    for (const [k, s] of Object.entries(screens)) s.classList.toggle('on', k === name);
  }

  // ---------- drawing ----------
  function draw() {
    const g = game.g;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // dashed centre line
    ctx.fillStyle = C.cream; ctx.globalAlpha = 0.35;
    for (let i = 0; i < 13; i++) ctx.fillRect(10 + i * 26, 316, 14, 4);
    ctx.globalAlpha = 1;
    // scores
    ctx.font = '22px "Press Start 2P"'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.tan; ctx.fillText(pad2(g.score.ai), 276, 264);
    ctx.fillStyle = C.cream; ctx.fillText(pad2(g.score.you), 276, 336);
    // paddles (they flash for a moment when they hit)
    ctx.fillStyle = flashAI > 0 ? '#fff' : C.tan; ctx.fillRect(Math.round(g.ai.x), AI_Y, PW, PH);
    ctx.fillStyle = flashYou > 0 ? '#fff' : C.cream; ctx.fillRect(Math.round(g.you.x), YOU_Y, PW, PH);
    // ball + trail
    if (g.state === 'play' || g.state === 'serve' || g.state === 'paused') {
      ctx.fillStyle = C.cream;
      g.trail.forEach((p, i) => { ctx.globalAlpha = i === 0 ? 0.45 : 0.22; ctx.fillRect(Math.round(p.x), Math.round(p.y), BALL, BALL); });
      ctx.globalAlpha = g.state === 'serve' && Math.floor(g.serveTimer * 8) % 2 ? 0.4 : 1;
      ctx.fillRect(Math.round(g.ball.x), Math.round(g.ball.y), BALL, BALL);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- game flow ----------
  function handle(ev) {
    for (const e of ev) {
      if (e.type === 'hit') { if (e.by === 'ai') flashAI = 0.09; else flashYou = 0.09; }
      if (e.type === 'over') onEvent({ type: e.winner === 'you' ? 'win' : 'lose' });
      if (e.type === 'point') {
        el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
        clearTimeout(shakeTimer); shakeTimer = setTimeout(() => el.classList.remove('shake'), 280);
        if (e.by === 'ai') { mood('Celebrating', 1100); onEvent({ type: 'aiPoint', score: e.score }); }
        else { mood('Confused', 1000); onEvent({ type: 'youPoint', score: e.score }); }
      }
    }
  }

  function syncScreen() {
    const g = game.g;
    if (g.state === 'start') return showScreen('start');
    if (g.state === 'paused') return showScreen('paused');
    if (g.state === 'over') {
      if (g.winner === 'you') { if (screen !== 'win') mood('Confused', 4000); showScreen('win'); }
      else { loseTxt.textContent = `${g.score.ai} - ${g.score.you}`; if (screen !== 'lose') mood('Celebrating', 4000); showScreen('lose'); }
      return;
    }
    if (g.state === 'point' && g.lastScorer === 'ai' && !g.winner) { scoreTxt.textContent = `${pad2(g.score.ai)} - ${pad2(g.score.you)}`; return showScreen('scores'); }
    showScreen('none');
  }

  const STEP = 1 / 120;
  let lastState = '';
  function frame(ts) {
    if (!open) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    acc += dt * dbg.speed;
    let ev = [];
    while (acc >= STEP) {
      acc -= STEP;
      const inp = dbg.bot ? dbg.bot(game.g, STEP) : (keys.size || input.targetX == null ? { dir: input.dir, targetX: input.targetX } : { targetX: input.targetX });
      ev = ev.concat(game.step(STEP, inp));
    }
    handle(ev);
    flashAI = Math.max(0, flashAI - dt); flashYou = Math.max(0, flashYou - dt);
    syncScreen();
    draw();
    // tell the squirrel where the AI paddle is so it can mirror it
    onEvent({ type: 'aim', value: ((game.g.ai.x + PW / 2) / W - 0.5) * 2 });
    if (game.g.state !== lastState) { lastState = game.g.state; }
    raf = requestAnimationFrame(frame);
  }

  // ---------- input ----------
  const fake = (e) => window.__stash && window.__stash.ignoreReal && e.isTrusted;   // self-test drives its own input
  const onMouse = (e) => {
    if (fake(e)) return;
    const r = el.getBoundingClientRect(); if (!r.width) return;
    input.targetX = ((e.clientX - r.left) / r.width) * W;
  };
  const dirFromKeys = () => { input.dir = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0); };
  const onKeyDown = (e) => {
    if (!open || fake(e)) return;
    const k = e.key.toLowerCase();
    if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); input.targetX = null; dirFromKeys(); e.preventDefault(); }   // keys take over from the mouse until it moves again
    else if (k === ' ') { e.preventDefault(); if (screen === 'start') api.begin(); else game.togglePause(); }
    else if (k === 'escape') { e.preventDefault(); api.close(); }
    else if (k === 'r' && game.g.state === 'over') { api.rematch(); }
  };
  const onKeyUp = (e) => { if (fake(e)) return; keys.delete(e.key.toLowerCase()); dirFromKeys(); };
  const onBlur = () => { if (open && ['play', 'serve', 'point'].includes(game.g.state)) game.pause(); };   // clicked into another app

  // ---------- placement ----------
  function place() {
    const s = getScreen();
    const scale = Math.min(1, (s.work.height - 40) / H);
    el.style.setProperty('--ps', scale);
    el.style.bottom = (s.height - (s.work.y + s.work.height) + 24) + 'px';   // 24px above the taskbar
    return { scale, left: s.width - W * scale, top: s.work.y + s.work.height - 24 - H * scale };
  }

  const api = {
    isOpen: () => open,
    rect: () => (open ? el.getBoundingClientRect() : null),
    cursor(x) { if (!open || keys.size) return; const r = el.getBoundingClientRect(); if (r.width) input.targetX = ((x - r.left) / r.width) * W; },
    async open() {
      if (open) return;
      try { await document.fonts.load('22px "Press Start 2P"'); } catch (_) { /* draw with the fallback font */ }
      game = createGame({ seed: (Date.now() & 0xffff) || 1 });
      open = true; screen = ''; acc = 0; input.targetX = null; input.dir = 0; keys.clear();
      setMini('Game Mode');
      const p = place();
      el.hidden = false; el.classList.remove('closing'); el.classList.add('opening');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('opening')));
      window.stash.setFocusable(true);
      document.addEventListener('mousemove', onMouse);
      window.addEventListener('keydown', onKeyDown, true); window.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('blur', onBlur);
      last = performance.now(); raf = requestAnimationFrame(frame);
      onEvent({ type: 'open', ...p });
    },
    close() {
      if (!open) return;
      open = false; cancelAnimationFrame(raf);
      document.removeEventListener('mousemove', onMouse);
      window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      window.stash.setFocusable(false);
      el.classList.add('closing');
      setTimeout(() => { if (!open) el.hidden = true; el.classList.remove('closing'); }, 380);
      onEvent({ type: 'close' });
    },
    toggle() { open ? api.close() : api.open(); },
    begin() { if (game) game.begin(); },
    pause() { if (game) game.pause(); },
    rematch() { if (game && game.g.state === 'over') { game.rematch(); showScreen('none'); setMini('Game Mode'); onEvent({ type: 'rematch' }); } },
    snapshot() {
      const g = game ? game.g : null;
      return { open, screen, state: g && g.state, score: g && { ...g.score }, winner: g && g.winner, aiX: g && g.ai.x, youX: g && g.you.x, ball: g && { x: g.ball.x, y: g.ball.y, speed: g.ball.speed }, hits: g && g.hits };
    },
    debug: dbg,
  };
  return api;
}
