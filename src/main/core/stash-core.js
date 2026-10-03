// Stash core: image intake, dedupe, storage. No Electron imports, so the
// dev server and the self-test can use it too.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_COLLECTION = 'Random inspo';

// ---------- URL helpers ----------

// Candidate URLs for the best-quality version of an image, best first.
function upgradeUrl(url) {
  const out = [];
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host.endsWith('pinimg.com')) {
      // /236x/ /474x/ /564x/ /736x/ -> /originals/
      const swap = (seg) => url.replace(/(pinimg\.com\/)(\d+x\d*(?:_RS)?)\//, `$1${seg}/`);
      out.push(swap('originals'), swap('736x'));
    } else if (host.endsWith('cosmos.so')) {
      for (const k of ['w', 'h', 'q', 'fit', 'width', 'height', 'quality']) u.searchParams.delete(k);
      out.push(u.toString());
    } else if (host.includes('cloudfront.net') || host.endsWith('are.na') || host.endsWith('arena.net')) {
      // Are.na serves large_/display_/square_/thumb_ variants next to original_
      out.push(url.replace(/\/(large|display|square|thumb)_/, '/original_'));
    }
  } catch (_) { /* not a URL */ }
  out.push(url);
  return [...new Set(out)];
}

function sourceLabel(url) {
  try {
    const h = new URL(url).hostname;
    if (h.endsWith('pinimg.com') || h.endsWith('pinterest.com')) return 'pinterest.com';
    if (h.endsWith('cosmos.so')) return 'cosmos.so';
    if (h.includes('cloudfront.net') || h.endsWith('are.na')) return 'are.na';
    return h.replace(/^www\./, '');
  } catch (_) { return ''; }
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)(\?|#|$)/i;
const IMG_HOST = /(pinimg\.com|cosmos\.so|cloudfront\.net|are\.na)/i;
const looksLikeImageUrl = (s) => /^https?:\/\//i.test(s) && (IMG_EXT.test(s) || IMG_HOST.test(s));

// Pull the best image URL + the page it came from out of a browser drop.
// Pinterest wraps the <img> in a link to the pin, so uri-list is often the
// pin page and the real image only appears in the html.
function pickFromDrop({ html = '', uriList = '', text = '' }) {
  let imageUrl = null;
  const imgTag = html.match(/<img[^>]+>/i);
  if (imgTag) {
    const srcset = imgTag[0].match(/srcset=["']([^"']+)["']/i);
    const src = imgTag[0].match(/\ssrc=["']([^"']+)["']/i);
    if (srcset) {
      // take the last (usually largest) entry
      const parts = srcset[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
      if (parts.length) imageUrl = parts[parts.length - 1];
    }
    if (!imageUrl && src) imageUrl = src[1];
  }
  const uris = uriList.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  if (!imageUrl) imageUrl = uris.find(looksLikeImageUrl) || (looksLikeImageUrl(text.trim()) ? text.trim() : null);
  const pageUrl = uris.find((l) => /^https?:\/\//i.test(l) && l !== imageUrl) || null;
  if (imageUrl) imageUrl = imageUrl.replace(/&amp;/g, '&');
  return { imageUrl, pageUrl };
}

// ---------- image sniffing ----------

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.slice(0, 3).toString() === 'GIF') return { ext: 'gif', mime: 'image/gif' };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

// ---------- store ----------

class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.imgDir = path.join(dataDir, 'images');
    this.file = path.join(dataDir, 'store.json');
    fs.mkdirSync(this.imgDir, { recursive: true });
    this.data = { items: [], tokens: [], collections: [] };
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { /* fresh */ }
    if (!this.data.collections) this.data.collections = [];
    if (!this.data.collections.includes(DEFAULT_COLLECTION) && !this.data.collections.length) this.data.collections.push(DEFAULT_COLLECTION);
  }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
  get items() { return this.data.items; }
  find(id) { return this.items.find((i) => i.id === id); }
  imagePath(item) { return path.join(this.imgDir, `${item.hash}.${item.ext}`); }
  hasHash(hash, collection) { return this.items.find((i) => i.hash === hash && i.collection === collection); }
  count(collection) { return this.items.filter((i) => i.collection === collection).length; }
  unsent(collection) { return this.items.filter((i) => !i.sentAt && (!collection || i.collection === collection)); }
  newToken() { const t = crypto.randomBytes(24).toString('hex'); this.data.tokens.push(t); this.save(); return t; }
  validToken(t) { return !!t && this.data.tokens.includes(t); }

  // ----- collections -----
  // Names in the order the user made them. Any collection that has items but is not listed is appended.
  collectionNames() {
    const names = [...this.data.collections];
    for (const i of this.items) if (!names.includes(i.collection)) names.push(i.collection);
    return names;
  }
  collections() { return this.collectionNames().map((name) => ({ name, count: this.count(name) })); }
  ensureCollection(name) {
    if (!this.data.collections.includes(name)) { this.data.collections.push(name); this.save(); }
  }
  addCollection(raw) {
    const name = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) return { ok: false, reason: 'empty' };
    if (this.collectionNames().some((n) => n.toLowerCase() === name.toLowerCase())) return { ok: false, reason: 'exists' };
    this.data.collections.push(name); this.save();
    return { ok: true, name };
  }
  // Items in the order they should show: manual order first, then newest last.
  itemsFor(collection) {
    return this.items.filter((i) => i.collection === collection)
      .sort((a, b) => (a.order ?? a.addedAt) - (b.order ?? b.addedAt));
  }
  nextOrder(collection) {
    const orders = this.items.filter((i) => i.collection === collection).map((i) => i.order ?? i.addedAt);
    return orders.length ? Math.max(...orders) + 1 : 0;
  }
  reorder(collection, ids) {
    ids.forEach((id, n) => { const it = this.find(id); if (it && it.collection === collection) it.order = n; });
    // anything not mentioned keeps its place after the listed ones
    let n = ids.length;
    for (const it of this.itemsFor(collection)) if (!ids.includes(it.id)) it.order = n++;
    this.save();
  }
  // Remove one item. The image file is only deleted if no other item still uses it.
  remove(id) {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) return false;
    const [item] = this.items.splice(idx, 1);
    if (!this.items.some((i) => i.hash === item.hash && i.ext === item.ext)) {
      try { fs.unlinkSync(this.imagePath(item)); } catch (_) { /* already gone */ }
    }
    this.save();
    return true;
  }
}

