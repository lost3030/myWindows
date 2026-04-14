const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getWidgetParams: () => ipcRenderer.invoke('get-widget-params'),
  getWidgetConfig: (id) => ipcRenderer.invoke('get-widget-config', id),
  getAllConfig: () => ipcRenderer.invoke('get-all-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  fetchStocks: (stocks) => ipcRenderer.invoke('fetch-stocks', stocks),
  fetchStockTrends: (stocks) => ipcRenderer.invoke('fetch-stock-trends', stocks),
  searchStock: (keyword) => ipcRenderer.invoke('search-stock', keyword),
  openSettings: () => ipcRenderer.send('open-settings'),
  closeWidget: () => ipcRenderer.send('close-widget'),
  addWidget: (type, config) => ipcRenderer.invoke('add-widget', type, config),
  removeWidget: (id) => ipcRenderer.invoke('remove-widget', id),
  updateWidgetConfig: (id, config) =>
    ipcRenderer.invoke('update-widget-config', id, config),
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config-updated', (_e, data) => callback(data));
  },
  onWidgetConfigUpdated: (callback) => {
    ipcRenderer.on('widget-config-updated', (_e, data) => callback(data));
  },
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowClose: () => ipcRenderer.send('window-close'),
});
