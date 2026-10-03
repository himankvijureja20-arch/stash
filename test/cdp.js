// usage: node cdp.js "<js expression>"   -> evaluates in the Stash overlay page and prints the JSON result
const http = require('http');
const expr = process.argv[2];
const PORT = process.env.CDP_PORT || '9333';
http.get('http://127.0.0.1:' + PORT + '/json', (res) => {
  let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => {
    const page = JSON.parse(s).find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
    ws.onmessage = (m) => { const r = JSON.parse(m.data); if (r.id === 1) { const v = r.result.result.value !== undefined ? r.result.result.value : r.result; console.log(typeof v === 'string' ? v : JSON.stringify(v)); ws.close(); } };
  });
});
