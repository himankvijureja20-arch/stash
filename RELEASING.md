# Releasing Stash

How to turn this folder into something your friends can download, and how to ship updates.
Everything here is free. The repository is `himankvijureja20-arch/stash`; the download page is `https://himankvijureja20-arch.github.io/stash/`.

## One-time setup

### 1. Move the project out of OneDrive (recommended)
OneDrive tries to sync `node_modules` (tens of thousands of files) and `dist`, which is slow and can lock files.
Copy the `app` folder to something like `C:\dev\stash`, and work from there from now on.

### 2. Make a GitHub account and a repository
1. Sign up at github.com (free).
2. Create a new **public** repository called `stash`. (Public matters: it lets Stash check for updates without a password.)
3. In `package.json`, replace `REPLACE-WITH-YOUR-GITHUB-NAME` with your GitHub username in two places:
   `homepage` and `build.publish[0].owner`.
4. In a terminal inside the project folder:
   ```
   git init
   git add .
   git commit -m "Stash 0.1.0"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/stash.git
   git push -u origin main
   ```
   (`node_modules` and `dist` are already excluded by `.gitignore`.)

### 3. Put the download page online (GitHub Pages)
1. Rebuild the page so it points at your repo: `node docs/build-site.mjs`, then commit and push.
2. On GitHub: repository **Settings, Pages**. Under "Build and deployment" choose **Deploy from a branch**, branch `main`, folder `/docs`. Save.
3. After a minute your page is live at `https://YOUR-NAME.github.io/stash/`. Share that link with friends.

## Publishing a version

1. Make a GitHub **personal access token**: GitHub, Settings, Developer settings, Personal access tokens, "Tokens (classic)", tick **repo**, generate. Copy it.
2. In PowerShell, in the project folder (the token only lives in this window, never in a file):
   ```
   $env:GH_TOKEN = "paste-the-token-here"
   npm run dist
   ```
   `npm run dist` builds the installer. To also upload it straight to GitHub as a draft release, use:
   ```
   npx electron-builder --win --publish always
   ```
3. On GitHub, open the new **draft release**, check it, and press **Publish release**.
4. The page's Download button (`.../releases/latest/download/Stash-Setup.exe`) now serves that installer.

## Shipping an update
1. Change `"version"` in `package.json` (for example `0.1.0` to `0.1.1`).
2. Repeat "Publishing a version".
3. Everyone who has Stash installed gets it automatically: Stash checks shortly after launch and every 6 hours,
   downloads quietly, shows a toast, and installs when they quit (or from the tray menu: **Restart to update Stash**).

Updates stay switched off until the GitHub name in `package.json` is real, so nothing breaks before you publish.

## Telling friends how to connect Figma (one time)
The Stash plugin ships inside the installer. In Stash's tray menu there is **Set up the Figma plugin...**, which
opens the plugin file in Explorer. Then in the **Figma desktop app**:
Plugins, Development, **Import plugin from manifest...**, pick that file. After that, open it from
Plugins, Development, Stash whenever you want images to flow in, and click **Allow** in the Stash pop-up the first time.

Publishing the plugin to the Figma Community is not recommended: Figma only allows local-network access for
plugins that are loaded in development mode, so friends import it once instead.

## Good to know
- **"Windows protected your PC" warning.** The installer isn't code-signed, so Windows SmartScreen shows this
  to new users. They click **More info, Run anyway**. The warning fades as more people install. To remove it
  you would buy a code-signing certificate (about $100 to $300 a year) and add it to the build. It is optional.
- **Mac.** Not supported yet.
- **Where things live on a friend's PC.** App: `%LOCALAPPDATA%\Programs\Stash`. Images and settings:
  `%APPDATA%\Stash`. Uninstalling removes the app but leaves the images.
- **Testing before you publish.** `npm test` (fast checks), `npm run selftest` (drives the running app),
  `npm run realtest` (moves the real mouse; hands off while it runs), `npm run pack` then
  `npm run selftest:packaged` (runs the whole self-test against the built app).
- **If the build says "Cannot create symbolic link".** Windows only lets the build tools make symbolic links when
  **Developer Mode** is on (Settings, System, For developers, Developer Mode). Turn it on once and build again.
  (On this PC the tools were unpacked by hand instead, so it built without it.)
