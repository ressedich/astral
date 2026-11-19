import http from 'node:http'
import tls from 'node:tls'
import { openUpstream } from './proxy.mjs'
import { fromSing } from './xray.mjs'

function clean(value, max) {
  return String(value || '').trim().slice(0, max)
}

function collect(text) {
  const servers = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const node = parseVless(line.trim())
    if (node) servers.push(node)
  }
  return servers
}

function parseVless(line) {
  if (!line || !line.toLowerCase().startsWith('vless://')) return null
  const body = line.slice('vless://'.length)
  const hash = body.lastIndexOf('#')
  let name = hash >= 0 ? body.slice(hash + 1) : ''
  try {
    name = decodeURIComponent(name.replace(/\+/g, ' '))
  } catch {
    name = name.replace(/%20/g, ' ')
  }
  const main = hash >= 0 ? body.slice(0, hash) : body
  const queryAt = main.indexOf('?')
  const params = new URLSearchParams(queryAt >= 0 ? main.slice(queryAt + 1) : '')
  const address = queryAt >= 0 ? main.slice(0, queryAt) : main
  const at = address.lastIndexOf('@')
  if (at < 1) return null
  let uuid = address.slice(0, at)
  try {
    uuid = decodeURIComponent(uuid)
  } catch {
    /* keep */
  }
  const hostport = address.slice(at + 1)
  let host = ''
  let port = 0
  if (hostport.startsWith('[')) {
    const end = hostport.indexOf(']')
    if (end < 0) return null
    host = hostport.slice(1, end)
    port = Number(hostport.slice(end + 2))
  } else {
    const colon = hostport.lastIndexOf(':')
    if (colon < 1) return null
    host = hostport.slice(0, colon)
    port = Number(hostport.slice(colon + 1))
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!/^[0-9a-fA-F-]{8,80}$/.test(uuid)) return null
  const pick = (key) => clean(params.get(key), 300)
  const network = (pick('type') || pick('network') || 'tcp').toLowerCase()
  return {
    name: clean(name, 80) || host,
    host,
    port,
    protocol: 'vless',
    vless: {
      uuid,
      flow: pick('flow'),
      network,
      security: (pick('security') || 'none').toLowerCase(),
      sni: pick('sni') || pick('serverName'),
      fp: pick('fp') || pick('fingerprint'),
      pbk: pick('pbk') || pick('publicKey'),
      sid: pick('sid') || pick('shortId'),
      path: pick('path'),
      hostHeader: pick('host') || pick('authority'),
      serviceName: pick('serviceName') || pick('service_name'),
      alpn: pick('alpn'),
      packetEncoding: pick('packetEncoding') || pick('packet_encoding'),
      mode: pick('mode'),
    },
  }
}

function fromBase64(input) {
  const compact = String(input || '').replace(/\s+/g, '')
  if (compact.length < 16 || !/^[A-Za-z0-9+/_=-]+$/.test(compact)) return ''
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/')
    const text = Buffer.from(normalized, 'base64').toString('utf8')
    if (!text || text.includes('\uFFFD')) return ''
    return text
  } catch {
    return ''
  }
}

function decodeBody(text) {
  const trimmed = String(text || '').trim()
  if (/vless:\/\//i.test(trimmed)) return trimmed
  const decoded = fromBase64(trimmed)
  if (decoded && /:\/\//.test(decoded)) return decoded
  return trimmed
}

function decodeTitle(value) {
  return headerText(value, 80)
}

function headerText(value, max) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.toLowerCase().startsWith('base64:')) return clean(fromBase64(raw.slice(7)), max)
  return clean(raw, max)
}

function userInfo(header) {
  const info = { upload: null, download: null, total: null, expire: null }
  for (const part of String(header || '').split(';')) {
    const bits = part.split('=')
    const key = bits[0]?.trim().toLowerCase()
    const raw = bits[1]?.trim()
    if (!raw || !/^\d+$/.test(raw)) continue
    const value = Number(raw)
    if (key === 'upload' || key === 'download' || key === 'total') info[key] = value
    if (key === 'expire' && value > 0) info.expire = value
  }
  return info
}

const emptyInfo = { announce: '', upload: null, download: null, total: null, expire: null }

function defined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
}

