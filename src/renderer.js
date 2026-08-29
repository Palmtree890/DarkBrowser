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

// ── Settings & Tor Bridges Configuration ─────────────────────────────────────

const btnSettings            = document.getElementById('btn-settings');
const settingsBridgeDot      = document.getElementById('settings-bridge-dot');
const settingsModalOverlay   = document.getElementById('settings-modal-overlay');
const btnCloseSettings       = document.getElementById('btn-close-settings');
const btnCancelSettings      = document.getElementById('btn-cancel-settings');
const btnSaveSettings        = document.getElementById('btn-save-settings');
const settingsTabBtns        = document.querySelectorAll('.settings-tab-btn');
const settingsPanels         = document.querySelectorAll('.settings-panel');
const sidebarBridgeBadge     = document.getElementById('sidebar-bridge-badge');

// Bridges Tab Elements
const bridgeEnableToggle     = document.getElementById('bridge-enable-toggle');
const bridgeOptionsContainer = document.getElementById('bridge-options-container');
const customBridgeBox        = document.getElementById('custom-bridge-box');
const customBridgesText      = document.getElementById('custom-bridges-text');
const bridgeRadioCards       = document.querySelectorAll('.bridge-radio-card');
const tagObfs4               = document.getElementById('tag-obfs4');
const tagSnowflake           = document.getElementById('tag-snowflake');
const linkTorBridges         = document.getElementById('link-tor-bridges');

// Networks Tab Elements
const settingDefaultNetwork  = document.getElementById('setting-default-network');
const settingsTorStatus      = document.getElementById('settings-tor-status');
const settingsI2pStatus      = document.getElementById('settings-i2p-status');
const btnRestartTorDaemon    = document.getElementById('btn-restart-tor-daemon');
const btnRestartI2pDaemon    = document.getElementById('btn-restart-i2p-daemon');

// Privacy & Search Tab Elements
const settingSearchEngine     = document.getElementById('setting-search-engine');
const settingRouteSuggestions = document.getElementById('setting-route-suggestions');
const btnClearCache           = document.getElementById('btn-clear-cache');

// About Tab Elements
const linkGithubRepo         = document.getElementById('link-github-repo');
const settingsSaveStatus     = document.getElementById('settings-save-status');

function updateBridgeIndicators(enabled) {
  if (settingsBridgeDot) {
    settingsBridgeDot.classList.toggle('hidden', !enabled);
  }
  if (sidebarBridgeBadge) {
    sidebarBridgeBadge.textContent = enabled ? 'ON' : 'OFF';
    sidebarBridgeBadge.className = 'tab-badge ' + (enabled ? 'on' : '');
  }
}

function switchSettingsTab(tabName) {
  settingsTabBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  settingsPanels.forEach(p => {
    p.classList.toggle('active', p.id === `tab-panel-${tabName}`);
  });
}

settingsTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    switchSettingsTab(btn.dataset.tab);
  });
});

