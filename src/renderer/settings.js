// Settings window (Figma "04 Small UI" > Settings). Every control writes straight to the app settings.
import { h } from './ui.js';
import { squirrelSVG } from './squirrel.js';

const KEYNAME = { Control: 'Ctrl', Super: 'Win' };

// Turn a keydown into an Electron accelerator like "Control+Shift+S". Returns null while only modifiers are held.
export function acceleratorFromEvent(e) {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  let key;
  if (/^[a-z]$/i.test(k)) key = k.toUpperCase();
  else if (/^[0-9]$/.test(k)) key = k;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) key = k;
  else key = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' }[k];
  if (!key) return { error: 'key' };
  if (!mods.length) return { error: 'modifier' };
  return { accel: [...mods, key].join('+') };
}

export function createSettings({ root, toast, getVersion }) {
  let cfg = {};
  let open = false, recording = false;

  const el = h('div', { id: 'settings', class: 'hit', hidden: true });
  root.appendChild(el);

  // ----- controls -----
  const toggle = (key) => {
    const t = h('div', { class: 'tg' + (cfg[key] ? ' on' : ''), role: 'switch', onclick: () => { cfg[key] = !cfg[key]; t.classList.toggle('on', cfg[key]); window.stash.setSetting(key, cfg[key]); } }, h('i'));
    return t;
  };
  const seg = (key, options) => {
    const box = h('div', { class: 'seg' });
    for (const o of options) {
      const b = h('div', { class: 'seg-o' + (cfg[key] === o.v ? ' on' : ''), onclick: () => {
        cfg[key] = o.v; window.stash.setSetting(key, o.v);
        for (const s of box.children) s.classList.toggle('on', s === b);
      } }, o.label);
      box.appendChild(b);
    }
    return box;
  };
  const num = (key, min, max) => {
    const input = h('input', { class: 'num-in', type: 'number', min, max, value: cfg[key] });
    const wrap = h('div', { class: 'num' }, input, h('span', {}, 'px'));
    const commit = () => {
      let v = Math.round(Number(input.value));
      if (!Number.isFinite(v)) v = cfg[key];
      v = Math.min(max, Math.max(min, v));
      input.value = v; cfg[key] = v; window.stash.setSetting(key, v);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); input.blur(); } e.stopPropagation(); });
    input.addEventListener('focus', () => window.stash.setFocusable(true));
    input.addEventListener('blur', () => { commit(); if (!recording) window.stash.setFocusable(false); });
    return wrap;
  };
  const row = (label, control, extra = '') => h('div', { class: 'row' + extra }, h('span', { class: 'row-l' }, label), control);

  // hotkey keycaps + recorder
  const keys = h('div', { class: 'keys' });
  const paintKeys = (text) => {
    keys.innerHTML = '';
    if (text) { keys.appendChild(h('span', { class: 'rec' }, text)); return; }
    for (const part of String(cfg.hotkey || '').split('+')) keys.appendChild(h('span', { class: 'kc' }, KEYNAME[part] || part));
  };
  const stopRecording = () => { recording = false; keys.classList.remove('recording'); window.removeEventListener('keydown', onKey, true); window.stash.setFocusable(false); paintKeys(); };
  async function onKey(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return stopRecording();
    const r = acceleratorFromEvent(e);
    if (!r) return;
    if (r.error) { keys.classList.remove('shake'); void keys.offsetWidth; keys.classList.add('shake'); return toast(r.error === 'modifier' ? 'Add Ctrl, Alt or Shift to the shortcut.' : "That key can't be used.", 'danger', 2600); }
    const res = await window.stash.setHotkey(r.accel);
    if (!res.ok) { keys.classList.remove('shake'); void keys.offsetWidth; keys.classList.add('shake'); toast('That shortcut is taken by another app. Try another.', 'danger', 3200); return; }
    cfg.hotkey = r.accel; stopRecording(); toast('Shortcut saved.', 'success', 2200);
  }
  keys.addEventListener('click', () => {
    if (recording) return stopRecording();
    recording = true; keys.classList.add('recording'); paintKeys('Press the new shortcut...');
    window.stash.setFocusable(true);
    window.addEventListener('keydown', onKey, true);
  });

  const label = (t) => h('div', { class: 'sec' }, t);
  const hr = () => h('div', { class: 'hr' });

  function build() {
    el.innerHTML = '';
    paintKeys();
    el.append(
      h('div', { class: 's-head' },
        h('div', { class: 'p-avatar' }, h('div', { class: 'p-avatar-sq', html: squirrelSVG('Idle') })),
        h('div', { class: 's-title' }, 'Settings'),
        h('div', { class: 'p-close', onclick: () => api.close() }, '×')),
      label('GENERAL'),
      row('Launch at startup', toggle('launchAtStartup')),
      row('Summon / hide hotkey', keys),
      hr(),
      label('BEHAVIOUR'),
      row('Let Stash roam around', toggle('roamEnabled')),
      row('Roam how often', seg('roam', [{ v: 'chill', label: 'Chill' }, { v: 'normal', label: 'Normal' }, { v: 'hyper', label: 'Hyper' }])),
      row('15-minute patrol reminder', toggle('patrolReminder')),
      row('Ask before keeping copied images', toggle('askBeforeKeep')),
      hr(),
      label('FIGMA EXPORT'),
      row('Auto-sync to Figma', toggle('autoSync')),
      row('After syncing', seg('afterSync', [{ v: 'check', label: 'Keep with check' }, { v: 'clear', label: 'Clear' }])),
      row('Layout', seg('layout', [{ v: 'grid', label: 'Grid' }, { v: 'masonry', label: 'Masonry' }])),
      row('Image width', num('imageWidth', 80, 1200)),
      row('Gap', num('gap', 0, 120)),
      row('Show source links', toggle('showSourceLinks')),
      row('One frame per collection', toggle('oneFramePerCollection')),
      h('div', { class: 'hr' }),
      h('div', { class: 's-ver' }, `Stash v${getVersion()}`),
    );
  }

  function place() {
    const vh = window.innerHeight, vw = window.innerWidth;
    el.style.maxHeight = Math.min(900, vh - 24) + 'px';
    el.style.left = Math.round((vw - 480) / 2) + 'px';
    el.style.top = Math.max(12, Math.round((vh - Math.min(900, vh - 24)) / 2)) + 'px';
  }

  const api = {
    isOpen: () => open,
    rect: () => (open ? el.getBoundingClientRect() : null),
    setConfig(c) { cfg = { ...c }; if (open && !recording) build(); },
    open() { if (open) return; open = true; build(); place(); el.hidden = false; el.classList.remove('closing'); },
    close() {
      if (!open) return;
      if (recording) stopRecording();
      open = false; window.stash.setFocusable(false);
      el.classList.add('closing'); setTimeout(() => { if (!open) el.hidden = true; el.classList.remove('closing'); }, 160);
    },
    toggle() { open ? api.close() : api.open(); },
    snapshot: () => ({ open, recording, cfg: { ...cfg } }),
  };
  return api;
}
