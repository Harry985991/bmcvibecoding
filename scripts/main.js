// main.js - Electron 主進程
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let proxyServer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.png'), // 可選：應用圖示
    title: '個人投資紀錄 - Portfolio Tracker'
  });

  // 載入 HTML 檔案
  mainWindow.loadFile('Investment.html');

  // 開發模式下開啟開發者工具
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

// 啟動代理伺服器
function startProxyServer() {
  if (proxyServer) {
    console.log('代理伺服器已在運行');
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    console.log('正在啟動代理伺服器...');
    
    proxyServer = spawn('node', ['scripts/proxy-server.js'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    proxyServer.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('代理伺服器:', output);
      
      // 通知渲染進程伺服器狀態
      if (mainWindow) {
        mainWindow.webContents.send('proxy-server-status', {
          status: 'running',
          message: output
        });
      }
    });

    proxyServer.stderr.on('data', (data) => {
      console.error('代理伺服器錯誤:', data.toString());
    });

    proxyServer.on('close', (code) => {
      console.log(`代理伺服器已關閉，退出碼: ${code}`);
      proxyServer = null;
      
      if (mainWindow) {
        mainWindow.webContents.send('proxy-server-status', {
          status: 'stopped',
          message: `伺服器已停止 (退出碼: ${code})`
        });
      }
    });

    proxyServer.on('error', (error) => {
      console.error('啟動代理伺服器失敗:', error);
      proxyServer = null;
      reject(error);
    });

    // 等待伺服器啟動
    setTimeout(() => {
      if (proxyServer) {
        resolve();
      }
    }, 2000);
  });
}

// 停止代理伺服器
function stopProxyServer() {
  if (proxyServer) {
    console.log('正在停止代理伺服器...');
    proxyServer.kill();
    proxyServer = null;
  }
}

// IPC 事件處理
ipcMain.handle('start-proxy-server', async () => {
  try {
    await startProxyServer();
    return { success: true, message: '代理伺服器啟動成功' };
  } catch (error) {
    return { success: false, message: `啟動失敗: ${error.message}` };
  }
});

ipcMain.handle('stop-proxy-server', () => {
  try {
    stopProxyServer();
    return { success: true, message: '代理伺服器已停止' };
  } catch (error) {
    return { success: false, message: `停止失敗: ${error.message}` };
  }
});

ipcMain.handle('get-proxy-status', () => {
  return { 
    running: proxyServer !== null,
    message: proxyServer ? '代理伺服器運行中' : '代理伺服器未運行'
  };
});

// 應用事件
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopProxyServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopProxyServer();
});
