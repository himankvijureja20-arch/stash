// Small JSON settings file in the user's app-data folder.
// Defaults mirror the Settings screen in Figma "04 Small UI".
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  launchAtStartup: true,
  hotkey: 'Control+Shift+S',
  roamEnabled: true,
  roam: 'normal',            // chill | normal | hyper
  patrolReminder: true,
  askBeforeKeep: true,
  autoSync: true,
  afterSync: 'check',        // check | clear
  layout: 'masonry',         // masonry | grid
  imageWidth: 280,
  gap: 16,
  showSourceLinks: true,
  oneFramePerCollection: true,
  activeCollection: 'Random inspo',
  onboarded: false,
  homeSpot: null,            // { fx, fy } where Stash was last put down, or null for the corner
  pickedUpHint: false,       // the one-time "this is my spot now" tip has been shown
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (_) { /* first run */ }
  }
  get(k) { return this.data[k]; }
  all() { return { ...this.data }; }
  set(k, v) {
    if (!(k in DEFAULTS)) return false;
    this.data[k] = v;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); } catch (_) { /* disk full etc: keep in memory */ }
    return true;
  }
}

module.exports = { Settings, DEFAULTS };
