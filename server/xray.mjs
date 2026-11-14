import { execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isAdmin } from './tun.mjs'

const RELEASE = '26.11.9'
const ZIP_URL = `https://github.com/XTLS/Xray-core/releases/download/v${RELEASE}/Xray-windows-64.zip`

const holderPath = fileURLToPath(new URL('./holder.mjs', import.meta.url))
const jobName = 'holder-job.json'
const statusName = 'holder-status.json'
const stopName = 'holder-stop'

function exec(file, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      clearTimeout(timer)
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve(String(stdout || '') + String(stderr || ''))
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Команда не завершилась'))
    }, timeoutMs)
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export function humanize(log) {
  const text = String(log || '')
  const lower = text.toLowerCase()
  if (lower.includes('cancel') || lower.includes('отмен') || lower.includes('1223')) {
    return 'Windows не разрешила включить туннель.'
  }
  if (lower.includes('access is denied') || lower.includes('administrator') || lower.includes('elevation')) {
    return 'Windows не дала туннелю права. Подтвердите запрос.'
  }
  if (
    lower.includes('address already in use') ||
    lower.includes('only one usage') ||
    (lower.includes('bind') && lower.includes('port'))
  ) {
    return 'Локальный порт занят. Смените его в параметрах.'
  }
  if (lower.includes('reality verification failed')) return 'Сервер отклонил соединение.'
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter(Boolean)
  const picked = lines.filter((line) => /error|fail|fatal/i.test(line)).pop() || lines.pop() || ''
  const clean = picked.replace(/^\d{4}\/\d{2}\/\d{2}\s+\S+\s+\[[^\]]+\]\s*/, '').slice(0, 180)
  return clean || 'Не удалось запустить соединение'
}

function defined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== ''))
}

function fromSing(core) {
  if (core.type === 'hysteria2') {
    const tls = core.tls || {}
    return {
      tag: 'proxy',
      protocol: 'hysteria',
      settings: { version: 2, address: core.server, port: Number(core.server_port) },
      streamSettings: {
        network: 'hysteria',
        security: 'tls',
        hysteriaSettings: { version: 2, auth: core.password || '' },
        tlsSettings: defined({
          serverName: tls.server_name || core.server,
          fingerprint: tls.utls?.fingerprint,
          alpn: tls.alpn,
        }),
      },
    }
  }
  if (core.type !== 'vless') throw new Error('Этот протокол пока не поддерживается')
  const tls = core.tls || {}
  const reality = tls.reality
  const transport = core.transport || {}
  const stream = { network: 'tcp' }
  if (reality?.enabled || reality?.public_key) {
    stream.security = 'reality'
    stream.realitySettings = defined({
      serverName: tls.server_name,
      fingerprint: tls.utls?.fingerprint || 'chrome',
      publicKey: reality.public_key,
      shortId: reality.short_id,
    })
  } else if (tls.enabled) {
    stream.security = 'tls'
    stream.tlsSettings = defined({
      serverName: tls.server_name,
      fingerprint: tls.utls?.fingerprint,
      alpn: tls.alpn,
    })
  } else {
    stream.security = 'none'
  }
  if (transport.type === 'ws') {
    stream.network = 'ws'
    stream.wsSettings = { path: transport.path || '/', headers: transport.headers || {} }
  } else if (transport.type === 'grpc') {
    stream.network = 'grpc'
    stream.grpcSettings = { serviceName: transport.service_name || '' }
  } else if (transport.type === 'httpupgrade') {
    stream.network = 'httpupgrade'
    stream.httpupgradeSettings = { path: transport.path || '/', host: transport.headers?.Host || '' }
  } else if (transport.type === 'xhttp' || transport.type === 'splithttp') {
    stream.network = 'xhttp'
    stream.xhttpSettings = defined({ path: transport.path || '/', host: transport.host, mode: transport.mode })
  }
  return {
    tag: core.tag && core.tag !== 'proxy' ? core.tag : 'proxy',
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: core.server,
          port: Number(core.server_port),
          users: [defined({ id: core.uuid, encryption: 'none', flow: core.flow })],
        },
      ],
    },
    streamSettings: stream,
  }
}

