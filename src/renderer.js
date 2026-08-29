'use strict';

const db = window.darkBrowser;

let currentNetwork = 'tor';
let activeTabId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tabsContainer = document.getElementById('tabs-container');
const addressBar    = document.getElementById('address-bar');
const loadIndicator = document.getElementById('load-indicator');
const securityIcon  = document.getElementById('security-icon');
const btnBack       = document.getElementById('btn-back');
const btnForward    = document.getElementById('btn-forward');
const btnReload     = document.getElementById('btn-reload');

// ── Network switcher ──────────────────────────────────────────────────────────

document.querySelectorAll('.net-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const network = btn.dataset.network;
    setNetworkActive(network);
    await db.switchNetwork(network);
  });

  // Right-click to restart daemon
  btn.addEventListener('contextmenu', e => {
    e.preventDefault();
    const network = btn.dataset.network;
    if (network !== 'direct') db.restartDaemon(network);
  });
});

function setNetworkActive(network) {
  currentNetwork = network;
  document.querySelectorAll('.net-btn').forEach(b => {
    b.classList.remove('active-tor', 'active-i2p', 'active-direct');
  });
  document.getElementById('net-' + network)?.classList.add('active-' + network);
  const colors = { tor: '#a855f7', i2p: '#10b981', direct: '#60a5fa' };
  document.documentElement.style.setProperty('--active-color', colors[network] || '#a855f7');
  securityIcon.style.color = colors[network] || '#475569';
}

// ── Daemon status on network buttons ─────────────────────────────────────────

function updateDaemonStatus({ name, status, bootstrap, desc }) {
  const btn     = document.getElementById('net-' + name);
  const dot     = document.getElementById('dot-' + name);
  const subtext = document.getElementById('sub-' + name);
  if (!btn) return;

  // Update dot
  if (dot) {
    dot.className = 'net-dot';
    if (status === 'ready')    dot.classList.add(`online-${name}`);
    else if (status === 'stopped' || status === 'missing') dot.classList.add('offline');
    else if (status === 'starting') dot.classList.add('spinning');
  }

  // Update sub-label
  if (subtext) {
    if (name === 'tor') {
      if (status === 'ready')    subtext.textContent = 'Ready';
      else if (status === 'starting') subtext.textContent = bootstrap ? `${bootstrap}%` : 'Starting…';
      else if (status === 'missing')  subtext.textContent = 'Not found';
      else                            subtext.textContent = 'Stopped';
    } else {
      if (status === 'ready')    subtext.textContent = 'Ready';
      else if (status === 'starting') subtext.textContent = 'Starting…';
      else if (status === 'missing')  subtext.textContent = 'Not found';
      else                            subtext.textContent = 'Stopped';
    }
  }

  // Bootstrap progress bar on TOR button
  if (name === 'tor') {
    let bar = btn.querySelector('.tor-progress');
    if (status === 'starting' && bootstrap > 0) {
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'tor-progress';
        btn.appendChild(bar);
      }
      bar.style.width = bootstrap + '%';
    } else {
      bar?.remove();
    }
  }

  btn.title = desc || '';
}

// ── Tab rendering ─────────────────────────────────────────────────────────────

function renderTabs(tabsState) {
  tabsContainer.innerHTML = '';
  tabsState.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.isActive ? ' active' : '');
    el.dataset.id = tab.id;

    if (tab.isActive) activeTabId = tab.id;

    if (tab.isLoading) {
      const spinner = document.createElement('div');
      spinner.className = 'tab-spinner';
      el.appendChild(spinner);
    } else {
      const fav = document.createElement('span');
      fav.className = 'tab-favicon';
      fav.innerHTML = '&#128196;';
      el.appendChild(fav);
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New Tab';
    el.appendChild(title);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.innerHTML = '&#10005;';
    close.addEventListener('click', e => { e.stopPropagation(); db.closeTab(tab.id); });
    el.appendChild(close);

    el.addEventListener('click', () => { activeTabId = tab.id; db.switchTab(tab.id); });
    if (tab.isActive) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    tabsContainer.appendChild(el);
  });
}

function updateTab(data) {
  const el = tabsContainer.querySelector(`.tab[data-id="${data.id}"]`);
  if (!el) return;

  if (data.title !== undefined) {
    const t = el.querySelector('.tab-title');
    if (t) t.textContent = data.title;
  }

  if (data.isLoading !== undefined) {
    const spinner = el.querySelector('.tab-spinner');
    if (data.isLoading && !spinner) {
      const s = document.createElement('div');
      s.className = 'tab-spinner';
      el.insertBefore(s, el.firstChild);
      el.querySelector('.tab-favicon')?.remove();
    } else if (!data.isLoading && spinner) {
      spinner.remove();
      const fav = document.createElement('span');
      fav.className = 'tab-favicon';
      fav.innerHTML = '&#128196;';
      el.insertBefore(fav, el.firstChild);
    }
  }

  if (data.favicon) {
    const fav = el.querySelector('.tab-favicon');
    if (fav) {
      const img = document.createElement('img');
      img.style.cssText = 'width:14px;height:14px;object-fit:contain;border-radius:2px;';
      img.src = data.favicon;
      img.onerror = () => { fav.innerHTML = '📄'; };
      fav.innerHTML = '';
      fav.appendChild(img);
    }
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

addressBar.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const result = await db.navigate(addressBar.value);
  if (result?.suggestion) showNetworkSuggestion(result.suggestion);
});
addressBar.addEventListener('focus', () => addressBar.select());