function tlsBlock(security, reality, tls, fallbackHost) {
  if (security === 'reality') {
    const fingerprint = clean(reality?.fingerprint, 32).toLowerCase()
    return defined({
      enabled: true,
      server_name: clean(reality?.serverName, 253) || fallbackHost,
      utls: fingerprint ? { enabled: true, fingerprint } : undefined,
      reality: {
        enabled: true,
        public_key: clean(reality?.publicKey, 120),
        short_id: clean(reality?.shortId, 32),
      },
    })
  }
  if (security === 'tls') {
    const fingerprint = clean(tls?.fingerprint, 32).toLowerCase()
    const alpn = Array.isArray(tls?.alpn) ? tls.alpn.map((item) => clean(item, 40)).filter(Boolean) : []
    return defined({
      enabled: true,
      server_name: clean(tls?.serverName, 253) || fallbackHost,
      alpn: alpn.length ? alpn : undefined,
      utls: fingerprint ? { enabled: true, fingerprint } : undefined,
    })
  }
  return null
}

function transportBlock(stream) {
  const network = clean(stream?.network, 32).toLowerCase()
  if (network === 'ws') {
    const ws = stream.wsSettings || {}
    const host = clean(ws.host, 253)
    return { type: 'ws', path: clean(ws.path, 300) || '/', headers: host ? { Host: host } : {} }
  }
  if (network === 'grpc') {
    return { type: 'grpc', service_name: clean(stream.grpcSettings?.serviceName, 200) }
  }
  if (network === 'httpupgrade') {
    const settings = stream.httpupgradeSettings || {}
    const host = clean(settings.host, 253)
    return { type: 'httpupgrade', path: clean(settings.path, 300) || '/', headers: host ? { Host: host } : {} }
  }
  if (network === 'xhttp' || network === 'splithttp') {
    const settings = stream.xhttpSettings || stream.splithttpSettings || {}
    return defined({
      type: 'xhttp',
      path: clean(settings.path, 300) || '/',
      host: clean(settings.host, 253) || undefined,
      mode: clean(settings.mode, 32) || undefined,
    })
  }
  return null
}

function fromXrayOutbound(outbound, remarks) {
  if (!outbound || ['freedom', 'blackhole', 'dns', 'loopback'].includes(outbound.protocol)) return null
  const name = clean(remarks, 80) || 'Сервер'
  if (outbound.protocol === 'vless') {
    const hop = outbound.settings?.vnext?.[0]
    const user = hop?.users?.[0]
    if (!hop?.address || !hop.port || !user?.id) return null
    const stream = outbound.streamSettings || {}
    const core = defined({
      type: 'vless',
      server: clean(hop.address, 253),
      server_port: Number(hop.port),
      uuid: clean(user.id, 80),
      flow: clean(user.flow, 64) || undefined,
      transport: transportBlock(stream) || undefined,
      tls: tlsBlock(stream.security, stream.realitySettings, stream.tlsSettings, hop.address) || undefined,
    })
    return {
      name,
      host: core.server,
      port: core.server_port,
      protocol: 'vless',
      vless: {
        uuid: core.uuid,
        flow: core.flow || '',
        network: clean(stream.network, 32) || 'tcp',
        security: clean(stream.security, 32) || 'none',
        sni: core.tls?.server_name || '',
        fp: clean(stream.realitySettings?.fingerprint || stream.tlsSettings?.fingerprint, 32),
        pbk: clean(stream.realitySettings?.publicKey, 120),
        sid: clean(stream.realitySettings?.shortId, 32),
        path: core.transport?.path || '',
        hostHeader: core.transport?.host || core.transport?.headers?.Host || '',
        serviceName: core.transport?.service_name || '',
        alpn: Array.isArray(core.tls?.alpn) ? core.tls.alpn.join(',') : '',
        packetEncoding: '',
        mode: core.transport?.mode || '',
      },
      core,
    }
  }
  if (outbound.protocol === 'hysteria' && Number(outbound.settings?.version || outbound.streamSettings?.hysteriaSettings?.version) === 2) {
    const settings = outbound.settings || {}
    const hysteria = outbound.streamSettings?.hysteriaSettings || {}
    const tls = outbound.streamSettings?.tlsSettings || {}
    const host = clean(settings.address, 253)
    const port = Number(settings.port)
    if (!host || !port) return null
    const core = defined({
      type: 'hysteria2',
      server: host,
      server_port: port,
      password: clean(hysteria.auth, 200),
      tls: tlsBlock('tls', null, tls, host) || { enabled: true, server_name: host },
    })
    return { name, host, port, protocol: 'hysteria2', vless: null, core }
  }
  return null
}

