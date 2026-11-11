import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'engine', 'artifacts.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
let changed = 0
for (const [name, entry] of Object.entries(manifest.artifacts)) {
  const sha256 = createHash('sha256').update(readFileSync(join(root, entry.wasm))).digest('hex')
  if (sha256 !== entry.sha256) changed += 1
  console.log(name + ' ' + (sha256 === entry.sha256 ? 'unchanged ' : entry.sha256.slice(0, 12) + ' -> ') + sha256.slice(0, 12))
  entry.sha256 = sha256
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log('pins changed: ' + changed)
