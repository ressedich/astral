import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const VALUES = ['ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL']
const BYPASS = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>'

function exec(file, args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      clearTimeout(timer)
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve(String(stdout || ''))
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
  })
}

function parseValue(stdout, name) {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(`${name} `) && !trimmed.startsWith(`${name}\t`)) continue
    const parts = trimmed.split(/\s{2,}/)
    if (parts.length < 3) return null
    return { type: parts[1], data: parts.slice(2).join('  ') }
  }
  return null
}

async function queryValue(name) {
  try {
    const stdout = await exec('reg', ['query', KEY, '/v', name])
    return parseValue(stdout, name)
  } catch {
    return null
  }
}

function dword(data) {
  if (/^0x/i.test(data)) return String(parseInt(data, 16))
  return data
}

async function writeValue(name, type, data) {
  const value = type === 'REG_DWORD' ? dword(data) : data
  await exec('reg', ['add', KEY, '/v', name, '/t', type, '/d', value, '/f'])
}

async function deleteValue(name) {
  try {
    await exec('reg', ['delete', KEY, '/v', name, '/f'])
  } catch {
    /* value already absent */
  }
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function applyProxy(values) {
  const lines = values
    .map((item) => `reg add '${KEY}' /v ${item.name} /t ${item.type} /d ${psQuote(item.data)} /f | Out-Null`)
    .join('\n')
  const script = `
${lines}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AstralInet {
  [DllImport("wininet.dll", SetLastError=true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, int Msg, IntPtr wParam, string lParam, int fuFlags, int uTimeout, out IntPtr lpdwResult);
  public static void Refresh() {
    InternetSetOption(IntPtr.Zero, 39, IntPtr.Zero, 0);
    InternetSetOption(IntPtr.Zero, 37, IntPtr.Zero, 0);
    IntPtr result;
    SendMessageTimeout((IntPtr)0xffff, 0x001A, IntPtr.Zero, "Internet Settings", 2, 1500, out result);
  }
}
"@
[AstralInet]::Refresh()
`
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 6000)
}

function backupPath(runtime) {
  return path.join(runtime, 'system-proxy.json')
}

export async function enableSystemProxy(runtime, httpPort) {
  const file = backupPath(runtime)
  try {
    await fs.access(file)
  } catch {
    const pairs = await Promise.all(VALUES.map(async (name) => [name, await queryValue(name)]))
    const snap = Object.fromEntries(pairs)
    await fs.mkdir(runtime, { recursive: true })
    await fs.writeFile(file, JSON.stringify(snap))
  }
  await applyProxy([
    { name: 'ProxyEnable', type: 'REG_DWORD', data: '1' },
    { name: 'ProxyServer', type: 'REG_SZ', data: `127.0.0.1:${httpPort}` },
    { name: 'ProxyOverride', type: 'REG_SZ', data: BYPASS },
  ])
  await deleteValue('AutoConfigURL')
}

export async function restoreSystemProxy(runtime) {
  const file = backupPath(runtime)
  let raw
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return false
  }
  const snap = JSON.parse(raw)
  const present = []
  for (const name of VALUES) {
    const item = snap[name]
    if (!item) await deleteValue(name)
    else present.push({ name, type: item.type, data: item.type === 'REG_DWORD' ? dword(item.data) : item.data })
  }
  if (present.length) await applyProxy(present)
  await fs.rm(file, { force: true })
  return true
}
