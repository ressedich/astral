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

function unpack(text) {
  const trimmed = String(text || '').trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{') || /:\/\//.test(trimmed)) return trimmed
  const decoded = fromBase64(trimmed)
  if (!decoded) return trimmed
  const packed = decoded.trim()
  if (packed.startsWith('[') || packed.startsWith('{') || /:\/\//.test(packed)) return packed
  return trimmed
}

async function fetchSub(url) {
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

export async function importSource(source) {
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
      loaded = await fetchSub(url)
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new Error('Подписка не ответила')
      throw new Error(error?.message || 'Не удалось открыть ссылку')
    }
    const unpacked = unpack(loaded.body)
    const servers = parseXrayBody(unpacked) || collect(unpacked)
    if (!servers.length) throw new Error('В подписке нет поддерживаемых серверов')
    return { name: loaded.title || url.hostname, url: url.toString(), servers, info: loaded.info || emptyInfo }
  }
  throw new Error('Нужна ссылка подписки или vless://')
}

export { parseVless, decodeBody }
