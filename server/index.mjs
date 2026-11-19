import http from 'node:http'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Engine } from './engine.mjs'
import { importSource } from './links.mjs'
import { readAutostart, writeAutostart } from './autostart.mjs'
import { paths, port, host } from './paths.mjs'

const engine = new Engine({ root: paths.root, bin: paths.bin, runtime: paths.runtime })
const webRoot = path.resolve(paths.web)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function send(res, code, body) {
  const data = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  })
  res.end(data)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('Слишком большой запрос')
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('Некорректный JSON')
  }
}

function insideWeb(target) {
  const base = webRoot.toLowerCase() + path.sep
  return target.toLowerCase().startsWith(base)
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'метод не поддерживается' })
    return
  }
  let relative
  try {
    relative = decodeURIComponent(pathname)
  } catch {
    send(res, 400, { error: 'некорректный адрес' })
    return
  }
  if (relative === '/' || relative === '') relative = '/index.html'
  const clean = relative.replace(/^[/\\]+/, '')
  let target = path.resolve(webRoot, clean)
  if (!insideWeb(target)) {
    send(res, 403, { error: 'нет доступа' })
    return
  }
  let info = await stat(target).catch(() => null)
  if (info?.isDirectory()) {
    target = path.join(target, 'index.html')
    info = await stat(target).catch(() => null)
  }
  if (!info?.isFile()) {
    if (path.extname(clean)) {
      send(res, 404, { error: 'файл не найден' })
      return
    }
    target = path.join(webRoot, 'index.html')
    info = await stat(target).catch(() => null)
    if (!info?.isFile()) {
      send(res, 503, { error: 'Интерфейс Astral не собран' })
      return
    }
  }
  const ext = path.extname(target).toLowerCase()
  const immutable = target.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, {
    'content-type': types[ext] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
    'x-content-type-options': 'nosniff',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  await pipeline(createReadStream(target), res).catch(() => {})
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${host}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && url.pathname === '/api/session') {
        send(res, 200, engine.snapshot())
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/session') {
        const body = await readJson(req)
        engine.cancel = false
        const snapshot = await engine.enqueue(() => engine.connect(body))
        send(res, 200, snapshot)
        return
      }
      if (req.method === 'DELETE' && url.pathname === '/api/session') {
        engine.cancel = true
        const snapshot = await engine.enqueue(() => engine.disconnect())
        send(res, 200, snapshot)
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/system') {
        send(res, 200, { autostart: await readAutostart() })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/system') {
        const body = await readJson(req)
        const autostart = await writeAutostart(body?.autostart === true)
        send(res, 200, { autostart })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/import') {
        const body = await readJson(req)
        const result = await importSource(body.source, { proxy: engine.proxyPort() })
        send(res, 200, result)
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/probe') {
        const ms = await engine.probe(url.searchParams.get('host'), url.searchParams.get('port'))
        send(res, 200, { ms })
        return
      }
      send(res, 404, { error: 'нет такого пути' })
      return
    }
    await serveStatic(req, res, url.pathname)
  } catch (error) {
    send(res, 400, { error: error?.message || 'сбой' })
  }
})

let closed = false
async function shutdown() {
  if (closed) return
  closed = true
  engine.cancel = true
  await engine.enqueue(() => engine.disconnect())
  server.close()
  process.exit(0)
}

await engine.prepare()
server.listen(port, host, () => {
  console.log(`Astral engine  http://${host}:${port}`)
})
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Порт движка ${port} уже занят`)
  else console.error(error.message)
  process.exit(1)
})

if (!process.stdin.isTTY) {
  process.stdin.on('end', () => void shutdown())
  process.stdin.resume()
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
