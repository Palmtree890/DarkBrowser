import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), '..');
const SHOT_DIR = '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

// Launch a standalone Electron window just to render splash.html
const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', APP_DIR],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' },
  timeout: 30_000,
});

// Inspect all webContents including the splash
await new Promise(r => setTimeout(r, 1200));

try {
  const wcs = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map(w => ({ id: w.id, type: w.getType(), url: w.getURL() })));
  console.log('All webContents:');
  wcs.forEach(w => console.log(` [${w.id}] ${w.type}: ${w.url}`));

  // Find the splash by URL
  const splashWc = wcs.find(w => w.url.includes('splash'));
  if (splashWc) {
    console.log('Found splash at id', splashWc.id);
    // Screenshot via CDP
    const result = await app.evaluate(async ({ webContents }, id) => {
      const wc = webContents.fromId(id);
      if (!wc) return null;
      const img = await wc.capturePage();
      return img.toDataURL();
    }, splashWc.id);
    if (result) {
      const base64 = result.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(SHOT_DIR, 'splash.png'), Buffer.from(base64, 'base64'));
      console.log('→ /tmp/shots/splash.png');
    }
  } else {
    console.log('Splash not found in webContents — taking screenshot of all windows');
  }
} catch(e) {
  console.log('Error:', e.message);
}

// Screenshot all windows anyway
const wins = app.windows();
for (let i = 0; i < wins.length; i++) {
  const url = wins[i].url();
  const name = url.includes('splash') ? 'splash-win' : `win-${i}`;
  await wins[i].screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  console.log(`→ /tmp/shots/${name}.png (${url})`);
}

await app.close();
