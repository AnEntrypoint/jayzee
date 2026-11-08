import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const spointRoot = process.argv[2] || '/workspace/spoint'
const mapspinner = join(spointRoot, 'packages', 'mapspinner')
const { createHeightSampler } = await import(pathToFileURL(join(mapspinner, 'src', 'height-cpu.js')).href)
const { encodePNGGray, toGray, crc32 } = await import(pathToFileURL(join(mapspinner, 'scripts', 'lab-png.mjs')).href)

const parseArgs = (argv) => {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const key = t.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) { a[key] = true }
      else { a[key] = next; i++ }
    } else a._.push(t)
  }
  return a
}
const num = (v, d) => (v === undefined || v === true ? d : Number(v))

function dirFromLatLon(latDeg, lonDeg) {
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180
  const cl = Math.cos(la)
  return [cl * Math.cos(lo), Math.sin(la), cl * Math.sin(lo)]
}

function sampleField(opts) {
  const res = Math.max(8, Math.round(num(opts.res, 256)))
  const radius = num(opts.radius, 6360000)
  const seed = opts.seed !== undefined ? (num(opts.seed, 1337) | 0) : undefined
  const hashVersion = opts['hash-version'] !== undefined ? num(opts['hash-version'], 1) : undefined
  const sampler = createHeightSampler({ radius, seed, hashVersion })
  let w, h, latOf, lonOf
  if (opts.center) {
    const [clat, clon] = String(opts.center).split(',').map(Number)
    const span = num(opts.span, 20)
    w = res; h = res
    latOf = (px, py) => clat + (0.5 - py / (h - 1)) * span
    lonOf = (px, py) => clon + (px / (w - 1) - 0.5) * span
  } else {
    w = res * 2; h = res
    latOf = (px, py) => 90 - (py / (h - 1)) * 180
    lonOf = (px, py) => (px / (w - 1)) * 360 - 180
  }
  const elev = new Float64Array(w * h)
  let min = Infinity, max = -Infinity, sum = 0, land = 0
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const e = sampler.heightAt(dirFromLatLon(latOf(px, py), lonOf(px, py)))
      elev[py * w + px] = e
      if (e < min) min = e; if (e > max) max = e
      sum += e; if (e > 0) land++
    }
  }
  return { w, h, elev, min, max, mean: sum / (w * h), landFrac: land / (w * h), radius }
}

const CASES = [
  { name: 'global-res-24', argv: ['--res', '24'] },
  { name: 'global-hillshade-res-16', argv: ['--res', '16', '--hillshade'] },
  { name: 'center-seed-7', argv: ['--res', '16', '--center', '46.5,8.2', '--span', '2', '--seed', '7'] },
  { name: 'hash-version-2-res-12', argv: ['--res', '12', '--hash-version', '2'] },
]

const cases = CASES.map(({ name, argv }) => {
  const opts = parseArgs(argv)
  const field = sampleField(opts)
  const gray = toGray(field, !!opts.hillshade)
  const m = (v) => v.toFixed(1)
  const stats = {
    ok: true, w: field.w, h: field.h, radiusM: field.radius,
    minM: +m(field.min), maxM: +m(field.max), meanM: +m(field.mean),
    reliefM: +m(field.max - field.min), landFrac: +field.landFrac.toFixed(3),
  }
  return { name, argv, stats, png: encodePNGGray(field.w, field.h, gray).toString('base64') }
})

const SYNTH_W = 17, SYNTH_H = 9
const synthGray = new Uint8Array(SYNTH_W * SYNTH_H)
for (let y = 0; y < SYNTH_H; y++) for (let x = 0; x < SYNTH_W; x++) synthGray[y * SYNTH_W + x] = (x * 7 + y * 13) & 255

const fixture = {
  generator: 'scripts/gen-heightmap-cli-fixture.mjs',
  source: 'spoint packages/mapspinner/src/height-cpu.js and scripts/lab-png.mjs; sampleField and toGray are transcribed from spoint scripts/lab.mjs heightmap (the lab module runs its CLI on import, so it is not imported)',
  cases,
  synthetic: { w: SYNTH_W, h: SYNTH_H, png: encodePNGGray(SYNTH_W, SYNTH_H, synthGray).toString('base64') },
  crc32: { input: '123456789', value: crc32(Buffer.from('123456789', 'ascii')) },
}
const out = join(root, 'scripts', 'fixtures', 'spoint', 'heightmap-cli.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote ' + out + ' cases=' + cases.length)
