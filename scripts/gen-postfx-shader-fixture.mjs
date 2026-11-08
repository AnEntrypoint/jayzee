import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/Bloom.js', 'client/core/FSR1.js', 'client/core/SSR.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const commit = execFileSync('git', ['log', '-1', '--format=%h', '--', ...files], { cwd: spointRoot }).toString().trim()

const mapped = {
  three: import.meta.resolve('three'),
  'three/tsl': import.meta.resolve('three/tsl'),
  'three/webgpu': import.meta.resolve('three/webgpu'),
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mapped, specifier)) return { url: mapped[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const THREE = await import('three')
const bloomMod = await import(pathToFileURL(join(spointRoot, 'client/core/Bloom.js')).href)
const fsrMod = await import(pathToFileURL(join(spointRoot, 'client/core/FSR1.js')).href)
const ssrMod = await import(pathToFileURL(join(spointRoot, 'client/core/SSR.js')).href)

const stubRenderer = { isWebGPURenderer: false, getDrawingBufferSize: () => new THREE.Vector2(640, 360), getPixelRatio: () => 1, getSize: (v) => v.set(640, 360) }
const shadersOf = (material) => ({ vertexShader: material.vertexShader, fragmentShader: material.fragmentShader })
const bloom = new bloomMod.Bloom(stubRenderer)
const fsr = new fsrMod.FSR1(stubRenderer)
const ssr = new ssrMod.SSR(stubRenderer, new THREE.Scene(), new THREE.PerspectiveCamera())
const fixture = {
  source: { commit, files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])) },
  bloom: { threshold: shadersOf(bloom._thresholdMat), blur: shadersOf(bloom._blurMat), composite: shadersOf(bloom._compositeMat) },
  fsr1: { easu: shadersOf(fsr._easuMat), rcas: shadersOf(fsr._rcasMat), composite: shadersOf(fsr._compositeMat) },
  ssr: { ssr: shadersOf(ssr._ssrMat), wetness: shadersOf(ssr._wetnessMat), composite: shadersOf(ssr._compositeMat) },
}
const out = join(here, 'fixtures', 'spoint', 'postfx-shaders.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' at ' + commit)
