import { execFile, execFileSync, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const RELEASE = '1.14.4'
const ZIP_URL = `https://github.com/SagerNet/sing-box/releases/download/v${RELEASE}/sing-box-${RELEASE}-windows-amd64.zip`

function exec(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve(String(stdout || '') + String(stderr || ''))
    })
  })
}

export function isAdmin() {
  try {
    execFileSync('net', ['session'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

export function humanize(log) {
  const text = String(log || '')
  const lower = text.toLowerCase()
  if (lower.includes('access is denied') || lower.includes('administrator') || lower.includes('elevation')) {
    return 'Нужны права администратора, чтобы создать адаптер TUN.'
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines.slice(-2).join(' ')
  if (!last) return 'Туннель не запустился'
  return last.length > 280 ? `${last.slice(0, 280)}…` : last
}

function dnsServer(ip) {
  if (ip === '8.8.8.8') {
    return {
      type: 'https',
      tag: 'remote',
      server: '8.8.8.8',
      server_port: 443,
      path: '/dns-query',
      tls: { server_name: 'dns.google' },
      detour: 'proxy',
    }
  }
  return {
    type: 'https',
    tag: 'remote',
    server: '1.1.1.1',
    server_port: 443,
    path: '/dns-query',
    tls: { server_name: 'cloudflare-dns.com' },
    detour: 'proxy',
  }
}

function clip(value, max) {
  return String(value || '').trim().slice(0, max)
}

function vlessTransport(vless) {
  const type = clip(vless.network, 32).toLowerCase()
  if (!type || type === 'tcp' || type === 'raw' || type === 'none') return null
  const host = clip(vless.hostHeader, 253)
  const path = clip(vless.path, 300) || '/'
  if (type === 'ws' || type === 'httpupgrade') {
    return { type, path, headers: host ? { Host: host } : {} }
  }
  if (type === 'grpc') return { type: 'grpc', service_name: clip(vless.serviceName, 200) }
  if (type === 'http' || type === 'h2') return { type: 'http', path, host: host ? [host] : undefined }
  if (type === 'xhttp' || type === 'splithttp') {
    return { type: 'xhttp', path, host: host || undefined, mode: clip(vless.mode, 32) || undefined }
  }
  return null
}

function vlessTls(vless, server) {
  const security = clip(vless.security, 32).toLowerCase()
  if (security !== 'tls' && security !== 'reality') return null
  const tls = { enabled: true, server_name: clip(vless.sni, 253) || server }
  const alpn = clip(vless.alpn, 120)
  if (alpn) tls.alpn = alpn.split(',').map((item) => item.trim()).filter(Boolean)
  const fingerprint = clip(vless.fp, 32).toLowerCase()
  if (fingerprint) tls.utls = { enabled: true, fingerprint }
  if (security === 'reality') {
    tls.reality = { enabled: true, public_key: clip(vless.pbk, 120), short_id: clip(vless.sid, 32) }
  }
  return tls
}

function buildOutbound(cfg) {
  if (cfg.upstream.core?.type) return { ...cfg.upstream.core, tag: 'proxy' }
  if (cfg.upstream.type === 'vless') {
    const vless = cfg.upstream.vless || {}
    const outbound = {
      type: 'vless',
      tag: 'proxy',
      server: cfg.upstream.host,
      server_port: cfg.upstream.port,
      uuid: clip(vless.uuid, 80),
    }
    const flow = clip(vless.flow, 64)
    if (flow && flow !== 'none') outbound.flow = flow
    const transport = vlessTransport(vless)
    if (transport) outbound.transport = transport
    const tls = vlessTls(vless, cfg.upstream.host)
    if (tls) outbound.tls = tls
    const packet = clip(vless.packetEncoding, 16)
    if (packet) outbound.packet_encoding = packet
    return outbound
  }
  const auth = cfg.upstream.username
    ? { username: cfg.upstream.username, password: cfg.upstream.password || '' }
    : {}
  if (cfg.upstream.type === 'http') {
    return { type: 'http', tag: 'proxy', server: cfg.upstream.host, server_port: cfg.upstream.port, ...auth }
  }
  return {
    type: 'socks',
    tag: 'proxy',
    server: cfg.upstream.host,
    server_port: cfg.upstream.port,
    version: '5',
    ...auth,
  }
}

export function buildConfig(cfg) {
  const outbound = buildOutbound(cfg)
  if (cfg.mode === 'proxy') {
    return {
      log: { level: 'info', timestamp: true },
      inbounds: [
        { type: 'socks', tag: 'socks-in', listen: '127.0.0.1', listen_port: cfg.proxy.socksPort },
        { type: 'http', tag: 'http-in', listen: '127.0.0.1', listen_port: cfg.proxy.httpPort },
      ],
      outbounds: [outbound],
      route: { auto_detect_interface: true, final: 'proxy' },
    }
  }
  return {
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [dnsServer(cfg.tun.dns)],
      final: 'remote',
      strategy: 'ipv4_only',
    },
    inbounds: [
      {
        type: 'tun',
        tag: 'tun-in',
        interface_name: cfg.tun.name,
        address: ['172.19.0.1/30'],
        mtu: cfg.tun.mtu,
        auto_route: true,
        strict_route: false,
        stack: 'mixed',
        route_exclude_address: ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'],
      },
    ],
    outbounds: [outbound],
    route: {
      rules: [{ action: 'sniff' }, { protocol: 'dns', action: 'hijack-dns' }],
      auto_detect_interface: true,
      final: 'proxy',
    },
  }
}

async function findExe(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await findExe(full)
      if (nested) return nested
    } else if (entry.name.toLowerCase() === 'sing-box.exe') {
      return full
    }
  }
  return null
}

export async function ensureSingBox(binDir) {
  const target = path.join(binDir, 'sing-box.exe')
  if (existsSync(target)) return target
  await mkdir(binDir, { recursive: true })
  const zip = path.join(binDir, `sing-box-${RELEASE}.zip`)
  const response = await fetch(ZIP_URL)
  if (!response.ok || !response.body) throw new Error('Не удалось скачать ядро TUN')
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zip))
  await exec('tar', ['-xf', zip, '-C', binDir])
  const found = await findExe(binDir)
  if (!found) throw new Error('В архиве нет sing-box.exe')
  if (path.resolve(found) !== path.resolve(target)) await copyFile(found, target)
  return target
}

