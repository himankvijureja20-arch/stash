// First-run intro: three cards (Figma "04 Small UI" > Onboarding 1/3 .. 3/3).
import { h } from './ui.js';
import { squirrelSVG } from './squirrel.js';

export const STEPS = [
  { state: 'Idle', title: 'Meet Stash', body: 'A squirrel that lives in the corner of your screen and hoards your inspo.', button: 'Next' },
  { state: 'Eating Peanut', title: 'Feed it images', body: 'Drag any image onto it while you scroll. Copied images work too. Every one is a peanut.', button: 'Next' },
  { state: 'Sending To Figma', title: 'Dump it into Figma', body: 'One click and your whole stash lands as a clean masonry moodboard.', button: "Let's go" },
];

export function createOnboarding({ root, onDone }) {
  let open = false, step = 0;
  const stage = h('div', { class: 'ob-stage' });
  const title = h('div', { class: 'ob-title' });
  const body = h('div', { class: 'ob-body' });
  const dots = h('div', { class: 'ob-dots' }, STEPS.map(() => h('i')));
  const btn = h('div', { class: 'ob-btn', onclick: () => next() }, h('span'));
  const el = h('div', { id: 'onboarding', class: 'hit', hidden: true }, stage, title, body, dots, btn);
  root.appendChild(el);

  function paint(animate) {
    const s = STEPS[step];
    stage.innerHTML = `<div class="ob-sq${animate ? ' pop' : ''}">${squirrelSVG(s.state)}</div>`;
    title.textContent = s.title; body.textContent = s.body;
    btn.firstChild.textContent = s.button;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === step));
    if (animate) for (const n of [title, body]) { n.classList.remove('swap'); void n.offsetWidth; n.classList.add('swap'); }
    center();
  }
  function center() {
    el.style.left = Math.round((window.innerWidth - 360) / 2) + 'px';
    el.style.top = Math.max(12, Math.round((window.innerHeight - el.offsetHeight) / 2)) + 'px';
  }
  function next() {
    if (step < STEPS.length - 1) { step++; paint(true); }
    else finish();
  }
  function finish() {
    if (!open) return;
    open = false;
    el.classList.add('closing'); setTimeout(() => { if (!open) el.hidden = true; el.classList.remove('closing'); }, 200);
    onDone();
  }
  return {
    isOpen: () => open,
    open() { if (open) return; open = true; step = 0; el.hidden = false; el.classList.remove('closing'); paint(false); },
    finish,
    reposition() { if (open) center(); },
    snapshot: () => ({ open, step, title: title.textContent, body: body.textContent, button: btn.firstChild.textContent, state: stage.querySelector('.sq-svg') && stage.querySelector('.sq-svg').dataset.state, dot: [...dots.children].findIndex((d) => d.classList.contains('on')) }),
  };
}
