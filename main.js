const { app, BrowserWindow, BrowserView, ipcMain, session, nativeImage } = require('electron');
const path  = require('path');
const net   = require('net');
const fs    = require('fs');
const { spawn, execSync } = require('child_process');

const TOOLBAR_HEIGHT = 116;
const TOR_SOCKS_PORT = 9050;
const I2P_HTTP_PORT  = 4444;
const appStartTime   = Date.now();

// Set app identity before any window is created
app.setName('DarkBrowser');

// Runtime daemons are unpacked beside the app archive in production so they
// remain executable. During development they are read directly from ./bin.
const runtimeBinDir = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin')
  : path.join(__dirname, 'bin');

let mainWindow;
let splashWindow;
let browserSession;
let currentNetwork = 'tor';
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;

// ── Daemon manager ────────────────────────────────────────────────────────────

const daemons = {
  tor:  { proc: null, status: 'stopped', bootstrap: 0, desc: '' },
  i2p:  { proc: null, status: 'stopped' },
};

function findBinary(...names) {
  const dirs = [
    path.join(runtimeBinDir, 'linux'),
    '/usr/sbin', '/usr/bin', '/usr/local/sbin', '/usr/local/bin',
    path.join(process.env.HOME || '', '.local', 'bin'),
  ];
  for (const name of names) {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
    try { const r = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim(); if (r) return r; }
    catch { /* not in PATH */ }
  }
  return null;
}

function emitDaemonStatus(name, patch) {
  Object.assign(daemons[name], patch);
  sendToRenderer('daemon-status', { name, ...daemons[name] });
}

async function startTor() {
  if (daemons.tor.proc) return;

  // If Tor is already running (system service), just mark it ready
  if (await checkPort('127.0.0.1', TOR_SOCKS_PORT)) {
    emitDaemonStatus('tor', { status: 'ready', bootstrap: 100, desc: 'System service' });
    return;
  }

  const bin = findBinary('tor');
  if (!bin) {
    emitDaemonStatus('tor', { status: 'missing' });
    return;
  }

  const dataDir = path.join(app.getPath('userData'), 'tor-data');
  fs.mkdirSync(dataDir, { recursive: true });

  const geoip  = path.join(runtimeBinDir, 'geoip', 'geoip');
  const geoip6 = path.join(runtimeBinDir, 'geoip', 'geoip6');

  const torrcLines = [
    `SocksPort ${TOR_SOCKS_PORT}`,
    'ControlPort 9051',
    'CookieAuthentication 1',
    `DataDirectory ${dataDir}`,
    'Log notice stdout',
    'MaxCircuitDirtiness 600',
  ];
  if (fs.existsSync(geoip))  torrcLines.push(`GeoIPFile ${geoip}`);
  if (fs.existsSync(geoip6)) torrcLines.push(`GeoIPv6File ${geoip6}`);

  const torrcPath = path.join(dataDir, 'torrc');
  fs.writeFileSync(torrcPath, torrcLines.join('\n') + '\n');

  emitDaemonStatus('tor', { status: 'starting', bootstrap: 0, desc: 'Initialising...' });

  const proc = spawn(bin, ['-f', torrcPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  daemons.tor.proc = proc;

  let buf = '';
  const onData = data => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const m = line.match(/Bootstrapped (\d+)%[^:]*:\s*(.+)/);
      if (m) {
        const pct = parseInt(m[1]);
        emitDaemonStatus('tor', {
          status: pct === 100 ? 'ready' : 'starting',
          bootstrap: pct,
          desc: m[2].trim(),
        });
      }
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('exit', code => {
    daemons.tor.proc = null;
    emitDaemonStatus('tor', { status: 'stopped', bootstrap: 0, desc: `exited (${code})` });
  });
}

async function startI2pd() {
  if (daemons.i2p.proc) return;

  // If I2P is already running (system service), just mark it ready
  if (await checkPort('127.0.0.1', I2P_HTTP_PORT)) {
    emitDaemonStatus('i2p', { status: 'ready', desc: 'System service' });
    return;
  }

  // Prefer i2pd (C++), fall back to i2prouter (Java I2P)
  const bin = findBinary('i2pd', 'i2prouter');
  if (!bin) {
    emitDaemonStatus('i2p', { status: 'missing' });
    return;
  }

  emitDaemonStatus('i2p', { status: 'starting' });

  let proc;
  if (bin.endsWith('i2prouter')) {
    // Java I2P router — just tell it to start; it daemonises itself
    proc = spawn(bin, ['start'], { stdio: 'ignore', detached: true });
    proc.unref();
    daemons.i2p.proc = null; // We don't own this process

    // Poll until port 4444 opens
    const pollStart = Date.now();
    const poll = setInterval(async () => {
      if (await checkPort('127.0.0.1', I2P_HTTP_PORT)) {
        clearInterval(poll);
        emitDaemonStatus('i2p', { status: 'ready', desc: 'Java I2P router' });
      } else if (Date.now() - pollStart > 120_000) {
        clearInterval(poll);
        emitDaemonStatus('i2p', { status: 'stopped', desc: 'Timed out waiting for I2P' });
      }
    }, 3000);
    return;
  }

  // i2pd
  const dataDir = path.join(app.getPath('userData'), 'i2pd-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const conf = path.join(runtimeBinDir, 'config', 'i2pd.conf');
  const args = [`--datadir=${dataDir}`, '--log=stdout'];
  if (fs.existsSync(conf)) args.push(`--conf=${conf}`);

  proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  daemons.i2p.proc = proc;

  let buf = '';
  const onData = data => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.includes('HTTP Proxy started') || line.includes('Tunnels creation started')) {
        emitDaemonStatus('i2p', { status: 'ready', desc: 'i2pd' });
      }
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('exit', code => {
    daemons.i2p.proc = null;
    emitDaemonStatus('i2p', { status: 'stopped', desc: `exited (${code})` });
  });
}

function stopDaemons() {
  for (const d of Object.values(daemons)) {
    if (d.proc) { d.proc.kill('SIGTERM'); d.proc = null; }
  }
}

// ── Port check ───────────────────────────────────────────────────────────────

function checkPort(host, port, timeout = 2000) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error',   () => resolve(false));
    s.connect(port, host);
  });
}

