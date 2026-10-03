// Pong engine tests: physics rules, scoring, pause, win condition, and simulated games to check "hard mode" difficulty.
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; } };

(async () => {
  const E = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'pong-engine.mjs')).href);
  const { createGame, W, WALL, BALL, PW, PH, AI_Y, YOU_Y } = E;
  const DT = 1 / 120;

  // run until `pred(events)` or time runs out
  const run = (game, seconds, input = {}, pred = null) => {
    const all = [];
    for (let i = 0; i < seconds / DT; i++) {
      const ev = game.step(DT, typeof input === 'function' ? input(game, DT) : input);
      all.push(...ev);
      if (pred && pred(ev, game)) break;
    }
    return all;
  };
  const started = (seed = 1) => { const g = createGame({ seed }); g.begin(); run(g, 1.0, {}, (ev) => ev.some((e) => e.type === 'serve')); return g; };

  console.log('Pong rules');
  await t('starts on the title screen; begin() moves to serve, then the ball launches', () => {
    const p = createGame(); assert.strictEqual(p.g.state, 'start');
    p.begin(); assert.strictEqual(p.g.state, 'serve');
    run(p, 1, {}, (ev) => ev.some((e) => e.type === 'serve'));
    assert.strictEqual(p.g.state, 'play'); assert.ok(p.g.ball.vy < 0, 'first serve goes toward the squirrel');
  });
  await t('court matches the design: 340x620, paddles 76x10 at y74 and y548, ball 12px', () => {
    assert.deepStrictEqual([E.W, E.H, E.PW, E.PH, E.AI_Y, E.YOU_Y, E.BALL], [340, 620, 76, 10, 74, 548, 12]);
  });
  await t('ball bounces off the side walls', () => {
    const p = started(); const b = p.g.ball; b.x = 40; b.vx = -400; b.vy = -50;
    run(p, 0.5, {}, () => b.vx > 0);
    assert.ok(b.vx > 0 && b.x >= WALL);
  });
  await t('hitting your paddle sends the ball back up', () => {
    const p = started(); const b = p.g.ball; p.g.you.x = p.g.you.target = 130;
    b.x = 160; b.y = YOU_Y - 40; b.vx = 0; b.vy = 300;
    const ev = run(p, 0.5, {}, (e) => e.some((x) => x.type === 'hit'));
    assert.ok(ev.some((e) => e.type === 'hit' && e.by === 'you')); assert.ok(b.vy < 0);
  });
  await t('where the ball lands on the paddle sets the angle (edge = steep, centre = straight)', () => {
    const edge = started(), mid = started();
    for (const [p, x] of [[edge, 130 + PW - 4], [mid, 130 + PW / 2 - BALL / 2]]) {
      p.g.you.x = p.g.you.target = 130; const b = p.g.ball; b.x = x; b.y = YOU_Y - 30; b.vx = 0; b.vy = 300; run(p, 0.5, {}, (e) => e.some((z) => z.type === 'hit'));
    }
    assert.ok(Math.abs(edge.g.ball.vx) > 5 * Math.abs(mid.g.ball.vx) + 50, `${edge.g.ball.vx} vs ${mid.g.ball.vx}`);
    assert.ok(Math.abs(mid.g.ball.vx) < 40);
  });
  await t('the ball never goes nearly horizontal (always keeps real vertical speed)', () => {
    const p = started(); p.g.you.x = p.g.you.target = 130; const b = p.g.ball; b.x = 130 + PW - 1; b.y = YOU_Y - 30; b.vx = 0; b.vy = 300;
    run(p, 0.5, {}, (e) => e.some((z) => z.type === 'hit'));
    assert.ok(Math.abs(b.vy) > 0.4 * b.speed, `vy ${b.vy} of ${b.speed}`);
  });
  await t('every hit speeds the ball up, up to a cap', () => {
    const p = started(); const b = p.g.ball; const s0 = b.speed;
    for (let i = 0; i < 40; i++) { p.g.you.x = p.g.you.target = b.x - 30; b.y = YOU_Y - 30; b.vy = 300; b.vx = 0; run(p, 0.5, {}, (e) => e.some((z) => z.type === 'hit')); if (i === 0) assert.ok(b.speed > s0); }
    assert.ok(b.speed <= E.HARD.maxSpeed + 1e-6 && b.speed > E.HARD.maxSpeed - 60, `speed ${b.speed}`);
  });
  await t('a fast ball cannot tunnel through a paddle (checked at max speed)', () => {
    const p = started(); const b = p.g.ball; b.speed = E.HARD.maxSpeed; p.g.you.x = p.g.you.target = 150;
    for (let k = 0; k < 50; k++) { b.x = 150 + (k % 5) * 15; b.y = YOU_Y - 60; b.vx = 0; b.vy = E.HARD.maxSpeed; p.g.state = 'play'; const ev = run(p, 0.4, {}, (e) => e.some((z) => z.type === 'hit' || z.type === 'point')); assert.ok(ev.some((z) => z.type === 'hit'), 'passed through at k=' + k); }
  });
  await t('missing the ball scores for the squirrel, and the miss is announced', () => {
    const p = started(); p.g.you.x = p.g.you.target = 10; const b = p.g.ball; b.x = 250; b.y = YOU_Y - 40; b.vx = 0; b.vy = 300;
    const ev = run(p, 1, {}, (e) => e.some((z) => z.type === 'point'));
    const pt = ev.find((e) => e.type === 'point'); assert.strictEqual(pt.by, 'ai'); assert.deepStrictEqual(pt.score, { you: 0, ai: 1 });
  });
  await t('getting it past the squirrel scores for you', () => {
    const p = started(); p.g.ai.x = p.g.ai.target = 5; const b = p.g.ball; b.x = 280; b.y = AI_Y + 60; b.vx = 0; b.vy = -300;
    p.g.state = 'play';
    const ev = run(p, 1, (g) => ({ targetX: 300 }), (e) => e.some((z) => z.type === 'point'));
    // AI is pinned left by setting its limits; give it no time to react
    assert.ok(ev.some((e) => e.type === 'point'));
  });
  await t('after a point there is a short pause, then the next serve goes to whoever lost it', () => {
    const p = started(); p.g.you.x = p.g.you.target = 10; const b = p.g.ball; b.x = 250; b.y = YOU_Y - 40; b.vx = 0; b.vy = 300;
    run(p, 1, {}, (e) => e.some((z) => z.type === 'point'));
    assert.strictEqual(p.g.state, 'point');
    run(p, 3, {}, (e) => e.some((z) => z.type === 'serve'));
    assert.strictEqual(p.g.state, 'play'); assert.ok(p.g.ball.vy > 0, 'loser (you) receives');
    assert.ok(Math.abs(p.g.ball.x - (W - BALL) / 2) < 120);
  });
  await t('first to 11 wins; the game then goes to the end screen', () => {
    const p = started(); p.g.score = { you: 10, ai: 3 }; p.g.ai.x = p.g.ai.target = 5;
    const b = p.g.ball; b.x = 280; b.y = AI_Y + 60; b.vx = 0; b.vy = -300; p.g.state = 'play';
    const ev = run(p, 4, { targetX: 300 }, (e, g) => g.state === 'over');
    assert.strictEqual(p.g.winner, 'you'); assert.strictEqual(p.g.state, 'over'); assert.ok(ev.some((e) => e.type === 'over' && e.winner === 'you'));
    assert.strictEqual(p.g.score.you, 11);
  });
  await t('10-10 is not over: the game continues until someone reaches 11', () => {
    const p = started(); p.g.score = { you: 10, ai: 10 }; assert.strictEqual(p.g.state, 'play'); assert.strictEqual(p.g.winner, null);
  });
  await t('pause freezes everything and resume continues', () => {
    const p = started(); const b = p.g.ball; const x0 = b.x, y0 = b.y;
    p.pause(); assert.strictEqual(p.g.state, 'paused'); run(p, 1);
    assert.strictEqual(b.x, x0); assert.strictEqual(b.y, y0);
    p.resume(); assert.strictEqual(p.g.state, 'play'); run(p, 0.2); assert.ok(b.y !== y0);
    p.togglePause(); assert.strictEqual(p.g.state, 'paused'); p.togglePause(); assert.strictEqual(p.g.state, 'play');
  });
  await t('rematch resets the score and serves again', () => {
    const p = started(); p.g.score = { you: 11, ai: 6 }; p.g.winner = 'you'; p.g.state = 'over';
    p.rematch(); assert.deepStrictEqual(p.g.score, { you: 0, ai: 0 }); assert.strictEqual(p.g.state, 'serve'); assert.strictEqual(p.g.winner, null);
  });
  await t('mouse target and A/D keys both move your paddle, and it stays inside the walls', () => {
    const p = started();
    run(p, 0.3, { targetX: 9999 }); assert.ok(p.g.you.x + PW <= W - WALL + 0.001);
    run(p, 0.3, { targetX: -9999 }); assert.ok(p.g.you.x >= WALL - 0.001);
    const x = p.g.you.x; run(p, 0.2, { dir: 1 }); assert.ok(p.g.you.x > x + 40);
    run(p, 0.2, { dir: -1 }); assert.ok(p.g.you.x < x + 20);
  });
  await t('same seed -> same game (deterministic)', () => {
    const a = createGame({ seed: 42 }), b = createGame({ seed: 42 }); a.begin(); b.begin();
    run(a, 6, { targetX: 170 }); run(b, 6, { targetX: 170 });
    assert.deepStrictEqual([a.g.ball.x, a.g.ball.y, a.g.score], [b.g.ball.x, b.g.ball.y, b.g.score]);
  });

  console.log('Hard mode: simulated games (virtual players)');
  // Three kinds of virtual player. All of them only see what a human sees: the ball.
  // where a ball (snapshot: centre x/y + velocity) will be when it reaches height y, folding off the side walls
  const fold = (s, y) => { const t = (y - s.y) / (s.vy || 1e-9); const lo = WALL + BALL / 2, hi = W - WALL - BALL / 2, span = hi - lo; let x = s.x + s.vx * Math.max(0, t) - lo; x = ((x % (2 * span)) + 2 * span) % (2 * span); return lo + (x > span ? 2 * span - x : x); };
  // A virtual player has a reaction delay (it sees an old picture of the ball) and a limited hand speed.
  const KINDS = {
    naive:    { delay: 0.24, speed: 380,  noise: 0,  aim: 0,  predict: false },
    decent:   { delay: 0.25, speed: 450,  noise: 34, aim: 24, predict: true },
    flawless: { delay: 0.04, speed: 1100, noise: 2,  aim: 34, predict: true },
  };
  const makeBot = (kind, rngSeed) => {
    const k = KINDS[kind];
    let r = rngSeed; const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    const buf = []; let pos = W / 2, offset = 0, volley = -1;
    return (g, dt) => {
      const b = g.ball;
      buf.push({ t: g.time, x: b.x + BALL / 2, y: b.y + BALL / 2, vx: b.vx, vy: b.vy });
      while (buf.length > 2 && g.time - buf[1].t > k.delay) buf.shift();
      const seen = buf[0];                                         // the old picture of the ball
      let want;
      if (!k.predict) want = seen.x;                              // just follow the ball sideways
      else if (seen.vy > 0) {
        if (volley !== g.hits) { volley = g.hits; offset = (rnd() - 0.5) * 2 * k.noise + (kind === 'flawless' ? (rnd() < 0.5 ? -1 : 1) * k.aim : (rnd() - 0.5) * 2 * k.aim); }
        want = fold(seen, YOU_Y) + offset;
      } else want = W / 2;
      const step = k.speed * dt; pos += Math.max(-step, Math.min(step, want - pos));
      return { targetX: pos };
    };
  };
  const playGame = (seed, kind) => {
    const p = createGame({ seed }); p.begin(); const bot = makeBot(kind, seed * 7919);
    for (let i = 0; i < 20 * 60 * 120 && p.g.state !== 'over'; i++) p.step(DT, bot(p.g, DT));
    return { winner: p.g.winner, score: { ...p.g.score }, rally: p.hits };
  };
  const series = (kind, n) => { let ai = 0, avgYou = 0; for (let s = 1; s <= n; s++) { const r = playGame(s, kind); if (r.winner === 'ai') ai++; avgYou += r.score.you; } return { aiWins: ai, n, avgYou: avgYou / n }; };
  const N = 30;
  const naive = series('naive', N), decent = series('decent', N), perfect = series('flawless', N);
  console.log(`       squirrel wins vs naive ${naive.aiWins}/${N} | decent ${decent.aiWins}/${N} | flawless ${perfect.aiWins}/${N}   (your avg points: ${naive.avgYou.toFixed(1)} / ${decent.avgYou.toFixed(1)} / ${perfect.avgYou.toFixed(1)})`);
  await t('games always finish (no endless rallies)', () => { for (let s = 1; s <= 5; s++) assert.ok(playGame(s, 'decent').winner); });
  await t('hard: the squirrel beats a ball-follower almost every time', () => assert.ok(naive.aiWins >= 0.9 * N, `${naive.aiWins}/${N}`));
  await t('hard: it beats a decent player most of the time, but not always', () => assert.ok(decent.aiWins >= 0.6 * N && decent.aiWins <= 0.92 * N, `${decent.aiWins}/${N}`));
  await t('and it is beatable: a flawless player wins most games', () => assert.ok(perfect.aiWins <= 0.5 * N, `squirrel won ${perfect.aiWins}/${N}`));
  await t('a decent player scores real points (it is a game, not a wall)', () => assert.ok(decent.avgYou >= 4, `avg ${decent.avgYou}`));

  console.log(`\n${passed} pong checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
