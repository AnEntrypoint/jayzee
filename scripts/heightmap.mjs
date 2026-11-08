import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodePNGGray } from './lib/png-gray.mjs'
import { sampleField, toGray } from './lib/heightmap.mjs'

const USAGE = [
  'usage: node scripts/heightmap.mjs [--res N=256] [--center lat,lon] [--span deg=20] [--radius m=6360000]',
  '                                   [--seed N] [--hash-version 1|2] [--hillshade] [--out path=heightmap.png]',
  '',
  'Renders the CPU height field (src/packages/mapspinner/height-cpu.js) to a grayscale PNG and prints its stats as JSON.',
  'Without --center the field is a global equirectangular map of 2N by N cells. With --center it is an N by N square of span degrees.',
].join('\n')

class UsageError extends Error {
  constructor(message) { super(message); this.name = 'UsageError' }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) throw new UsageError('unexpected argument ' + token)
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args[key] = true
    else { args[key] = next; i++ }
  }
  return args
}

function numberOf(args, key, fallback) {
  if (args[key] === undefined || args[key] === true) return fallback
  const value = Number(args[key])
  if (!Number.isFinite(value)) throw new UsageError('--' + key + ' must be a finite number, got ' + args[key])
  return value
}

function optionsOf(args) {
  const res = Math.max(8, Math.round(numberOf(args, 'res', 256)))
  const radius = numberOf(args, 'radius', 6360000)
  const seed = args.seed === undefined || args.seed === true ? undefined : numberOf(args, 'seed', 1337) | 0
  const hashVersion = args['hash-version'] === undefined || args['hash-version'] === true ? undefined : numberOf(args, 'hash-version', 1)
  if (hashVersion !== undefined && hashVersion !== 1 && hashVersion !== 2) throw new UsageError('--hash-version must be 1 or 2, got ' + args['hash-version'])
  let center = null
  if (args.center !== undefined) {
    if (args.center === true) throw new UsageError('--center needs lat,lon')
    const parts = String(args.center).split(',').map(Number)
    if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new UsageError('--center needs two finite numbers as lat,lon, got ' + args.center)
    center = parts
  }
  const span = numberOf(args, 'span', 20)
  return { res, radius, seed, hashVersion, center, span }
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  const options = optionsOf(args)
  const field = sampleField(options)
  const gray = toGray(field, args.hillshade === true)
  const out = args.out === undefined || args.out === true ? resolve('heightmap.png') : resolve(String(args.out))
  writeFileSync(out, encodePNGGray(field.w, field.h, gray))
  const m = (v) => v.toFixed(1)
  console.log(JSON.stringify({
    ok: true, out, w: field.w, h: field.h, radiusM: field.radius,
    minM: +m(field.min), maxM: +m(field.max), meanM: +m(field.mean),
    reliefM: +m(field.max - field.min), landFrac: +field.landFrac.toFixed(3),
  }, null, 1))
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  const usage = error instanceof UsageError
  console.error(JSON.stringify({ ok: false, error: error.message }))
  if (usage) console.error(USAGE)
  process.exitCode = usage ? 2 : 1
}
