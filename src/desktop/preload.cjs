'use strict';
// Narrow, explicit bridge for desktop-only features. The renderer has no Node access.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('stalkerDesktop', {
  pickGcsFile: () => ipcRenderer.invoke('pick-gcs-file'),
  pickGcsExe: () => ipcRenderer.invoke('pick-gcs-exe'),
  openWindow: (url, title) => ipcRenderer.invoke('open-window', String(url), String(title || '')),
});
