import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function pick(value, fallback) {
  const text = String(value || '').trim()
  return text ? path.resolve(text) : fallback
}

export const paths = {
  root,
  bin: pick(process.env.ASTRAL_BIN, path.join(root, 'bin')),
  runtime: pick(process.env.ASTRAL_RUNTIME, path.join(root, 'runtime')),
  web: pick(process.env.ASTRAL_WEB, path.join(root, 'dist')),
}

const requested = Number(process.env.ASTRAL_PORT)
export const port = Number.isInteger(requested) && requested > 0 && requested < 65536 ? requested : 47321
export const host = '127.0.0.1'
