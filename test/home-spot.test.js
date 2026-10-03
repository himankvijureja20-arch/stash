// Maths for remembering where Stash was put down.
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; } };

(async () => {
  const H = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'home-spot.js')).href);
  const work = { x: 0, y: 0, width: 1920, height: 1032 }, S = 112, floor = 1032 - S * 0.94;

  console.log('Home spot');
  t('a position turns into fractions and back to the same position', () => {
    const pos = { x: 640, y: 300 };
    const back = H.posFromSpot(H.spotFromPos(pos, S, work, floor), S, work, floor);
    assert.ok(Math.abs(back.x - pos.x) < 0.5 && Math.abs(back.y - pos.y) < 0.5, JSON.stringify(back));
  });
  t('corners map to 0 and 1', () => {
    assert.deepStrictEqual(H.spotFromPos({ x: 0, y: 0 }, S, work, floor), { fx: 0, fy: 0 });
    assert.deepStrictEqual(H.spotFromPos({ x: 1920 - S, y: floor }, S, work, floor), { fx: 1, fy: 1 });
  });
  t('positions outside the screen are clamped into 0..1', () => {
    assert.deepStrictEqual(H.spotFromPos({ x: -500, y: 9000 }, S, work, floor), { fx: 0, fy: 1 });
  });
  t('the same spot lands in the same relative place on a smaller screen', () => {
    const small = { x: 0, y: 0, width: 1280, height: 680 };
    const p = H.posFromSpot({ fx: 0.5, fy: 0.5 }, S, small, 680 - S * 0.94);
    assert.ok(Math.abs(p.x - (1280 - S) / 2) < 0.5 && Math.abs(p.y - (680 - S * 0.94) / 2) < 0.5);
  });
  t('a taskbar that moves the work area is respected', () => {
    const shifted = { x: 0, y: 40, width: 1920, height: 992 };
    const p = H.posFromSpot({ fx: 0, fy: 0 }, S, shifted, 1032 - S * 0.94);
    assert.strictEqual(p.y, 40);
  });
  t('settings-file values are validated', () => {
    assert.strictEqual(H.cleanSpot(null), null);
    assert.strictEqual(H.cleanSpot('x'), null);
    assert.strictEqual(H.cleanSpot({ fx: 'a', fy: 1 }), null);
    assert.strictEqual(H.cleanSpot({ fx: NaN, fy: 0.5 }), null);
    assert.deepStrictEqual(H.cleanSpot({ fx: 7, fy: -3 }), { fx: 1, fy: 0 });
    assert.deepStrictEqual(H.cleanSpot({ fx: 0.25, fy: 0.75 }), { fx: 0.25, fy: 0.75 });
  });
  console.log(`\n${passed} home-spot checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
