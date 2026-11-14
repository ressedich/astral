import http from 'node:http'
import { spawn, execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { humanize } from './xray.mjs'

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
let log = ''
let closing = false

const child = spawn(job.exe, job.args, {
  cwd: job.cwd,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const take = (chunk) => {
  log = (log + chunk.toString()).slice(-12000)
}
child.stdout?.on('data', take)
child.stderr?.on('data', take)

function writeStatus(status) {
  writeFileSync(job.status, JSON.stringify(status))
}

function signalGroup(pid) {
  const script = `
$sig = @"
using System;
using System.Runtime.InteropServices;
public static class AstralCtrl {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint dwProcessId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr HandlerRoutine, bool Add);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
}
"@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
[AstralCtrl]::FreeConsole() | Out-Null
if (-not [AstralCtrl]::AttachConsole(${Number(pid)})) { exit 2 }
[AstralCtrl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if (-not [AstralCtrl]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true }, () => resolve())
  })
}

function waitExit(ms) {
  if (child.exitCode != null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

async function shutdown() {
  if (closing) return
  closing = true
  clearInterval(poll)
  if (child.exitCode == null) {
    await signalGroup(process.pid)
    const exited = await waitExit(2500)
    if (!exited) child.kill()
    await waitExit(1500)
  }
  try {
    server.close()
  } catch {
    /* already closed */
  }
  try {
    rmSync(job.status, { force: true })
  } catch {
    /* gone */
  }
  try {
    rmSync(job.stopFlag, { force: true })
  } catch {
    /* gone */
  }
  process.exit(0)
}

process.on('SIGINT', () => {})
process.on('SIGBREAK', () => {})

const server = http.createServer((req, res) => {
  if (req.headers['x-astral-token'] !== job.token) {
    res.writeHead(403)
    res.end()
    return
  }
  if (req.method === 'POST' && req.url === '/stop') {
    res.writeHead(200)
    res.end('ok')
    void shutdown()
    return
  }
  res.writeHead(404)
  res.end()
})

const poll = setInterval(() => {
  if (existsSync(job.stopFlag)) void shutdown()
}, 400)

function ready(error) {
  if (error) {
    writeStatus({ ok: false, error: humanize(error.message || log) })
    setTimeout(() => process.exit(1), 300)
    return
  }
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    writeStatus({ ok: true, port: address.port, pid: process.pid })
  })
}

let settled = false
const timer = setTimeout(() => {
  if (settled) return
  settled = true
  if (child.exitCode == null) ready(null)
  else ready(new Error(log))
}, 15000)

const watch = () => {
  if (settled) return
  if (/started/i.test(log)) {
    settled = true
    clearTimeout(timer)
    ready(null)
  }
}
child.stdout?.on('data', watch)
child.stderr?.on('data', watch)
child.once('exit', () => {
  if (!settled) {
    settled = true
    clearTimeout(timer)
    ready(new Error(log))
    return
  }
  if (!closing) {
    writeStatus({ ok: false, error: 'Туннель остановился' })
    process.exit(0)
  }
})