function bundleOf(config) {
  if (!config || !Array.isArray(config.outbounds)) return null
  const bundle = { outbounds: config.outbounds }
  if (config.dns) bundle.dns = config.dns
  if (config.routing) bundle.routing = config.routing
  if (config.burstObservatory) bundle.burstObservatory = config.burstObservatory
  if (config.observatory) bundle.observatory = config.observatory
  return bundle
}

function fromXrayConfig(config) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.outbounds)) return null
  const proxy = config.outbounds.find((item) => item && !['freedom', 'blackhole', 'dns', 'loopback'].includes(item.protocol))
  const server = fromXrayOutbound(proxy, config.remarks || config.ps || proxy?.tag)
  if (!server) return null
  server.xray = bundleOf(config)
  return server
}

function parseXrayBody(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null
  let data
  try {
    data = JSON.parse(trimmed)
  } catch {
    return null
  }
  const list = Array.isArray(data) ? data : data?.outbounds ? [data] : null
  if (!list) return null
  return list.map(fromXrayConfig).filter(Boolean)
}

const singPrivate = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16']

function strings(value) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return source
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function numbers(value) {
  const source = Array.isArray(value) ? value : typeof value === 'number' ? [value] : []
  return source.filter((item) => Number.isInteger(item) && item > 0 && item <= 65535)
}

function singInbounds(value) {
  const mapped = []
  for (const tag of strings(value)) {
    const lower = tag.toLowerCase()
    if (lower.includes('tun')) mapped.push('tun-in')
    else if (lower.includes('socks')) mapped.push('socks-in')
    else if (lower.includes('http')) mapped.push('http-in')
    else if (lower.includes('mixed')) mapped.push('socks-in', 'http-in')
  }
  return [...new Set(mapped)]
}

function singRule(rule, tags) {
  if (!rule || typeof rule !== 'object' || rule.invert) return null
  if (
    rule.rule_set ||
    rule.clash_mode ||
    rule.process_name ||
    rule.process_path ||
    rule.package_name ||
    rule.user
  ) {
    return null
  }
  const action = String(rule.action || 'route')
  if (action !== 'route' && action !== 'reject') return null
  const outboundTag = action === 'reject' ? 'block' : clean(rule.outbound, 64)
  if (!outboundTag || !tags.has(outboundTag)) return null
  const result = { type: 'field' }
  let hasCondition = false
  const domain = []
  for (const item of strings(rule.domain)) domain.push(`full:${item}`)
  for (const item of strings(rule.domain_suffix)) {
    const suffix = item.replace(/^\./, '')
    if (suffix) domain.push(`domain:${suffix}`)
  }
  for (const item of strings(rule.domain_keyword)) {
    domain.push(`regexp:${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  }
  for (const item of strings(rule.domain_regex)) domain.push(`regexp:${item}`)
  for (const item of strings(rule.geosite)) domain.push(`geosite:${item}`)
  if (domain.length) {
    result.domain = [...new Set(domain)].slice(0, 512)
    hasCondition = true
  }
  const ip = [...strings(rule.ip_cidr)]
  for (const item of strings(rule.geoip)) ip.push(`geoip:${item}`)
  if (rule.ip_is_private === true) ip.push(...singPrivate)
  if (ip.length) {
    result.ip = [...new Set(ip)].slice(0, 512)
    hasCondition = true
  }
  const sourceIP = strings(rule.source_ip_cidr)
  if (sourceIP.length) {
    result.sourceIP = sourceIP.slice(0, 128)
    hasCondition = true
  }
  const protocol = strings(rule.protocol)
  if (protocol.length) {
    result.protocol = protocol.slice(0, 32)
    hasCondition = true
  }
  if (rule.inbound !== undefined) {
    const inbound = singInbounds(rule.inbound)
    if (!inbound.length) return null
    result.inboundTag = inbound
    hasCondition = true
  }
  const ranges = strings(rule.port_range)
    .map((item) => item.replace(':', '-'))
    .filter((item) => /^\d+-\d+$/.test(item))
  const ports = [...numbers(rule.port).map(String), ...ranges]
  if (ports.length) {
    result.port = ports.join(',')
    hasCondition = true
  }
  if (rule.network !== undefined) {
    const network = strings(rule.network).filter((item) => item === 'tcp' || item === 'udp')
    if (!network.length) return null
    result.network = [...new Set(network)].join(',')
    hasCondition = true
  }
  if (!hasCondition) return null
  result.outboundTag = outboundTag
  return result
}

function singDns(dns) {
  const servers = []
  for (const item of Array.isArray(dns?.servers) ? dns.servers : []) {
    if (typeof item === 'string') {
      const address = item.trim()
      if (!address || /^(fakeip|fakedns|local)$/i.test(address)) continue
      servers.push(address)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const type = String(item.type || '')
    const host = clean(item.server, 253)
    if (!type) {
      const address = clean(item.address, 253)
      if (address && !/^(fakeip|fakedns|local)$/i.test(address)) servers.push(address)
      continue
    }
    if (!host) continue
    const value = Number(item.server_port)
    const port = Number.isInteger(value) && value > 0 ? value : null
    if (type === 'https') {
      const route = clean(item.path, 120) || '/dns-query'
      servers.push(`https://${host}${port ? `:${port}` : ''}${route.startsWith('/') ? route : `/${route}`}`)
    } else if (type === 'tls') {
      servers.push(`tls://${host}${port ? `:${port}` : ''}`)
    } else if (type === 'quic' || type === 'h3') {
      servers.push(`quic://${host}${port ? `:${port}` : ''}`)
    } else if (type === 'udp' || type === 'tcp') {
      servers.push(`${host}${port ? `:${port}` : ''}`)
    }
  }
  if (!servers.length) return null
  return { queryStrategy: 'UseIPv4', servers: [...new Set(servers)].slice(0, 8) }
}

