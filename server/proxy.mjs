import dns from 'node:dns/promises'
import net from 'node:net'

function arm(socket) {
  socket.setNoDelay(true)
  socket.on('error', () => {})
}

export class ByteBuffer {
  constructor(socket) {
    this.socket = socket
    this.chunks = []
    this.length = 0
    this.waiters = []
    this.onData = (chunk) => {
      this.chunks.push(chunk)
      this.length += chunk.length
      this.drain()
    }
    this.onEnd = () => this.fail(new Error('соединение закрыто'))
    this.onError = (error) => this.fail(error)
    socket.on('data', this.onData)
    socket.on('end', this.onEnd)
    socket.on('error', this.onError)
  }

  read(size) {
    if (this.length >= size) return Promise.resolve(this.take(size))
    return new Promise((resolve, reject) => {
      this.waiters.push({ size, resolve, reject })
    })
  }

  async readHeader(max = 32768) {
    const acc = []
    while (acc.length < max) {
      const byte = await this.read(1)
      acc.push(byte[0])
      const n = acc.length
      if (n >= 4 && acc[n - 4] === 13 && acc[n - 3] === 10 && acc[n - 2] === 13 && acc[n - 1] === 10) {
        return Buffer.from(acc.slice(0, n - 4)).toString('utf8')
      }
    }
    throw new Error('слишком большой заголовок')
  }

  take(size) {
    const out = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const head = this.chunks[0]
      const need = size - offset
      if (head.length <= need) {
        head.copy(out, offset)
        offset += head.length
        this.chunks.shift()
      } else {
        head.copy(out, offset, 0, need)
        this.chunks[0] = head.subarray(need)
        offset += need
      }
    }
    this.length -= size
    return out
  }

  drain() {
    while (this.waiters.length && this.length >= this.waiters[0].size) {
      const waiter = this.waiters.shift()
      waiter.resolve(this.take(waiter.size))
    }
  }

  fail(error) {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter.reject(error)
  }

  release() {
    this.socket.off('data', this.onData)
    this.socket.off('end', this.onEnd)
    this.socket.off('error', this.onError)
    if (this.length) this.socket.unshift(this.take(this.length))
    this.fail(new Error('released'))
  }
}

export function connectTcp(host, port, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket = net.connect({ host, port })
    arm(socket)
    const timer = setTimeout(() => finish(new Error('таймаут')), timeout)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        socket.destroy()
        reject(error)
      } else resolve(value)
    }
    socket.once('connect', () => finish(null, socket))
    socket.once('error', (error) => finish(error))
  })
}

function formatIpv6(buffer) {
  const parts = []
  for (let i = 0; i < 16; i += 2) parts.push(buffer.readUInt16BE(i).toString(16))
  return parts.join(':')
}

async function readSocksAddress(buffer, atyp) {
  if (atyp === 1) {
    const addr = await buffer.read(4)
    return Array.from(addr).join('.')
  }
  if (atyp === 3) {
    const len = (await buffer.read(1))[0]
    return (await buffer.read(len)).toString('utf8')
  }
  if (atyp === 4) return formatIpv6(await buffer.read(16))
  throw new Error('неизвестный адрес')
}

function socksReply(code) {
  return Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
}

async function connectViaSocks(upstream, host, port) {
  const socket = await connectTcp(upstream.host, upstream.port)
  const buffer = new ByteBuffer(socket)
  try {
    if (upstream.username) socket.write(Buffer.from([0x05, 0x01, 0x02]))
    else socket.write(Buffer.from([0x05, 0x01, 0x00]))
    const method = await buffer.read(2)
    if (method[0] !== 0x05) throw new Error('сервер не говорит на SOCKS5')
    if (method[1] === 0x02) {
      const user = Buffer.from(upstream.username)
      const pass = Buffer.from(upstream.password || '')
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]))
      const auth = await buffer.read(2)
      if (auth[1] !== 0x00) throw new Error('сервер не принял логин')
    } else if (method[1] !== 0x00) {
      throw new Error('сервер не принял метод SOCKS')
    }
    const name = Buffer.from(host)
    const request = Buffer.alloc(7 + name.length)
    request[0] = 0x05
    request[1] = 0x01
    request[2] = 0x00
    request[3] = 0x03
    request[4] = name.length
    name.copy(request, 5)
    request.writeUInt16BE(port, 5 + name.length)
    socket.write(request)
    const head = await buffer.read(4)
    if (head[1] !== 0x00) throw new Error('сервер отклонил соединение')
    await readSocksAddress(buffer, head[3])
    await buffer.read(2)
    buffer.release()
    return socket
  } catch (error) {
    buffer.release()
    socket.destroy()
    throw error
  }
}

