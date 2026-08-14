import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { registerSettingsIpc } from './ipc/settings'
import { registerOrchestratorIpc } from './ipc/orchestrator'
import { registerImageIpc } from './ipc/image'
import { browserPool } from './browser'
import { registerThrottleIpc, destroyProxyAgents } from './throttle'
import { initCachePersistence, flushCacheToDisk } from './queries/cache'
import { prewarmExchangeRates } from './currency'

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
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
    // macOS-only window styling
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 15, y: 10 }
    })
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

app.whenReady().then(() => {
  initCachePersistence(app.getPath('userData'))
  prewarmExchangeRates()
  registerSettingsIpc()
  registerOrchestratorIpc()
  registerImageIpc()
  registerThrottleIpc()

  // Register shell.openExternal handler
  ipcMain.handle('openExternal', async (_event, url: string) => {
    console.log('openExternal called with:', url)
    await shell.openExternal(url)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  browserPool.closeAll()
  destroyProxyAgents()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  flushCacheToDisk()
})
