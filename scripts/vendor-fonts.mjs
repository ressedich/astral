import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fontsDir = path.join(root, 'src', 'assets', 'fonts')
const cssPath = path.join(root, 'src', 'fonts.css')

const families = [
  'Cormorant+Garamond:ital,wght@0,500;1,500;1,600',
  'Manrope:wght@400;500;600',
  'Unbounded:wght@400;500',
].join('&family=')

const url = `https://fonts.googleapis.com/css2?family=${families}&display=swap`
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const response = await fetch(url, { headers: { 'user-agent': UA } })
if (!response.ok) throw new Error(`Google Fonts ответил ${response.status}`)
const css = await response.text()

await mkdir(fontsDir, { recursive: true })

const blocks = css.split('/*').slice(1).map((part) => `/*${part}`)
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const keep = new Set(['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'])
const out = []
let saved = 0

for (const block of blocks) {
  const subset = (block.match(/^\/\*\s*([a-z0-9-]+)\s*\*\//i) || [])[1]
  const face = block.match(/@font-face\s*\{([\s\S]*?)\}/)
  if (!subset || !face || !keep.has(subset)) continue
  const body = face[1]
  const family = (body.match(/font-family:\s*'([^']+)'/) || [])[1]
  const style = (body.match(/font-style:\s*([^;]+);/) || [])[1]?.trim() || 'normal'
  const weight = (body.match(/font-weight:\s*([^;]+);/) || [])[1]?.trim() || '400'
  const range = (body.match(/unicode-range:\s*([^;]+);/) || [])[1]?.trim()
  const src = (body.match(/url\((https:[^)]+)\)/) || [])[1]
  if (!family || !src) continue

  const name = `${slug(family)}-${weight}-${slug(style)}-${subset}.woff2`
  const file = await fetch(src, { headers: { 'user-agent': UA } })
  if (!file.ok) throw new Error(`Не скачался ${src}: ${file.status}`)
  await writeFile(path.join(fontsDir, name), Buffer.from(await file.arrayBuffer()))
  saved += 1

  out.push(
    [
      '@font-face {',
      `  font-family: '${family}';`,
      `  font-style: ${style};`,
      `  font-weight: ${weight};`,
      '  font-display: swap;',
      `  src: url('./assets/fonts/${name}') format('woff2');`,
      range ? `  unicode-range: ${range};` : null,
      '}',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

const header = '/* Сгенерировано scripts/vendor-fonts.mjs. Шрифты: SIL Open Font License 1.1. */\n\n'
await writeFile(cssPath, header + out.join('\n\n') + '\n')
console.log(`Сохранено ${saved} файлов шрифтов, CSS: src/fonts.css`)