async function openSettingsModal(tab = 'bridges') {
  settingsSaveStatus.textContent = '';
  settingsSaveStatus.className = 'save-status-msg';
  switchSettingsTab(tab);

  try {
    const settings = await db.getSettings();

    // 1. Bridges settings
    const bridgeConfig = settings.bridges || {};
    bridgeEnableToggle.checked = !!bridgeConfig.enabled;

    const radio = document.querySelector(`input[name="bridgeType"][value="${bridgeConfig.type || 'builtin-obfs4'}"]`);
    if (radio) radio.checked = true;

    customBridgesText.value = bridgeConfig.customBridges || '';
    updateRadioCardStyles();
    toggleBridgeOptionsUI(bridgeConfig.enabled);
    customBridgeBox.classList.toggle('hidden', bridgeConfig.type !== 'custom');

    // Transports diagnostic tags
    if (settings.availableTransports) {
      const hasObfs4 = settings.availableTransports.obfs4;
      const hasSnowflake = settings.availableTransports.snowflake;

      if (tagObfs4) {
        tagObfs4.textContent = hasObfs4 ? '✓ obfs4: Ready' : '⚠ obfs4: Missing binary';
        tagObfs4.className = 'diag-tag ' + (hasObfs4 ? 'ready' : 'missing');
      }
      if (tagSnowflake) {
        tagSnowflake.textContent = hasSnowflake ? '✓ snowflake: Ready' : '○ snowflake: Fallback';
        tagSnowflake.className = 'diag-tag ' + (hasSnowflake ? 'ready' : '');
      }
    }

    // 2. Network settings
    if (settingDefaultNetwork && settings.defaultNetwork) {
      settingDefaultNetwork.value = settings.defaultNetwork;
    }

    // 3. Privacy & Search settings
    if (settingSearchEngine && settings.searchEngine) {
      settingSearchEngine.value = settings.searchEngine;
    }
    if (settingRouteSuggestions) {
      settingRouteSuggestions.checked = settings.routeSuggestions !== false;
    }

    updateBridgeIndicators(bridgeConfig.enabled);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }

  // Remove browser view underneath to prevent covering modal
  await db.setModalOpen(true);
  settingsModalOverlay.classList.remove('hidden');
}

async function closeSettingsModal() {
  settingsModalOverlay.classList.add('hidden');
  await db.setModalOpen(false);
}

function toggleBridgeOptionsUI(enabled) {
  if (bridgeOptionsContainer) {
    bridgeOptionsContainer.classList.toggle('disabled-section', !enabled);
  }
}

function updateRadioCardStyles() {
  bridgeRadioCards.forEach(card => {
    const radio = card.querySelector('input[type="radio"]');
    card.classList.toggle('selected', !!radio?.checked);
  });
}

// Modal Event Listeners
btnSettings.addEventListener('click', () => openSettingsModal('bridges'));
btnCloseSettings.addEventListener('click', closeSettingsModal);
btnCancelSettings.addEventListener('click', closeSettingsModal);

settingsModalOverlay.addEventListener('click', e => {
  if (e.target === settingsModalOverlay) closeSettingsModal();
});

bridgeEnableToggle.addEventListener('change', () => {
  toggleBridgeOptionsUI(bridgeEnableToggle.checked);
});

bridgeRadioCards.forEach(card => {
  const radio = card.querySelector('input[type="radio"]');
  card.addEventListener('click', () => {
    if (radio) {
      radio.checked = true;
      updateRadioCardStyles();
      customBridgeBox.classList.toggle('hidden', radio.value !== 'custom');
    }
  });
});

linkTorBridges?.addEventListener('click', e => {
  e.preventDefault();
  closeSettingsModal();
  db.newTab('https://bridges.torproject.org');
});

linkGithubRepo?.addEventListener('click', e => {
  e.preventDefault();
  closeSettingsModal();
  db.newTab('https://github.com/Palmtree890/DarkBrowser');
});

btnRestartTorDaemon?.addEventListener('click', () => {
  db.restartDaemon('tor');
  settingsSaveStatus.textContent = 'Restarting Tor daemon...';
  settingsSaveStatus.className = 'save-status-msg';
});

btnRestartI2pDaemon?.addEventListener('click', () => {
  db.restartDaemon('i2p');
  settingsSaveStatus.textContent = 'Restarting I2P daemon...';
  settingsSaveStatus.className = 'save-status-msg';
});

btnClearCache?.addEventListener('click', async () => {
  btnClearCache.disabled = true;
  btnClearCache.textContent = 'Clearing…';
  const res = await db.clearBrowsingData();
  if (res?.success) {
    btnClearCache.textContent = 'Data Cleared!';
    settingsSaveStatus.textContent = 'Browsing partition cache & session data cleared.';
    settingsSaveStatus.className = 'save-status-msg success';
  } else {
    btnClearCache.textContent = 'Clear Session Data';
    settingsSaveStatus.textContent = 'Failed to clear session data.';
    settingsSaveStatus.className = 'save-status-msg error';
  }
  setTimeout(() => {
    btnClearCache.disabled = false;
    btnClearCache.textContent = 'Clear Session Data';
  }, 2000);
});

