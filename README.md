# Stash (app)

A squirrel that lives on your desktop and hoards your inspo, then dumps it into Figma as a moodboard.
Windows only. Designed in Figma (not public).

## Run it
```
npm install
npm start
```

## Tests
```
npm test            # data layer + Figma bridge + plugin placement (mock Figma) + ping-pong rules and AI difficulty
npm run selftest    # drives the real app through the Figma interaction table (about 3 minutes, uses a throwaway data folder)
npm run realtest    # moves the REAL mouse and clicks (hands off while it runs; quit Stash first): checks that real hovering/clicking reach Stash
```

## The Figma plugin
In **Figma desktop** (not the browser): Plugins > Development > Import plugin from manifest... and pick
`figma-plugin/manifest.json`. Then run Plugins > Development > Stash. The first time, click **Allow** in the
Stash pop-up. Keep the plugin open (minimised is fine) and images land in the file by themselves.

## Layout
- `src/main` Electron main process: overlay window, tray, hotkey, clipboard watcher, local bridge to the plugin
- `src/main/core` image intake, dedupe, collections, the plugin bridge (no Electron, fully unit tested)
- `src/renderer` the squirrel (`squirrel.js` rebuilt from the Figma layers), behaviour engine (`app.js`), collection panel, settings window, clipboard prompt
- `figma-plugin` the Stash plugin
- `assets/icons` app + tray icons exported from Figma

## Sharing it
`npm run dist` builds the installer (`Stash-Setup.exe`); `npm run pack` builds just the app folder for testing.
`docs/` is the download page (`node docs/build-site.mjs` regenerates it). See **RELEASING.md** for putting it on GitHub,
publishing a version and shipping updates.
