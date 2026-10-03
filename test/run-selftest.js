// Launches the real app in self-test mode (fast timers, throwaway data folder, no auto-roam)
// and exits with the app's result code.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-selftest-data-'));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ roamEnabled: false, patrolReminder: true, onboarded: true }));
const out = process.env.STASH_SELFTEST_OUT || '';
if (out) fs.mkdirSync(out, { recursive: true });

// --packaged runs the built app (STASH_EXE, or dist output) instead of the source, to prove the installer's files work
const packaged = process.argv.includes('--packaged');
const exe = process.env.STASH_EXE || path.join(process.env.STASH_DIST || path.join(__dirname, '..', 'dist'), 'win-unpacked', 'Stash.exe');
if (packaged && !fs.existsSync(exe)) { console.error('Packaged app not found: ' + exe + ' (run npm run pack first)'); process.exit(2); }
const child = spawn(packaged ? exe : electron, packaged ? [] : ['.'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, STASH_SELFTEST: '1', STASH_DATA: data, STASH_MULTI: '1', STASH_AUTOALLOW: '1', STASH_TIME_SCALE: '10', STASH_NO_LOGIN_ITEM: '1', STASH_SELFTEST_OUT: out },
});
child.on('exit', (code) => { fs.rmSync(data, { recursive: true, force: true }); process.exit(code ?? 1); });