function fromLink(upstream) {
  const core = {
    type: 'vless',
    server: upstream.host,
    server_port: upstream.port,
    uuid: upstream.vless?.uuid,
    flow: upstream.vless?.flow,
    transport: null,
    tls: null,
  }
  const vless = upstream.vless || {}
  const security = String(vless.security || 'none')
  if (security === 'reality' || security === 'tls') {
    core.tls = {
      enabled: true,
      server_name: vless.sni || upstream.host,
      utls: vless.fp ? { enabled: true, fingerprint: vless.fp } : undefined,
      reality:
        security === 'reality'
          ? { enabled: true, public_key: vless.pbk, short_id: vless.sid }
          : undefined,
      alpn: vless.alpn ? vless.alpn.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
    }
  }
  const network = String(vless.network || 'tcp')
  if (network === 'ws' || network === 'httpupgrade') {
    core.transport = { type: network, path: vless.path || '/', headers: vless.hostHeader ? { Host: vless.hostHeader } : {} }
  } else if (network === 'grpc') {
    core.transport = { type: 'grpc', service_name: vless.serviceName || '' }
  } else if (network === 'xhttp' || network === 'splithttp') {
    core.transport = { type: 'xhttp', path: vless.path || '/', host: vless.hostHeader, mode: vless.mode }
  }
  return fromSing(core)
}

function singleOutbound(upstream) {
  if (upstream.core?.type) return fromSing(upstream.core)
  if (upstream.type === 'vless') return fromLink(upstream)
  throw new Error('Этот протокол пока не поддерживается')
}

function isUtility(outbound) {
  return ['freedom', 'blackhole', 'dns', 'loopback'].includes(outbound?.protocol)
}

function preference(outbound) {
  if (isUtility(outbound)) return 50
  const tag = String(outbound.tag || '')
  if (tag === 'main' || /-2$/.test(tag)) return 0
  if (tag === 'proxy') return 30
  return 10
}

function withDirect(outbounds) {
  const list = outbounds.map((item) => ({ ...item }))
  if (!list.some((item) => item.protocol === 'freedom')) list.push({ protocol: 'freedom', tag: 'direct' })
  if (!list.some((item) => item.protocol === 'blackhole')) list.push({ protocol: 'blackhole', tag: 'block' })
  return list
}

const privateRule = {
  type: 'field',
  ip: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16'],
  outboundTag: 'direct',
}

