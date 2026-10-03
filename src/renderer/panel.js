// The collection panel (Figma "03 Collection Panel"): 360 x 560, anchored above the squirrel.
import { h, CHEVRON, CHECK, syncModel, masonry } from './ui.js';
import { squirrelSVG } from './squirrel.js';

const W = 360, H = 560, INNER = 326, COLS = 3, GAP = 8;
const COL_W = (INNER - GAP * (COLS - 1)) / COLS;
const DOT = { success: '#6E8B3D', accent: '#B8622E', danger: '#C2412D', muted: '#8A7563' };

export function createPanel({ root, anchor, toast, hint }) {
  let data = { collection: '', collections: [], items: [], unsent: 0, sent: 0, pluginUp: false, autoSync: true };
  let open = false, dropdownOpen = false, creating = false;
  const nodes = new Map();        // item id -> element
  const natural = new Map();      // item id -> measured height/width (for files without a header size)
  let order = [];                 // ids as displayed
  let drag = null;

  // ---------- skeleton ----------
  const avatar = h('div', { class: 'p-avatar' }, h('div', { class: 'p-avatar-sq', html: squirrelSVG('Idle') }));
  const label = h('div', { class: 'p-label' }, 'COLLECTION');
  const switchName = h('span', { class: 'p-name' });
  const switcher = h('div', { class: 'p-switch', onclick: (e) => { e.stopPropagation(); toggleDropdown(); } }, switchName, h('span', { class: 'p-chev', html: CHEVRON }));
  const status = h('div', { class: 'p-status' }, h('i'), h('span'));
  const count = h('div', { class: 'p-count' });
  const close = h('div', { class: 'p-close', onclick: () => api.close() }, '×');
  const head = h('div', { class: 'p-head' }, avatar, h('div', { class: 'p-title' }, label, status, switcher), count, close);

  const banner = h('div', { class: 'p-banner' }, h('b', {}, 'Open the Stash plugin in Figma'), h('span', {}, 'Plugins > Stash, in the file you want. Do it once, then everything syncs by itself. You can minimise the plugin.'));
  const grid = h('div', { class: 'p-grid' });
  const emptySq = h('div', { class: 'p-empty-sq', html: squirrelSVG('Idle') });
  const empty = h('div', { class: 'p-empty' }, emptySq, h('b', {}, 'Nothing stashed yet'), h('span', {}, "Drag any image onto Stash while you scroll, or copy one and it'll ask."));
  const body = h('div', { class: 'p-body' }, grid, empty);
  const barFill = h('div', { class: 'p-bar-fill' });
  const progress = h('div', { class: 'p-progress' }, h('span', {}, 'Placing images in your Figma frame...'), h('div', { class: 'p-bar' }, barFill));
  const btnL = h('div', { class: 'p-btn ghost', draggable: 'true' }, h('span'));
  const btnR = h('div', { class: 'p-btn primary' }, h('span'));
  const foot = h('div', { class: 'p-foot' }, btnL, btnR);
  const dropdown = h('div', { class: 'p-drop', hidden: true });
  const el = h('div', { id: 'panel', class: 'hit', hidden: true }, head, banner, body, progress, foot, dropdown);
  root.appendChild(el);

  // ---------- footer buttons ----------
  const LEFT = { drag: 'Drag out all', pause: 'Pause sync', resume: 'Resume sync' };
  const RIGHT = { send: 'Send to Figma', connect: 'How to connect', open: 'Open in Figma' };

  btnL.addEventListener('dragstart', (e) => {
    e.preventDefault();                       // we start a real file drag from the main process instead
    if (model.left !== 'drag') return;
    if (!data.items.length) return toast('Nothing to drag out yet.', 'muted');
    window.stash.dragAll();
  });
  btnL.addEventListener('click', async () => {
    if (model.left === 'pause' || model.left === 'resume') {
      const on = await window.stash.toggleSync();
      toast(on ? 'Sync resumed' : 'Sync paused', on ? 'success' : 'muted');
    } else if (model.left === 'drag' && !data.items.length) toast('Nothing to drag out yet.', 'muted');
    else if (model.left === 'drag') toast('Grab this button and drag it into Figma.', 'accent', 3200);
  });
  btnR.addEventListener('click', async () => {
    if (model.right === 'open') return window.stash.openFigma();
    if (model.right === 'connect') {
      banner.classList.remove('pulse'); void banner.offsetWidth; banner.classList.add('pulse');
      window.stash.revealPlugin();
      return toast('In Figma: Plugins > Development > Import plugin from manifest..., pick the file that just opened. Then run Plugins > Development > Stash.', 'accent', 8000);
    }
    if (data.unsent === 0) return toast('Nothing to send yet.', 'muted');
    if (!data.pluginUp) { banner.classList.remove('pulse'); void banner.offsetWidth; banner.classList.add('pulse'); return toast("Figma isn't listening. Open the Stash plugin first.", 'danger', 4200); }
    await window.stash.sendNow();
    toast(`Sending ${data.unsent} to Figma...`, 'accent');
  });

  // ---------- rendering ----------
  let model = syncModel(data);

  function setBtn(btn, text, kind) { btn.firstChild.textContent = text; btn.dataset.kind = kind; }

  function render() {
    model = syncModel(data);
    const n = data.items.length;
    switchName.textContent = data.collection;
    count.textContent = String(n);
    label.hidden = !model.empty;
    status.hidden = !!model.empty;
    if (!model.empty) { status.querySelector('i').style.background = DOT[model.dot]; status.querySelector('span').textContent = model.text; }
    banner.hidden = !model.banner;
    progress.hidden = !model.progress && model.progress !== 0;
    if (!progress.hidden) barFill.style.width = Math.round(model.progress * 100) + '%';
    setBtn(btnL, LEFT[model.left], model.left);
    setBtn(btnR, RIGHT[model.right], model.right);
    btnL.setAttribute('draggable', model.left === 'drag' ? 'true' : 'false');
    empty.hidden = n > 0;
    grid.hidden = n === 0;
    el.classList.toggle('has-banner', !!model.banner);
    reconcile();
    if (dropdownOpen) renderDropdown();
  }

  // ---------- thumbs ----------
  const ratioOf = (it) => {
    const r = it.w && it.h ? it.h / it.w : natural.get(it.id) || 1;
    return Math.min(1.9, Math.max(0.55, r));
  };

  function makeThumb(it) {
    const img = h('img', { src: it.url, draggable: 'false', alt: '' });
    img.addEventListener('load', () => {
      if (!it.w && img.naturalWidth) { natural.set(it.id, img.naturalHeight / img.naturalWidth); layout(); }
    });
    const del = h('div', { class: 't-del', onclick: async (e) => { e.stopPropagation(); await removeItem(it.id); } }, '×');
    const t = h('div', { class: 'thumb', 'data-id': it.id },
      img, h('div', { class: 't-over' }), del,
      it.source ? h('div', { class: 't-chip' }, it.source) : null,
      h('div', { class: 't-sent', html: CHECK }),
      h('div', { class: 't-sync' }, 'Syncing'));
    t.addEventListener('pointerdown', (e) => beginPress(e, it.id));
    return t;
  }

  function reconcile() {
    const ids = new Set(data.items.map((i) => i.id));
    for (const [id, node] of nodes) {
      if (!ids.has(id)) { nodes.delete(id); node.classList.add('leaving'); setTimeout(() => node.remove(), 220); }
    }
    for (const it of data.items) {
      let node = nodes.get(it.id);
      if (!node) { node = makeThumb(it); nodes.set(it.id, node); node.classList.add('entering'); grid.appendChild(node); requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('entering'))); }
      node.classList.toggle('is-sent', it.sent);
      node.classList.toggle('is-syncing', !it.sent && data.pluginUp && data.autoSync);
      const chip = node.querySelector('.t-chip');
      if (chip && it.source) chip.textContent = it.source;
    }
    order = data.items.map((i) => i.id);
    layout();
  }

  function layout(slotIndex = -1, slotH = 0) {
    const ids = drag ? order.filter((id) => id !== drag.id) : order;
    const items = ids.map((id) => data.items.find((i) => i.id === id)).filter(Boolean);
    const heights = items.map((it) => Math.round(COL_W * ratioOf(it)));
    if (slotIndex >= 0) heights.splice(slotIndex, 0, slotH);
    const { slots, height } = masonry(heights, COLS, COL_W, GAP);
    let k = 0;
    ids.forEach((id, idx) => {
      if (slotIndex >= 0 && idx === slotIndex) k++;       // skip the slot's place
      const s = slots[k++];
      const node = nodes.get(id);
      if (!node || !s) return;
      node.style.width = COL_W + 'px';
      node.style.height = s.h + 'px';
      node.style.transform = `translate(${s.x}px, ${s.y}px)`;
    });
    if (slotIndex >= 0 && drag) {
      const s = slots[slotIndex];
      drag.slot.style.transform = `translate(${s.x}px, ${s.y}px)`;
      drag.slotPos = s;
    }
    grid.style.height = height + 'px';
    return { slots, ids };
  }

  async function removeItem(id) {
    const node = nodes.get(id);
    if (node) node.classList.add('leaving');
    data = await window.stash.deleteItem(id);
    render();
  }

  // ---------- drag to reorder ----------
  let press = null;
  function beginPress(e, id) {
    if (e.button !== 0 || e.target.closest('.t-del')) return;
    press = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, node: nodes.get(id) };
    try { press.node.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer in tests */ }
    press.node.addEventListener('pointermove', onPressMove);
    press.node.addEventListener('pointerup', onPressUp);
    press.node.addEventListener('pointercancel', onPressUp);
  }
  function onPressMove(e) {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      startDrag(e);
    }
    moveDrag(e);
  }
  function onPressUp(e) {
    const p = press; press = null;
    if (!p) return;
    p.node.removeEventListener('pointermove', onPressMove);
    p.node.removeEventListener('pointerup', onPressUp);
    p.node.removeEventListener('pointercancel', onPressUp);
    try { p.node.releasePointerCapture(p.pointerId); } catch (_) { /* already released */ }
    if (drag) endDrag();
  }

  function startDrag(e) {
    const node = press.node;
    const gr = grid.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const slot = h('div', { class: 'p-slot' });
    slot.style.width = COL_W + 'px'; slot.style.height = r.height + 'px';
    grid.appendChild(slot);
    drag = { id: press.id, node, slot, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, hgt: r.height, index: order.indexOf(press.id), scroller: null };
    node.classList.add('dragging');
    el.classList.add('is-reordering');
    layout(drag.index, drag.hgt);
    void gr;
  }

  function moveDrag(e) {
    const gr = grid.getBoundingClientRect();
    const x = e.clientX - gr.left - drag.dx, y = e.clientY - gr.top - drag.dy;
    drag.node.style.transform = `translate(${x}px, ${y}px) scale(1.04)`;
    // find where the slot should go: the item under the pointer decides
    const px = e.clientX - gr.left, py = e.clientY - gr.top;
    // The thumbnail nearest the pointer decides: top half = insert before it, bottom half = after it.
    const others = order.filter((id) => id !== drag.id);
    let target = 0, best = Infinity;
    for (let i = 0; i < others.length; i++) {
      const n = nodes.get(others[i]);
      const m = n.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      if (!m) continue;
      const nx = parseFloat(m[1]), ny = parseFloat(m[2]), nh = parseFloat(n.style.height);
      const cx = nx + COL_W / 2, cy = ny + nh / 2;
      const dist = Math.hypot(px - cx, py - cy);
      if (dist < best) { best = dist; target = py < cy ? i : i + 1; }
    }
    if (target !== drag.index) { drag.index = Math.min(target, others.length); layout(drag.index, drag.hgt); }
    // edge auto-scroll
    const br = body.getBoundingClientRect();
    if (e.clientY < br.top + 28) body.scrollTop -= 8; else if (e.clientY > br.bottom - 28) body.scrollTop += 8;
  }

  async function endDrag() {
    const d = drag;
    const others = order.filter((id) => id !== d.id);
    others.splice(d.index, 0, d.id);
    order = others;
    // settle the lifted thumb into the slot, then drop the slot
    const s = d.slotPos;
    d.node.classList.remove('dragging');
    d.node.style.transform = `translate(${s.x}px, ${s.y}px)`;
    d.slot.remove();
    drag = null;
    el.classList.remove('is-reordering');
    layout();
    const changedOrder = others.join() !== data.items.map((i) => i.id).join();
    if (changedOrder) {
      data.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      data = { ...(await window.stash.reorder(order)) };
      render();
    }
  }

  // ---------- collection dropdown ----------
  function toggleDropdown() { dropdownOpen ? closeDropdown() : openDropdown(); }
  function openDropdown() { dropdownOpen = true; creating = false; renderDropdown(); dropdown.hidden = false; }
  function closeDropdown() { dropdownOpen = false; creating = false; dropdown.hidden = true; }

  function renderDropdown() {
    dropdown.innerHTML = '';
    for (const c of data.collections) {
      const row = h('div', { class: 'p-drop-item' + (c.name === data.collection ? ' on' : ''), onclick: async (e) => {
        e.stopPropagation();
        if (c.name !== data.collection) { data = await window.stash.setCollection(c.name); render(); body.scrollTop = 0; }
        closeDropdown();
      } }, h('span', {}, c.name), h('em', {}, String(c.count)));
      dropdown.appendChild(row);
    }
    dropdown.appendChild(h('div', { class: 'p-drop-sep' }));
    if (!creating) {
      dropdown.appendChild(h('div', { class: 'p-drop-new', onclick: (e) => { e.stopPropagation(); creating = true; renderDropdown(); dropdown.querySelector('input').focus(); } }, '+ New collection'));
    } else {
      const input = h('input', { class: 'p-drop-input', placeholder: 'Name it and press Enter', maxlength: '40', spellcheck: 'false' });
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') { creating = false; renderDropdown(); }
        if (e.key !== 'Enter') return;
        const r = await window.stash.newCollection(input.value);
        if (!r.ok) { input.classList.add('bad'); toast(r.reason === 'exists' ? 'You already have a collection with that name.' : 'Give it a name first.', 'danger', 3000); return; }
        data = r.data; render(); closeDropdown(); toast(`New collection: ${r.name}`, 'success');
      });
      dropdown.appendChild(h('div', { class: 'p-drop-new input' }, input));
      // keyboard needs a focusable window while typing
      window.stash.setFocusable(true);
      setTimeout(() => input.focus(), 30);
    }
  }
  el.addEventListener('pointerdown', (e) => { if (dropdownOpen && !e.target.closest('.p-drop') && !e.target.closest('.p-switch')) closeDropdown(); });

  // ---------- placement + lifecycle ----------
  function reposition() {
    const a = anchor();             // { x, y, w, h } of the squirrel
    const ph = Math.min(H, a.screenH - 24);
    let left = a.x + a.w - W + 10, top = a.y - 14 - ph;
    let origin = 'bottom right';
    if (top < 8) {                  // not enough room above: go beside the squirrel
      const roomLeft = a.x - 14 - W >= 8;
      left = roomLeft ? a.x - 14 - W : a.x + a.w + 14;
      top = Math.min(Math.max(8, a.y + a.h - ph), a.screenH - ph - 8);
      origin = roomLeft ? 'bottom right' : 'bottom left';
    }
    left = Math.min(Math.max(8, left), a.screenW - W - 8);
    el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.height = ph + 'px';
    el.style.transformOrigin = origin;
    report();
  }
  function report() { window.stash.panelBox(open ? { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: W, h: parseFloat(el.style.height) } : null); }

  const api = {
    isOpen: () => open,
    rect: () => (open ? el.getBoundingClientRect() : null),
    async open() {
      if (open) return;
      open = true;
      data = await window.stash.panelData();
      reposition(); el.hidden = false; el.classList.remove('closing');
      render();
      hint(true);
    },
    close() {
      if (!open) return;
      open = false; closeDropdown(); window.stash.setFocusable(false);
      el.classList.add('closing');
      setTimeout(() => { if (!open) el.hidden = true; el.classList.remove('closing'); }, 180);
      report(); hint(false);
    },
    toggle() { open ? api.close() : api.open(); },
    reposition() { if (open) reposition(); },
    async refresh() { if (!open) return; const keepScroll = body.scrollTop; data = await window.stash.panelData(); render(); body.scrollTop = keepScroll; },
    snapshot: () => ({ open, collection: data.collection, count: data.items.length, ids: [...order], status: model.text || null, left: model.left, right: model.right, banner: !model.banner ? false : !banner.hidden, progress: model.progress ?? null, dropdown: dropdownOpen }),
  };
  return api;
}
