import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = process.argv[2] ?? '/workspace/spoint'
const readme = readFileSync(join(spointRoot, 'README.md'), 'utf8')
const block = /## World Config[^\n]*\n\n```javascript\n([\s\S]*?)```/.exec(readme)
if (!block) throw new Error('World Config block not found in the spoint README')
const source = block[1]

const tickRate = Number(/tickRate:\s*(\d+)/.exec(source)?.[1])
const gravity = JSON.parse(/gravity:\s*(\[[^\]]*\])/.exec(source)?.[1] ?? 'null')
const movementText = /movement:\s*(\{[^}]*\})/.exec(source)?.[1]
if (!Number.isFinite(tickRate) || !Array.isArray(gravity) || !movementText) throw new Error('World Config fields not found')
const movement = JSON.parse(movementText.replace(/(\w+):/g, '"$1":'))

const fixture = { source: 'spoint README.md, World Config block', tickRate, gravity, movement }
writeFileSync(join(here, 'fixtures', 'spoint', 'world-config.json'), JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote world-config.json:', JSON.stringify({ tickRate, gravity, movement }))