btnSaveSettings.addEventListener('click', async () => {
  const bridgeEnabled = bridgeEnableToggle.checked;
  const selectedRadio = document.querySelector('input[name="bridgeType"]:checked');
  const bridgeType = selectedRadio ? selectedRadio.value : 'builtin-obfs4';
  const customBridges = customBridgesText.value.trim();
  const defaultNetwork = settingDefaultNetwork ? settingDefaultNetwork.value : 'tor';
  const searchEngine = settingSearchEngine ? settingSearchEngine.value : 'duckduckgo';
  const routeSuggestions = settingRouteSuggestions ? settingRouteSuggestions.checked : true;

  if (bridgeEnabled && bridgeType === 'custom' && !customBridges) {
    settingsSaveStatus.textContent = 'Please provide at least one bridge line.';
    settingsSaveStatus.className = 'save-status-msg error';
    switchSettingsTab('bridges');
    return;
  }

  btnSaveSettings.disabled = true;
  btnSaveSettings.textContent = 'Saving…';
  settingsSaveStatus.textContent = 'Applying configuration...';
  settingsSaveStatus.className = 'save-status-msg';

  try {
    const payload = {
      bridges: {
        enabled: bridgeEnabled,
        type: bridgeType,
        customBridges,
      },
      defaultNetwork,
      searchEngine,
      routeSuggestions,
    };

    const res = await db.saveSettings(payload);
    if (res?.success) {
      updateBridgeIndicators(bridgeEnabled);
      settingsSaveStatus.textContent = 'Settings saved successfully.';
      settingsSaveStatus.className = 'save-status-msg success';
      setTimeout(() => {
        btnSaveSettings.disabled = false;
        btnSaveSettings.textContent = 'Save & Apply';
        closeSettingsModal();
      }, 700);
    } else {
      settingsSaveStatus.textContent = 'Failed to save settings.';
      settingsSaveStatus.className = 'save-status-msg error';
      btnSaveSettings.disabled = false;
      btnSaveSettings.textContent = 'Save & Apply';
    }
  } catch (err) {
    settingsSaveStatus.textContent = 'Error: ' + err.message;
    settingsSaveStatus.className = 'save-status-msg error';
    btnSaveSettings.disabled = false;
    btnSaveSettings.textContent = 'Save & Apply';
  }
});

db.on('settings-changed', settings => {
  if (settings?.bridges) {
    updateBridgeIndicators(settings.bridges.enabled);
  }
});

// Update daemon badges in settings modal
const originalUpdateDaemonStatus = updateDaemonStatus;
updateDaemonStatus = function(data) {
  originalUpdateDaemonStatus(data);
  const { name, status, bootstrap } = data;
  if (name === 'tor' && settingsTorStatus) {
    settingsTorStatus.textContent = status === 'ready' ? 'Ready' : (status === 'starting' ? (bootstrap ? `${bootstrap}%` : 'Starting') : (status === 'missing' ? 'Not Found' : 'Stopped'));
    settingsTorStatus.className = 'daemon-badge ' + (status === 'ready' ? 'ready' : (status === 'starting' ? 'starting' : 'stopped'));
  }
  if (name === 'i2p' && settingsI2pStatus) {
    settingsI2pStatus.textContent = status === 'ready' ? 'Ready' : (status === 'starting' ? 'Starting' : (status === 'missing' ? 'Not Found' : 'Stopped'));
    settingsI2pStatus.className = 'daemon-badge ' + (status === 'ready' ? 'ready' : (status === 'starting' ? 'starting' : 'stopped'));
  }
};

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

  // Seed bridge indicator
  try {
    const settings = await db.getSettings();
    updateBridgeIndicators(settings?.bridges?.enabled);
  } catch { /* ignore */ }
}

init();
