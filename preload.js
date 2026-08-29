const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('darkBrowser', {
  navigate:           url     => ipcRenderer.invoke('navigate', url),
  goBack:             ()      => ipcRenderer.invoke('go-back'),
  goForward:          ()      => ipcRenderer.invoke('go-forward'),
  reload:             ()      => ipcRenderer.invoke('reload'),
  newTab:             url     => ipcRenderer.invoke('new-tab', url),
  closeTab:           id      => ipcRenderer.invoke('close-tab', id),
  switchTab:          id      => ipcRenderer.invoke('switch-tab', id),
  switchNetwork:      network => ipcRenderer.invoke('switch-network', network),
  checkNetworkStatus: ()      => ipcRenderer.invoke('check-network-status'),
  getState:           ()      => ipcRenderer.invoke('get-state'),
  restartDaemon:      name    => ipcRenderer.invoke('restart-daemon', name),
  minimize:           ()      => ipcRenderer.invoke('window-minimize'),
  maximize:           ()      => ipcRenderer.invoke('window-maximize'),
  close:              ()      => ipcRenderer.invoke('window-close'),

  on(channel, callback) {
    const allowed = [
      'tabs-state', 'tab-updated', 'nav-state',
      'network-changed', 'network-status', 'daemon-status',
    ];
    if (!allowed.includes(channel)) return;
    const sub = (_, ...args) => callback(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },
});
