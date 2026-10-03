// Where Stash's "home" is. The spot is saved as fractions of the usable screen (0..1 each way),
// so it survives a change of resolution, a different monitor size or a moved taskbar.
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// work = { x, y, width, height } of the usable screen, S = Stash's size, floor = lowest y Stash may stand at
export function spotFromPos(pos, S, work, floor) {
  const w = Math.max(1, work.width - S), h = Math.max(1, floor - work.y);
  return { fx: round(clamp01((pos.x - work.x) / w)), fy: round(clamp01((pos.y - work.y) / h)) };
}

export function posFromSpot(spot, S, work, floor) {
  return { x: work.x + spot.fx * (work.width - S), y: work.y + spot.fy * (floor - work.y) };
}

// Anything from the settings file is checked before it is trusted.
export function cleanSpot(s) {
  if (!s || typeof s !== 'object') return null;
  const fx = Number(s.fx), fy = Number(s.fy);
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  return { fx: clamp01(fx), fy: clamp01(fy) };
}

const round = (v) => Math.round(v * 10000) / 10000;
