// 安阳麻将 · 无边框桌面启动器
// 启动 Node 服务器 + 打开真正的无边框(无系统边框/标题栏)网页窗口
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..'); // anyang-mahjong/
const SERVER_JS = path.join(ROOT, 'server.js');
const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;

// 候选 node 可执行文件（优先使用 WorkBuddy 托管的 node，避免依赖系统 PATH）
const NODE_CANDIDATES = [
  process.env.NODE_BIN,
  'C:\\Users\\tiank\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe',
  'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe',
  'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\versions\\24.14.1\\node.exe',
  'node'
].filter(Boolean);

let serverProc = null;

function findNode() {
  for (const c of NODE_CANDIDATES) {
    try {
      execSync(`"${c}" -v`, { stdio: 'ignore' });
      return c;
    } catch (e) { /* 尝试下一个 */ }
  }
  return 'node';
}

function startServer() {
  const nodeBin = findNode();
  console.log('[launcher] 使用 node:', nodeBin);
  serverProc = spawn(nodeBin, [SERVER_JS], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });
  serverProc.on('error', (e) => console.error('[launcher] 服务器启动失败:', e.message));
}

function waitForServer(timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryOnce = () => {
      const req = http.get(URL, (res) => { res.destroy(); resolve(true); });
      req.on('error', schedule);
      req.setTimeout(1000, () => { req.destroy(); schedule(); });
      function schedule() {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, 300);
      }
    };
    tryOnce();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,            // 真正的无边框
    show: false,
    backgroundColor: '#1b1b1b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(URL);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  ipcMain.removeAllListeners('win-min');
  ipcMain.removeAllListeners('win-max');
  ipcMain.removeAllListeners('win-close');
  ipcMain.on('win-min', () => win.minimize());
  ipcMain.on('win-max', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('win-close', () => win.close());

  return win;
}

function killServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch (e) { /* ignore */ }
    serverProc = null;
  }
}

app.whenReady().then(async () => {
  startServer();
  const ok = await waitForServer();
  if (!ok) console.warn('[launcher] 服务器未就绪，仍尝试打开页面');
  createWindow();
});

app.on('window-all-closed', () => { killServer(); app.quit(); });
app.on('before-quit', killServer);
