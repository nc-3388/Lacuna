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

/** Inject security headers required for SharedArrayBuffer (WASM) and CSP. */
function installSecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers: Record<string, string[]> = {
      ...details.responseHeaders,
      'Cross-Origin-Opener-Policy': ['same-origin'],
      'Cross-Origin-Embedder-Policy': ['credentialless'],
    };
    if (!isDev) {
      headers['Content-Security-Policy'] = [
        "default-src 'self' app: file:; script-src 'self' 'unsafe-inline' app: file:; style-src 'self' 'unsafe-inline' app: file:; font-src 'self' app: file:; img-src 'self' blob: data: app: file:; connect-src 'self';",
      ];
    }
    callback({ responseHeaders: headers });
  });
}

/** Register the app:// custom protocol for serving production assets. */
function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const distPath = path.resolve(path.join(app.getAppPath(), 'dist'));

    // Extract the raw path part after the scheme.  We deliberately do NOT use
    // new URL().pathname because for non-special schemes (like app://) the host
    // portion would be discarded, allowing traversal via the authority section
    // (e.g. app://../../../etc/passwd would yield pathname === '/passwd').
    let rawPath: string;
    try {
      rawPath = decodeURIComponent(request.url.slice('app://'.length));
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    // Normalise and ensure the resolved path stays inside the dist folder.
    const resolved = path.resolve(path.join(distPath, rawPath));
    const relative = path.relative(distPath, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
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
    installSecurityHeaders();

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
