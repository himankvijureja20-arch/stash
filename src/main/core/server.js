// Local-only HTTP bridge between Stash and the Figma plugin.
// Binds to 127.0.0.1 only, rejects foreign Host headers (DNS rebinding),
// and requires a token that is only handed out after the user clicks Allow.
const http = require('http');
const fs = require('fs');

const PORT = 47821;

function createServer(store, opts = {}) {
  const approve = opts.approve || (async () => false); // () => Promise<boolean>
  const onPoll = opts.onPoll || (() => {});   // (q) plugin asked for pending images (it is open and listening)
  const onAck = opts.onAck || (() => {});     // (item, unsentLeft, status) an image was placed or skipped
  const canSend = opts.canSend || (() => true); // ({auto, force}) => bool: may we hand images to the plugin right now?
  const getConfig = opts.getConfig || (() => ({}));
  const log = opts.log || (() => {});
  const port = opts.port || PORT;

  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (_) { resolve({}); } });
  });

  const server = http.createServer(async (req, res) => {
    // CORS: the plugin iframe has a null origin, so we answer * but still need the token.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-stash-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    const host = (req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(res, 403, { error: 'bad host' });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://${host}`);
    try {
      if (url.pathname === '/ping') return json(res, 200, { app: 'stash', version: 1 });

      if (url.pathname === '/connect' && req.method === 'POST') {
        const body = await readBody(req);
        if (store.validToken(body.token)) return json(res, 200, { token: body.token, approved: true });
        const ok = await approve();
        if (!ok) return json(res, 403, { error: 'denied' });
        log('Figma plugin approved');
        return json(res, 200, { token: store.newToken(), approved: true });
      }

      // everything below needs the token
      const token = req.headers['x-stash-token'] || url.searchParams.get('token');
      if (!store.validToken(token)) return json(res, 401, { error: 'unauthorized' });

      if (url.pathname === '/pending') {
        // The plugin tells us whether its own auto-sync box is ticked (auto=1) or the
        // user pressed Sync now (force=1). Stash adds its own Pause sync / Send now rules.
        const q = { auto: url.searchParams.get('auto') !== '0', force: url.searchParams.get('force') === '1' };
        onPoll(q);
        const allowed = canSend(q);
        const names = store.collectionNames();
        const byOrder = (a, b) => (a.collection === b.collection ? (a.order ?? a.addedAt) - (b.order ?? b.addedAt) : names.indexOf(a.collection) - names.indexOf(b.collection));
        const items = allowed ? store.unsent().sort(byOrder).map((i) => ({
          id: i.id, hash: i.hash, collection: i.collection, source: i.source,
          sourceUrl: i.sourceUrl, mime: i.mime,
        })) : [];
        return json(res, 200, { items, config: getConfig(), held: !allowed && store.unsent().length });
      }

      const img = url.pathname.match(/^\/image\/([0-9a-f]+)$/);
      if (img) {
        const item = store.find(img[1]);
        if (!item) return json(res, 404, { error: 'no such image' });
        res.writeHead(200, { 'Content-Type': item.mime });
        return fs.createReadStream(store.imagePath(item)).pipe(res);
      }

      if (url.pathname === '/ack' && req.method === 'POST') {
        const b = await readBody(req);
        const item = store.find(b.id);
        if (!item) return json(res, 404, { error: 'no such image' });
        if (!item.sentAt) {
          item.sentAt = Date.now();
          item.figmaNodeId = b.figmaNodeId || null;
          store.save();
          onAck(item, store.unsent().length);
        }
        return json(res, 200, { ok: true, unsent: store.unsent().length });
      }

      return json(res, 404, { error: 'not found' });
    } catch (e) {
      log('server error ' + e);
      return json(res, 500, { error: String(e) });
    }
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server.address().port));
    }),
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { createServer, PORT };
