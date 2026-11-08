import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/PlayerLOD.js', 'client/core/PlayerLODTSL.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const pinned = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'player-dot-shader.json'), 'utf8')).source
const hashes = Object.fromEntries(files.map((f) => [f, sha256(f)]))
for (const f of files) {
  if (hashes[f] !== pinned.sha256[f]) throw new Error(f + ' differs from the dot shader fixture pinned at ' + pinned.commit)
}
const commit = execFileSync('git', ['log', '-1', '--format=%h', '--', ...files], { cwd: spointRoot }).toString().trim()
if (commit !== pinned.commit) throw new Error('last commit touching the dot files is ' + commit + ', not ' + pinned.commit)

const mapped = {
  three: import.meta.resolve('three'),
  'three/tsl': import.meta.resolve('three/tsl'),
  'three/webgpu': import.meta.resolve('three/webgpu'),
  '@three.ez/instanced-mesh': import.meta.resolve('@three.ez/instanced-mesh'),
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mapped, specifier)) return { url: mapped[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const spointLod = await import(pathToFileURL(join(spointRoot, 'client/core/PlayerLOD.js')).href)
const spointTsl = await import(pathToFileURL(join(spointRoot, 'client/core/PlayerLODTSL.js')).href)
const props = (m) => ({ side: m.side, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite })
const mesh = spointLod.createCrowdDotRenderer({ children: [], add() {}, remove() {} }, {}).instancedMesh
const fixture = {
  source: { commit, files, sha256: hashes },
  webgl: {
    material: props(mesh.material),
    mesh: { frustumCulled: mesh.frustumCulled, renderOrder: mesh.renderOrder },
  },
  tsl: { material: props(spointTsl.createDotMaterialTSL()) },
}
const out = join(here, 'fixtures', 'spoint', 'player-dot-material.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' at ' + commit)
