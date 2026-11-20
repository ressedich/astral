const { app, dialog, ipcMain } = require('electron')

function createUpdater({ getWindow, beforeInstall, log }) {
  const packaged = app.isPackaged
  const state = {
    version: app.getVersion(),
    status: packaged ? 'idle' : 'unavailable',
    message: packaged ? 'Astral проверяет GitHub Releases после запуска.' : 'Доступно в установленной версии Astral.',
    percent: null,
    nextVersion: null,
  }
  let prompted = false
  let checking = null
  let installing = false
  let autoUpdater = null

  function note(line) {
    try {
      log?.(String(line))
    } catch {
      /* logging must not break the update */
    }
  }

  function publish(patch) {
    Object.assign(state, patch)
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('astral:update', { ...state })
  }

  ipcMain.handle('astral:update-get', () => ({ ...state }))
  ipcMain.handle('astral:update-check', () => check())
  ipcMain.handle('astral:update-install', () => install())

  if (packaged) {
    autoUpdater = require('electron-updater').autoUpdater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.disableWebInstaller = true
    autoUpdater.logger = {
      info: (...args) => note(args.join(' ')),
      warn: (...args) => note(args.join(' ')),
      error: (...args) => note(args.join(' ')),
      debug: (...args) => note(args.join(' ')),
    }

    autoUpdater.on('checking-for-update', () => {
      publish({ status: 'checking', message: 'Проверяю обновления…', percent: null })
    })
    autoUpdater.on('update-available', (info) => {
      publish({
        status: 'available',
        nextVersion: info?.version || null,
        percent: 0,
        message: `Найдена версия ${info.version}. Скачиваю…`,
      })
    })
    autoUpdater.on('update-not-available', () => {
      publish({ status: 'current', message: 'Установлена последняя версия.', percent: null, nextVersion: null })
    })
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)))
      const version = state.nextVersion
      publish({
        status: 'downloading',
        percent,
        message: version ? `Скачиваю версию ${version} · ${percent}%` : `Скачиваю обновление · ${percent}%`,
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      const version = info?.version || state.nextVersion
      publish({
        status: 'ready',
        nextVersion: version,
        percent: 100,
        message: `Версия ${version} скачана. Можно установить её и перезапустить Astral.`,
      })
      void askToRestart(version)
    })
    autoUpdater.on('error', (error) => {
      const text = error?.message || String(error)
      note(text)
      const hidden = /404|401|403|Not Found/i.test(text)
      publish({
        status: 'error',
        percent: null,
        message: hidden
          ? 'GitHub не отдал релиз. Обновление скачивается только с публичного релиза.'
          : 'Не удалось проверить обновления.',
      })
    })
  }

  function check() {
    if (!packaged || !autoUpdater) return Promise.resolve({ ...state })
    if (state.status === 'downloading' || state.status === 'ready' || installing) return Promise.resolve({ ...state })
    if (checking) return checking
    checking = autoUpdater
      .checkForUpdates()
      .then(() => ({ ...state }))
      .catch((error) => {
        note(error?.message || error)
        return { ...state }
      })
      .finally(() => {
        checking = null
      })
    return checking
  }

  function schedule() {
    if (!packaged) return
    setTimeout(() => {
      void check()
    }, 4000)
  }

  async function askToRestart(version) {
    if (prompted || installing) return
    prompted = true
    const win = getWindow()
    const result = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'info',
      buttons: ['Перезапустить', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Обновление Astral',
      message: `Версия ${version} готова`,
      detail: 'Обновление скачано с GitHub. Перезапустить Astral и установить его? Текущее соединение будет закрыто.',
    })
    if (result.response === 0) await install()
  }

  async function install() {
    if (!packaged || !autoUpdater || state.status !== 'ready' || installing) return { ...state }
    installing = true
    try {
      await beforeInstall()
      autoUpdater.quitAndInstall(true, true)
    } catch (error) {
      installing = false
      note(error?.message || error)
      publish({ status: 'error', message: 'Не удалось запустить установку обновления.' })
    }
    return { ...state }
  }

  return { schedule, check, install }
}

module.exports = { createUpdater }
