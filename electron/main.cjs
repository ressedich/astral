const { app, BrowserWindow, Menu, dialog, nativeTheme, shell } = require('electron')
const { spawn } = require('node:child_process')
const { createWriteStream, mkdirSync } = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { createUpdater } = require('./update.cjs')

const isDev = !app.isPackaged
const root = path.join(__dirname, '..')
const appId = 'com.astral.app'

let win = null
let engine = null
let engineLog = null
let enginePort = 0
let quitting = false
let updates = null

nativeTheme.themeSource = 'dark'
app.setAppUserModelId(appId)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  app.whenReady().then(start).catch((error) => fail(error))
}

async function start() {
  Menu.setApplicationMenu(null)
  updates = createUpdater({
    getWindow: () => win,
    beforeInstall: async () => {
      quitting = true
      await stopEngine()
    },
    log: (line) => {
      if (engineLog) engineLog.write(`[update] ${line}\n`)
    },
  })
  enginePort = isDev ? 47321 : await freePort()
  if (!isDev) await startEngine()
  createWindow()
  updates.schedule()
}

function dedicatedRuntime() {
  return path.join(app.getPath('userData'), 'runtime')
}

function startLog() {
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    engineLog = createWriteStream(path.join(dir, 'engine.log'), { flags: 'w' })
  } catch {
    engineLog = null
  }
}

function startEngine() {
  startLog()
  const script = path.join(process.resourcesPath, 'server', 'index.mjs')
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ASTRAL_PORT: String(enginePort),
    ASTRAL_BIN: path.join(process.resourcesPath, 'bin'),
    ASTRAL_WEB: path.join(process.resourcesPath, 'dist'),
    ASTRAL_RUNTIME: dedicatedRuntime(),
    ASTRAL_EXE: process.execPath,
    ASTRAL_PACKAGED: app.isPackaged ? '1' : '0',
  }

  engine = spawn(process.execPath, [script], {
    env,
    cwd: path.dirname(script),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const note = (chunk) => {
    const text = chunk.toString()
    if (engineLog) engineLog.write(text)
  }
  engine.stdout?.on('data', note)
  engine.stderr?.on('data', note)
  engine.on('error', (error) => note(`${error.message}\n`))

  return new Promise((resolve, reject) => {
    const started = Date.now()
    let settled = false
    const done = (error) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setInterval(async () => {
      if (settled) return
      if (engine.exitCode != null) {
        done(new Error('Движок Astral завершился при запуске'))
        return
      }
      if (await ping(enginePort)) return done(null)
      if (Date.now() - started > 30000) done(new Error('Движок Astral не ответил за 30 секунд'))
    }, 200)
  })
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/session', timeout: 1200 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function createWindow() {
  const options = {
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
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  }
  if (!isDev) options.icon = path.join(process.resourcesPath, 'icon.png')
  win = new BrowserWindow(options)

  win.setMenu(null)
  win.once('ready-to-show', () => {
    win.setAlwaysOnTop(false)
    win.show()
  })
  win.on('closed', () => {
    win = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const target = isDev ? 'http://127.0.0.1:5173' : `http://127.0.0.1:${enginePort}`
    if (!url.startsWith(target)) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  const url = isDev ? 'http://127.0.0.1:5173/' : `http://127.0.0.1:${enginePort}/`
  let tries = 0
  win.webContents.on('did-fail-load', () => {
    if (tries >= 20) {
      fail(new Error(`Не удалось открыть интерфейс: ${url}`))
      return
    }
    tries += 1
    setTimeout(() => win?.loadURL(url), 400)
  })
  win.loadURL(url)
}

async function stopEngine() {
  if (!engine) return
  if (engine.exitCode != null) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        engine.kill()
      } catch {
        /* already gone */
      }
      resolve()
    }, 6000)
    engine.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      engine.stdin?.end()
    } catch {
      engine.kill()
    }
  })
}

function fail(error) {
  const message = error?.message || String(error)
  try {
    dialog.showErrorBox('Astral', message)
  } catch {
    /* window system unavailable */
  }
  quitting = true
  void stopEngine().finally(() => app.exit(1))
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void stopEngine().finally(() => app.quit())
})
