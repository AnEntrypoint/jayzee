import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHeightSampler } from '../src/packages/mapspinner/height-cpu.js'
import { encodeHeightfield } from '../src/packages/mapspinner/heightfield-codec.js'
import { bakeHeightfield } from '../src/terrain-pure/heightfieldBake.js'
import { repoPinTable, readPins, writePins, PINS_PATH } from './lib/bakePins.mjs'

const USAGE = [
  'usage: node scripts/bake-heightfield.mjs --out path.hf [--n 257] [--extent m=4096] [--anchor x,y,z=0,1,0] [--center x,z=0,0]',
  '                                         [--radius m=6360000] [--seed N] [--hash-version 1|2] [--bits 8|16] [--sector 16]',
  '       node scripts/bake-heightfield.mjs --version',
  '       node scripts/bake-heightfield.mjs --pin',
  '',
  'Bakes the CPU height field over a tangent square into a .hf artifact stamped with the code version of its source closure.',
  '--version prints that version and the files it covers. --pin records it in ' + PINS_PATH + '.',
  'A bake is refused while the recorded pin differs from the tree, so a height code change is always an explicit re-pin.',
].join('\n')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) throw new RangeError('unexpected argument ' + token)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args[token.slice(2)] = true
    else {
      args[token.slice(2)] = next
      i++
    }
  }
  return args
}

const numbers = (text, count, name) => {
  const parts = String(text).split(',').map(Number)
  if (parts.length !== count || parts.some((v) => !Number.isFinite(v))) throw new RangeError(`--${name} needs ${count} comma-separated numbers, got ${text}`)
  return parts
}

function run(argv) {
  const args = parseArgs(argv)
  const table = repoPinTable()
  const version = table.versionOf('heightfield')
  if (args.version) {
    process.stdout.write(JSON.stringify({ codeVersion: version, inputs: table.inputsOf('heightfield') }, null, 2) + '\n')
    return
  }
  if (args.pin) {
    writePins({ ...readPins(), heightfield: version })
    process.stdout.write(JSON.stringify({ pinned: version }) + '\n')
    return
  }
  if (typeof args.out !== 'string') throw new RangeError('--out is required')
  const pinned = readPins().heightfield
  if (pinned !== version) throw new RangeError(`the height code is at ${version} and the recorded pin is ${pinned}: run with --pin once the change is meant, then bake`)
  const radius = args.radius === undefined ? 6360000 : Number(args.radius)
  const seed = args.seed === undefined ? undefined : Number(args.seed)
  const hashVersion = args['hash-version'] === undefined ? undefined : Number(args['hash-version'])
  const sampler = createHeightSampler({ radius, seed, hashVersion })
  const artifact = bakeHeightfield({
    heightAt: sampler.heightAt,
    radius,
    extent: args.extent === undefined ? 4096 : Number(args.extent),
    N: args.n === undefined ? 257 : Number(args.n),
    anchorDir: args.anchor === undefined ? [0, 1, 0] : numbers(args.anchor, 3, 'anchor'),
    center: args.center === undefined ? [0, 0] : numbers(args.center, 2, 'center'),
    bits: args.bits === undefined ? 16 : Number(args.bits),
    nodesPerSector: args.sector === undefined ? 16 : Number(args.sector),
    seed,
    hashVersion: sampler.hashVersion,
    codeVersion: version,
  })
  const bytes = new Uint8Array(encodeHeightfield(artifact))
  const out = resolve(args.out)
  writeFileSync(out, bytes)
  process.stdout.write(JSON.stringify({ out, bytes: bytes.byteLength, N: artifact.N, extent: artifact.extent, codeVersion: version, anchorHeight: artifact.anchorHeight }) + '\n')
}

try {
  run(process.argv.slice(2))
} catch (error) {
  process.stderr.write((error && error.message ? error.message : String(error)) + '\n\n' + USAGE + '\n')
  process.exitCode = 1
}
