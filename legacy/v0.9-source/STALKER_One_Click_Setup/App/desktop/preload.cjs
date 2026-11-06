'use strict';
const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('stalkerDesktop',Object.freeze({
  gcsStatus: profileId => ipcRenderer.invoke('gcs:status',profileId),
  gcsConfigure: () => ipcRenderer.invoke('gcs:configure'),
  gcsOpen: () => ipcRenderer.invoke('gcs:open'),
  gcsLink: profileId => ipcRenderer.invoke('gcs:link',profileId),
  gcsUnlink: profileId => ipcRenderer.invoke('gcs:unlink',profileId),
  gcsRead: profileId => ipcRenderer.invoke('gcs:read',profileId),
  gcsOpenLinked: profileId => ipcRenderer.invoke('gcs:open-linked',profileId),
  onGcsFileChanged: callback => {if(typeof callback==='function')ipcRenderer.on('gcs:file-changed',(_event,payload)=>callback(payload));},
  onGcsLinkRequest: callback => {if(typeof callback==='function')ipcRenderer.on('gcs:request-link',()=>callback());},
  saveImage: bytes => ipcRenderer.invoke('assets:save',bytes),
  startServer: config => ipcRenderer.invoke('server:start',config),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  onNavigate: callback => { if(typeof callback!=='function')return; ipcRenderer.on('app:navigate',(_event,payload)=>callback(payload)); },
  chooseImage: () => ipcRenderer.invoke('assets:choose'),
  readSavedData: () => ipcRenderer.invoke('data:read'),
  writeSavedData: data => ipcRenderer.invoke('data:write',data)
}));
