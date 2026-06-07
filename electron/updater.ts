import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';
import log from 'electron-log';

/** Configure and start the auto-updater. */
export function initAutoUpdater(mainWindow: BrowserWindow | null): void {
  autoUpdater.logger = log;

  autoUpdater.on('update-available', () => {
    mainWindow?.webContents.send('update:available');
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:downloaded');
  });

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err);
  });

  // Check for updates shortly after launch so startup is never blocked.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => {
      // Silently ignore — no update server is not an error in dev.
    });
  }, 5_000);
}

/** Install the downloaded update and restart. */
export function installUpdate(): void {
  autoUpdater.quitAndInstall();
}
