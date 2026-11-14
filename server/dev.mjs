import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const require = createRequire(import.meta.url)
const engine = spawn(node, ['server/index.mjs'], {
  cwd: root,
  stdio: ['pipe', 'inherit', 'inherit'],
})
const vite = spawn(node, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let desktop = null
let stopping = false

function launchDesktop() {
  if (desktop || stopping) return
  let electronBinary = ''
  try {
    electronBinary = require('electron')
  } catch {
    console.error('Не найден Electron. Запусти npm install в папке astral.')
    return
  }
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  desktop = spawn(electronBinary, [path.join(root, 'electron', 'main.cjs')], {
    cwd: root,
    env,
    stdio: 'inherit',
  })
  desktop.on('exit', () => {
    if (!stopping) stop()
  })
}

function watchVite(stream) {
  stream?.on('data', (chunk) => {
    process.stdout.write(chunk)
    if (/127\.0\.0\.1:5173/.test(chunk.toString())) launchDesktop()
  })
}

watchVite(vite.stdout)
watchVite(vite.stderr)
setTimeout(launchDesktop, 8000)

function stop() {
  if (stopping) return
  stopping = true
  if (desktop && desktop.exitCode == null) desktop.kill()
  engine.stdin?.end()
  vite.kill()
  setTimeout(() => {
    if (engine.exitCode == null) engine.kill()
    process.exit(0)
  }, 1500)
}

engine.on('exit', (code) => {
  if (!stopping && code) {
    vite.kill()
    process.exit(code)
  }
})
vite.on('exit', (code) => {
  if (!stopping && code) stop()
})

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
