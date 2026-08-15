import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { registerSettingsIpc } from './ipc/settings'
import { registerOrchestratorIpc } from './ipc/orchestrator'
import { registerImageIpc } from './ipc/image'
import { registerCurrencyIpc } from './ipc/currency'
import { registerCloudflareIpc } from './ipc/cloudflare'
import { registerEnrichmentIpc } from './ipc/enrich'
import { registerLoggingIpc } from './ipc/log'
import { registerExportIpc } from './ipc/export'
import { initLogger, getLogLevel, logger, type LogLevel } from './logger'
import { initCloudflareChrome, closeCloudflareChrome } from './cloudflare'
import { browserPool } from './browser'
import { registerThrottleIpc, destroyProxyAgents } from './throttle'
import { registerLanIpc } from './ipc/lan'
import { applyLanServer, closeLanServer } from './lan'
import { initCachePersistence, flushCacheToDisk } from './queries/cache'
import { prewarmExchangeRates } from './currency'

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  logger.debug('main', 'creating main window')
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    // Frameless title bar styling per platform.
    // - macOS: hiddenInset keeps the native traffic lights.
    // - Windows: hidden removes the system title bar but keeps native window
    //   controls overlaid at the top-right; the renderer reserves space for them.
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 15, y: 10 }
        }
      : process.platform === 'win32'
        ? { titleBarStyle: 'hidden' as const }
        : {})
  })

  // Prevent Electron from navigating inside the window
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function cliLogLevel(): string | undefined {
  const withEquals = process.argv.find(arg => arg.startsWith('--log-level='))
  if (withEquals) return withEquals.split('=')[1]
  const index = process.argv.indexOf('--log-level')
  return index >= 0 ? process.argv[index + 1] : undefined
}

app.whenReady().then(async () => {
  const defaultLevel: LogLevel = VITE_DEV_SERVER_URL ? 'debug' : 'info'
  initLogger({
    dir: join(app.getPath('userData'), 'logs'),
    level: cliLogLevel(),
    defaultLevel
  })
  logger.info('main', 'application ready', { logLevel: getLogLevel() })

  initCachePersistence(app.getPath('userData'))
  initCloudflareChrome(app.getPath('userData'))
  prewarmExchangeRates()
  registerSettingsIpc()
  registerOrchestratorIpc()
  registerEnrichmentIpc()
  registerLoggingIpc()
  registerExportIpc()
  registerImageIpc()
  registerThrottleIpc()
  registerLanIpc()
  registerCurrencyIpc()
  registerCloudflareIpc()

  // Register shell.openExternal handler
  ipcMain.handle('openExternal', async (_event, url: string) => {
    logger.debug('main', 'openExternal called', { url })
    await shell.openExternal(url)
  })

  // Start the LAN server (when enabled) before the window appears so the
  // settings panel can immediately show the QR code / status.
  try {
    await applyLanServer()
  } catch (err) {
    logger.error('lan', 'failed to apply LAN server settings on startup', {
      error: err instanceof Error ? err.message : String(err)
    })
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  logger.debug('main', 'all windows closed, tearing down browser/session resources')
  browserPool.closeAll()
  destroyProxyAgents()
  void closeCloudflareChrome()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  logger.debug('main', 'before-quit: flushing cache and stopping LAN server')
  flushCacheToDisk()
  void closeLanServer()
})
