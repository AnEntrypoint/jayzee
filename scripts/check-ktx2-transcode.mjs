import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { finish, gate } from './lib/gate.mjs'
import { validateKtx2 } from '../tools/asset-pipeline/validate.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT_DIR = join(root, 'build/assets/vegetation')
const NAMES = ['tree', 'tall_tree', 'grass_large', 'flowers']
const BASIS_SOURCE = join(root, 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.js')
const BASIS_WASM = join(root, 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm')
const TARGETS = Object.freeze({ ETC1: 0, BC1: 2 })

const loadBasis = () => {
  const factory = new Function(readFileSync(BASIS_SOURCE, 'utf8') + '\nreturn BASIS;')()
  const wasmBinary = readFileSync(BASIS_WASM)
  return new Promise((resolveModule) => {
    const module = {
      wasmBinary,
      onRuntimeInitialized: () => {
        module.initializeBasis()
        resolveModule(module)
      },
    }
    factory(module)
  })
}

const transcode = (basis, bytes, format) => {
  const file = new basis.KTX2File(bytes)
  try {
    assert.ok(file.startTranscoding(), 'startTranscoding failed')
    const size = file.getImageTranscodedSizeInBytes(0, 0, 0, format)
    const dst = new Uint8Array(size)
    const status = file.transcodeImage(dst, 0, 0, 0, format, 0, -1, -1)
    return { width: file.getWidth(), height: file.getHeight(), size, ok: Boolean(status), nonZero: dst.some((byte) => byte !== 0) }
  } finally {
    file.close()
    file.delete()
  }
}

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const basis = await loadBasis()
const manifest = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8'))

for (const name of NAMES) {
  const doc = await io.read(join(OUT_DIR, name + '.glb'))
  const images = doc.getRoot().listTextures().filter((texture) => texture.getMimeType() === 'image/ktx2').map((texture) => texture.getImage())
  const recorded = manifest.assets.find((asset) => asset.name === name + '.glb')

  gate(name + ': every KTX2 image in the prepped GLB is a valid KTX2 file, and there are as many as the prep recorded', () => {
    assert.equal(images.length, recorded.texturesEncoded)
    for (const [index, bytes] of images.entries()) {
      assert.deepEqual(validateKtx2(bytes), [], name + ' image ' + index)
    }
  })

  gate(name + ': every KTX2 image transcodes to ETC1 and to BC1 with a non-empty, non-zero output', () => {
    for (const [index, bytes] of images.entries()) {
      for (const [target, format] of Object.entries(TARGETS)) {
        const result = transcode(basis, bytes, format)
        assert.ok(result.ok, name + ' image ' + index + ' to ' + target + ' transcode status failed')
        assert.ok(result.size > 0, name + ' image ' + index + ' to ' + target + ' has no output size')
        assert.ok(result.nonZero, name + ' image ' + index + ' to ' + target + ' transcoded to all zeros')
      }
    }
  })
}

finish()