export function buildRunConfig(cfg) {
  const bundle = cfg.upstream.xray
  const ranked = (bundle?.outbounds?.length ? bundle.outbounds : [singleOutbound(cfg.upstream)])
    .slice()
    .sort((a, b) => preference(a) - preference(b))
  const outbounds = withDirect(ranked)
  const allProxies = outbounds.filter((item) => !isUtility(item))
  const mirrors = allProxies.filter((item) => item.tag === 'main' || /-2$/.test(item.tag || ''))
  const proxies = mirrors.length ? mirrors : allProxies
  const chosen = proxies[0]
  const routing = {
    domainStrategy: 'AsIs',
    rules: [privateRule, { type: 'field', network: 'tcp,udp', outboundTag: chosen?.tag || 'proxy' }],
  }
  const keep = new Set([chosen?.tag, 'direct', 'block'].filter(Boolean))
  const slim = outbounds.filter((item) => isUtility(item) || keep.has(item.tag))
  const dns = bundle?.dns ? { ...bundle.dns, queryStrategy: 'UseIPv4' } : { queryStrategy: 'UseIPv4', servers: [cfg.tun?.dns || '1.1.1.1', '8.8.8.8'] }
  const config = {
    log: { loglevel: 'warning' },
    dns,
    policy: { levels: { 0: { handshake: 4, connIdle: 300, uplinkOnly: 1, downlinkOnly: 2 } } },
    routing,
    inbounds:
      cfg.mode === 'tun'
        ? [
            {
              tag: 'tun-in',
              port: 0,
              protocol: 'tun',
              settings: {
                name: cfg.tun.name || 'Astral',
                mtu: cfg.tun.mtu || 1400,
                gateway: ['172.19.0.1/30'],
                dns: [cfg.tun.dns || '1.1.1.1'],
                autoSystemRoutingTable: ['0.0.0.0/0'],
                autoOutboundsInterface: 'auto',
                autoSystemWfpBlockLeak: ['dns', 'misconfigtun'],
              },
            },
          ]
        : [
            {
              tag: 'socks-in',
              listen: '127.0.0.1',
              port: cfg.proxy.socksPort,
              protocol: 'socks',
              settings: { auth: 'noauth', udp: true },
            },
            { tag: 'http-in', listen: '127.0.0.1', port: cfg.proxy.httpPort, protocol: 'http' },
          ],
    outbounds: slim,
  }
  return config
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

function ephemeral() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

async function reservePorts(proxy) {
  let socks = Number(proxy.socksPort)
  let http = Number(proxy.httpPort)
  if (!(await canListen(socks))) socks = await ephemeral()
  if (!(await canListen(http)) || http === socks) http = await ephemeral()
  return { ...proxy, socksPort: socks, httpPort: http }
}

export async function ensureXray(binDir) {
  const target = path.join(binDir, 'xray.exe')
  if (existsSync(target)) return target
  await mkdir(binDir, { recursive: true })
  const zip = path.join(binDir, `Xray-windows-64.zip`)
  const response = await fetch(ZIP_URL)
  if (!response.ok || !response.body) throw new Error('Не удалось скачать ядро')
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zip))
  await exec('tar', ['-xf', zip, '-C', binDir])
  if (!existsSync(target)) throw new Error('В архиве нет xray.exe')
  return target
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(port) })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 200)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.end()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

async function waitPort(child, port, readLog) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(humanize(readLog()))
    if (await portOpen(port)) return
    await delay(25)
  }
  throw new Error(humanize(readLog()) || 'Ядро не открыло порт')
}

function waitStarted(child, readLog) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(child.exitCode == null ? null : new Error(humanize(readLog()))), 15000)
    const take = () => {
      if (/started/i.test(readLog())) finish(null)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.once('exit', () => finish(new Error(humanize(readLog()))))
  })
}

