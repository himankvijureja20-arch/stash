// Tests the Figma plugin's placement logic against a small mock of Figma's plugin API.
// (The real thing has to be tried inside Figma, but layout/dup/frame rules can be checked here.)
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; } };

// ---- mock Figma ----
let nextId = 1;
class Node {
  constructor(type) { this.type = type; this.id = `${nextId++}:1`; this.children = []; this.parent = null; this.x = 0; this.y = 0; this.width = 100; this.height = 100; this.data = {}; this.name = type; this.layoutMode = 'NONE'; this.itemSpacing = 0; this.fills = []; this.links = []; }
  getPluginData(k) { return this.data[k] || ''; }
  setPluginData(k, v) { this.data[k] = v; }
  resize(w, h) { this.width = w; this.height = h; this._relayout(); }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); c.parent = this; this.children.push(c); this._relayout(); }
  _relayout() {
    if (this.layoutMode === 'VERTICAL' && this.primaryAxisSizingMode === 'AUTO') {
      this.height = this.children.reduce((s, c) => s + c.height, 0) + this.itemSpacing * Math.max(0, this.children.length - 1);
    }
    if (this.parent) this.parent._relayout();
  }
  setRangeHyperlink(a, b, link) { this.links.push({ a, b, link }); }
  set characters(v) { this._chars = v; this.height = 14; }
  get characters() { return this._chars; }
}
const page = new Node('PAGE'); page.loadAsync = async () => {};
let fonts = 0;
const figmaMock = {
  showUI() {}, ui: { postMessage(m) { posted.push(m); }, onmessage: null },
  currentPage: page,
  viewport: { center: { x: 500, y: 300 }, scrollAndZoomIntoView() {} },
  clientStorage: { async getAsync() { return null; }, async setAsync() {} },
  createFrame() { return new Node('FRAME'); },
  createRectangle() { return new Node('RECTANGLE'); },
  createText() { return new Node('TEXT'); },
  loadFontAsync: async () => { fonts++; },
  createImage(bytes) {
    // read PNG header for the size, like Figma would
    const w = Buffer.from(bytes).readUInt32BE(16), h = Buffer.from(bytes).readUInt32BE(20);
    return { hash: 'img' + w + 'x' + h, getSizeAsync: async () => ({ width: w, height: h }) };
  },
  notify() {},
};
const posted = [];
page.appendChild = Node.prototype.appendChild.bind(page);

const sandbox = { figma: figmaMock, __html__: '', console, Math, Number, String, Array, Promise, JSON, Object };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'figma-plugin', 'code.js'), 'utf8'), sandbox);

// a tiny PNG header is all the mock needs
const pngBytes = (w, h) => { const b = Buffer.alloc(32); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return new Uint8Array(b); };
let seq = 0;
const send = async (item, w, h, cfg) => {
  const before = posted.length;
  await figmaMock.ui.onmessage({ type: 'place', item: { id: 'i' + ++seq, hash: item.hash || 'h' + seq, collection: 'Board', source: 'pinterest.com', sourceUrl: 'https://www.pinterest.com/pin/1/', ...item }, bytes: pngBytes(w, h), config: cfg });
  return posted.slice(before).find((m) => m.type === 'placed' || m.type === 'place-error');
};
const frames = () => page.children.filter((c) => c.type === 'FRAME');
const cards = (f) => f.children.filter((c) => c.getPluginData('stashHash'));
const MASONRY = { layout: 'masonry', imageWidth: 280, gap: 16, showSourceLinks: true, oneFramePerCollection: true };

