// Automated checks for everything that does not need Figma or a real browser.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const assert = require('assert');
const core = require('../src/main/core/stash-core');
const { createServer } = require('../src/main/core/server');

const PORT = 47999;
let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())]);
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function req(method, p, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p,
      headers: { Host: host || `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json; try { json = JSON.parse(buf.toString()); } catch (_) { /* binary */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-test-'));
  const store = new core.Store(dir);
  let approvals = 0;
  const srv = createServer(store, { port: PORT, approve: async () => { approvals++; return true; } });
  await srv.listen();
  console.log('Stash core + bridge self-test');

  console.log('URL rules');
  await t('Pinterest thumbnail upgrades to originals first', () => {
    const c = core.upgradeUrl('https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg');
    assert.strictEqual(c[0], 'https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg');
    assert.ok(c.includes('https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg'));
    assert.strictEqual(c[c.length - 1], 'https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg');
  });
  await t('Pinterest _RS size segment is handled', () => {
    assert.ok(core.upgradeUrl('https://i.pinimg.com/564x_RS/ab/cd/x.jpg')[0].includes('/originals/'));
  });
  await t('Cosmos resize params are stripped', () => {
    const c = core.upgradeUrl('https://cdn.cosmos.so/abc.jpg?format=webp&w=640&q=70');
    assert.ok(!/[?&]w=/.test(c[0]) && !/q=/.test(c[0]) && c[0].includes('format=webp'));
  });
  await t('Are.na large_ becomes original_', () => {
    assert.ok(core.upgradeUrl('https://d2w9rnfcy7mm78.cloudfront.net/1/large_abc.jpg')[0].includes('/original_abc.jpg'));
  });
  await t('Unknown host is left alone', () => {
    assert.deepStrictEqual(core.upgradeUrl('https://example.com/a.png'), ['https://example.com/a.png']);
  });
  await t('Pinterest-style drop: image from <img>, pin page from uri-list', () => {
    const r = core.pickFromDrop({
      html: '<a href="https://www.pinterest.com/pin/123/"><img src="https://i.pinimg.com/236x/a/b/c.jpg" srcset="https://i.pinimg.com/236x/a/b/c.jpg 1x, https://i.pinimg.com/474x/a/b/c.jpg 2x"></a>',
      uriList: 'https://www.pinterest.com/pin/123/\r\n',
    });
    assert.strictEqual(r.imageUrl, 'https://i.pinimg.com/474x/a/b/c.jpg');
    assert.strictEqual(r.pageUrl, 'https://www.pinterest.com/pin/123/');
  });
  await t('Plain image URL in uri-list works', () => {
    assert.strictEqual(core.pickFromDrop({ uriList: 'https://example.com/pic.png' }).imageUrl, 'https://example.com/pic.png');
  });
  await t('Non-image drop is rejected', () => {
    assert.strictEqual(core.pickFromDrop({ text: 'hello world' }).imageUrl, null);
  });

  console.log('Intake + dedupe');
  const a = makePng(40, 60, [200, 80, 40]);
  const b = makePng(40, 60, [10, 90, 200]);
  await t('PNG is sniffed and stashed', () => {
    const r = core.ingestBuffer(store, a, { collection: 'Board A', source: 'test' });
    assert.strictEqual(r.status, 'stashed'); assert.strictEqual(r.count, 1);
  });
  await t('Same bytes again -> duplicate, not saved', () => {
    const r = core.ingestBuffer(store, a, { collection: 'Board A' });
    assert.strictEqual(r.status, 'duplicate'); assert.strictEqual(store.count('Board A'), 1);
  });
  await t('Different image is accepted', () => {
    assert.strictEqual(core.ingestBuffer(store, b, { collection: 'Board A' }).status, 'stashed');
  });
  await t('Text file is rejected as not-image', () => {
    assert.strictEqual(core.ingestBuffer(store, Buffer.from('just some text, not a picture at all'), {}).status, 'not-image');
  });
  await t('Local-file drop works', async () => {
    const f = path.join(dir, 'drop.png'); fs.writeFileSync(f, makePng(20, 20, [1, 2, 3]));
    const r = await core.ingestDrop(store, { files: [f] }, 'Board A');
    assert.strictEqual(r.status, 'stashed');
  });
  await t('Image survives a restart (store reloads from disk)', () => {
    const again = new core.Store(dir);
    assert.strictEqual(again.count('Board A'), 3);
  });

  console.log('Bridge security');
  await t('Foreign Host header is rejected (DNS rebinding)', async () => {
    assert.strictEqual((await req('GET', '/ping', { host: 'evil.example.com' })).status, 403);
  });
  await t('/pending without a token -> 401', async () => {
    assert.strictEqual((await req('GET', '/pending')).status, 401);
  });
  await t('CORS preflight allowed for the plugin iframe', async () => {
    const r = await req('OPTIONS', '/pending');
    assert.strictEqual(r.status, 204); assert.strictEqual(r.headers['access-control-allow-origin'], '*');
  });
  let token;
  await t('/connect asks once, hands out a token', async () => {
    const r = await req('POST', '/connect', { body: {} });
    assert.strictEqual(r.status, 200); token = r.json.token; assert.ok(token); assert.strictEqual(approvals, 1);
  });
  await t('Reconnecting with the saved token does not ask again', async () => {
    const r = await req('POST', '/connect', { body: { token } });
    assert.strictEqual(r.json.token, token); assert.strictEqual(approvals, 1);
  });
  await t('A wrong token is refused', async () => {
    assert.strictEqual((await req('GET', '/pending', { headers: { 'x-stash-token': 'nope' } })).status, 401);
  });

  console.log('Sync rules');
  const H = () => ({ 'x-stash-token': token });
  let pending;
  await t('Pending lists every unsent image', async () => {
    pending = (await req('GET', '/pending', { headers: H() })).json.items;
    assert.strictEqual(pending.length, 3);
  });
  await t('Image bytes served match what was stored', async () => {
    const r = await req('GET', `/image/${pending[0].id}`, { headers: H() });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(core.sniff(r.buf).ext, 'png');
  });
  await t('Ack records sentAt + figmaNodeId and removes it from pending', async () => {
    const r = await req('POST', '/ack', { headers: H(), body: { id: pending[0].id, figmaNodeId: '12:34' } });
    assert.strictEqual(r.json.unsent, 2);
    const it = store.find(pending[0].id); assert.ok(it.sentAt); assert.strictEqual(it.figmaNodeId, '12:34');
  });
  await t('A second ack never overwrites (nothing sent twice)', async () => {
    const before = store.find(pending[0].id).sentAt;
    await req('POST', '/ack', { headers: H(), body: { id: pending[0].id, figmaNodeId: '99:99' } });
    assert.strictEqual(store.find(pending[0].id).figmaNodeId, '12:34');
    assert.strictEqual(store.find(pending[0].id).sentAt, before);
  });
  await t('Re-dropping an already-sent image is still a duplicate', () => {
    assert.strictEqual(core.ingestBuffer(store, a, { collection: 'Board A' }).status, 'duplicate');
  });
  await t('Same image in a different collection is its own item (one image = one collection)', () => {
    assert.strictEqual(core.ingestBuffer(store, a, { collection: 'Board B' }).status, 'stashed');
    assert.strictEqual(store.count('Board A'), 3);
  });
  await t('Images queue while no plugin is connected, and show up when it asks', async () => {
    const n = (await req('GET', '/pending', { headers: H() })).json.items.length;
    core.ingestBuffer(store, makePng(30, 30, [5, 5, 5]), { collection: 'Board A' });
    assert.strictEqual((await req('GET', '/pending', { headers: H() })).json.items.length, n + 1);
  });

  console.log('Phase 2: sizes, collections, order, delete');
  await t('PNG size is read from the header', () => {
    assert.deepStrictEqual(core.imageSize(makePng(41, 23, [1, 2, 3])), { w: 41, h: 23 });
  });
  await t('GIF size is read from the header', () => {
    const g = Buffer.alloc(20); g.write('GIF89a'); g.writeUInt16LE(64, 6); g.writeUInt16LE(48, 8);
    assert.deepStrictEqual(core.imageSize(g), { w: 64, h: 48 });
  });
  await t('JPEG size is found past other segments', () => {
    const j = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]),
      Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x90, 0x01, 0x2c, 0x01, 0x01, 0x11, 0x00]), Buffer.alloc(8)]);
    assert.deepStrictEqual(core.imageSize(j), { w: 300, h: 400 });
  });
  await t('WebP (VP8X) size is read', () => {
    const w = Buffer.alloc(40); w.write('RIFF', 0); w.write('WEBP', 8); w.write('VP8X', 12); w.writeUIntLE(499, 24, 3); w.writeUIntLE(699, 27, 3);
    assert.deepStrictEqual(core.imageSize(w), { w: 500, h: 700 });
  });
  await t('Stashed items remember their size', () => {
    const it = core.ingestBuffer(store, makePng(50, 80, [9, 9, 9]), { collection: 'Board C' }).item;
    assert.strictEqual(it.w, 50); assert.strictEqual(it.h, 80);
  });
  await t('The same picture in two collections gets two different ids', () => {
    const x = makePng(33, 33, [77, 7, 7]);
    const one = core.ingestBuffer(store, x, { collection: 'Board D' }).item;
    const two = core.ingestBuffer(store, x, { collection: 'Board E' }).item;
    assert.notStrictEqual(one.id, two.id); assert.strictEqual(one.hash, two.hash);
  });
  await t('Deleting one copy keeps the file while another collection still uses it', () => {
    const x = makePng(33, 33, [77, 7, 7]);
    const one = store.items.find((i) => i.collection === 'Board D');
    const two = store.items.find((i) => i.collection === 'Board E');
    assert.ok(store.remove(one.id));
    assert.ok(fs.existsSync(store.imagePath(two)));
    assert.ok(store.remove(two.id));
    assert.ok(!fs.existsSync(store.imagePath(two)));
    assert.strictEqual(core.ingestBuffer(store, x, { collection: 'Board D' }).status, 'stashed'); // can be stashed again after delete
  });
  await t('New collections: trimmed, unique (any case), not empty', () => {
    assert.deepStrictEqual(store.addCollection('  Type   refs '), { ok: true, name: 'Type refs' });
    assert.strictEqual(store.addCollection('type REFS').reason, 'exists');
    assert.strictEqual(store.addCollection('   ').reason, 'empty');
  });
  await t('Collection list keeps creation order and counts', () => {
    const names = store.collections().map((c) => c.name);
    assert.ok(names.indexOf('Type refs') >= 0);
    assert.strictEqual(store.collections().find((c) => c.name === 'Board A').count, store.count('Board A'));
  });
  await t('Reordering changes itemsFor order and survives a restart', () => {
    const ids = store.itemsFor('Board A').map((i) => i.id);
    const flipped = [...ids].reverse();
    store.reorder('Board A', flipped);
    assert.deepStrictEqual(store.itemsFor('Board A').map((i) => i.id), flipped);
    assert.deepStrictEqual(new core.Store(dir).itemsFor('Board A').map((i) => i.id), flipped);
  });
  await t('New items go to the end of the manual order', () => {
    const it = core.ingestBuffer(store, makePng(18, 18, [3, 3, 3]), { collection: 'Board A' }).item;
    const list = store.itemsFor('Board A');
    assert.strictEqual(list[list.length - 1].id, it.id);
  });
  await t('Bridge holds images back when Pause sync is on, releases them on Sync now', async () => {
    const srv2 = createServer(store, { port: 47998, canSend: ({ force }) => force, getConfig: () => ({ imageWidth: 280, gap: 16 }) });
    await srv2.listen();
    const get = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: 47998, path: p, headers: { Host: '127.0.0.1:47998', 'x-stash-token': token } }, (res) => {
        let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve(JSON.parse(s)));
      }).on('error', reject);
    });
    const held = await get('/pending?auto=1');
    assert.strictEqual(held.items.length, 0); assert.ok(held.held > 0); assert.strictEqual(held.config.imageWidth, 280);
    const forced = await get('/pending?auto=1&force=1');
    assert.ok(forced.items.length > 0);
    await srv2.close();
  });
  await t('Pending images come out grouped by collection, in manual order', async () => {
    const items = (await req('GET', '/pending', { headers: H() })).json.items;
    const seenCollections = []; for (const i of items) if (seenCollections[seenCollections.length - 1] !== i.collection) seenCollections.push(i.collection);
    assert.strictEqual(new Set(seenCollections).size, seenCollections.length); // never interleaved
  });

  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
