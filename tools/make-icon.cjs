'use strict';
/* One-off: render tools/icon.html offscreen at 512x512 → build/icon.png (electron-builder
 * converts to .ico) + resources/icon.png (tray, runtime). Run: npx electron tools/make-icon.cjs */
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('fs');
const path = require('path');

const SETTLE_MS = 700;

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, sandbox: true }
  });
  let latest = null;
  win.webContents.on('paint', (_e, _d, image) => {
    latest = image;
  });
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      if (!latest) {
        console.error('no paint received');
        app.exit(1);
        return;
      }
      const root = path.join(__dirname, '..');
      mkdirSync(path.join(root, 'build'), { recursive: true });
      writeFileSync(path.join(root, 'build', 'icon.png'), latest.toPNG());
      writeFileSync(path.join(root, 'resources', 'icon.png'), latest.toPNG());
      console.log('icon written: build/icon.png + resources/icon.png', latest.getSize());
      app.exit(0);
    }, SETTLE_MS);
  });
  win.loadFile(path.join(__dirname, 'icon.html')).catch((e) => {
    console.error(e);
    app.exit(1);
  });
});
