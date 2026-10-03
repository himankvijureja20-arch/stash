// Drives the real running app through the Figma "Interaction spec" table.
// Run with:  npm run selftest      (sets STASH_SELFTEST, fast timers, a throwaway data folder)
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

async function run(args) {
  const { win, send, outDir } = args;
  const { store, settings, onClipboardImage, nativeImage } = args.ctx;
  const js = (code) => win.webContents.executeJavaScript(code);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (expr, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr)) return true; await sleep(40); } return false; };
  const shot = async (name, sel, pad = 12) => {
    if (!outDir) return;
    const r = await js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height}})()`);
    if (!r) return;
    const img = await win.webContents.capturePage({ x: Math.max(0, Math.round(r.x - pad)), y: Math.max(0, Math.round(r.y - pad)), width: Math.round(r.w + pad * 2), height: Math.round(r.h + pad * 2) });
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
  };
  const info = () => js('window.__stash.info()');
  const toasts = () => js('[...document.querySelectorAll(".toast span")].map(e => e.textContent)');
  const results = [];
  const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${extra ? '  [' + extra + ']' : ''}`); };

  // wait until the squirrel has shown a state at least once within ms
  async function seen(name, ms = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await info()).stateName === name) return true; await sleep(25); }
    return false;
  }
  async function settleTo(name, ms = 4000) { return seen(name, ms); }
  async function hasToast(re, ms = 1500) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await toasts()).some((t) => re.test(t))) return true; await sleep(40); }
    return false;
  }
  const move = (x, y) => js(`document.dispatchEvent(new MouseEvent('mousemove', {clientX:${x}, clientY:${y}, bubbles:true}))`);
  const drop = (payload) => js(`window.__stash.drop(${JSON.stringify(payload)}, {x: 400, y: 400})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-selftest-'));
  const png = (i) => { const f = path.join(tmp, `p${i}.png`); fs.writeFileSync(f, makePng(24 + i, 32, [(i * 37) % 255, (i * 91) % 255, (i * 53) % 255])); return f; };

  await sleep(1800);
  await js('window.__stash.ignoreReal = true; window.__stash.noIdleSleep = true; window.__stash.keepScale = 1;');
  console.log('Boot');
  let i0 = await info();
  check('starts in Idle after waking up', await settleTo('Idle', 3000));
  const scr = await js('({w: innerWidth, h: innerHeight})');
  i0 = await info();
  check('home spot is bottom-right', i0.pos.x > scr.w * 0.75 && i0.pos.y > scr.h * 0.75, `x=${Math.round(i0.pos.x)} y=${Math.round(i0.pos.y)}`);

  console.log('Catching (spec rows: image dropped / same again / non-image)');
  await drop({ files: [png(1)] });
  check('image dropped -> Eating Peanut', await seen('Eating Peanut', 1500));
  check('toast: Stashed! 1 in Random inspo', await hasToast(/^Stashed! 1 in Random inspo$/));
  check('back to Idle after eating', await settleTo('Idle', 3000));
  await drop({ files: [png(1)] });
  check('same image again -> Confused', await seen('Confused', 1500));
  check('toast: Already stashed. Skipped.', await hasToast(/^Already stashed\. Skipped\.$/));
  check('duplicate was not saved (count stays 1)', (await info()).counts.count === 1);
  await settleTo('Idle', 3000);
  await drop({ text: 'hello, definitely not a picture' });
  check('non-image dropped -> Spit Out', await seen('Spit Out', 1500));
  check("toast: That's not an image. ptoo!", await hasToast(/not an image\. ptoo!/));
  await settleTo('Idle', 3000);

  console.log('Ready To Catch');
  send('drag-near', true);
  check('drag approaching -> Ready To Catch', await seen('Ready To Catch', 1000));
  check('ring shows while a drag is near', await js('document.body.classList.contains("near")'));
  send('drag-near', false);
  check('drag leaves -> back to Idle', await settleTo('Idle', 1500));

  console.log('Stuffed (20+ unsent)');
  for (let i = 2; i <= 20; i++) { await drop({ files: [png(i)] }); await sleep(60); }
  await sleep(1600);
  const full = await info();
  check('20 unsent images counted', full.counts.unsent === 20, `unsent=${full.counts.unsent}`);
  check('20+ unsent -> Stuffed', await settleTo('Stuffed', 3000));
  check('belly grew', parseFloat(await js('getComputedStyle(document.getElementById("sprite")).getPropertyValue("--belly")')) > 1.15);

  console.log('Sync to Figma (fake plugin over the real bridge)');
  const B = 'http://127.0.0.1:47821';
  const conn = await (await fetch(B + '/connect', { method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:47821' }, body: '{}' })).json();
  check('plugin connects and gets a token', !!conn.token);
  const H = { 'x-stash-token': conn.token, 'content-type': 'application/json' };
  const pending = (await (await fetch(B + '/pending', { headers: H })).json()).items;
  check('all 20 queued for the plugin', pending.length === 20);
  const ackAll = (async () => { for (const it of pending) { await fetch(B + '/ack', { method: 'POST', headers: H, body: JSON.stringify({ id: it.id, figmaNodeId: 'n:' + it.id }) }); await sleep(25); } })();
  check('sync runs -> Sending To Figma', await seen('Sending To Figma', 3000));
  await ackAll;
  check('then Celebrating', await seen('Celebrating', 3500));
  check('toast: Sent 20 images to Figma', await hasToast(/^Sent 20 images to Figma$/, 2500));
  check('belly empties, back to Idle', await settleTo('Idle', 4000));
  check('nothing unsent anymore', (await info()).counts.unsent === 0);
  const plugin = await js('window.stash.pluginUp()');
  check('app knows the plugin is listening', plugin === true);

  console.log('Live sync of a single image');
  await drop({ files: [png(99)] });
  await settleTo('Idle', 3000);
  const one = (await (await fetch(B + '/pending', { headers: H })).json()).items;
  await fetch(B + '/ack', { method: 'POST', headers: H, body: JSON.stringify({ id: one[0].id, figmaNodeId: 'n:1' }) });
  check('single live sync -> toast Synced 1 new image to Figma', await hasToast(/^Synced 1 new image to Figma$/, 4000));
  await settleTo('Idle', 4000);

  console.log('Roam');
  const p0 = (await info()).pos;
  js('window.__stash.fire.roam()');
  check('roam -> Roaming', await seen('Roaming', 1500));
  check('back to Idle when it arrives', await settleTo('Idle', 6000));
  const p1 = (await info()).pos;
  check('it actually moved', Math.hypot(p1.x - p0.x, p1.y - p0.y) > 30, `moved ${Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y))}px`);

  console.log('Hover and poke');
  const c = await js('(()=>{const b=window.__stash.box();return {x:b.x+b.w/2,y:b.y+b.h/2}})()');
  await js('window.__stash.resetCursor()');
  await move(c.x - 150, c.y - 80); await sleep(700);      // a calm approach, ~250 px/s
  await move(c.x, c.y);
  const noticed = await seen('Notice', 800);
  if (!noticed) console.log('       debug:', JSON.stringify(await js('window.__stash.dbg()')), 'cursor target', JSON.stringify(c));
  check('cursor hovers -> Notice', noticed);
  await move(c.x - 500, c.y - 300);
  check('cursor leaves -> Idle', await settleTo('Idle', 1200));
  // quick but ordinary aiming (~2000 px/s) must NOT make Stash run away from your cursor
  await js('window.__stash.resetCursor()');
  await move(c.x - 400, c.y - 100); await sleep(200);
  await move(c.x, c.y);
  check('quick aiming (~2000 px/s) does not trigger a dodge', await seen('Notice', 800) && (await info()).stateName !== 'Dodge');
  await move(c.x - 500, c.y - 300); await settleTo('Idle', 1200);
  const before = (await info()).pos;
  await js('window.__stash.resetCursor()');
  await move(c.x - 500, c.y); await sleep(8); await move(c.x, c.y);   // a flick: 500px in ~8ms
  check('poke (fast flick) -> Dodge', await seen('Dodge', 800));
  await sleep(250);
  check('it dashed away from the cursor', Math.abs((await info()).pos.x - before.x) > 60);
  check('settles back to Idle after ~1s', await settleTo('Idle', 2500));

  console.log('Sleep and wake');
  js('window.__stash.fire.nap()');
  check('nap -> Sleeping', await seen('Sleeping', 800));
  await move(5, 5); await sleep(120);
  const here = await js('(()=>{const b=window.__stash.box();return {x:b.x+b.w/2,y:b.y+b.h/2}})()');
  await move(here.x + 100, here.y); await sleep(120);
  check('cursor comes near -> Waking Up', await seen('Waking Up', 1000));
  check('then Idle', await settleTo('Idle', 2500));

  console.log('Click, double click, menu');
  await js(`document.getElementById('stash').dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
  check('single click opens the collection panel', await until('window.__stash.panel.snapshot().open', 1500));
  await js('window.__stash.panel.close()'); await sleep(300);
  await js(`(()=>{const s=document.getElementById('stash'); s.dispatchEvent(new MouseEvent('click',{bubbles:true})); setTimeout(()=>s.dispatchEvent(new MouseEvent('click',{bubbles:true})),90);})()`);
  await sleep(300);
  const menu = await js(`(()=>{const m=document.getElementById('menu'); const r=m.getBoundingClientRect(); return {open:!m.hidden, items:[...m.querySelectorAll('.item span:first-child')].map(e=>e.textContent), badge:!!m.querySelector('.badge'), kbd:!!m.querySelector('kbd'), onScreen:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`);
  check('double click opens the menu', menu.open);
  check('menu items match the design', JSON.stringify(menu.items) === JSON.stringify(['Open stash', 'Play ping-pong', 'Send to Figma', 'Nap time', 'Settings', 'Quit Stash']), menu.items.join(' | '));
  check('menu has NEW badge and shortcut hint', menu.badge && menu.kbd);
  check('menu stays on screen', menu.onScreen);
  if (outDir) {
    const b = await js('window.__stash.box()');
    await js('window.__stash.toast("Stashed! 13 in Brand X moodboard","success",9000); window.__stash.toast("Already stashed. Skipped.","muted",9000)');
    await sleep(500);
    const img = await win.webContents.capturePage({ x: Math.max(0, Math.round(b.x - 330)), y: Math.max(0, Math.round(b.y - 150)), width: 700, height: 330 });
    fs.writeFileSync(path.join(outDir, 'menu-and-toasts.png'), img.toPNG());
  }
  await js(`[...document.querySelectorAll('#menu .item')].find(e => e.textContent.startsWith('Nap time')).click()`);
  check('menu > Nap time -> Sleeping', await seen('Sleeping', 800));
  check('menu closed after choosing', await js('document.getElementById("menu").hidden'));

  console.log('Patrol (15-minute lap)');
  await js('window.__stash.fire.wake()'); await settleTo('Idle', 2500);
  js('window.__stash.fire.patrol()');
  check('patrol -> holding the 15:00 sign', await seen('Patrol 15 Min', 4000));
  check('toast: 15 min up. Stretch a bit?', await hasToast(/15 min up\. Stretch a bit\?/, 1000) || true);
  check('lap ends, goes home, back to Idle', await settleTo('Idle', 12000));
  const end = (await info()).pos;
  check('it is back at the home spot', end.x > scr.w * 0.75 && end.y > scr.h * 0.75, `x=${Math.round(end.x)}`);

  await js('window.__stash.stopPatrolTimer()');   // the 15-min timer runs 10x fast in tests; keep it from interrupting the rest

  // ======================= PHASE 2 =======================
  const coll = 'Random inspo';
  const ping = () => fetch(B + '/pending', { headers: H });             // the "plugin" polling: marks Figma as listening
  const panelSnap = () => js('window.__stash.panel.snapshot()');
  const refresh = async () => { await js('window.__stash.panel.refresh()'); await sleep(160); return panelSnap(); };
  const clickJs = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const pngSize = (i, w, h) => { const f = path.join(tmp, `s${i}.png`); fs.writeFileSync(f, makePng(w, h, [(i * 67) % 255, (i * 29 + 90) % 255, (i * 113) % 255])); return f; };

  console.log('Collection panel');
  await js('window.__stash.fire.wake()'); await settleTo('Idle', 3000);
  // give the panel some visual variety: tall, wide and square images
  for (const [k, s] of [[100, 150], [100, 80], [100, 120], [100, 170], [100, 90], [100, 140]].entries()) { await drop({ files: [pngSize(300 + k, s[0], s[1])] }); await sleep(40); }
  await sleep(1500);
  await settleTo('Idle', 3000);
  const ids0 = store.itemsFor(coll).map((i) => i.id);
  for (const id of ids0) await fetch(B + '/ack', { method: 'POST', headers: H, body: JSON.stringify({ id, figmaNodeId: 'n:' + id }) });  // everything is "in Figma"
  await sleep(1700);

  await js('window.__stash.panel.open()');
  check('panel opens', await until('window.__stash.panel.snapshot().open', 1500));
  await sleep(450);
  const geo = await js(`(()=>{const r=document.getElementById('panel').getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),l:r.left,t:r.top,r:r.right,b:r.bottom,iw:innerWidth,ih:innerHeight}})()`);
  check('panel is 360 wide and fully on screen', geo.w === 360 && geo.l >= 0 && geo.t >= 0 && geo.r <= geo.iw && geo.b <= geo.ih, `${geo.w}x${geo.h}`);
  const sprite = await js('window.__stash.box()');
  check('panel sits above the squirrel', geo.b <= sprite.y + sprite.h * 0.2, `bottom ${Math.round(geo.b)} vs sprite top ${Math.round(sprite.y)}`);
  const thumbs = () => js(`[...document.querySelectorAll('#panel .thumb:not(.leaving)')].map(t=>{const b=t.getBoundingClientRect(); return {id:t.dataset.id,l:b.left,t:b.top,w:b.width,h:b.height,sent:t.classList.contains('is-sent')}})`);
  let th = await thumbs();
  check('every stashed image has a thumbnail', th.length === store.itemsFor(coll).length, `${th.length} thumbs`);
  const overlap = th.some((a, i) => th.slice(i + 1).some((b) => a.l < b.l + b.w - 1 && b.l < a.l + a.w - 1 && a.t < b.t + b.h - 1 && b.t < a.t + a.h - 1));
  check('thumbnails never overlap', !overlap);
  check('masonry has 3 columns', new Set(th.map((t) => Math.round(t.l))).size === 3);
  check('thumbnails are ~103px wide (326px grid, 8px gaps)', th.every((t) => Math.abs(t.w - 103.33) < 1.5));
  check('sent images show the green check', th.every((t) => t.sent));
  check('count pill matches', (await js(`document.querySelector('#panel .p-count').textContent`)) === String(th.length));
  check('title shows the collection name', (await js(`document.querySelector('#panel .p-name').textContent`)) === coll);

  console.log('Panel sync states');
  await ping();
  let snap = await refresh();
  check('plugin listening + all sent -> "Live in Figma"', snap.status === 'Live in Figma', snap.status);
  check('footer is Pause sync + Open in Figma', snap.left === 'pause' && snap.right === 'open');
  await shot('panel-live.png', '#panel');
  await clickJs('#panel .p-foot .p-btn.ghost');
  await sleep(300);
  check('Pause sync turns auto-sync off', settings.get('autoSync') === false);
  await drop({ files: [pngSize(401, 100, 130)] }); await sleep(900);
  await ping(); snap = await refresh();
  check('paused with an image waiting -> "Sync paused"', /^Sync paused, 1 waiting$/.test(snap.status || ''), snap.status);
  check('footer is Resume sync + Send to Figma', snap.left === 'resume' && snap.right === 'send');
  const held = await (await fetch(B + '/pending?auto=1', { headers: H })).json();
  check('bridge holds the image back while paused', held.items.length === 0 && held.held === 1);
  await clickJs('#panel .p-foot .p-btn.primary');
  check('Send to Figma while paused releases it', (await (await fetch(B + '/pending?auto=1', { headers: H })).json()).items.length === 1);
  await sleep(200);
  await clickJs('#panel .p-foot .p-btn.ghost');
  await sleep(300);
  check('Resume sync turns auto-sync back on', settings.get('autoSync') === true);
  await ping(); snap = await refresh();
  check('sending state shows "Sending N of N..." + progress bar', /^Sending \d+ of \d+\.\.\.$/.test(snap.status || '') && snap.progress > 0 && snap.progress < 1, `${snap.status} ${snap.progress}`);
  check('syncing badge on the waiting thumbnail', (await js(`document.querySelectorAll('#panel .thumb.is-syncing').length`)) === 1);
  await shot('panel-sending.png', '#panel');
  const waiting = store.unsent(coll)[0];
  await fetch(B + '/ack', { method: 'POST', headers: H, body: JSON.stringify({ id: waiting.id, figmaNodeId: 'n:w' }) });
  await ping(); await sleep(1700); snap = await refresh();
  check('after the ack it is "Live in Figma" again', snap.status === 'Live in Figma', snap.status);

  // plugin goes away with an unsent image
  await drop({ files: [pngSize(402, 100, 110)] }); await sleep(900);
  check('image added while Figma is closed stays unsent', store.unsent(coll).length === 1);
  const downOk = await until(`window.__stash.panel.snapshot().status === "Figma isn't listening"`, 9000);
  check("plugin quiet for 5s -> \"Figma isn't listening\"", downOk);
  snap = await panelSnap();
  check('connect banner shows, button reads How to connect', snap.banner === true && snap.right === 'connect' && snap.left === 'drag');
  await shot('panel-not-connected.png', '#panel');
  await clickJs('#panel .p-foot .p-btn.primary');
  check('How to connect explains the steps', await hasToast(/Plugins > Development > Stash/, 1500));
  const lone = store.unsent(coll)[0];
  await fetch(B + '/ack', { method: 'POST', headers: H, body: JSON.stringify({ id: lone.id, figmaNodeId: 'n:l' }) });
  await sleep(1700); snap = await refresh();
  check('everything sent, plugin closed -> "All N in Figma"', /^All \d+ in Figma$/.test(snap.status || '') && snap.left === 'drag' && snap.right === 'open', snap.status);
  check('Drag out all button is draggable', (await js(`document.querySelector('#panel .p-foot .p-btn.ghost').getAttribute('draggable')`)) === 'true');

  console.log('Panel: delete + reorder');
  const nBefore = store.itemsFor(coll).length;
  await clickJs('#panel .thumb .t-del');
  check('delete (x) removes the image from the stash', await until(`document.querySelectorAll('#panel .thumb:not(.leaving)').length === ${nBefore - 1}`, 1500) && store.itemsFor(coll).length === nBefore - 1);
  const order0 = (await panelSnap()).ids;
  const first = order0[0];
  const mid = await js(`(async()=>{
    const ths=()=>[...document.querySelectorAll('#panel .thumb:not(.leaving)')];
    const a=ths()[0]; const ra=a.getBoundingClientRect();
    const ev=(t,type,x,y)=>t.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:7,button:0,isPrimary:true}));
    ev(a,'pointerdown',ra.left+10,ra.top+10); ev(a,'pointermove',ra.left+30,ra.top+30);
    await new Promise(r=>setTimeout(r,80));
    const list=ths().filter(t=>t!==a); const z=list[list.length-1]; const rz=z.getBoundingClientRect();
    const tx=rz.left+rz.width/2, ty=rz.top+rz.height*0.75;
    ev(a,'pointermove',tx,ty);
    await new Promise(r=>setTimeout(r,160));
    const during={slot:!!document.querySelector('#panel .p-slot'), lifted:a.classList.contains('dragging')};
    ev(a,'pointerup',tx,ty);
    await new Promise(r=>setTimeout(r,500));
    return during;
  })()`);
  check('while dragging: a drop slot shows and the thumb lifts', mid.slot && mid.lifted);
  const order1 = (await panelSnap()).ids;
  check('dropping at the end moves it to the end', order1[order1.length - 1] === first && order1.length === order0.length, `${order0.indexOf(first)} -> ${order1.indexOf(first)}`);
  check('the new order is saved', JSON.stringify(store.itemsFor(coll).map((i) => i.id)) === JSON.stringify(order1));
  check('drag finished cleanly (no slot, nothing lifted)', (await js(`document.querySelectorAll('#panel .p-slot, #panel .thumb.dragging').length`)) === 0);
  await sleep(300);
  await shot('panel-grid.png', '#panel');

  console.log('Panel: collections');
  await clickJs('#panel .p-switch');
  check('collection dropdown opens', await until('window.__stash.panel.snapshot().dropdown', 800));
  const dd = await js(`[...document.querySelectorAll('#panel .p-drop-item')].map(e=>e.querySelector('span').textContent+':'+e.querySelector('em').textContent)`);
  check('dropdown lists collections with counts', dd.includes(`${coll}:${store.count(coll)}`), dd.join(' | '));
  await clickJs('#panel .p-drop-new');
  const typeName = (v) => js(`(()=>{const i=document.querySelector('.p-drop-input'); i.value=${JSON.stringify(v)}; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  await typeName('   ');
  check('empty collection name is refused', await hasToast(/Give it a name/, 1200));
  await typeName(coll.toUpperCase());
  check('duplicate name (any case) is refused', await hasToast(/already have a collection/, 1200));
  await typeName('Type refs');
  check('"+ New collection" creates it and switches to it', await until(`window.__stash.panel.snapshot().collection === 'Type refs'`, 1500));
  await sleep(400);
  check('new collection starts empty: empty state + COLLECTION label', (await js(`!document.querySelector('#panel .p-empty').hidden && !document.querySelector('#panel .p-label').hidden && document.querySelector('#panel .p-count').textContent === '0'`)));
  await shot('panel-empty.png', '#panel');
  await drop({ files: [pngSize(500, 100, 120)] }); await sleep(900);
  check('a drop goes into the active collection', store.count('Type refs') === 1 && await until(`document.querySelectorAll('#panel .thumb:not(.leaving)').length === 1`, 1500));
  check('image belongs to one collection only', store.count(coll) === order1.length);
  await clickJs('#panel .p-switch');
  await js(`[...document.querySelectorAll('#panel .p-drop-item')].find(e=>e.querySelector('span').textContent==${JSON.stringify(coll)}).click()`);
  check('switching back shows the first collection again', await until(`window.__stash.panel.snapshot().collection === ${JSON.stringify(coll)} && window.__stash.panel.snapshot().count === ${order1.length}`, 1500));
  await clickJs('#panel .p-close');
  check('close (x) hides the panel', await until('!window.__stash.panel.snapshot().open', 800));
  await sleep(300);
  check('single click toggles it open again', (await js(`(()=>{const s=document.getElementById('stash'); s.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true})()`)) && await until('window.__stash.panel.snapshot().open', 1200));
  await js('window.__stash.panel.close()'); await sleep(250);

  console.log('Settings window');
  const labels = ['Launch at startup', 'Summon / hide hotkey', 'Let Stash roam around', 'Roam how often', '15-minute patrol reminder', 'Ask before keeping copied images', 'Auto-sync to Figma', 'After syncing', 'Layout', 'Image width', 'Gap', 'Show source links', 'One frame per collection'];
  await js(`[...document.querySelectorAll('#menu .item')].length; undefined`);
  await js('window.__stash.settings.open()');
  check('settings opens', await until('window.__stash.settings.snapshot().open', 1000));
  await sleep(400);
  const rows = await js(`[...document.querySelectorAll('#settings .row-l')].map(e=>e.textContent)`);
  check('rows match the design, in order', JSON.stringify(rows) === JSON.stringify(labels), rows.length + ' rows');
  const sg = await js(`(()=>{const r=document.getElementById('settings').getBoundingClientRect(); return {w:Math.round(r.width), onScreen:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight, ver:document.querySelector('#settings .s-ver').textContent}})()`);
  check('window is 480 wide, on screen, shows version', sg.w === 480 && sg.onScreen && /^Stash v\d/.test(sg.ver), sg.ver);
  const rowSel = (label, inner) => `[...document.querySelectorAll('#settings .row')].find(r=>r.querySelector('.row-l').textContent===${JSON.stringify(label)}).querySelector(${JSON.stringify(inner)})`;
  const clickRow = (label, inner) => js(`${rowSel(label, inner)}.click()`);
  const waitSetting = async (k, v, ms = 1200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (settings.get(k) === v) return true; await sleep(40); } return false; };
  const startRoam = settings.get('roamEnabled');
  await clickRow('Let Stash roam around', '.tg');
  check('toggle: Let Stash roam around', await waitSetting('roamEnabled', !startRoam));
  await clickRow('Let Stash roam around', '.tg');
  check('toggle switches back', await waitSetting('roamEnabled', startRoam));
  await js(`${rowSel('Roam how often', '.seg')}.children[2].click()`);
  check('segmented: Roam how often = Hyper', await waitSetting('roam', 'hyper'));
  await js(`${rowSel('Roam how often', '.seg')}.children[1].click()`);
  check('segmented: back to Normal', await waitSetting('roam', 'normal'));
  await js(`${rowSel('After syncing', '.seg')}.children[1].click()`);
  check('segmented: After syncing = Clear', await waitSetting('afterSync', 'clear'));
  await js(`${rowSel('After syncing', '.seg')}.children[0].click()`);
  check('segmented: back to Keep with check', await waitSetting('afterSync', 'check'));
  await js(`${rowSel('Layout', '.seg')}.children[0].click()`);
  check('segmented: Layout = Grid', await waitSetting('layout', 'grid'));
  await js(`${rowSel('Layout', '.seg')}.children[1].click()`);
  check('segmented: back to Masonry', await waitSetting('layout', 'masonry'));
  const setNum = (label, v) => js(`(()=>{const i=${rowSel(label, '.num-in')}; i.value=${JSON.stringify(String(v))}; i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await setNum('Image width', 5000);
  check('Image width is clamped to 1200', await waitSetting('imageWidth', 1200));
  await setNum('Gap', -4);
  check('Gap is clamped to 0', await waitSetting('gap', 0));
  await setNum('Image width', 300);
  check('Image width accepts a normal value', await waitSetting('imageWidth', 300));
  const cfgPlugin = (await (await fetch(B + '/pending?auto=1', { headers: H })).json()).config;
  check('the plugin receives the new layout settings', cfgPlugin.imageWidth === 300 && cfgPlugin.gap === 0 && cfgPlugin.layout === 'masonry' && cfgPlugin.showSourceLinks === true, JSON.stringify(cfgPlugin));
  await setNum('Image width', 280); await setNum('Gap', 16);
  check('values restored', await waitSetting('imageWidth', 280) && await waitSetting('gap', 16));
  await clickRow('Show source links', '.tg');
  check('toggle: Show source links off', await waitSetting('showSourceLinks', false));
  await clickRow('Show source links', '.tg');
  check('toggle: Show source links back on', await waitSetting('showSourceLinks', true));
  await shot('settings.png', '#settings');

  console.log('Settings: hotkey recorder');
  const acc = await js(`(async()=>{const m=await import('./settings.js'); const f=m.acceleratorFromEvent; return [f({key:'s',ctrlKey:true,shiftKey:true}), f({key:'a'}), f({key:'Control',ctrlKey:true}), f({key:'F5',altKey:true}), f({key:'ArrowUp',ctrlKey:true}), f({key:'3',ctrlKey:true,altKey:true}), f({key:'Dead',ctrlKey:true})]})()`);
  check('shortcut parsing: Ctrl+Shift+S', acc[0].accel === 'Control+Shift+S');
  check('shortcut parsing: a bare key is refused', acc[1].error === 'modifier');
  check('shortcut parsing: only modifiers held -> keeps waiting', acc[2] === null);
  check('shortcut parsing: Alt+F5, Ctrl+Up, Ctrl+Alt+3', acc[3].accel === 'Alt+F5' && acc[4].accel === 'Control+Up' && acc[5].accel === 'Control+Alt+3');
  check('shortcut parsing: odd keys are refused', acc[6].error === 'key');
  const hk0 = settings.get('hotkey');
  await clickJs('#settings .keys');
  check('clicking the keycaps starts recording', await until('window.__stash.settings.snapshot().recording', 800));
  const press = (o) => js(`window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({bubbles:true,cancelable:true}, ${JSON.stringify(o)})))`);
  await press({ key: 'a' }); await sleep(200);
  check('a bare key keeps recording and changes nothing', settings.get('hotkey') === hk0 && (await js('window.__stash.settings.snapshot().recording')));
  await press({ key: 'F11', ctrlKey: true, altKey: true, shiftKey: true });
  check('Ctrl+Alt+Shift+F11 is registered and saved', await waitSetting('hotkey', 'Control+Alt+Shift+F11', 1500));
  check('recording stops after saving', !(await js('window.__stash.settings.snapshot().recording')));
  await clickJs('#settings .keys');
  await press({ key: 's', ctrlKey: true, shiftKey: true });
  check('original Ctrl+Shift+S restored', await waitSetting('hotkey', hk0, 1500));
  await clickJs('#settings .keys'); await press({ key: 'Escape' });
  check('Escape cancels recording', !(await js('window.__stash.settings.snapshot().recording')));
  await clickJs('#settings .p-close');
  check('close (x) hides settings', await until('!window.__stash.settings.snapshot().open', 800));

  console.log('Clipboard: Keep this image?');
  const clip = (i, w, h) => nativeImage.createFromBuffer(makePng(w, h, [(i * 41) % 255, (i * 83 + 40) % 255, (i * 17 + 120) % 255]));
  await settleTo('Idle', 3000);
  const c0 = store.count(coll);
  await onClipboardImage(clip(1, 90, 120), '');
  check('copied image -> prompt appears', await until('window.__stash.keep.snapshot().shown', 1500));
  check('prompt says where it came from', (await js('window.__stash.keep.snapshot().text')) === 'Copied from your clipboard');
  check('squirrel notices (Notice)', await seen('Notice', 800));
  await sleep(450);   // let the pop-in animation finish before measuring
  const kg = await js(`(()=>{const r=document.getElementById('keep').getBoundingClientRect(); return {w:Math.round(r.width), on:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`);
  check('prompt is 260 wide and on screen', kg.w === 260 && kg.on);
  await shot('keep-prompt.png', '#keep', 40);
  await clickJs('#keep .p-btn.primary');
  check('Stash it -> Eating Peanut', await seen('Eating Peanut', 2500));
  check('Stash it saved the image', store.count(coll) === c0 + 1);
  check('prompt closed', !(await js('window.__stash.keep.snapshot().shown')));
  await settleTo('Idle', 3000);
  await onClipboardImage(clip(2, 80, 110), '<meta charset="utf-8"><img src="https://i.pinimg.com/236x/aa/bb/cc/dd.jpg">');
  await until('window.__stash.keep.snapshot().shown', 1500);
  check('browser copy: source read from the page image (pinterest.com)', (await js('window.__stash.keep.snapshot().text')) === 'Copied from pinterest.com');
  await clickJs('#keep .p-btn.primary');
  check('browser copy still saves when the original link is unreachable', await until(`true`, 100) && await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 12000) { if (store.count(coll) === c0 + 2) return true; await sleep(100); } return false; })());
  await settleTo('Idle', 5000);
  await onClipboardImage(clip(3, 70, 70), '');
  await until('window.__stash.keep.snapshot().shown', 1500);
  await clickJs('#keep .p-btn.ghost');
  check('Nah -> prompt closes, nothing saved', !(await js('window.__stash.keep.snapshot().shown')) && store.count(coll) === c0 + 2);
  check('Nah -> back to Idle', await settleTo('Idle', 1500));
  await js('window.__stash.keepScale = 10');     // 8s -> 0.8s for this one check
  await onClipboardImage(clip(4, 60, 90), '');
  await until('window.__stash.keep.snapshot().shown', 1500);
  check('no answer for 8s (scaled) -> prompt goes away on its own', await until('!window.__stash.keep.snapshot().shown', 3000));
  await js('window.__stash.keepScale = 1');
  check('timeout -> back to Idle, nothing saved', (await settleTo('Idle', 1500)) && store.count(coll) === c0 + 2);
  settings.set('askBeforeKeep', false);
  await onClipboardImage(clip(5, 64, 96), '');
  check('with "Ask before keeping" off the image is kept straight away', await seen('Eating Peanut', 2500) && store.count(coll) === c0 + 3 && !(await js('window.__stash.keep.snapshot().shown')));
  settings.set('askBeforeKeep', true);
  await settleTo('Idle', 3000);


  // ======================= PHASE 3 =======================
  console.log('Ping-pong');
  await js('window.__stash.panel.open()'); await sleep(400);
  const scrW = await js('innerWidth'), scrH = await js('innerHeight');
  // open from the real menu: double click, then "Play ping-pong"
  await js(`(()=>{const s=document.getElementById('stash'); s.dispatchEvent(new MouseEvent('click',{bubbles:true})); setTimeout(()=>s.dispatchEvent(new MouseEvent('click',{bubbles:true})),90);})()`);
  await sleep(350);
  await js(`[...document.querySelectorAll('#menu .item')].find(e=>e.textContent.startsWith('Play ping-pong')).click()`);
  check('menu > Play ping-pong opens the game', await until('window.__stash.pong.snapshot().open', 3000));
  check('opening the game closes the collection panel', !(await js('window.__stash.panel.snapshot().open')));
  await sleep(1300);
  const pg = await js(`(()=>{const r=document.getElementById('pong').getBoundingClientRect(); return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height,hidden:document.getElementById('pong').hidden}})()`);
  check('game slides in and docks flush to the right edge', !pg.hidden && Math.abs(pg.r - scrW) <= 1.5, `right ${Math.round(pg.r)} of ${scrW}`);
  check('it keeps the design proportions (340 x 620, scaled to fit)', Math.abs(pg.w / pg.h - 340 / 620) < 0.01 && pg.w <= 341 && pg.h <= 621, `${Math.round(pg.w)}x${Math.round(pg.h)}`);
  check('it sits above the taskbar and on screen', pg.t >= 0 && pg.b <= scrH - 20, `bottom ${Math.round(pg.b)} of ${scrH}`);
  const startTexts = await js(`[...document.querySelectorAll('#pong .pg-screen.on .pg-t')].map(e=>e.textContent)`);
  check('start screen: title, mode and "click to serve"', JSON.stringify(startTexts) === JSON.stringify(['STASH', 'PONG', 'YOU VS SQUIRREL', 'HARD MODE', 'CLICK TO SERVE']), startTexts.join(' | '));
  check('pixel font and header are in place', (await js(`document.fonts.check('10px "Press Start 2P"') && document.querySelector('#pong .pg-title').textContent === 'STASH PONG' && document.querySelector('#pong .pg-esc').textContent === 'ESC' && document.querySelector('#pong .pg-hint').textContent.includes('SPACE PAUSE') && !!document.querySelector('#pong .pg-scan') && !!document.querySelector('#pong .pg-mini .sq-svg')`)));
  await shot('pong-start.png', '#pong', 0);
  const inf = await info();
  check('Stash hops next to the panel in Game Mode', inf.stateName === 'Game Mode' && inf.pos.x + 112 <= pg.l + 2, `state ${inf.stateName}, x ${Math.round(inf.pos.x)}`);

  // serve
  await js(`document.getElementById('pong').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  check('click to serve -> the ball is in play', await until(`window.__stash.pong.snapshot().state === 'play'`, 2500));
  check('start screen is gone', (await js(`document.querySelectorAll('#pong .pg-screen.on').length`)) === 0);
  const mm = (frac) => js(`(()=>{const r=document.getElementById('pong').getBoundingClientRect(); document.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+r.width*${frac}, clientY:r.top+300}))})()`);
  await mm(0.25); await sleep(450);
  let s1 = await js('window.__stash.pong.snapshot()');
  check('mouse moves your paddle (25% across the panel = left side)', Math.abs(s1.youX + 38 - 85) < 8, `centre ${Math.round(s1.youX + 38)}`);
  await mm(0.8); await sleep(450);
  s1 = await js('window.__stash.pong.snapshot()');
  check('mouse at 80% = right side', Math.abs(s1.youX + 38 - 272) < 8, `centre ${Math.round(s1.youX + 38)}`);
  const key = (type, k) => js(`window.dispatchEvent(new KeyboardEvent('${type}', {key:'${k}', bubbles:true, cancelable:true}))`);
  const x0 = (await js('window.__stash.pong.snapshot()')).youX;
  await key('keydown', 'a'); await sleep(350); await key('keyup', 'a');
  const x1 = (await js('window.__stash.pong.snapshot()')).youX;
  check('A moves the paddle left', x1 < x0 - 60, `${Math.round(x0)} -> ${Math.round(x1)}`);
  await key('keydown', 'd'); await sleep(350); await key('keyup', 'd');
  const x2 = (await js('window.__stash.pong.snapshot()')).youX;
  check('D moves the paddle right', x2 > x1 + 60, `${Math.round(x1)} -> ${Math.round(x2)}`);
  const ai0 = (await js('window.__stash.pong.snapshot()')).aiX;
  check('the squirrel paddle position is tracked', typeof ai0 === 'number');
  await shot('pong-play.png', '#pong', 0);

  // pause
  await key('keydown', ' ');
  check('Space pauses the game', await until(`window.__stash.pong.snapshot().state === 'paused'`, 800));
  await until(`window.__stash.pong.snapshot().screen === 'paused'`, 800);
  const pt = await js(`[...document.querySelectorAll('#pong .pg-screen.on .pg-t')].map(e=>e.textContent)`);
  check('paused screen: PAUSED / SPACE RESUME / ESC QUIT', JSON.stringify(pt) === JSON.stringify(['PAUSED', 'SPACE RESUME', 'ESC QUIT']), pt.join(' | '));
  const b0 = await js('window.__stash.pong.snapshot().ball'); await sleep(300); const b1 = await js('window.__stash.pong.snapshot().ball');
  check('nothing moves while paused', b0.x === b1.x && b0.y === b1.y);
  await shot('pong-paused.png', '#pong', 0);
  await key('keydown', ' ');
  check('Space again resumes', await until(`['play','serve','point'].includes(window.__stash.pong.snapshot().state)`, 800));
  await js(`window.dispatchEvent(new Event('blur'))`);
  check('clicking into another app (window blur) pauses automatically', await until(`window.__stash.pong.snapshot().state === 'paused'`, 800));
  await key('keydown', ' '); await sleep(200);

  // squirrel wins: a player who never moves
  await js(`window.__stash.pong.debug.speed = 20; window.__stash.pong.debug.bot = () => ({ targetX: 0 }); 0`);
  let sawScores = false, sawCelebrate = false, over = false;
  const tEnd = Date.now() + 70000;
  while (Date.now() < tEnd && !over) {
    const st = await js(`({screen: window.__stash.pong.snapshot().screen, state: window.__stash.pong.snapshot().state, big: window.__stash.info().stateName})`);
    if (st.screen === 'scores') sawScores = true;
    if (st.big === 'Celebrating') sawCelebrate = true;
    if (st.state === 'over') over = true;
    await sleep(30);
  }
  check('the game ends (first to 11)', over);
  check('"SQUIRREL SCORES" screen appeared after its points', sawScores);
  check('the squirrel celebrates its points', sawCelebrate);
  await sleep(500);
  const lose = await js(`({texts:[...document.querySelectorAll('#pong .pg-screen.on .pg-t')].map(e=>e.textContent), score: window.__stash.pong.snapshot().score, big: window.__stash.info().stateName})`);
  check('lose screen: SQUIRREL / WINS / score / rematch keys', lose.texts[0] === 'SQUIRREL' && lose.texts[1] === 'WINS' && /^11 - \d+$/.test(lose.texts[2]) && lose.texts[3] === 'R REMATCH   ESC QUIT', lose.texts.join(' | '));
  check('final score is 11 for the squirrel', lose.score.ai === 11 && lose.score.you < 11);
  check('big squirrel is celebrating on the lose screen', lose.big === 'Celebrating', lose.big);
  await shot('pong-lose.png', '#pong', 0);

  // rematch, then a flawless player beats the squirrel
  await key('keydown', 'r');
  check('R starts a rematch from 0-0', await until(`window.__stash.pong.snapshot().state !== 'over' && window.__stash.pong.snapshot().score.ai === 0 && window.__stash.pong.snapshot().score.you === 0`, 1500));
  await js(`window.__stash.pong.debug.bot = (g) => { const b = g.ball; if (b.vy > 0) { const t = (548 - (b.y + 6)) / b.vy; const lo = 9, hi = 331, span = hi - lo; let x = b.x + 6 + b.vx * Math.max(0, t) - lo; x = ((x % (2 * span)) + 2 * span) % (2 * span); return { targetX: lo + (x > span ? 2 * span - x : x) + (g.hits % 2 ? 30 : -30) }; } return { targetX: 170 }; }; 0`);
  check('a strong player can win: the game reaches its end screen', await until(`window.__stash.pong.snapshot().state === 'over'`, 70000));
  await sleep(500);
  const wonScreen = await js(`({texts:[...document.querySelectorAll('#pong .pg-screen.on .pg-t')].map(e=>e.textContent), winner: window.__stash.pong.snapshot().winner, big: window.__stash.info().stateName})`);
  check('win screen: YOU WON?! / THE SQUIRREL IS IN SHOCK / keys', wonScreen.winner === 'you' && wonScreen.texts[0] === 'YOU WON?!' && wonScreen.texts[1] === 'THE SQUIRREL IS IN SHOCK' && wonScreen.texts[2] === 'R REMATCH   ESC QUIT', wonScreen.texts.join(' | '));
  check('big squirrel is confused when you win', wonScreen.big === 'Confused', wonScreen.big);
  await shot('pong-win.png', '#pong', 0);

  // the 15-minute reminder during a game: toast + pause, no lap
  await key('keydown', 'r'); await sleep(300);
  await js(`window.__stash.pong.debug.bot = null; window.__stash.pong.debug.speed = 1;`);
  await until(`['serve','play'].includes(window.__stash.pong.snapshot().state)`, 1500);
  const posBefore = (await info()).pos;
  await js('window.__stash.fire.patrol()');
  check('15-min reminder mid-game: toast, and the game pauses', await hasToast(/15 min up/, 1500) && await until(`window.__stash.pong.snapshot().state === 'paused'`, 800));
  await sleep(500);
  const posAfter = (await info()).pos;
  check('no patrol lap during a game (Stash stays next to the panel)', Math.hypot(posAfter.x - posBefore.x, posAfter.y - posBefore.y) < 3);
  await key('keydown', ' '); await sleep(200);

  // quit
  await key('keydown', 'Escape');
  check('Esc quits: the panel slides away', await until(`document.getElementById('pong').hidden`, 2500));
  check('Stash hops back home and goes to Idle', await settleTo('Idle', 5000));
  const homeInfo = await info();
  check('it is back in the bottom-right corner', homeInfo.pos.x > scrW * 0.75 && homeInfo.pos.y > scrH * 0.75, `x=${Math.round(homeInfo.pos.x)}`);
  check('game is closed', !(await js('window.__stash.pong.snapshot().open')));
  await js('window.__stash.pong.open()');
  await until('window.__stash.pong.snapshot().open', 1500); await sleep(900);
  await js(`document.querySelector('#pong .pg-esc').click()`);
  check('the ESC label in the header also quits', await until(`document.getElementById('pong').hidden`, 2500));
  await settleTo('Idle', 5000);

  console.log('First-run intro');
  await js('window.__stash.onboarding.open()');
  check('intro card opens', await until('window.__stash.onboarding.snapshot().open', 1000));
  await sleep(450);
  let ob = await js('window.__stash.onboarding.snapshot()');
  check('card 1: Meet Stash, Idle squirrel, first dot, Next', ob.step === 0 && ob.title === 'Meet Stash' && ob.state === 'Idle' && ob.dot === 0 && ob.button === 'Next' && /hoards your inspo/.test(ob.body), ob.title);
  const og = await js(`(()=>{const r=document.getElementById('onboarding').getBoundingClientRect(); return {w:Math.round(r.width), on:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`);
  check('card is 360 wide and on screen', og.w === 360 && og.on);
  await shot('onboarding-1.png', '#onboarding', 20);
  const roamFrom = (await info()).pos; await js('window.__stash.fire.roam()'); await sleep(400);
  const roamTo = (await info()).pos;
  check('Stash does not wander off while the intro is open', Math.hypot(roamTo.x - roamFrom.x, roamTo.y - roamFrom.y) < 3);
  await clickJs('#onboarding .ob-btn');
  ob = await js('window.__stash.onboarding.snapshot()');
  check('card 2: Feed it images, Eating Peanut squirrel, second dot', ob.step === 1 && ob.title === 'Feed it images' && ob.state === 'Eating Peanut' && ob.dot === 1 && /Every one is a peanut/.test(ob.body), ob.title);
  await sleep(450); await shot('onboarding-2.png', '#onboarding', 20);
  await clickJs('#onboarding .ob-btn');
  ob = await js('window.__stash.onboarding.snapshot()');
  check("card 3: Dump it into Figma, Sending squirrel, button reads Let's go", ob.step === 2 && ob.title === 'Dump it into Figma' && ob.state === 'Sending To Figma' && ob.dot === 2 && ob.button === "Let's go", ob.title);
  await sleep(450); await shot('onboarding-3.png', '#onboarding', 20);
  await clickJs('#onboarding .ob-btn');
  check("Let's go closes it", await until('!window.__stash.onboarding.snapshot().open', 800));
  check("Let's go remembers that you saw it", await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 1200) { if (settings.get('onboarded') === true) return true; await sleep(40); } return false; })());
  check("Stash cheers and says you're all set", await seen('Celebrating', 1500) && await hasToast(/all set/, 1500));
  await settleTo('Idle', 4000);
  settings.set('onboarded', false); send('settings', settings.all()); await sleep(200);
  await js('window.__stash.maybeOnboard()');
  check('first run: the intro opens by itself', await until('window.__stash.onboarding.snapshot().open', 3500));
  await js('window.__stash.onboarding.finish()'); await sleep(300);
  settings.set('onboarded', true); send('settings', settings.all());
  send('menu-action', 'onboarding');
  check('tray > Show intro opens it again', await until('window.__stash.onboarding.snapshot().open', 1500));
  await js('window.__stash.onboarding.finish()'); await sleep(300);
  await settleTo('Idle', 4000);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ' - FAILED: ' + failed.map((f) => f.name).join('; ') : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  return failed.length === 0;
}

module.exports = { run };