// Width/height from the file header, without decoding the image. Returns null if unknown.
function imageSize(buf) {
  try {
    const k = sniff(buf);
    if (!k) return null;
    if (k.ext === 'png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (k.ext === 'gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (k.ext === 'jpg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (k.ext === 'webp') {
      const kind = buf.slice(12, 16).toString();
      if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    }
  } catch (_) { /* truncated file */ }
  return null;
}

// Core intake. Never throws for bad input; returns a status the UI can animate.
function ingestBuffer(store, buf, meta = {}) {
  const kind = sniff(buf);
  if (!kind) return { status: 'not-image' };
  const collection = meta.collection || DEFAULT_COLLECTION;
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const existing = store.hasHash(hash, collection);
  if (existing) return { status: 'duplicate', item: existing };
  const size = imageSize(buf);
  const item = {
    // id mixes in the collection: the same picture in two collections is two separate items
    id: crypto.createHash('sha256').update(hash + '|' + collection).digest('hex').slice(0, 12),
    hash, ext: kind.ext, mime: kind.mime, bytes: buf.length,
    w: size ? size.w : null, h: size ? size.h : null,
    collection, source: meta.source || '', sourceUrl: meta.sourceUrl || '',
    addedAt: Date.now(), order: store.nextOrder(collection), sentAt: null, figmaNodeId: null,
  };
  fs.writeFileSync(store.imagePath(item), buf);
  store.ensureCollection(collection);
  store.items.push(item);
  store.save();
  return { status: 'stashed', item, count: store.count(collection), unsent: store.unsent().length };
}

async function fetchImage(url) {
  const origin = (() => { try { return new URL(url).origin + '/'; } catch (_) { return undefined; } })();
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Stash', Referer: origin || '' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// A full browser drop: local files, or image URLs. Tries the best-quality URL first.
async function ingestDrop(store, payload, collection) {
  const results = [];
  for (const p of payload.files || []) {
    try { results.push(ingestBuffer(store, fs.readFileSync(p), { collection, source: 'local file' })); }
    catch (e) { results.push({ status: 'error', message: String(e) }); }
  }
  if (results.length) return results[results.length - 1];

  const { imageUrl, pageUrl } = pickFromDrop(payload);
  if (!imageUrl) return { status: 'not-image' };
  if (imageUrl.startsWith('data:')) {
    const m = imageUrl.match(/^data:[^;,]+;base64,(.*)$/);
    return m ? ingestBuffer(store, Buffer.from(m[1], 'base64'), { collection, source: 'data uri' }) : { status: 'not-image' };
  }
  let lastErr;
  for (const candidate of upgradeUrl(imageUrl)) {
    try {
      const buf = await fetchImage(candidate);
      const r = ingestBuffer(store, buf, { collection, source: sourceLabel(imageUrl), sourceUrl: pageUrl || imageUrl });
      r.fetchedUrl = candidate;
      r.upgraded = candidate !== imageUrl;
      return r;
    } catch (e) { lastErr = e; }
  }
  return { status: 'error', message: String(lastErr) };
}

module.exports = {
  DEFAULT_COLLECTION, upgradeUrl, sourceLabel, pickFromDrop, sniff, imageSize,
  Store, ingestBuffer, ingestDrop, fetchImage,
};
