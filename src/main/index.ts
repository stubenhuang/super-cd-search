import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { initDatabase, closeDatabase } from './database'
import { registerSettingsIpc } from './ipc/settings'
import { registerOrchestratorIpc } from './ipc/orchestrator'
import { registerHistoryIpc } from './ipc/history'
import { registerExportIpc } from './ipc/export'
import { browserPool } from './browser'
import { registerThrottleIpc } from './throttle'

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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDatabase()
  registerSettingsIpc()
  registerOrchestratorIpc()
  registerHistoryIpc()
  registerExportIpc()
  registerThrottleIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  browserPool.closeAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
