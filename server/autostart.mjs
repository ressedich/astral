import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const valueName = 'Astral'

function reg(args) {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, text: `${stdout || ''}${stderr || ''}` })
    })
  })
}

function target() {
  if (process.env.ASTRAL_PACKAGED !== '1') return null
  const exe = String(process.env.ASTRAL_EXE || '').trim()
  if (!exe || !existsSync(exe)) return null
  return exe
}

export async function readAutostart() {
  const exe = target()
  if (!exe) return { available: false, enabled: false }
  const result = await reg(['query', runKey, '/v', valueName])
  if (!result.ok) return { available: true, enabled: false }
  const enabled = result.text.toLowerCase().includes(exe.toLowerCase())
  return { available: true, enabled }
}

export async function writeAutostart(enabled) {
  const exe = target()
  if (!exe) throw new Error('Автозапуск доступен в установленной версии')
  if (enabled) {
    const result = await reg(['add', runKey, '/v', valueName, '/t', 'REG_SZ', '/d', `"${exe}"`, '/f'])
    if (!result.ok) throw new Error('Windows не разрешила включить автозапуск')
  } else {
    await reg(['delete', runKey, '/v', valueName, '/f'])
  }
  return readAutostart()
}
