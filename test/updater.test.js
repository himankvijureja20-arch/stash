// Update-feed rules: updates stay OFF until a real release location exists, and switch on for a test feed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFeed } = require('../src/main/updater');

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; } };
const fakeApp = (packaged) => ({ isPackaged: packaged });
const withResources = (yml, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-res-'));
  if (yml != null) fs.writeFileSync(path.join(dir, 'app-update.yml'), yml);
  const old = process.resourcesPath; process.resourcesPath = dir;
  try { fn(); } finally { process.resourcesPath = old; fs.rmSync(dir, { recursive: true, force: true }); }
};
delete process.env.STASH_UPDATE_URL;

console.log('Updater');
t('running from source: updates are off', () => assert.strictEqual(readFeed(fakeApp(false)), null));
t('installed app with the placeholder GitHub name: updates are off', () => withResources('provider: github\nowner: REPLACE-WITH-YOUR-GITHUB-NAME\nrepo: stash\n', () => assert.strictEqual(readFeed(fakeApp(true)), null)));
t('installed app with a real GitHub name: updates are on', () => withResources('provider: github\nowner: himank\nrepo: stash\n', () => assert.deepStrictEqual(readFeed(fakeApp(true)), { kind: 'file' })));
t('installed app with no update file at all: updates are off', () => withResources(null, () => assert.strictEqual(readFeed(fakeApp(true)), null)));
t('a test feed URL switches updates on even from source', () => { process.env.STASH_UPDATE_URL = 'http://localhost:5050'; assert.deepStrictEqual(readFeed(fakeApp(false)), { kind: 'url', url: 'http://localhost:5050' }); delete process.env.STASH_UPDATE_URL; });
console.log(`\n${passed} updater checks passed${process.exitCode ? ', some FAILED' : ''}`);
