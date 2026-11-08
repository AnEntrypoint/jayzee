import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const spointRoot = process.argv[2] || '/workspace/spoint'
const srcDir = join(spointRoot, 'packages', 'mapspinner', 'src')
const at = (rel) => pathToFileURL(join(srcDir, rel)).href
const heightCpu = await import(at('height-cpu.js'))
const anchorField = await import(at('anchor-field.js'))
const hpfLattice = await import(at('hpf-lattice.js'))
const splatWeights = await import(at('splat-weights.js'))
const jsgen = await import(at('tsl/ops-jsgen.js'))

const enc = (x) => (Object.is(x, -0) ? '-0' : typeof x === 'number' && !Number.isFinite(x) ? String(x) : x)
const encAll = (xs) => xs.map(enc)

const attempt = (fn) => {
  try {
    fn()
    return { threw: false }
  } catch (error) {
    return { threw: true, name: error.name, code: error.code === undefined ? null : error.code, message: String(error.message) }
  }
}

const DIRS = []
for (let i = 0; i < 48; i++) {
  const y = 1 - ((i + 0.5) / 48) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const th = i * 2.399963229728653
  DIRS.push([r * Math.cos(th), y, r * Math.sin(th)])
}
DIRS.push([1, 0, 0], [0, -1, 0], [0, 0, -1], [0.2, 0.2, -0.9], [-0.6, 0.3, 0.7])

const CARVES = [
  { dir: [1, 0.2, 0], innerM: 100, outerM: 400 },
  { dir: [0, 0.5, -1], innerM: 50, outerM: 200 },
]

const CONFIGS = [
  { name: 'hv1-default', opts: { hashVersion: 1 } },
  { name: 'hv2-default', opts: { hashVersion: 2 } },
  { name: 'hv2-f32', opts: { hashVersion: 2, precision: 'f32' } },
  { name: 'hv1-relief-2', opts: { hashVersion: 1, reliefScale: 2 } },
  { name: 'hv1-landbias-300', opts: { hashVersion: 1, uniforms: { uLandBias: 300 } } },
  { name: 'hv2-seed-7', opts: { hashVersion: 2, seed: 7 } },
  { name: 'hv2-hpf-64', opts: { hashVersion: 2, hpfTexRes: 64 } },
  { name: 'hv2-carves', opts: { hashVersion: 2, carves: CARVES } },
  { name: 'hv2-carves-f32', opts: { hashVersion: 2, precision: 'f32', carves: CARVES } },
  { name: 'hv2-radius-1000', opts: { hashVersion: 2, radius: 1000 } },
]

const samplers = CONFIGS.map((config) => {
  const s = heightCpu.createHeightSampler(config.opts)
  return {
    name: config.name,
    opts: config.opts,
    heights: encAll(DIRS.map((d) => s.heightAt(d))),
    surface: DIRS.slice(0, 6).map((d) => encAll(s.surfacePoint(d))),
    carves: s.carves.map((c) => ({ dir: encAll(c.dir), innerChord2: enc(c.innerChord2), outerChord2: enc(c.outerChord2), targetH: enc(c.targetH) })),
  }
})

const uniforms = {}
for (const [key, value] of Object.entries(heightCpu.HEIGHT_UNIFORM_DEFAULTS)) uniforms[key] = enc(value)

const refusals = [
  ['carves on hash 1', () => heightCpu.createHeightSampler({ hashVersion: 1, carves: CARVES })],
  ['sculpt override', () => heightCpu.createHeightSampler({ sculpt: () => 0 })],
  ['relief NaN', () => heightCpu.createHeightSampler({ reliefScale: NaN })],
  ['relief string', () => heightCpu.createHeightSampler({ reliefScale: '2' })],
  ['carve zero direction', () => heightCpu.createHeightSampler({ hashVersion: 2, carves: [{ dir: [0, 0, 0], innerM: 1, outerM: 2 }] })],
  ['carve inner not below outer', () => heightCpu.createHeightSampler({ hashVersion: 2, carves: [{ dir: [1, 0, 0], innerM: 5, outerM: 5 }] })],
  ['carve count above four', () => heightCpu.createHeightSampler({ hashVersion: 2, carves: [1, 2, 3, 4, 5].map((k) => ({ dir: [k, 1, 0], innerM: 1, outerM: 9 })) })],
  ['hash version three', () => heightCpu.createHeightSampler({ hashVersion: 3 })],
  ['precision f16', () => heightCpu.createHeightSampler({ hashVersion: 2, precision: 'f16' })],
]
const refusalRows = refusals.map(([label, fn]) => Object.assign({ label }, attempt(fn)))

