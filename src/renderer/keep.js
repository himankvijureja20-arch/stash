// "Keep this image?" bubble shown when an image lands on the clipboard (Figma "04 Small UI").
import { h } from './ui.js';

const TIMEOUT_MS = 8000;

export function createKeep({ root, anchor, onKeep, onNah, hint = () => {}, timeScale = 1 }) {
  let timer = null, shown = false;
  const thumb = h('img', { class: 'k-thumb', alt: '' });
  const sub = h('span', { class: 'k-sub' });
  const nah = h('div', { class: 'p-btn ghost', onclick: () => finish(false) }, h('span', {}, 'Nah'));
  const yes = h('div', { class: 'p-btn primary', onclick: () => finish(true) }, h('span', {}, 'Stash it'));
  const el = h('div', { id: 'keep', class: 'hit', hidden: true },
    h('div', { class: 'k-row' }, thumb, h('div', { class: 'k-text' }, h('b', {}, 'Keep this one?'), sub)),
    h('div', { class: 'k-btns' }, nah, yes));
  root.appendChild(el);

  function place() {
    const a = anchor();
    const w = 260;
    el.style.left = Math.min(Math.max(8, a.x + a.w - w + 6), a.screenW - w - 8) + 'px';
    el.style.top = Math.max(8, a.y - el.offsetHeight - 6) + 'px';
  }

  function finish(keep) {
    if (!shown) return;
    const rect = thumb.getBoundingClientRect();
    shown = false; clearTimeout(timer); hint(false);
    el.classList.add('closing');
    setTimeout(() => { if (!shown) el.hidden = true; el.classList.remove('closing'); }, 160);
    if (keep) onKeep({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, thumb.src);
    else onNah();
  }

  return {
    isOpen: () => shown,
    show({ thumb: src, source }) {
      thumb.src = src;
      sub.textContent = `Copied from ${source}`;
      el.hidden = false; el.classList.remove('closing');
      shown = true; place(); hint(true);
      clearTimeout(timer);
      const scale = typeof timeScale === 'function' ? timeScale() : timeScale;
      timer = setTimeout(() => finish(false), TIMEOUT_MS / scale);   // spec: 8s timeout = back to Idle
    },
    reposition() { if (shown) place(); },
    finish,
    snapshot: () => ({ shown, text: sub.textContent }),
  };
}
