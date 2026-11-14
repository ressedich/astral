import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { probeEgress, probeTcp, startProxy } from './proxy.mjs'
import { enableSystemProxy, restoreSystemProxy } from './system-proxy.mjs'
import { reapTun } from './tun.mjs'
import { reapXray, startCore, stopCore } from './xray.mjs'

function port(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${label}: нужен порт от 1 до 65535`)
  }
  return number
}

function cleanHost(value) {
  const host = String(value || '').trim()
  if (!host || host.length > 253 || /[\s/\\]/.test(host)) throw new Error('Укажи корректный адрес сервера')
  return host
}

function tunName(value) {
  const name = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return name || 'Astral'
}

function dnsAddress(value) {
  const dns = String(value || '').trim()
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(dns)) return dns
  return '1.1.1.1'
}

function clip(value, max) {
  return String(value || '').trim().slice(0, max)
}

function cleanVless(raw) {
  const vless = raw && typeof raw === 'object' ? raw : {}
  const uuid = clip(vless.uuid, 80)
  if (!/^[0-9a-fA-F-]{8,80}$/.test(uuid)) throw new Error('В ссылке vless нет UUID')
  const security = clip(vless.security, 32).toLowerCase()
  const pbk = clip(vless.pbk, 120)
  if (security === 'reality' && !pbk) throw new Error('В ссылке Reality нет публичного ключа')
  return {
    uuid,
    flow: clip(vless.flow, 64),
    network: clip(vless.network, 32).toLowerCase() || 'tcp',
    security: security || 'none',
    sni: clip(vless.sni, 253),
    fp: clip(vless.fp, 32).toLowerCase(),
    pbk,
    sid: clip(vless.sid, 32),
    path: clip(vless.path, 300),
    hostHeader: clip(vless.hostHeader, 253),
    serviceName: clip(vless.serviceName, 200),
    alpn: clip(vless.alpn, 120),
    packetEncoding: clip(vless.packetEncoding, 16),
    mode: clip(vless.mode, 32),
  }
}

function normalize(body) {
  const mode = body?.mode === 'tun' ? 'tun' : 'proxy'
  const rawUpstream = body?.upstream ?? {}
  const type = ['direct', 'socks5', 'http', 'vless', 'hysteria2'].includes(rawUpstream.type) ? rawUpstream.type : 'direct'
  const upstream = {
    type,
    host: '',
    port: 1080,
    username: String(rawUpstream.username || '').slice(0, 200),
    password: String(rawUpstream.password || '').slice(0, 200),
    vless: null,
    core: null,
  }
  if (rawUpstream.core && typeof rawUpstream.core === 'object') {
    const json = JSON.stringify(rawUpstream.core)
    if (json.length > 20000) throw new Error('Конфиг сервера слишком большой')
    const core = JSON.parse(json)
    if (core?.type !== 'vless' && core?.type !== 'hysteria2') throw new Error('Этот протокол пока не поддерживается')
    if (!core.server || !core.server_port) throw new Error('У сервера нет адреса')
    upstream.core = { ...core, tag: 'proxy' }
    upstream.type = core.type
    upstream.host = cleanHost(core.server)
    upstream.port = port(core.server_port, 'Порт сервера')
  } else if (type === 'vless') {
    upstream.host = cleanHost(rawUpstream.host)
    upstream.port = port(rawUpstream.port, 'Порт сервера')
    upstream.vless = cleanVless(rawUpstream.vless)
  } else if (type !== 'direct') {
    upstream.host = cleanHost(rawUpstream.host)
    upstream.port = port(rawUpstream.port, 'Порт сервера')
  }
  const rawProxy = body?.proxy ?? {}
  const proxy = {
    socksPort: port(rawProxy.socksPort ?? 1080, 'SOCKS'),
    httpPort: port(rawProxy.httpPort ?? 8080, 'HTTP'),
    systemProxy: Boolean(rawProxy.systemProxy),
  }
  if (mode === 'proxy' && proxy.socksPort === proxy.httpPort) {
    throw new Error('Порты SOCKS и HTTP должны отличаться.')
  }
  const rawTun = body?.tun ?? {}
  const mtu = Number(rawTun.mtu ?? 1400)
  if (!Number.isInteger(mtu) || mtu < 576 || mtu > 9000) throw new Error('MTU должен быть от 576 до 9000')
  const tun = {
    name: tunName(rawTun.name),
    mtu,
    dns: dnsAddress(rawTun.dns),
    allowRoutes: Boolean(rawTun.allowRoutes),
  }
  if (mode === 'proxy') proxy.systemProxy = true
  let xray = null
  if (rawUpstream.xray && typeof rawUpstream.xray === 'object') {
    const xrayJson = JSON.stringify(rawUpstream.xray)
    if (xrayJson.length > 200000) throw new Error('Конфиг сервера слишком большой')
    const parsed = JSON.parse(xrayJson)
    if (!Array.isArray(parsed.outbounds) || !parsed.outbounds.length) throw new Error('В конфиге сервера нет выхода')
    xray = parsed
  }
  upstream.xray = xray
  if (mode === 'tun' && upstream.type === 'direct' && !xray) {
    throw new Error('Для TUN нужен сервер vless, SOCKS5 или HTTP.')
  }
  return { mode, upstream, proxy, tun }
}

export class Engine {
  constructor(root) {
    this.root = root
    this.runtime = path.join(root, 'runtime')
    this.phase = 'idle'
    this.mode = 'proxy'
    this.message = ''
    this.startedAt = null
    this.egressIp = null
    this.counters = { rx: 0, tx: 0 }
    this.systemProxy = false
    this.socks = null
    this.http = null
    this.tunName = null
    this.proxy = null
    this.core = null
    this.cancel = false
    this.tail = Promise.resolve()
  }

  enqueue(task) {
    const run = this.tail.then(task, task)
    this.tail = run.then(
      () => {},
      () => {},
    )
    return run
  }

  async prepare() {
    await mkdir(this.runtime, { recursive: true })
    await restoreSystemProxy(this.runtime)
    await reapXray(this.runtime)
    await reapTun(this.runtime)
  }

  snapshot() {
    return {
      phase: this.phase,
      mode: this.mode,
      message: this.message,
      startedAt: this.startedAt,
      rx: this.counters.rx,
      tx: this.counters.tx,
      egressIp: this.egressIp,
      socks: this.socks,
      http: this.http,
      systemProxy: this.systemProxy,
      tunName: this.tunName,
    }
  }

  finishIdle() {
    this.phase = 'idle'
    this.message = ''
    this.startedAt = null
    this.egressIp = null
    this.systemProxy = false
    this.socks = null
    this.http = null
    this.tunName = null
    this.counters.rx = 0
    this.counters.tx = 0
    return this.snapshot()
  }

  async stopAll() {
    try {
      await restoreSystemProxy(this.runtime)
    } catch (error) {
      console.error(error?.message || error)
    }
    this.systemProxy = false
    const proxy = this.proxy
    this.proxy = null
    if (proxy) await proxy.close()
    const core = this.core
    this.core = null
    if (core) await stopCore(core, this.runtime)
    this.socks = null
    this.http = null
    this.tunName = null
  }

  async connect(body) {
    if (this.cancel) return this.finishIdle()
    this.phase = 'connecting'
    this.message = ''
    this.egressIp = null
    try {
      if (this.core || this.proxy || this.systemProxy) await this.stopAll()
      if (this.cancel) return this.finishIdle()
      const cfg = normalize(body)
      this.counters.rx = 0
      this.counters.tx = 0
      if (cfg.mode === 'proxy') await this.startProxyMode(cfg)
      else await this.startTunMode(cfg)
      if (this.cancel) {
        await this.stopAll()
        return this.finishIdle()
      }
      this.phase = 'connected'
      this.mode = cfg.mode
      this.startedAt = Date.now()
      this.message = ''
      if (cfg.mode === 'proxy') this.watchEgress(cfg.proxy.httpPort)
      return this.snapshot()
    } catch (error) {
      if (this.cancel) {
        await this.stopAll()
        return this.finishIdle()
      }
      await this.stopAll()
      this.phase = 'error'
      this.message = error?.message || 'Не удалось открыть канал'
      this.startedAt = null
      throw new Error(this.message)
    }
  }

  async disconnect() {
    await this.stopAll()
    return this.finishIdle()
  }

  async startProxyMode(cfg) {
    const usesCore = cfg.upstream.xray || cfg.upstream.core || cfg.upstream.type === 'vless' || cfg.upstream.type === 'hysteria2'
    const system = Boolean(cfg.proxy.systemProxy)
    if (usesCore) {
      const handle = await startCore(cfg, this.root, (message) => {
        if (this.phase !== 'connected' || !this.core) return
        this.phase = 'error'
        this.message = message || 'Прокси остановился'
        this.startedAt = null
        this.core = null
      })
      this.core = handle
      this.http = `127.0.0.1:${handle.proxy.httpPort}`
      this.socks = `127.0.0.1:${handle.proxy.socksPort}`
    } else {
      this.proxy = await startProxy({
        httpPort: cfg.proxy.httpPort,
        socksPort: cfg.proxy.socksPort,
        upstream: cfg.upstream,
        counters: this.counters,
      })
      this.http = `127.0.0.1:${cfg.proxy.httpPort}`
      this.socks = `127.0.0.1:${cfg.proxy.socksPort}`
    }
    if (system) {
      const actual = Number(String(this.http).split(':').pop())
      await enableSystemProxy(this.runtime, actual)
      this.systemProxy = true
    }
  }

  async startTunMode(cfg) {
    this.core = await startCore(cfg, this.root, (message) => {
      if (this.phase !== 'connected' || !this.core) return
      this.phase = 'error'
      this.message = message || 'Туннель остановился'
      this.startedAt = null
      this.core = null
    })
    this.tunName = cfg.tun.name
  }

  watchEgress(port) {
    probeEgress(port)
      .then((ip) => {
        if (this.phase === 'connected' && this.mode === 'proxy') this.egressIp = ip
      })
      .catch(() => {})
  }

  probe(host, port) {
    const clean = String(host || '').trim()
    const number = Number(port)
    if (!clean || !Number.isInteger(number)) return Promise.resolve(-1)
    return probeTcp(clean, number)
  }
}