function parseSingBoxBody(text) {
  let data
  try {
    data = JSON.parse(String(text || '').trim())
  } catch {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.outbounds)) return []
  const declared = data.outbounds.filter((item) => item && typeof item === 'object' && typeof item.type === 'string')
  if (!declared.length) return []
  const outbounds = []
  const tags = new Set()
  const add = (outbound) => {
    if (!outbound) return
    let tag = clean(outbound.tag, 64) || 'proxy'
    if (tags.has(tag)) {
      let index = 2
      while (tags.has(`${tag}-${index}`)) index += 1
      tag = `${tag}-${index}`
    }
    tags.add(tag)
    outbounds.push({ ...outbound, tag })
  }
  for (const item of declared) {
    const type = String(item.type || '')
    if (type === 'direct') {
      add({ protocol: 'freedom', tag: clean(item.tag, 64) || 'direct' })
      continue
    }
    if (type === 'block') {
      add({ protocol: 'blackhole', tag: clean(item.tag, 64) || 'block' })
      continue
    }
    if (type !== 'vless' && type !== 'hysteria2') continue
    try {
      add(fromSing(item))
    } catch {
      /* outbound не поддерживается */
    }
  }
  const proxies = outbounds.filter((item) => item.protocol === 'vless' || item.protocol === 'hysteria')
  if (!proxies.length) return []
  if (!outbounds.some((item) => item.protocol === 'blackhole')) add({ protocol: 'blackhole', tag: 'block' })
  if (!outbounds.some((item) => item.protocol === 'freedom')) add({ protocol: 'freedom', tag: 'direct' })
  const final = clean(data.route?.final, 64)
  let chosen = proxies.find((item) => item.tag === final)
  if (!chosen && final) {
    const group = declared.find((item) => clean(item.tag, 64) === final && Array.isArray(item.outbounds))
    const member = group ? clean(group.outbounds[0], 64) : ''
    chosen = proxies.find((item) => item.tag === member)
  }
  chosen = chosen || proxies[0]
  const ordered = [chosen, ...outbounds.filter((item) => item !== chosen)]
  const rules = (Array.isArray(data.route?.rules) ? data.route.rules : [])
    .slice(0, 400)
    .map((rule) => singRule(rule, tags))
    .filter(Boolean)
  const server = fromXrayOutbound(chosen, clean(data.remarks || data.ps, 80) || chosen.tag)
  if (!server) return []
  server.xray = { outbounds: ordered, routing: { domainStrategy: 'IPIfNonMatch', rules } }
  const dns = singDns(data.dns)
  if (dns) server.xray.dns = dns
  return [server]
}

function firstServers(...lists) {
  for (const list of lists) {
    if (list?.length) return list
  }
  return []
}

