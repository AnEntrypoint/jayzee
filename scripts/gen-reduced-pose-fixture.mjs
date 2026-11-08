import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const bin = await import(pathToFileURL(join(spointRoot, 'src', 'netcode', 'SnapshotBinFormat.js')).href)
const msgpack = await import(pathToFileURL(join(spointRoot, 'src', 'protocol', 'msgpack.js')).href)
await msgpack.ensurePacked

const INPUTS = [
  { id: 1, x: 0, z: 0, yawN: 0 },
  { id: 7, x: 12.34, z: -5.67, yawN: 128 },
  { id: 300, x: -1000.5, z: 1000.25, yawN: 255 },
  { id: 65536, x: 0.01, z: -0.01, yawN: 1 },
  { id: 2, x: 21474836.47, z: -21474836.47, yawN: 0 },
]
const REFUSED = [
  { id: 3, x: 'NaN', z: 0, yawN: 0 },
  { id: 4, x: 0, z: 21474836.48, yawN: 0 },
  { id: 5, x: 'Infinity', z: 0, yawN: 0 },
]

const cases = INPUTS.map((input) => {
  const tuple = bin.packReducedPlayerPose(input.id, input.x, input.z, input.yawN)
  const decoded = bin.unpackReducedPlayerPose(tuple, bin.makeReducedPlayerPose())
  return {
    input,
    tuple,
    hex: Buffer.from(msgpack.pack(tuple)).toString('hex'),
    decoded: { id: decoded.id, x: decoded.x, z: decoded.z, yawN: decoded.yawN, tier: decoded.tier },
  }
})

const errors = REFUSED.map((input) => {
  try {
    bin.packReducedPlayerPose(input.id, Number(input.x), Number(input.z), input.yawN)
    return { input, error: 'none' }
  } catch (error) {
    return { input, error: error.constructor.name }
  }
})

const fixture = {
  source: 'spoint src/netcode/SnapshotBinFormat.js packReducedPlayerPose and unpackReducedPlayerPose; spoint src/protocol/msgpack.js pack',
  cases,
  errors,
}
writeFileSync(join(here, 'fixtures', 'spoint', 'reduced-pose.json'), JSON.stringify(fixture, null, 2) + '\n')
console.log(JSON.stringify(cases.map((c) => [c.tuple, c.hex])))
console.log(JSON.stringify(errors.map((e) => e.error)))
