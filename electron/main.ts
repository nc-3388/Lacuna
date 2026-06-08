import { app, BrowserWindow, session, protocol, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initAutoUpdater } from './updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const distPath = path.resolve(path.join(app.getAppPath(), 'dist'));

    // Parse the pathname out of the custom URL so query strings and fragments
    // cannot be used to mask a traversal attempt.
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    // Normalise the requested path and ensure it stays inside the dist folder.
    const resolved = path.resolve(path.join(distPath, pathname));
    if (!resolved.startsWith(distPath + path.sep) && resolved !== distPath) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(`file://${resolved}`);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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
    try {
      const baseDir = isDev ? path.join(__dirname, '..') : __dirname;
      const fontsCssPath = path.join(baseDir, 'fonts.css');
      let css = fs.readFileSync(fontsCssPath, 'utf-8');
      // Rewrite relative url() paths to absolute file:// URLs so insertCSS
      // can resolve them regardless of the base URL context.
      const fontsDir = path.join(baseDir, 'assets', 'fonts').replace(/\\/g, '/');
      css = css.replace(/url\('..\/assets\/fonts\//g, `url('file:///${fontsDir}/`);
      void mainWindow?.webContents.insertCSS(css);
    } catch {
      // fonts.css may not exist in dev mode; this is fine.
    }
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

    createWindow();

    if (!isDev) {
      initAutoUpdater(mainWindow);
    }
  });
}

app.on('window-all-closed', () => {
  app.quit();
});
