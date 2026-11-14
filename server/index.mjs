import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from './engine.mjs'
import { importSource } from './links.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const engine = new Engine(root)

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  try {
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
    if (req.method === 'POST' && url.pathname === '/api/import') {
      const body = await readJson(req)
      const result = await importSource(body.source)
      send(res, 200, result)
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/probe') {
      const ms = await engine.probe(url.searchParams.get('host'), url.searchParams.get('port'))
      send(res, 200, { ms })
      return
    }
    send(res, 404, { error: 'нет такого пути' })
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
server.listen(47321, '127.0.0.1', () => {
  console.log('Astral engine  http://127.0.0.1:47321')
})
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error('Порт движка 47321 уже занят')
  else console.error(error.message)
  process.exit(1)
})

if (!process.stdin.isTTY) process.stdin.on('end', () => void shutdown())
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
