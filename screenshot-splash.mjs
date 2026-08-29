import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), '..');
const SHOT_DIR = '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', APP_DIR],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' },
  timeout: 30_000,
});

// Catch splash early — it closes after ~2.5s
await new Promise(r => setTimeout(r, 1800));

const wins = app.windows();
console.log('Windows at 1.8s:', wins.map(w => w.url()));

// Screenshot all windows — splash will be one of them
for (let i = 0; i < wins.length; i++) {
  const url = wins[i].url();
  const name = url.includes('splash') ? 'splash' : url.includes('newtab') ? 'newtab' : `main-${i}`;
  const f = path.join(SHOT_DIR, `${name}.png`);
  await wins[i].screenshot({ path: f });
  console.log(`→ ${f}`);
}

// Wait for main window to appear then screenshot it too
await new Promise(r => setTimeout(r, 2000));
const wins2 = app.windows();
console.log('Windows at 3.8s:', wins2.map(w => w.url()));
for (const w of wins2) {
  if (w.url().includes('index')) {
    await w.screenshot({ path: path.join(SHOT_DIR, 'main-after-splash.png') });
    console.log('→ main-after-splash.png');
  }
}

await app.close();
