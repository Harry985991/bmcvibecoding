// preload.js - Electron 預載腳本
const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 給渲染進程
contextBridge.exposeInMainWorld('electronAPI', {
  // 代理伺服器控制
  startProxyServer: () => ipcRenderer.invoke('start-proxy-server'),
  stopProxyServer: () => ipcRenderer.invoke('stop-proxy-server'),
  getProxyStatus: () => ipcRenderer.invoke('get-proxy-status'),
  
  // 監聽代理伺服器狀態更新
  onProxyServerStatus: (callback) => {
    ipcRenderer.on('proxy-server-status', (event, data) => callback(event, data));
  },
  
  // 移除監聽器
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
