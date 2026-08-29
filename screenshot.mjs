import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), '..');
const SHOT_DIR = '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron');

console.log('Launching DarkBrowser...');
const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', APP_DIR],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' },
  timeout: 30_000,
});

// Wait for the app to load
await new Promise(r => setTimeout(r, 7_000));

const wins = app.windows();
console.log('Windows:', wins.length);
wins.forEach((w, i) => console.log(` [${i}] ${w.url()}`));

// Inspect all webContents to find the toolbar page vs BrowserViews
try {
  const wcs = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map(w => ({ id: w.id, type: w.getType(), url: w.getURL() })));
  console.log('All webContents:');
  wcs.forEach(w => console.log(` [${w.id}] ${w.type}: ${w.url}`));
} catch(e) {
  console.log('webContents eval:', e.message);
}

// Screenshot each window
for (let i = 0; i < wins.length; i++) {
  const w = wins[i];
  const url = w.url();
  const name = url.includes('newtab') ? 'newtab' : url.includes('index') ? 'toolbar' : `window-${i}`;
  const f = path.join(SHOT_DIR, `${name}.png`);
  try {
    await w.screenshot({ path: f });
    console.log(`screenshot [${i}] → ${f}`);
  } catch(e) {
    console.log(`screenshot [${i}] failed:`, e.message);
  }
}

// The toolbar window is our main UI. Take a full screenshot of it.
const toolbarPage = wins.find(w => w.url().includes('index.html')) ?? wins[0];
if (toolbarPage) {
  const f = path.join(SHOT_DIR, 'darkbrowser-main.png');
  await toolbarPage.screenshot({ path: f });
  console.log('Main screenshot:', f);

  // Check the DOM of the toolbar
  const bodyText = await toolbarPage.evaluate(() => document.body?.innerText?.slice(0, 400));
  console.log('Toolbar body text:', bodyText);

  // Check the network switcher state
  const netBtns = await toolbarPage.evaluate(() =>
    [...document.querySelectorAll('.net-btn')].map(b => ({
      text: b.textContent?.trim(),
      active: b.className
    }))
  );
  console.log('Network buttons:', JSON.stringify(netBtns));
}

await app.close();
console.log('Done.');
