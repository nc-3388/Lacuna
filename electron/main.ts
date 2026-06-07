import { app, BrowserWindow, session, ipcMain, protocol, net } from 'electron';
import path from 'node:path';

const isDev = !app.isPackaged;
const VITE_DEV_URL = 'http://localhost:5173';
let mainWindow: BrowserWindow | null = null;

/** Inject Cross-Origin Isolation headers required for SharedArrayBuffer (WASM). */
function installCrossOriginIsolation(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['credentialless'],
      },
    });
  });
}

/** Register the app:// custom protocol for serving production assets. */
function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const filePath = path.join(__dirname, '..', 'dist', request.url.slice('app://'.length));
    return net.fetch(`file://${filePath}`);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Inject local font-face overrides so the app works fully offline.
  mainWindow.webContents.on('did-finish-load', () => {
    const fontsCssPath = path.join(__dirname, 'fonts.css');
    mainWindow?.webContents.insertCSS(`
      @import url('file:///${fontsCssPath.replace(/\\/g, '/')}');
    `);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
  } else {
    mainWindow.loadURL('app://./index.html');
  }
}

/** Window control IPC handlers. */
function registerWindowControls(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
}

/** Single instance lock — prevent multiple windows. */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    installCrossOriginIsolation();

    if (!isDev) {
      registerAppProtocol();
    }

    registerWindowControls();
    createWindow();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});