btnBack.addEventListener('click',    () => db.goBack());
btnForward.addEventListener('click', () => db.goForward());
btnReload.addEventListener('click',  () => db.reload());

document.getElementById('btn-new-tab').addEventListener('click', () => db.newTab());
document.getElementById('btn-minimize').addEventListener('click', () => db.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => db.maximize());
document.getElementById('btn-close').addEventListener('click',    () => db.close());

function showNetworkSuggestion(network) {
  const names = { tor: 'Tor', i2p: 'I2P' };
  const colors = { tor: '#7c3aed', i2p: '#059669' };
  const old = document.getElementById('net-suggestion');
  if (old) old.remove();

  const banner = document.createElement('div');
  banner.id = 'net-suggestion';
  banner.style.cssText = `
    position:fixed;top:116px;left:50%;transform:translateX(-50%);
    background:#1a1a2e;border:1px solid #3a3a60;border-radius:8px;
    padding:10px 18px;color:#e2e8f0;font-size:13px;z-index:9999;
    box-shadow:0 4px 20px rgba(0,0,0,.5);display:flex;align-items:center;gap:12px;
  `;
  banner.innerHTML = `
    <span>This looks like a <strong>${names[network]}</strong> address.</span>
    <button style="padding:4px 10px;border-radius:5px;border:none;cursor:pointer;
      background:${colors[network]};color:#fff;font-size:12px;font-weight:600">
      Switch to ${names[network]}
    </button>
    <button style="padding:4px 8px;border-radius:5px;border:1px solid #3a3a60;
      background:transparent;color:#94a3b8;cursor:pointer;font-size:12px">
      Dismiss
    </button>
  `;
  const [switchBtn, dismissBtn] = banner.querySelectorAll('button');
  switchBtn.addEventListener('click', async () => {
    setNetworkActive(network);
    await db.switchNetwork(network);
    banner.remove();
  });
  dismissBtn.addEventListener('click', () => banner.remove());
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 8000);
}

// ── Main process events ───────────────────────────────────────────────────────

db.on('tabs-state', renderTabs);

db.on('tab-updated', data => {
  if (data.id === activeTabId && data.isLoading !== undefined) {
    if (data.isLoading) {
      loadIndicator.classList.remove('hidden');
      btnReload.innerHTML = '&#10005;';
      btnReload.title = 'Stop';
    } else {
      loadIndicator.classList.add('hidden');
      btnReload.innerHTML = '&#8635;';
      btnReload.title = 'Reload';
    }
  }
  updateTab(data);
});

db.on('nav-state', ({ canGoBack, canGoForward, url }) => {
  btnBack.disabled    = !canGoBack;
  btnForward.disabled = !canGoForward;
  if (url && !url.startsWith('file://')) {
    addressBar.value = url;
    securityIcon.textContent = url.startsWith('https://') ? '🔒' : '⚠';
  } else if (url?.startsWith('file://')) {
    addressBar.value = '';
    addressBar.placeholder = 'Search or enter address...';
  }
});

db.on('network-changed', network => setNetworkActive(network));

db.on('network-status', ({ tor, i2p }) => {
  // Only update dot if daemon manager hasn't already painted it
  const torBtn = document.getElementById('net-tor');
  const i2pBtn = document.getElementById('net-i2p');
  const torDot  = torBtn?.querySelector('.net-dot');
  const i2pDot  = i2pBtn?.querySelector('.net-dot');
  // Only use port-check result if daemon is 'stopped' (not managed by us)
  if (torDot && !torDot.classList.contains('online-tor') && !torDot.classList.contains('spinning')) {
    torDot.className = 'net-dot ' + (tor ? 'online-tor' : 'offline');
  }
  if (i2pDot && !i2pDot.classList.contains('online-i2p') && !i2pDot.classList.contains('spinning')) {
    i2pDot.className = 'net-dot ' + (i2p ? 'online-i2p' : 'offline');
  }
});

db.on('daemon-status', updateDaemonStatus);

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const state = await db.getState();
  setNetworkActive(state.network);
  renderTabs(state.tabs || []);
  const status = await db.checkNetworkStatus();
  // Seed dots before daemon events arrive
  document.getElementById('dot-tor').className   = 'net-dot ' + (status.tor ? 'online-tor' : 'offline');
  document.getElementById('dot-i2p').className   = 'net-dot ' + (status.i2p ? 'online-i2p' : 'offline');
  document.getElementById('dot-direct').className = 'net-dot online-direct';
}

init();