function waitExit(child, ms) {
  if (!child || child.exitCode != null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

export async function stopHolder(runtime) {
  const statusPath = path.join(runtime, statusName)
  const jobPath = path.join(runtime, jobName)
  const stopPath = path.join(runtime, stopName)
  const job = await readJson(jobPath)
  const status = await readJson(statusPath)
  await writeFile(stopPath, '1').catch(() => {})
  if (status?.port && job?.token) {
    try {
      await fetch(`http://127.0.0.1:${status.port}/stop`, {
        method: 'POST',
        headers: { 'x-astral-token': job.token },
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      /* holder may already be gone */
    }
  }
  const started = Date.now()
  while (Date.now() - started < 4000) {
    if (!existsSync(statusPath)) break
    await delay(150)
  }
  await rm(statusPath, { force: true })
  await rm(jobPath, { force: true })
  await rm(stopPath, { force: true })
}

function watchHolder(runtime, onExit) {
  const statusPath = path.join(runtime, statusName)
  let misses = 0
  let closed = false
  const timer = setInterval(() => {
    if (closed) return
    readJson(statusPath).then((status) => {
      if (closed) return
      if (!status) {
        misses += 1
        if (misses >= 3) {
          closed = true
          clearInterval(timer)
          onExit('Туннель остановился')
        }
        return
      }
      misses = 0
      if (status.ok === false) {
        closed = true
        clearInterval(timer)
        onExit(status.error || 'Туннель остановился')
      }
    })
  }, 1000)
  return () => {
    closed = true
    clearInterval(timer)
  }
}

async function launchHolder(runtime, elevated) {
  const jobPath = path.join(runtime, jobName)
  await rm(path.join(runtime, statusName), { force: true })
  await rm(path.join(runtime, stopName), { force: true })
  if (!elevated) {
    const child = spawn(process.execPath, [holderPath, jobPath], {
      cwd: runtime,
      windowsHide: true,
      stdio: 'ignore',
    })
    child.unref()
    return
  }
  const command = `Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList @(${psQuote(holderPath)},${psQuote(jobPath)}) -Verb RunAs -WindowStyle Hidden`
  try {
    await exec('powershell.exe', ['-NoProfile', '-Command', command], 120000)
  } catch (error) {
    throw new Error(humanize(`${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`))
  }
}

export async function reapXray(runtime) {
  await stopHolder(runtime)
  const pidFile = path.join(runtime, 'xray.pid')
  if (!existsSync(pidFile)) return
  try {
    const pid = Number(await readFile(pidFile, 'utf8'))
    if (pid) {
      try {
        process.kill(pid)
      } catch {
        /* already gone */
      }
    }
  } finally {
    await rm(pidFile, { force: true })
  }
}

export async function startCore(cfg, root, onExit) {
  const binDir = path.join(root, 'bin')
  const bin = await ensureXray(binDir)
  const runtime = path.join(root, 'runtime')
  await mkdir(runtime, { recursive: true })
  const next = cfg.mode === 'proxy' ? { ...cfg, proxy: await reservePorts(cfg.proxy) } : cfg
  const configPath = path.join(runtime, 'core.json')
  await writeFile(configPath, JSON.stringify(buildRunConfig(next)))
  if (next.mode === 'tun') {
    const token = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    await writeFile(
      path.join(runtime, jobName),
      JSON.stringify({
        exe: bin,
        args: ['run', '-c', configPath],
        cwd: binDir,
        token,
        status: path.join(runtime, statusName),
        stopFlag: path.join(runtime, stopName),
      }),
    )
    await launchHolder(runtime, !isAdmin())
    try {
      await pollStatus(path.join(runtime, statusName), 20000)
    } catch (error) {
      await stopHolder(runtime)
      await rm(configPath, { force: true })
      throw error
    }
    return { elevated: true, child: null, unwatch: watchHolder(runtime, onExit), proxy: next.proxy }
  }
  const child = spawn(bin, ['run', '-c', configPath], {
    cwd: binDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const take = (chunk) => {
    log = (log + chunk.toString()).slice(-12000)
  }
  child.stdout?.on('data', take)
  child.stderr?.on('data', take)
  try {
    await waitPort(child, next.proxy.httpPort, () => log)
  } catch (error) {
    if (child.exitCode == null) child.kill()
    await rm(configPath, { force: true })
    throw error
  }
  await writeFile(path.join(runtime, 'xray.pid'), String(child.pid ?? ''))
  child.on('exit', () => onExit('Соединение остановилось'))
  return { elevated: false, child, unwatch: () => {}, proxy: next.proxy }
}

async function pollStatus(file, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await readJson(file)
    if (status?.ok === false) throw new Error(status.error || 'Туннель не запустился')
    if (status?.ok && status.port) return status
    await delay(200)
  }
  throw new Error('Туннель не запустился')
}

export async function stopCore(handle, runtime) {
  handle?.unwatch?.()
  if (handle?.elevated) await stopHolder(runtime)
  const child = handle?.child
  if (child && child.exitCode == null) {
    child.kill()
    await waitExit(child, 2000)
  }
  await rm(path.join(runtime, 'xray.pid'), { force: true })
  await rm(path.join(runtime, 'core.json'), { force: true })
}
