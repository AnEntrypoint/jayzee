import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { validateAsset } from './validate.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const PLATFORM_DIRS = { linux: 'linux', darwin: 'darwin', win32: 'win' }
const ARCH_DIRS = { x64: 'x64', arm64: 'arm64' }
export const KTX2_IMAGE_MIME = 'image/ktx2'
export const MESHOPT_LEVEL = 'medium'

export const basisuBinary = () => {
  const platform = PLATFORM_DIRS[process.platform]
  const arch = ARCH_DIRS[process.arch]
  if (platform === undefined || arch === undefined) throw new Error('no pinned basisu binary for ' + process.platform + '/' + process.arch)
  const exe = process.platform === 'win32' ? 'basisu.exe' : 'basisu'
  const path = resolve(root, 'node_modules/basisu/bin', platform, arch, exe)
  if (!existsSync(path)) throw new Error('basisu binary missing at ' + path + '; run npm install')
  return path
}

export const encodeKtx2 = (image, workDir, index) => {
  const input = join(workDir, 'texture-' + index + '.png')
  const output = join(workDir, 'texture-' + index + '.ktx2')
  writeFileSync(input, image)
  execFileSync(basisuBinary(), ['-ktx2', '-mipmap', '-output_file', output, input], { stdio: 'pipe' })
  const bytes = new Uint8Array(readFileSync(output))
  const check = validateAsset(output, bytes)
  if (!check.ok) throw new Error('basisu wrote a file that is not KTX2: ' + check.reasons.join('; '))
  return bytes
}

export const createIo = async () => {
  await MeshoptEncoder.ready
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
}

export const prepareGlb = async (io, inputPath, outputPath, workDir) => {
  const before = readFileSync(inputPath)
  const doc = await io.read(inputPath)
  await doc.transform(dedup(), prune())
  let textures = 0
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage()
    if (image === null || texture.getMimeType() === KTX2_IMAGE_MIME) continue
    texture.setImage(encodeKtx2(image, workDir, textures)).setMimeType(KTX2_IMAGE_MIME)
    textures += 1
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: MESHOPT_LEVEL }))
  const bytes = await io.writeBinary(doc)
  const check = validateAsset(outputPath, bytes)
  if (!check.ok) throw new Error('prepared asset rejected: ' + outputPath + ': ' + check.reasons.join('; '))
  writeFileSync(outputPath, bytes)
  return { name: basename(outputPath), inputBytes: before.length, outputBytes: bytes.length, texturesEncoded: textures }
}

const main = async (outDir, inputs) => {
  mkdirSync(outDir, { recursive: true })
  const io = await createIo()
  const workDir = mkdtempSync(join(tmpdir(), 'jayzee-prep-'))
  const results = []
  try {
    for (const input of inputs) {
      const outputPath = join(outDir, basename(input))
      results.push(await prepareGlb(io, input, outputPath, workDir))
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ meshoptLevel: MESHOPT_LEVEL, assets: results }, null, 1) + '\n')
  return results
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [outDir, ...inputs] = process.argv.slice(2)
  if (outDir === undefined || inputs.length === 0) {
    console.error('usage: node tools/asset-pipeline/prep.mjs <outDir> <in.glb...>')
    process.exitCode = 2
  } else {
    const results = await main(outDir, inputs)
    for (const result of results) console.log(JSON.stringify(result))
  }
}
