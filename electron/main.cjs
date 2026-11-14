const { app, BrowserWindow, nativeTheme } = require('electron')

nativeTheme.themeSource = 'dark'

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#000000',
    title: 'Astral',
    autoHideMenuBar: true,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#010101',
      symbolColor: '#ffffff',
      height: 36,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.setMenu(null)
  win.setAlwaysOnTop(false)
  win.once('ready-to-show', () => {
    win.setAlwaysOnTop(false)
    win.show()
  })
  let tries = 0
  win.webContents.on('did-fail-load', () => {
    if (tries >= 20) return
    tries += 1
    setTimeout(() => win.loadURL('http://127.0.0.1:5173/'), 400)
  })
  win.loadURL('http://127.0.0.1:5173/')
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
