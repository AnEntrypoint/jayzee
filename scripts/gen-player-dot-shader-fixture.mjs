import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/PlayerLOD.js', 'client/core/PlayerLODTSL.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: spointRoot }).toString().trim()
const mapped = {
  'three': import.meta.resolve('three'),
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
const shaderOf = (material) => {
  const shader = { uniforms: {}, vertexShader: ['#include <common>', '#include <begin_vertex>', 'void main() {}'].join(String.fromCharCode(10)) }
  material.onBeforeCompile(shader)
  return shader.vertexShader
}
const dots = spointLod.createCrowdDotRenderer({ children: [], add() {}, remove() {} }, {})
const fixture = {
  source: { commit, files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])) },
  webglVertexShader: shaderOf(dots.instancedMesh.material),
  tslSource: spointTsl.createDotMaterialTSL.toString(),
}
const out = join(here, 'fixtures', 'spoint', 'player-dot-shader.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' at ' + commit)

