import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = path.join(root, 'bin')
const tmp = path.join(bin, '.download')

const XRAY = {
  url: 'https://github.com/XTLS/Xray-core/releases/download/v26.11.9/Xray-windows-64.zip',
}

const SING = {
  url: 'https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box-1.14.4-windows-amd64.zip',
}

const WINTUN = {
  url: 'https://www.wintun.net/builds/wintun-0.14.1.zip',
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stdout || ''}\n${stderr || ''}`
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function download(url, target) {
  if (await tryCurl(url, target)) return
  await rm(target, { force: true })
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Не удалось скачать ${url}: ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
}

function tryCurl(url, target) {
  return new Promise((resolve) => {
    execFile(
      'curl',
      ['-fL', '--retry', '2', '--retry-delay', '2', '--connect-timeout', '20', '--max-time', '240', '--speed-limit', '2048', '--speed-time', '30', '-o', target, url],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          console.warn(`curl не справился: ${(stderr || error.message).trim().split('\n')[0]}`)
          resolve(false)
          return
        }
        resolve(true)
      },
    )
  })
}

async function findAll(dir, name, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await findAll(full, name, found)
    else if (entry.name.toLowerCase() === name.toLowerCase()) found.push(full)
  }
  return found
}

async function ensure(pack, mapping, marker) {
  if (existsSync(path.join(bin, marker))) {
    console.log(`${marker} уже на месте`)
    return
  }
  await mkdir(bin, { recursive: true })
  const archive = path.join(tmp, path.basename(new URL(pack.url).pathname))
  const unpacked = path.join(tmp, path.basename(archive, path.extname(archive)))
  await rm(unpacked, { recursive: true, force: true })
  await mkdir(unpacked, { recursive: true })
  console.log(`Скачиваю ${pack.url}`)
  await download(pack.url, archive)
  await run('tar', ['-xf', archive, '-C', unpacked])
  for (const item of mapping) {
    const [source] = await findAll(unpacked, item.from)
    if (!source) {
      if (item.optional) continue
      throw new Error(`В архиве нет ${item.from}`)
    }
    const target = path.join(bin, item.to)
    await copyFile(source, target)
    const size = (await stat(target)).size
    console.log(`${item.to}  ${(size / 1024 / 1024).toFixed(1)} МБ`)
  }
}

await mkdir(tmp, { recursive: true })
try {
  await ensure(
    XRAY,
    [
      { from: 'xray.exe', to: 'xray.exe' },
      { from: 'geoip.dat', to: 'geoip.dat' },
      { from: 'geosite.dat', to: 'geosite.dat' },
      { from: 'LICENSE', to: 'LICENSE' },
    ],
    'xray.exe',
  )
  await ensure(
    SING,
    [
      { from: 'sing-box.exe', to: 'sing-box.exe' },
      { from: 'libcronet.dll', to: 'libcronet.dll', optional: true },
      { from: 'LICENSE', to: 'LICENSE-sing-box', optional: true },
    ],
    'sing-box.exe',
  )
  const vendored = path.join(root, 'vendor', 'wintun')
  if (existsSync(path.join(vendored, 'wintun.dll'))) {
    await copyFile(path.join(vendored, 'wintun.dll'), path.join(bin, 'wintun.dll'))
    if (existsSync(path.join(vendored, 'LICENSE.txt'))) {
      await copyFile(path.join(vendored, 'LICENSE.txt'), path.join(bin, 'LICENSE-Wintun'))
    }
    console.log('wintun.dll взят из vendor/wintun')
  } else {
    await ensure(
      WINTUN,
      [
        { from: 'wintun.dll', to: 'wintun.dll' },
        { from: 'LICENSE.txt', to: 'LICENSE-Wintun', optional: true },
      ],
      'wintun.dll',
    ).catch((error) => {
      console.warn(`wintun.dll не скачался, это не критично: ${error.message.split('\n')[0]}`)
    })
  }
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log('Ядра готовы в bin/')