function waitUntilStarted(child) {
  return new Promise((resolve, reject) => {
    let log = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(log)
    }
    const timer = setTimeout(() => finish(child.exitCode == null ? null : new Error(humanize(log))), 15000)
    const take = (chunk) => {
      log += chunk.toString()
      if (/started/i.test(log)) finish(null)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.once('exit', () => finish(new Error(humanize(log))))
  })
}

async function reapPid(file) {
  if (!existsSync(file)) return
  try {
    const pid = Number(await readFile(file, 'utf8'))
    if (pid) {
      try {
        process.kill(pid)
      } catch {
        /* already gone */
      }
    }
  } finally {
    await rm(file, { force: true })
  }
}

export async function reapTun(runtime) {
  await reapPid(path.join(runtime, 'tun.pid'))
  await reapPid(path.join(runtime, 'core.pid'))
}

export async function startCore(cfg, root, onExit) {
  if (cfg.mode === 'tun' && !isAdmin()) {
    throw new Error('Режим TUN просит права администратора. Запусти Astral из терминала, открытого от имени администратора.')
  }
  const bin = await ensureSingBox(path.join(root, 'bin'))
  const runtime = path.join(root, 'runtime')
  await mkdir(runtime, { recursive: true })
  const configPath = path.join(runtime, 'core.json')
  await writeFile(configPath, JSON.stringify(buildConfig(cfg), null, 2))
  try {
    await exec(bin, ['check', '-c', configPath])
  } catch (error) {
    const detail = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`
    throw new Error(humanize(detail))
  }
  const child = spawn(bin, ['run', '-c', configPath], {
    cwd: runtime,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  })
  const log = { text: '' }
  const take = (chunk) => {
    log.text += chunk.toString()
  }
  child.stdout?.on('data', take)
  child.stderr?.on('data', take)
  try {
    await waitUntilStarted(child)
  } catch (error) {
    if (child.exitCode == null) child.kill()
    throw error
  }
  await writeFile(path.join(runtime, 'core.pid'), String(child.pid ?? ''))
  child.on('exit', (code) => {
    onExit(code, log.text)
  })
  return { child }
}

export async function stopTun(handle, runtime) {
  const child = handle?.child
  if (child && child.exitCode == null) {
    child.kill()
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  await rm(path.join(runtime, 'core.pid'), { force: true })
  await rm(path.join(runtime, 'tun.pid'), { force: true })
}

export function startTun(cfg, root, onExit) {
  return startCore({ ...cfg, mode: 'tun' }, root, onExit)
}