const SEEDS = [null, 0, -5, 123456, 2147483647]
const ANCHOR_POINTS = [[0, 0.3, 0.6], [1, 0.5, 0.5], [2, 0.1, 0.9], [3, 0.77, 0.02], [4, 0.4, 0.55], [5, 0.9, 0.1]]
const anchors = SEEDS.map((seed) => {
  const af = seed === null ? anchorField.createAnchorField() : anchorField.createAnchorField({ seed })
  return {
    seed,
    samples: ANCHOR_POINTS.flatMap(([face, fu, fv]) => [6, 3].map((level) => {
      const s = af.sampleUV(face, fu, fv, level)
      return [face, fu, fv, level, encAll([s.seaBias, s.elevAmp, s.temp, s.humidity, s.erosion, s.roughness])]
    })),
    faces: DIRS.map((d) => af.dirToFaceUV(d)).map((f) => ({ face: f.face, fu: enc(f.fu), fv: enc(f.fv) })),
  }
})
const anchorRefusals = [2147483648, -2147483649, 1.5, '3', NaN].map((seed) => Object.assign({ seedType: typeof seed, seed: typeof seed === 'string' ? seed : enc(seed) }, attempt(() => anchorField.createAnchorField({ seed }))))

const HPF_RES = 16
const hpfBuffer = new Float32Array(HPF_RES * HPF_RES * 4)
for (let i = 0; i < hpfBuffer.length; i++) hpfBuffer[i] = Math.sin(i * 0.37)
const hpfSampler = hpfLattice.hpfFaceSampler(hpfBuffer, HPF_RES)
const hpfSamples = [[0.3, 0.7], [0.99, 0.01], [0, 0], [1, 1], [0.5, 0.25]].map(([fu, fv]) => encAll(hpfSampler(fu, fv, [0, 0, 0, 0])))

let rng = 12345
const rnd = () => { rng = (rng * 16807) % 2147483647; return rng / 2147483647 }
const splatInputs = []
for (let i = 0; i < 400; i++) {
  const v = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  splatInputs.push({ dir: encAll(v.map((x) => x / l)), h: enc((rnd() * 1000) - 100), slope: enc(rnd() * 1.2), temp: enc(rnd()), humid: enc(rnd()) })
}
const splat = [1, 2].map((hashVersion) => {
  const weights = splatWeights.createSplatWeights({ hashVersion })
  return { hashVersion, outputs: splatInputs.map((x) => { const o = weights(x.dir, x.h, x.slope, x.temp, x.humid); return encAll([o.grass, o.rock, o.sand, o.snow]) }) }
})

const snoisePoints = []
for (let i = 0; i < 300; i++) snoisePoints.push(encAll([(rnd() - 0.5) * 40, (rnd() - 0.5) * 40, (rnd() - 0.5) * 40]))
const snoise = [1, 2].map((hashVersion) => {
  const f = jsgen.compileSnoise3({ hashVersion, precision: 'f64' })
  return { hashVersion, values: snoisePoints.map((p) => enc(f(p[0], p[1], p[2]))) }
})

const fixture = {
  generator: 'scripts/gen-height-cpu-fixture.mjs',
  source: 'spoint packages/mapspinner/src (height-cpu.js, anchor-field.js, hpf-lattice.js, splat-weights.js, tsl/ops-jsgen.js)',
  encoding: 'numbers are JSON numbers; -0 and non-finite values are strings',
  directions: encAll(DIRS.flat()),
  uniforms,
  samplers,
  refusals: refusalRows,
  anchors,
  anchorRefusals,
  hpf: { res: HPF_RES, sine: 0.37, samples: hpfSamples },
  splat,
  splatInputs,
  snoisePoints,
  snoise,
}
const out = join(root, 'scripts', 'fixtures', 'spoint', 'height-cpu.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote ' + out + ' samplers=' + samplers.length + ' refusals=' + refusalRows.length + ' anchors=' + anchors.length + ' splat=' + splat.length)