// ── Favicon fetcher ──────────────────────────────────────────────────────────
// Uses session.fetch() — proxy-aware, resolves to a data URL the renderer can use

async function fetchFavicon(url) {
  if (!url || !browserSession) return null;
  if (url.startsWith('data:')) return url;  // already inlined, use directly
  try {
    const res = await browserSession.fetch(url);
    if (!res.ok) return null;
    const buf  = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get('content-type') || 'image/x-icon').split(';')[0].trim();
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// Extract the best favicon URL from the page DOM, falling back to /favicon.ico
async function getFaviconUrl(webContents) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const sel = [
          "link[rel='icon'][type*='image']",
          "link[rel='icon']",
          "link[rel='shortcut icon']",
          "link[rel='apple-touch-icon']",
        ];
        for (const s of sel) {
          const el = document.querySelector(s);
          if (el?.href) return el.href;
        }
        const o = location.origin;
        return (o && o !== 'null') ? o + '/favicon.ico' : null;
      })()
    `);
  } catch {
    return null;
  }
}

// ── URL helpers ──────────────────────────────────────────────────────────────

function smartUrl(input) {
  input = input.trim();
  if (/^https?:\/\//i.test(input)) return input;
  if (input.endsWith('.onion') || /\.onion\//.test(input)) return 'http://' + input;
  if (input.endsWith('.i2p')   || /\.i2p\//.test(input))   return 'http://' + input;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(input) && !input.includes(' ')) return 'https://' + input;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(input);
}

// ── Proxy ────────────────────────────────────────────────────────────────────

async function applyProxy(network) {
  const rules = {
    tor:    `socks5://127.0.0.1:${TOR_SOCKS_PORT}`,
    i2p:    `http://127.0.0.1:${I2P_HTTP_PORT}`,
    direct: 'direct://',
  };
  await browserSession.setProxy({ proxyRules: rules[network] || 'direct://' });
  currentNetwork = network;
}

// ── IPC helpers ──────────────────────────────────────────────────────────────

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// ── Tab management ───────────────────────────────────────────────────────────

