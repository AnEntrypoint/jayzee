import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory = join(scriptsDirectory, 'fixtures')
const outputPath = join(outputDirectory, 'spoint-content.json')
const portPattern = /\bport\b["']?\s*:\s*(\d+)/g

const sourceArgument = process.argv[2]
if (!sourceArgument) {
  console.error('usage: node scripts/gen-spoint-content.mjs <spoint-root>')
  process.exit(2)
}

const spointRoot = resolve(sourceArgument)
const entriesIn = (relative) => readdirSync(join(spointRoot, relative), { withFileTypes: true })
const namesWhere = (relative, keep) => entriesIn(relative).filter(keep).map((entry) => entry.name).sort()
const isGlb = (entry) => entry.isFile() && entry.name.endsWith('.glb')
const portsDeclaredIn = (relative) => [...readFileSync(join(spointRoot, relative), 'utf8').matchAll(portPattern)].map((match) => Number(match[1]))

const worldFiles = namesWhere('apps/world', (entry) => entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'index.js')

const content = {
  commit: execFileSync('git', ['-C', spointRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  placedApps: {
    directories: namesWhere('src/stdlib-apps', (entry) => entry.isDirectory()),
    nonDirectories: namesWhere('src/stdlib-apps', (entry) => !entry.isDirectory()),
  },
  worldDefs: worldFiles.map((file) => ({ file, ports: portsDeclaredIn(join('apps/world', file)) })),
  maps: {
    glb: namesWhere('apps/maps', isGlb),
    other: namesWhere('apps/maps', (entry) => !isGlb(entry)),
  },
}

mkdirSync(outputDirectory, { recursive: true })
writeFileSync(outputPath, JSON.stringify(content, null, 2) + '\n')
console.log('placed apps: ' + content.placedApps.directories.length + ' directories, ' + content.placedApps.nonDirectories.length + ' other entries')
console.log('world defs: ' + content.worldDefs.length + ' (index.js excluded)')
console.log('glb maps: ' + content.maps.glb.length + ' (' + content.maps.other.length + ' other entries)')
console.log('port 3002 declared by: ' + content.worldDefs.filter((def) => def.ports.includes(3002)).map((def) => def.file).join(', '))
console.log('wrote ' + outputPath)
