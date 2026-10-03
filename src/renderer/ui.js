// Tiny DOM helpers shared by the panel, settings and prompts.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const CHEVRON = '<svg width="10" height="5" viewBox="0 0 10 5" fill="none"><path d="M1 .8l4 3.4 4-3.4" stroke="#2A1B12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const CHECK = '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.6 2.6L9 1" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// What the panel header/footer should show for a given situation (Figma "03 Collection Panel" sync states).
// d = { items, unsent, sent, pluginUp, autoSync }
export function syncModel(d) {
  const total = d.items.length;
  if (!total) return { empty: true, left: 'drag', right: 'send' };
  if (!d.pluginUp) {
    if (d.unsent > 0) return { dot: 'danger', text: "Figma isn't listening", banner: true, left: 'drag', right: 'connect' };
    return { dot: 'success', text: `All ${total} in Figma`, left: 'drag', right: 'open' };
  }
  if (d.unsent > 0 && d.autoSync) {
    return { dot: 'accent', text: `Sending ${Math.min(total, d.sent + 1)} of ${total}...`, progress: d.sent / total, syncing: true, left: 'pause', right: 'open' };
  }
  if (d.unsent > 0) return { dot: 'muted', text: `Sync paused, ${d.unsent} waiting`, left: 'resume', right: 'send' };
  return { dot: 'success', text: d.autoSync ? 'Live in Figma' : `All ${total} in Figma`, left: d.autoSync ? 'pause' : 'drag', right: 'open' };
}

// Masonry placement: each item goes into the currently shortest column.
export function masonry(heights, cols, colW, gap) {
  const bottoms = Array(cols).fill(0);
  const out = [];
  for (const hgt of heights) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (bottoms[i] < bottoms[c]) c = i;
    out.push({ x: c * (colW + gap), y: bottoms[c], h: hgt });
    bottoms[c] += hgt + gap;
  }
  return { slots: out, height: Math.max(0, Math.max(...bottoms) - gap) };
}