(async () => {
  console.log('Figma plugin placement (mock Figma)');
  let first;
  await t('first image creates a frame named after the collection', async () => {
    const r = await send({}, 600, 800, MASONRY);
    assert.strictEqual(r.status, 'placed'); assert.strictEqual(r.frame, 'Board');
    assert.strictEqual(frames().length, 1); assert.strictEqual(frames()[0].name, 'Board');
    first = frames()[0];
  });
  await t('images are 280px wide and keep their aspect ratio', () => {
    const c = cards(first)[0]; const img = c.children[0];
    assert.strictEqual(img.width, 280); assert.strictEqual(img.height, Math.round(280 * 800 / 600));
  });
  await t('source link caption sits under the image and is a real hyperlink', () => {
    const c = cards(first)[0]; const cap = c.children[1];
    assert.strictEqual(cap.characters, 'pinterest.com'); assert.strictEqual(cap.links[0].link.value, 'https://www.pinterest.com/pin/1/');
  });
  await t('next images fill the columns left to right, 16px apart', async () => {
    for (const [w, h] of [[500, 500], [400, 700], [800, 400]]) await send({}, w, h, MASONRY);
    const xs = cards(first).map((c) => c.x);
    assert.deepStrictEqual(xs, [32, 32 + 296, 32 + 592, 32 + 888]);
  });
  await t('then each new image goes under the SHORTEST column', async () => {
    const r = await send({}, 500, 500, MASONRY);
    const kids = cards(first); const newest = kids[kids.length - 1];
    const bottoms = {}; for (const k of kids.slice(0, -1)) bottoms[k.x] = Math.max(bottoms[k.x] || 0, k.y + k.height);
    const shortest = Object.keys(bottoms).sort((a, b) => bottoms[a] - bottoms[b])[0];
    assert.strictEqual(newest.x, Number(shortest)); assert.strictEqual(newest.y, bottoms[shortest] + 16);
    assert.strictEqual(r.status, 'placed');
  });
  await t('the frame grows to fit everything (plus padding)', () => {
    const maxBottom = Math.max(...first.children.map((c) => c.y + c.height));
    assert.strictEqual(first.height, maxBottom + 32);
    assert.strictEqual(first.width, 32 * 2 + 4 * 280 + 3 * 16);
  });
  await t('a repeated image is skipped, not placed again', async () => {
    const n = cards(first).length;
    const a = await send({ hash: 'dup-hash' }, 300, 300, MASONRY);
    const b = await send({ hash: 'dup-hash' }, 300, 300, MASONRY);
    assert.strictEqual(a.status, 'placed'); assert.strictEqual(b.status, 'duplicate'); assert.strictEqual(b.nodeId, a.nodeId);
    assert.strictEqual(cards(first).length, n + 1);
  });
  await t('a different collection gets its own frame', async () => {
    const r = await send({ collection: 'Type refs' }, 400, 400, MASONRY);
    assert.strictEqual(r.frame, 'Type refs'); assert.strictEqual(frames().length, 2);
  });
  await t('"One frame per collection" off -> everything goes into one frame called Stash', async () => {
    const one = { ...MASONRY, oneFramePerCollection: false };
    const a = await send({ collection: 'Board' }, 400, 400, one);
    const b = await send({ collection: 'Type refs' }, 400, 400, one);
    assert.strictEqual(a.frame, 'Stash'); assert.strictEqual(b.frame, 'Stash');
    assert.strictEqual(frames().filter((f) => f.name === 'Stash').length, 1);
  });
  await t('"Show source links" off -> no caption', async () => {
    const r = await send({ collection: 'NoLinks' }, 400, 400, { ...MASONRY, showSourceLinks: false });
    const f = frames().find((x) => x.name === 'NoLinks');
    assert.strictEqual(r.status, 'placed'); assert.strictEqual(cards(f)[0].children.length, 1);
  });
  await t('custom width and gap are honoured', async () => {
    const cfg = { ...MASONRY, imageWidth: 200, gap: 10 };
    for (let i = 0; i < 5; i++) await send({ collection: 'Custom' }, 400, 400, cfg);
    const f = frames().find((x) => x.name === 'Custom');
    assert.strictEqual(cards(f)[0].children[0].width, 200);
    assert.deepStrictEqual(cards(f).slice(0, 4).map((c) => c.x), [32, 242, 452, 662]);
    assert.strictEqual(f.width, 32 * 2 + 4 * 200 + 3 * 10);
  });
  await t('Grid layout: square cells in rows of 4', async () => {
    const cfg = { ...MASONRY, layout: 'grid' };
    for (let i = 0; i < 6; i++) await send({ collection: 'Grid' }, 300 + i * 40, 500, cfg);
    const f = frames().find((x) => x.name === 'Grid'); const k = cards(f);
    assert.ok(k.every((c) => c.children[0].width === 280 && c.children[0].height === 280));
    assert.deepStrictEqual(k.slice(0, 4).map((c) => [c.x, c.y]), [[32, 32], [328, 32], [624, 32], [920, 32]]);
    assert.strictEqual(k[4].x, 32); assert.ok(k[4].y > k[0].y + 280);
  });
  await t('settings can also arrive on their own (config message)', async () => {
    await figmaMock.ui.onmessage({ type: 'config', config: { layout: 'masonry', imageWidth: 150, gap: 4, showSourceLinks: true, oneFramePerCollection: true } });
    await figmaMock.ui.onmessage({ type: 'place', item: { id: 'zz', hash: 'zz', collection: 'Cfg', source: '', sourceUrl: '' }, bytes: pngBytes(300, 300) });
    const f = frames().find((x) => x.name === 'Cfg');
    assert.strictEqual(cards(f)[0].children[0].width, 150);
  });
  await t('bad config values are clamped to sane limits', async () => {
    await figmaMock.ui.onmessage({ type: 'config', config: { layout: 'nonsense', imageWidth: 99999, gap: -5 } });
    await figmaMock.ui.onmessage({ type: 'place', item: { id: 'yy', hash: 'yy', collection: 'Clamp', source: '', sourceUrl: '' }, bytes: pngBytes(300, 300) });
    const f = frames().find((x) => x.name === 'Clamp');
    assert.strictEqual(cards(f)[0].children[0].width, 1200);
    await figmaMock.ui.onmessage({ type: 'config', config: MASONRY });
  });

  console.log(`\n${passed} plugin checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
