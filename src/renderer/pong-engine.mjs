// Stash Pong game logic: no DOM, so it can be tested with simulated games.
// Coordinates are the Figma "05 Ping Pong" ones: a 340 x 620 court, squirrel paddle at the top, yours at the bottom.
export const W = 340, H = 620;
export const WALL = 3, BALL = 12, PW = 76, PH = 10;
export const AI_Y = 74, YOU_Y = 548;
export const WIN_SCORE = 11;

// Hard mode: quick reactions, a good paddle speed, and a little error that grows with ball speed.
export const HARD = { speedMax: 560, reaction: 0.06, errBase: 5, errPerSpeed: 0.02, aim: 1.1, safe: 30, drift: 150, mistake: 0.015, tire: 0.004, slip: 38, speedUp: 1.06, maxSpeed: 760 };

const BASE_SPEED = 300, MAX_SPEED = 720, SPEED_UP = 1.05, MAX_ANGLE = 1.08;   // 62 degrees off vertical
const YOU_MAX_SPEED = 1500, KEY_SPEED = 560;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createGame({ seed = 1, difficulty = HARD, winScore = WIN_SCORE } = {}) {
  const rng = mulberry32(seed);
  const g = {
    state: 'start',            // start | serve | play | point | paused | over
    prevState: 'play',
    score: { you: 0, ai: 0 },
    ball: { x: (W - BALL) / 2, y: (H - BALL) / 2, vx: 0, vy: 0, speed: BASE_SPEED },
    you: { x: (W - PW) / 2, target: (W - PW) / 2 },
    ai: { x: (W - PW) / 2, target: (W - PW) / 2, since: 0, err: 0, aim: 0, volley: -1, vx: 0 },
    rally: 0, hits: 0, vol: 0, lastScorer: null, winner: null, serveTimer: 0, pointTimer: 0, trail: [], trailT: 0, time: 0,
    difficulty, winScore,
  };

  const resetBall = () => { g.ball.x = (W - BALL) / 2; g.ball.y = (H - BALL) / 2; g.ball.vx = 0; g.ball.vy = 0; g.ball.speed = BASE_SPEED; g.rally = 0; g.trail = []; };

  function launch() {
    const toward = g.lastScorer === 'ai' ? 1 : -1;          // the player who just lost the point receives (first serve goes to the squirrel)
    const ang = (rng() - 0.5) * 0.9;                          // up to ~26 degrees
    g.ball.speed = BASE_SPEED; g.vol++;
    g.ball.vx = g.ball.speed * Math.sin(ang);
    g.ball.vy = toward * g.ball.speed * Math.cos(ang);
  }

  // Where will the ball be, along its current path, when it reaches height y? (folds off the side walls)
  function predictX(y) {
    const b = g.ball;
    if (b.vy === 0) return b.x + BALL / 2;
    const t = (y - (b.y + BALL / 2)) / b.vy;
    const lo = WALL + BALL / 2, hi = W - WALL - BALL / 2, span = hi - lo;
    let x = b.x + BALL / 2 + b.vx * Math.max(0, t) - lo;
    x = ((x % (2 * span)) + 2 * span) % (2 * span);
    return lo + (x > span ? 2 * span - x : x);
  }

  function bounceOff(paddleX, dirY) {
    const b = g.ball;
    const rel = clamp(((b.x + BALL / 2) - (paddleX + PW / 2)) / (PW / 2 + BALL / 2), -1, 1);
    const ang = rel * MAX_ANGLE;
    b.speed = Math.min(g.difficulty.maxSpeed || MAX_SPEED, b.speed * (g.difficulty.speedUp || SPEED_UP) + 3);
    b.vx = b.speed * Math.sin(ang);
    b.vy = dirY * b.speed * Math.cos(ang);
    g.rally++; g.hits++; g.vol++;
  }

  function stepAI(dt) {
    const a = g.ai, d = g.difficulty, b = g.ball;
    a.since += dt;
    const incoming = g.state === 'play' && b.vy < 0;
    if (incoming) {
      if (a.volley !== g.vol) {                               // a new volley (after a serve or a paddle hit): choose its aim and mistake once
        a.volley = g.vol;
        // Normally the squirrel puts the ball on its paddle, aiming for the side you are not on.
        const youC = g.you.x + PW / 2;
        const sendRight = youC < W / 2 ? 1 : -1;
        a.aim = sendRight * (0.25 + rng() * 0.5) * (PW / 2) * d.aim;
        const wobble = (rng() - 0.5) * 2 * (d.errBase + d.errPerSpeed * b.speed);
        // paddle centre = where the ball arrives, shifted so the ball meets the aimed part of the paddle (kept well inside the paddle)
        a.err = clamp(wobble - a.aim, -d.safe, d.safe);
        // ...unless this is one of its occasional mistakes, which get likelier the longer the rally runs
        if (rng() < d.mistake + g.rally * d.tire) a.err += (rng() < 0.5 ? -1 : 1) * (d.slip + rng() * d.slip);
        a.since = d.reaction;                                  // first look happens at once, then one look per reaction time
      }
      if (a.since >= d.reaction) { a.since = 0; a.target = predictX(AI_Y + PH) + a.err - PW / 2; }
    } else {
      a.target = (W - PW) / 2;                                 // wait in the middle
    }
    const limit = (incoming ? d.speedMax : d.drift) * dt;
    const dx = clamp(a.target - a.x, -limit, limit);
    a.x = clamp(a.x + dx, WALL, W - WALL - PW);
    a.vx = dx / dt;
  }

  function movePlayer(dt, input) {
    const y = g.you;
    if (input && input.dir) y.target = clamp(y.target + input.dir * KEY_SPEED * dt, WALL, W - WALL - PW);
    else if (input && input.targetX != null) y.target = clamp(input.targetX - PW / 2, WALL, W - WALL - PW);
    const lim = YOU_MAX_SPEED * dt;
    y.x = clamp(y.x + clamp(y.target - y.x, -lim, lim), WALL, W - WALL - PW);
  }

  function substep(h, ev) {
    const b = g.ball;
    b.x += b.vx * h; b.y += b.vy * h;
    if (b.x < WALL) { b.x = WALL; b.vx = Math.abs(b.vx); ev.push({ type: 'wall' }); }
    if (b.x > W - WALL - BALL) { b.x = W - WALL - BALL; b.vx = -Math.abs(b.vx); ev.push({ type: 'wall' }); }
    // squirrel paddle (top)
    if (b.vy < 0 && b.y < AI_Y + PH && b.y + BALL > AI_Y && b.x + BALL > g.ai.x && b.x < g.ai.x + PW) {
      b.y = AI_Y + PH; bounceOff(g.ai.x, 1); ev.push({ type: 'hit', by: 'ai' });
    }
    // your paddle (bottom)
    if (b.vy > 0 && b.y + BALL > YOU_Y && b.y < YOU_Y + PH && b.x + BALL > g.you.x && b.x < g.you.x + PW) {
      b.y = YOU_Y - BALL; bounceOff(g.you.x, -1); ev.push({ type: 'hit', by: 'you' });
    }
    // goals: the ball got past a paddle
    if (b.y + BALL < AI_Y - 2) score('you', ev);
    else if (b.y > YOU_Y + PH + 2) score('ai', ev);
  }

  function score(by, ev) {
    g.score[by]++; g.lastScorer = by;
    g.state = 'point'; g.pointTimer = by === 'ai' ? 1.5 : 1.1;
    g.ball.vx = g.ball.vy = 0;
    ev.push({ type: 'point', by, score: { ...g.score } });
    if (g.score[by] >= g.winScore) { g.winner = by; ev.push({ type: 'over', winner: by, score: { ...g.score } }); }
  }

  const api = {
    g,
    begin() { if (g.state === 'start') { g.state = 'serve'; g.serveTimer = 0.6; } },
    pause() { if (g.state === 'play' || g.state === 'serve' || g.state === 'point') { g.prevState = g.state; g.state = 'paused'; } },
    resume() { if (g.state === 'paused') g.state = g.prevState; },
    togglePause() { g.state === 'paused' ? api.resume() : api.pause(); },
    rematch() {
      g.score = { you: 0, ai: 0 }; g.winner = null; g.lastScorer = null; g.hits = 0;
      resetBall(); g.state = 'serve'; g.serveTimer = 0.6; g.ai.x = g.ai.target = g.you.x = g.you.target = (W - PW) / 2;
    },
    step(dt, input) {
      const ev = [];
      if (g.state === 'start' || g.state === 'paused' || g.state === 'over') { if (g.state !== 'paused') movePlayer(dt, input); return ev; }
      g.time += dt;
      movePlayer(dt, input);
      stepAI(dt);
      if (g.state === 'serve') {
        g.serveTimer -= dt;
        if (g.serveTimer <= 0) { launch(); g.state = 'play'; ev.push({ type: 'serve' }); }
        return ev;
      }
      if (g.state === 'point') {
        g.pointTimer -= dt;
        if (g.pointTimer <= 0) {
          if (g.winner) g.state = 'over';
          else { resetBall(); g.state = 'serve'; g.serveTimer = 0.7; }
        }
        return ev;
      }
      // play: small sub-steps so a fast ball can never skip through a paddle
      let left = dt;
      while (left > 1e-9 && g.state === 'play') { const h = Math.min(left, 1 / 240); substep(h, ev); left -= h; }
      g.trailT += dt;
      if (g.trailT > 0.028) { g.trailT = 0; g.trail.unshift({ x: g.ball.x, y: g.ball.y }); g.trail.length = Math.min(g.trail.length, 2); }
      return ev;
    },
  };
  return api;
}