function unpack(text) {
  const trimmed = String(text || '').trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{') || /:\/\//.test(trimmed)) return trimmed
  const decoded = fromBase64(trimmed)
  if (!decoded) return trimmed
  const packed = decoded.trim()
  if (packed.startsWith('[') || packed.startsWith('{') || /:\/\//.test(packed)) return packed
  return trimmed
}

function readThrough(socket, host, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      method: 'GET',
      path,
      headers: {
        host,
        'user-agent': 'v2rayNG/1.8.29',
        accept: '*/*',
        'accept-encoding': 'identity',
        connection: 'close',
      },
      createConnection: () => socket,
    })
    const timer = setTimeout(() => request.destroy(new Error('timeout')), 20000)
    const done = (error, value) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    request.on('response', (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > 2_000_000) {
          request.destroy(new Error('Подписка слишком большая'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        done(null, {
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
      response.on('error', (error) => done(error))
    })
    request.on('error', (error) => done(error))
    request.end()
  })
}

async function fetchThroughProxy(url, proxyPort, hops = 0) {
  if (hops > 6) throw new Error('Слишком много перенаправлений')
  const target = new URL(url)
  const secure = target.protocol === 'https:'
  const port = Number(target.port || (secure ? 443 : 80))
  let socket = await openUpstream(target.hostname, port, { type: 'http', host: '127.0.0.1', port: proxyPort })
  if (secure) {
    const tunneled = socket
    socket = tls.connect({ socket: tunneled, servername: target.hostname })
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
      socket.once('close', () => reject(new Error('Соединение закрыто')))
    })
  }
  const path = `${target.pathname || '/'}${target.search || ''}`
  const result = await readThrough(socket, target.host, path).finally(() => {
    socket.destroy()
  })
  if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
    const next = new URL(String(result.headers.location), target).toString()
    return fetchThroughProxy(next, proxyPort, hops + 1)
  }
  return result
}

function headerValue(value) {
  if (Array.isArray(value)) return String(value[0] || '')
  return String(value || '')
}

async function fetchSub(url, proxyPort) {
  if (proxyPort) {
    const loaded = await fetchThroughProxy(String(url), proxyPort)
    if (loaded.status < 200 || loaded.status >= 300) throw new Error(`Подписка ответила ${loaded.status}`)
    const info = {
      ...userInfo(headerValue(loaded.headers['subscription-userinfo'])),
      announce: headerText(headerValue(loaded.headers.announce), 500).replace(/\r/g, '').trim(),
    }
    const title = decodeTitle(headerValue(loaded.headers['profile-title'] || loaded.headers['content-disposition']))
    return { body: loaded.body, title, info }
  }
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: { 'user-agent': 'v2rayNG/1.8.29' },
  })
  if (!response.ok) throw new Error(`Подписка ответила ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Пустой ответ подписки')
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 2_000_000) throw new Error('Подписка слишком большая')
    chunks.push(value)
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
  const title = decodeTitle(response.headers.get('profile-title') || response.headers.get('content-disposition') || '')
  const usage = userInfo(response.headers.get('subscription-userinfo'))
  const info = {
    ...usage,
    announce: headerText(response.headers.get('announce'), 500).replace(/\r/g, '').trim(),
  }
  return { body, title, info }
}

export async function importSource(source, options = {}) {
  const proxyPort = Number(options.proxy) > 0 ? Number(options.proxy) : null
  const text = String(source || '').trim()
  if (!text) throw new Error('Вставьте ссылку или vless://')
  if (/vless:\/\//i.test(text)) {
    const servers = collect(text)
    if (!servers.length) throw new Error('Не разобрал ни одной ссылки vless')
    const name = servers.length === 1 ? servers[0].name : 'Мои'
    return { name, url: '', servers, info: emptyInfo }
  }
  if (/^https?:\/\//i.test(text)) {
    let url
    try {
      url = new URL(text.split(/\s+/)[0])
    } catch {
      throw new Error('Некорректная ссылка')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Нужна ссылка http или https')
    let loaded
    try {
      loaded = await fetchSub(url, proxyPort)
    } catch (error) {
      const text = String(error?.message || '')
      if (error?.name === 'TimeoutError' || text === 'timeout') throw new Error('Подписка не ответила')
      throw new Error(text || 'Не удалось открыть ссылку')
    }
    const unpacked = unpack(loaded.body)
    const servers = firstServers(parseXrayBody(unpacked), parseSingBoxBody(unpacked), collect(unpacked))
    if (!servers.length) throw new Error('В подписке нет поддерживаемых серверов')
    return { name: loaded.title || url.hostname, url: url.toString(), servers, info: loaded.info || emptyInfo }
  }
  throw new Error('Нужна ссылка подписки или vless://')
}

export { parseVless, decodeBody }