async function connectViaHttp(upstream, host, port) {
  const socket = await connectTcp(upstream.host, upstream.port)
  const buffer = new ByteBuffer(socket)
  try {
    let auth = ''
    if (upstream.username) {
      const token = Buffer.from(`${upstream.username}:${upstream.password || ''}`).toString('base64')
      auth = `Proxy-Authorization: Basic ${token}\r\n`
    }
    socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`)
    const header = await buffer.readHeader()
    if (!/^HTTP\/1\.[01] 200\b/.test(header)) throw new Error('сервер отклонил CONNECT')
    buffer.release()
    return socket
  } catch (error) {
    buffer.release()
    socket.destroy()
    throw error
  }
}

function directUpstream(upstream) {
  return !upstream || upstream.type === 'direct' || !upstream.host
}

export function openUpstream(host, port, upstream) {
  if (directUpstream(upstream)) return connectTcp(host, port)
  if (upstream.type === 'http') return connectViaHttp(upstream, host, port)
  return connectViaSocks(upstream, host, port)
}

export function link(client, remote, counters) {
  client.setTimeout(0)
  remote.setTimeout(0)
  const pump = (from, to, key) => {
    from.on('data', (chunk) => {
      counters[key] += chunk.length
      if (to.destroyed) return
      if (!to.write(chunk)) from.pause()
    })
    to.on('drain', () => from.resume())
  }
  const close = () => {
    client.destroy()
    remote.destroy()
  }
  pump(client, remote, 'tx')
  pump(remote, client, 'rx')
  client.on('end', () => remote.end())
  remote.on('end', () => client.end())
  client.on('error', close)
  remote.on('error', close)
  client.on('close', () => remote.destroy())
  remote.on('close', () => client.destroy())
}

function splitHostPort(target, fallback) {
  if (target.startsWith('[')) {
    const end = target.indexOf(']')
    const host = target.slice(1, end)
    const port = target.slice(end + 2)
    return [host, Number(port || fallback)]
  }
  const index = target.lastIndexOf(':')
  if (index === -1) return [target, fallback]
  return [target.slice(0, index), Number(target.slice(index + 1))]
}

async function handleSocks(socket, upstream, counters) {
  arm(socket)
  socket.setTimeout(20000, () => socket.destroy())
  const buffer = new ByteBuffer(socket)
  try {
    const head = await buffer.read(2)
    if (head[0] !== 0x05) throw new Error('socks')
    const methods = await buffer.read(head[1])
    if (!methods.includes(0x00)) {
      socket.write(Buffer.from([0x05, 0xff]))
      socket.end()
      return
    }
    socket.write(Buffer.from([0x05, 0x00]))
    const request = await buffer.read(4)
    if (request[1] !== 0x01) {
      socket.write(socksReply(0x07))
      socket.end()
      return
    }
    const host = await readSocksAddress(buffer, request[3])
    const port = (await buffer.read(2)).readUInt16BE(0)
    const remote = await openUpstream(host, port, upstream)
    buffer.release()
    socket.write(socksReply(0x00))
    link(socket, remote, counters)
  } catch {
    try {
      buffer.release()
    } catch {
      /* already released */
    }
    if (!socket.destroyed) {
      socket.write(socksReply(0x05))
      socket.destroy()
    }
  }
}

async function handleHttp(socket, upstream, counters) {
  arm(socket)
  socket.setTimeout(20000, () => socket.destroy())
  const buffer = new ByteBuffer(socket)
  try {
    const header = await buffer.readHeader()
    const [requestLine, ...headerLines] = header.split('\r\n')
    const [method, target, version = 'HTTP/1.1'] = requestLine.split(' ')
    if (!method || !target) throw new Error('bad request')
    let host = ''
    let port = 80
    let path = '/'
    if (method === 'CONNECT') {
      ;[host, port] = splitHostPort(target, 443)
    } else {
      const url = target.startsWith('http://') || target.startsWith('https://') ? new URL(target) : null
      if (url?.protocol === 'https:') {
        socket.write('HTTP/1.1 400 Use CONNECT\r\nConnection: close\r\n\r\n')
        socket.end()
        return
      }
      if (url) {
        host = url.hostname
        port = Number(url.port || 80)
        path = `${url.pathname}${url.search}` || '/'
      } else {
        const hostHeader = headerLines.find((line) => line.toLowerCase().startsWith('host:'))
        const raw = hostHeader ? hostHeader.slice(5).trim() : ''
        ;[host, port] = splitHostPort(raw, 80)
        path = target
      }
    }
    const remote = await openUpstream(host, port, upstream)
    if (method === 'CONNECT') {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    } else {
      const kept = headerLines.filter((line) => {
        const name = line.split(':')[0]?.trim().toLowerCase()
        return name && !['proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'host'].includes(name)
      })
      const lines = [`${method} ${path} ${version}`, `Host: ${host}${port === 80 ? '' : `:${port}`}`, ...kept, '', '']
      remote.write(lines.join('\r\n'))
    }
    buffer.release()
    link(socket, remote, counters)
  } catch {
    try {
      buffer.release()
    } catch {
      /* already released */
    }
    if (!socket.destroyed) {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      socket.destroy()
    }
  }
}

function listen(port, handler) {
  const server = net.createServer(handler)
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.sockets = sockets
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError)
      server.on('error', () => {})
      resolve(server)
    })
  })
}

function closeServer(server) {
  if (!server) return Promise.resolve()
  for (const socket of server.sockets ?? []) socket.destroy()
  server.closeAllConnections?.()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 400)
    server.close(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function portError(error, port, label) {
  if (error?.code === 'EADDRINUSE') return `${label} ${port} уже занят`
  return error?.message || `не удалось открыть ${label}`
}

export async function startProxy({ httpPort, socksPort, upstream, counters }) {
  let httpServer
  try {
    httpServer = await listen(httpPort, (socket) => {
      void handleHttp(socket, upstream, counters)
    })
  } catch (error) {
    throw new Error(portError(error, httpPort, 'HTTP'))
  }
  let socksServer
  try {
    socksServer = await listen(socksPort, (socket) => {
      void handleSocks(socket, upstream, counters)
    })
  } catch (error) {
    await closeServer(httpServer)
    throw new Error(portError(error, socksPort, 'SOCKS'))
  }
  return {
    async close() {
      await Promise.all([closeServer(httpServer), closeServer(socksServer)])
    },
  }
}

export function probeEgress(httpPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: httpPort })
    arm(socket)
    let data = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('timeout'))
    }, 8000)
    socket.once('connect', () => {
      socket.write('GET http://ipv4.icanhazip.com/ HTTP/1.1\r\nHost: ipv4.icanhazip.com\r\nConnection: close\r\n\r\n')
    })
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8')
    })
    socket.on('end', () => {
      clearTimeout(timer)
      const body = data.split('\r\n\r\n').pop()?.trim() || ''
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(body)) resolve(body)
      else reject(new Error('bad egress'))
    })
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

export async function probeViaProxy(proxyPort, host, port) {
  const started = performance.now()
  try {
    const socket = await Promise.race([
      openUpstream(host, port, { type: 'http', host: '127.0.0.1', port: proxyPort }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
    ])
    socket.end()
    return Math.max(1, Math.round(performance.now() - started))
  } catch {
    return -1
  }
}

export async function probeTcp(host, port) {
  let address = String(host || '')
  if (!net.isIP(address)) {
    try {
      const found = await dns.lookup(address, { family: 4 })
      address = found.address
    } catch {
      return -1
    }
  }
  const started = performance.now()
  try {
    const socket = await connectTcp(address, Number(port), 1200)
    socket.end()
    return Math.max(1, Math.round(performance.now() - started))
  } catch {
    return -1
  }
}