function getTabsState() {
  return tabs.map(t => ({
    id: t.id, title: t.title, url: t.url,
    isLoading: t.isLoading, isActive: t.id === activeTabId,
  }));
}

function createTab(url) {
  const id   = ++tabIdCounter;
  const view = new BrowserView({
    webPreferences: {
      session: browserSession,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  const tab = { id, view, title: 'New Tab', url: '', isLoading: false };
  tabs.push(tab);

  view.webContents.on('did-navigate', (_, u) => {
    tab.url = u; tab.isLoading = false;
    sendToRenderer('tab-updated', { id, url: u, isLoading: false });
    sendToRenderer('nav-state', {
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      url: u,
    });
  });
  view.webContents.on('did-navigate-in-page', (_, u) => {
    tab.url = u;
    sendToRenderer('tab-updated', { id, url: u });
    sendToRenderer('nav-state', {
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      url: u,
    });
  });
  view.webContents.on('did-start-loading', () => {
    tab.isLoading = true;
    sendToRenderer('tab-updated', { id, isLoading: true });
  });
  view.webContents.on('did-stop-loading', () => {
    tab.isLoading = false;
    sendToRenderer('tab-updated', { id, isLoading: false, url: view.webContents.getURL() });
  });
  view.webContents.on('page-title-updated', (_, title) => {
    tab.title = title || 'Untitled';
    sendToRenderer('tab-updated', { id, title: tab.title });
  });
  view.webContents.on('page-favicon-updated', async (_, favicons) => {
    const url = favicons?.[0];
    if (!url) return;
    const dataUrl = await fetchFavicon(url);
    if (dataUrl) sendToRenderer('tab-updated', { id, favicon: dataUrl });
  });

  // Fallback: query DOM after load for sites that don't emit page-favicon-updated
  view.webContents.on('did-finish-load', async () => {
    const pageUrl = view.webContents.getURL();
    if (!pageUrl || pageUrl.startsWith('file://')) return;
    const faviconUrl = await getFaviconUrl(view.webContents);
    if (!faviconUrl) return;
    const dataUrl = await fetchFavicon(faviconUrl);
    if (dataUrl) sendToRenderer('tab-updated', { id, favicon: dataUrl });
  });
  view.webContents.on('new-window', (event, newUrl) => {
    event.preventDefault();
    const newId = createTab(newUrl);
    setActiveTab(newId);
  });

  setActiveTab(id);
  if (url) view.webContents.loadURL(smartUrl(url));
  else     view.webContents.loadFile(path.join(__dirname, 'src', 'newtab.html'));

  return id;
}

function setActiveTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  tabs.forEach(t => { if (mainWindow.getBrowserViews().includes(t.view)) mainWindow.removeBrowserView(t.view); });
  activeTabId = id;
  mainWindow.addBrowserView(tab.view);
  updateBrowserViewBounds();
  sendToRenderer('tabs-state', getTabsState());
  sendToRenderer('nav-state', {
    canGoBack: tab.view.webContents.canGoBack(),
    canGoForward: tab.view.webContents.canGoForward(),
    url: tab.url,
  });
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (mainWindow.getBrowserViews().includes(tab.view)) mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.splice(idx, 1);
  if (tabs.length === 0) { createTab(); return; }
  if (id === activeTabId) setActiveTab(tabs[Math.min(idx, tabs.length - 1)].id);
  else sendToRenderer('tabs-state', getTabsState());
}

function updateBrowserViewBounds() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const [w, h] = mainWindow.getContentSize();
  tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: Math.max(w, 0), height: Math.max(h - TOOLBAR_HEIGHT, 0) });
}

// ── Window ───────────────────────────────────────────────────────────────────

const appIcon = nativeImage.createFromPath(
  path.join(__dirname, 'src', 'images', 'icon-512.png')
);

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 480,
    frame: false,
    resizable: false,
    transparent: false,
    backgroundColor: '#08080f',
    icon: appIcon,
    skipTaskbar: true,
    center: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, 'src', 'splash.html'));
}

function closeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  // Trigger CSS fade-out then close
  splashWindow.webContents.executeJavaScript("document.body.classList.add('fade-out')");
  setTimeout(() => {
    if (!splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
  }, 380);
}

function createWindow() {
  browserSession = session.fromPartition('darkbrowser-private');

  // Show splash immediately
  createSplash();

  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#0a0a14',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.on('did-finish-load', async () => {
    await applyProxy(currentNetwork);
    createTab();
    sendToRenderer('network-changed', currentNetwork);
    sendToRenderer('tabs-state', getTabsState());

    // Start daemons (async — check port first, spawn only if needed)
    startTor();
    startI2pd();

    // Initial port check
    const [tor, i2p] = await Promise.all([
      checkPort('127.0.0.1', TOR_SOCKS_PORT),
      checkPort('127.0.0.1', I2P_HTTP_PORT),
    ]);
    sendToRenderer('network-status', { tor, i2p });

    // Ensure splash shows for at least 2.5s, then reveal main window
    const SPLASH_MIN_MS = 2500;
    const elapsed = Date.now() - appStartTime;
    setTimeout(() => {
      mainWindow.setIcon(appIcon);   // re-assert icon right before showing
      mainWindow.show();
      closeSplash();
    }, Math.max(0, SPLASH_MIN_MS - elapsed));
  });

  mainWindow.on('resize',    updateBrowserViewBounds);
  mainWindow.on('maximize',  updateBrowserViewBounds);
  mainWindow.on('unmaximize', updateBrowserViewBounds);

  setInterval(async () => {
    const [tor, i2p] = await Promise.all([
      checkPort('127.0.0.1', TOR_SOCKS_PORT),
      checkPort('127.0.0.1', I2P_HTTP_PORT),
    ]);
    sendToRenderer('network-status', { tor, i2p });
  }, 30_000);
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('navigate', async (_, input) => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const url = smartUrl(input);
  const suggestion =
    (url.includes('.onion') && currentNetwork !== 'tor') ? 'tor' :
    (url.includes('.i2p')   && currentNetwork !== 'i2p') ? 'i2p' : null;
  tab.view.webContents.loadURL(url);
  return { url, suggestion };
});

ipcMain.handle('go-back',    () => { const t = tabs.find(t => t.id === activeTabId); if (t?.view.webContents.canGoBack())    t.view.webContents.goBack(); });
ipcMain.handle('go-forward', () => { const t = tabs.find(t => t.id === activeTabId); if (t?.view.webContents.canGoForward()) t.view.webContents.goForward(); });
ipcMain.handle('reload',     () => { const t = tabs.find(t => t.id === activeTabId); if (t) { if (t.isLoading) t.view.webContents.stop(); else t.view.webContents.reload(); } });

ipcMain.handle('new-tab',    (_, url) => { createTab(url || null); sendToRenderer('tabs-state', getTabsState()); });
ipcMain.handle('close-tab',  (_, id)  => closeTab(id));
ipcMain.handle('switch-tab', (_, id)  => setActiveTab(id));

ipcMain.handle('switch-network', async (_, network) => {
  await applyProxy(network);
  sendToRenderer('network-changed', network);
  return { network };
});

ipcMain.handle('check-network-status', async () => {
  const [tor, i2p] = await Promise.all([
    checkPort('127.0.0.1', TOR_SOCKS_PORT),
    checkPort('127.0.0.1', I2P_HTTP_PORT),
  ]);
  return { tor, i2p };
});

ipcMain.handle('get-state', () => ({ network: currentNetwork, tabs: getTabsState() }));

ipcMain.handle('restart-daemon', (_, name) => {
  if (name === 'tor') { if (daemons.tor.proc) { daemons.tor.proc.kill(); daemons.tor.proc = null; } setTimeout(startTor,  500); }
  if (name === 'i2p') { if (daemons.i2p.proc) { daemons.i2p.proc.kill(); daemons.i2p.proc = null; } setTimeout(startI2pd, 500); }
});

ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); });
ipcMain.handle('window-close',    () => mainWindow.close());

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('before-quit', stopDaemons);
app.on('window-all-closed', () => { stopDaemons(); if (process.platform !== 'darwin') app.quit(); });
