import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { createTranscoder } from '../../src/engine/decodeCore.js'
import { runPageWitness } from './page-witness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/decode-worker/run.json')
const port = Number(process.argv[3] ?? '8843')
const DONE = '(() => { const r = window.decodeWorkerResult; return r && r.done === true ? JSON.stringify(r) : null })()'
const PREPPED_GLB = resolve(root, 'build/assets/vegetation/tree.glb')
const BASIS_SOURCE = resolve(root, 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.js')
const BASIS_WASM = resolve(root, 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm')

const fnv = (bytes) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

const preppedKtx2 = async () => {
  if (!existsSync(PREPPED_GLB)) return null
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read(PREPPED_GLB)
  const texture = doc.getRoot().listTextures().find((entry) => entry.getMimeType() === 'image/ktx2')
  return texture ? texture.getImage() : null
}

const nodeReference = async (bytes) => {
  const copy = join(dirname(outPath), 'basis_transcoder.cjs')
  copyFileSync(BASIS_SOURCE, copy)
  const factory = createRequire(import.meta.url)(copy)
  const image = await createTranscoder(factory, readFileSync(BASIS_WASM)).transcodeKtx2(bytes)
  return { sourceBytes: bytes.length, width: image.width, height: image.height, rgbaBytes: image.rgba.length, fnv: fnv(image.rgba) }
}

mkdirSync(dirname(outPath), { recursive: true })
const ktx2Bytes = await preppedKtx2()
const ktx2File = join(dirname(outPath), 'texture.ktx2')
let reference = null
if (ktx2Bytes !== null) {
  writeFileSync(ktx2File, ktx2Bytes)
  reference = await nodeReference(ktx2Bytes)
}
const query = ktx2Bytes === null ? '' : '?ktx2=' + encodeURIComponent(relative(root, ktx2File))

const started = Date.now()
const run = await runPageWitness({ root, port, pagePath: 'scripts/browser/decode-worker.html' + query, expression: DONE, timeoutMs: 120000, pollMs: 500, record: false })
const wallMs = Date.now() - started
const result = run.result ?? { error: run.error ?? 'no result' }
const browser = result.ktx2 ?? null
const ktx2Equal = reference === null ? null : browser !== null && ['sourceBytes', 'width', 'height', 'rgbaBytes', 'fnv'].every((key) => browser[key] === reference[key])
const out = { wallMs, ...result, ktx2Reference: reference, ktx2Equal }
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
if (result.ok !== true || (result.errors ?? []).length > 0 || ktx2Equal === false) process.exitCode = 1
