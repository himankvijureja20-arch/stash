// Stash plugin, main thread. Places images into a frame on the canvas.
// Layout rules come from Stash's Settings ("Figma export") and arrive with every poll:
//   layout masonry|grid, imageWidth, gap, showSourceLinks, oneFramePerCollection.
// Duplicates are skipped by hash, so nothing is ever placed twice, even after manual drag-outs.
const PAD = 32;
const COLS = 4;
let CFG = { layout: 'masonry', imageWidth: 280, gap: 16, showSourceLinks: true, oneFramePerCollection: true };

figma.showUI(__html__, { width: 320, height: 372, title: 'Stash' });

function post(msg) { figma.ui.postMessage(msg); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function applyConfig(c) {
  if (!c) return;
  CFG = {
    layout: c.layout === 'grid' ? 'grid' : 'masonry',
    imageWidth: clamp(Number(c.imageWidth) || 280, 80, 1200),
    gap: clamp(Number.isFinite(Number(c.gap)) ? Number(c.gap) : 16, 0, 120),
    showSourceLinks: c.showSourceLinks !== false,
    oneFramePerCollection: c.oneFramePerCollection !== false,
  };
}

const frameWidth = () => PAD * 2 + COLS * CFG.imageWidth + (COLS - 1) * CFG.gap;
const frameNameFor = (collection) => (CFG.oneFramePerCollection ? collection : 'Stash');

async function getFrame(name) {
  await figma.currentPage.loadAsync();
  for (const n of figma.currentPage.children) {
    if (n.type === 'FRAME' && n.getPluginData('stashCollection') === name) return n;
  }
  const f = figma.createFrame();
  f.name = name;
  f.setPluginData('stashCollection', name);
  f.fills = [{ type: 'SOLID', color: { r: 1, g: 0.973, b: 0.937 } }]; // ui/bg #FFF8EF
  f.cornerRadius = 22;
  f.clipsContent = false;
  f.resize(frameWidth(), 200);
  const c = figma.viewport.center;
  f.x = Math.round(c.x - frameWidth() / 2);
  f.y = Math.round(c.y - 100);
  figma.currentPage.appendChild(f);
  figma.viewport.scrollAndZoomIntoView([f]);
  return f;
}

const stashChildren = (frame) => frame.children.filter((c) => c.getPluginData('stashHash'));

function findDuplicate(frame, hash) {
  for (const child of frame.children) if (child.getPluginData('stashHash') === hash) return child;
  return null;
}

// Where the next card goes. Works from what is already in the frame, so it survives restarts and manual edits.
function nextSlot(frame) {
  const w = CFG.imageWidth, g = CFG.gap;
  const kids = stashChildren(frame);
  if (CFG.layout === 'grid') {
    const idx = kids.length, col = idx % COLS, row = Math.floor(idx / COLS);
    let y = PAD;
    if (row > 0) {
      y = 0;
      kids.forEach((k, i) => { if (Math.floor(i / COLS) === row - 1) y = Math.max(y, k.y + k.height); });
      y += g;
    }
    return { x: PAD + col * (w + g), y };
  }
  const bottoms = Array(COLS).fill(PAD);
  const used = Array(COLS).fill(false);
  for (const k of kids) {
    const col = clamp(Math.round((k.x - PAD) / (w + g)), 0, COLS - 1);
    bottoms[col] = Math.max(bottoms[col], k.y + k.height);
    used[col] = true;
  }
  let best = 0;
  for (let i = 1; i < COLS; i++) if (bottoms[i] < bottoms[best]) best = i;
  return { x: PAD + best * (w + g), y: used[best] ? bottoms[best] + g : PAD };
}

async function place(item, bytes) {
  const frame = await getFrame(frameNameFor(item.collection));

  const dup = findDuplicate(frame, item.hash);
  if (dup) return { status: 'duplicate', nodeId: dup.id, frame: frame.name };

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const image = figma.createImage(bytes);
  const size = await image.getSizeAsync();
  const w = CFG.imageWidth;

  const card = figma.createFrame();
  card.name = 'Stash image';
  card.fills = [];
  card.layoutMode = 'VERTICAL';
  card.itemSpacing = 6;
  card.resize(w, 100);
  card.primaryAxisSizingMode = 'AUTO';
  card.counterAxisSizingMode = 'FIXED';
  card.clipsContent = false;

  const rect = figma.createRectangle();
  rect.name = 'image';
  rect.cornerRadius = 8;
  rect.resize(w, CFG.layout === 'grid' ? w : Math.max(1, Math.round((w * size.height) / size.width)));
  rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
  card.appendChild(rect);

  if (CFG.showSourceLinks && item.source) {
    const t = figma.createText();
    t.fontName = { family: 'Inter', style: 'Regular' };
    t.fontSize = 11;
    t.fills = [{ type: 'SOLID', color: { r: 0.541, g: 0.459, b: 0.388 } }]; // ui/text-muted
    t.characters = item.source;
    if (/^https?:\/\//.test(item.sourceUrl || '')) t.setRangeHyperlink(0, t.characters.length, { type: 'URL', value: item.sourceUrl });
    card.appendChild(t);
    t.layoutSizingHorizontal = 'FILL';
  }

  card.setPluginData('stashHash', item.hash);
  card.setPluginData('stashId', item.id);

  const slot = nextSlot(frame); // before appending, so the new card is not counted
  frame.appendChild(card);
  card.x = slot.x;
  card.y = slot.y;

  let maxBottom = PAD;
  for (const child of frame.children) maxBottom = Math.max(maxBottom, child.y + child.height);
  frame.resize(frameWidth(), maxBottom + PAD);

  return { status: 'placed', nodeId: card.id, frame: frame.name };
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-token') {
    post({ type: 'token', value: (await figma.clientStorage.getAsync('stashToken')) || null });
  } else if (msg.type === 'set-token') {
    await figma.clientStorage.setAsync('stashToken', msg.value);
  } else if (msg.type === 'config') {
    applyConfig(msg.config);
  } else if (msg.type === 'place') {
    try {
      if (msg.config) applyConfig(msg.config);
      const r = await place(msg.item, msg.bytes);
      post({ type: 'placed', id: msg.item.id, ...r });
    } catch (e) {
      post({ type: 'place-error', id: msg.item.id, message: String(e && e.message ? e.message : e) });
    }
  } else if (msg.type === 'notify') {
    figma.notify(msg.text, { timeout: 2000 });
  }
};
