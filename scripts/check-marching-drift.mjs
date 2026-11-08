import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as jzEdges from '../src/terrain-pure/marchingEdges.js'
import * as jzTri from '../src/terrain-pure/rockTriTable.js'
import * as jzRock from '../src/terrain-pure/rockShapes.js'
import * as jzCave from '../src/terrain-pure/caveSdf.js'
import * as jzCavePatches from '../src/terrain-pure/cavePatches.js'

const JZ_EDGES = new URL('../src/terrain-pure/marchingEdges.js', import.meta.url)
const JZ_TRI = new URL('../src/terrain-pure/rockTriTable.js', import.meta.url)
const SPOINT = '/workspace/spoint/src/terrain/'
const SP_EDGE_FILES = [SPOINT + 'RockShapes.js', SPOINT + 'CavePatches.js']
const SP_TRI_FILE = SPOINT + 'RockTriTableShared.js'

const spRock = await import(pathToFileURL(SPOINT + 'RockShapes.js').href)
const spCave = await import(pathToFileURL(SPOINT + 'CaveSDF.js').href)
const spTri = await import(pathToFileURL(SP_TRI_FILE).href)
const spCavePatches = await import(pathToFileURL(SPOINT + 'CavePatches.js').href)

const eq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}: ${a} !== ${b}`)
}
const refutes = (fn, what) => {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  if (!threw) throw new Error(`control did not detect: ${what}`)
}

const normalise = (text) => text.replace(/\r\n/g, '\n')

const tableBody = (text) => {
  const src = normalise(text)
  const at = src.search(/=\s*(new Int32Array\()?\[/)
  if (at < 0) throw new Error('no table literal after an assignment')
  const open = src.indexOf('[', at)
  const close = src.indexOf('\n]', open)
  if (close < 0) throw new Error('table literal has no closing line')
  return src.slice(open, close + 2)
}

const bodyOf = (path) => tableBody(readFileSync(path, 'utf8'))

const jzEdgeBody = bodyOf(JZ_EDGES)
const jzTriBody = bodyOf(JZ_TRI)
const spEdgeBodies = SP_EDGE_FILES.map(bodyOf)
const spTriBody = bodyOf(SP_TRI_FILE)

const edgeValues = (body) => body.match(/0x[0-9a-f]+/gi).map((hex) => parseInt(hex, 16))

const sameMesh = (a, b, what) => {
  eq(a.vc, b.vc, `${what} vertex count`)
  eq(a.ic, b.ic, `${what} index count`)
  eq(a.positions.constructor.name, b.positions.constructor.name, `${what} position type`)
  eq(a.indices.constructor.name, b.indices.constructor.name, `${what} index type`)
  eq(a.positions.length, b.positions.length, `${what} position length`)
  eq(a.indices.length, b.indices.length, `${what} index length`)
  for (let i = 0; i < a.positions.length; i++) {
    if (!Object.is(a.positions[i], b.positions[i])) throw new Error(`${what} position ${i}: ${a.positions[i]} !== ${b.positions[i]}`)
  }
  for (let i = 0; i < a.indices.length; i++) {
    if (a.indices[i] !== b.indices[i]) throw new Error(`${what} index ${i}: ${a.indices[i]} !== ${b.indices[i]}`)
  }
}

const seeded = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = seeded(2026)
const between = (lo, hi) => lo + (hi - lo) * rnd()
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1))

const spLib = { rock: spRock, cave: spCave }
const jzLib = { rock: jzRock, cave: jzCave }

const fieldSpecs = []
fieldSpecs.push({ name: 'rock seed 1337', build: (lib) => lib.rock.makeRockSDF(1337) })
for (let k = 0; k < 4; k++) {
  const seed = intBetween(-100000, 100000)
  fieldSpecs.push({ name: `rock seed ${seed}`, build: (lib) => lib.rock.makeRockSDF(seed) })
}
for (let k = 0; k < 3; k++) {
  const cx = between(-0.3, 0.3)
  const cy = between(-0.3, 0.3)
  const cz = between(-0.3, 0.3)
  const radius = between(0.4, 1.8)
  fieldSpecs.push({ name: `sphere ${k}`, build: (lib) => lib.cave.makeSphereCaveSDF(cx, cy, cz, radius) })
}
for (let k = 0; k < 2; k++) {
  const radius = between(0.3, 1.2)
  const halfHeight = between(0.2, 1.5)
  const axis = ['x', 'y'][k]
  fieldSpecs.push({ name: `cylinder ${axis}`, build: (lib) => lib.cave.makeCylinderCaveSDF(0, 0, 0, radius, halfHeight, axis) })
}
for (let k = 0; k < 2; k++) {
  const seed = intBetween(-5000, 5000)
  const radius = between(0.3, 1)
  const length = between(1, 4)
  const axis = ['x', 'z'][k]
  const warpAmp = 0.1 + k * 0.1
  fieldSpecs.push({ name: `tunnel ${axis}`, build: (lib) => lib.cave.makeTunnelCaveSDF(seed, radius, length, axis, warpAmp, 2.5) })
}

const RESOLUTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 16]

const probes = Array.from({ length: 512 }, () => [between(-1.6, 1.6), between(-1.6, 1.6), between(-1.6, 1.6)])

gate('edge table body in src/terrain-pure/marchingEdges.js equals spoint RockShapes.js EDGE_TABLE after CRLF stripping', () => {
  eq(jzEdgeBody, spEdgeBodies[0], 'edge body')
})

gate('edge table body in src/terrain-pure/marchingEdges.js equals spoint CavePatches.js EDGE_TABLE after CRLF stripping', () => {
  eq(jzEdgeBody, spEdgeBodies[1], 'edge body')
})

gate('triangle table body in src/terrain-pure/rockTriTable.js equals spoint RockTriTableShared.js TRI_TABLE after CRLF stripping', () => {
  eq(jzTriBody, spTriBody, 'triangle body')
})

gate('imported jayzee TRI_TABLE and EDGE_TABLE equal the parsed spoint-identical literals', () => {
  eq(JSON.stringify(jzTri.TRI_TABLE), JSON.stringify(JSON.parse(spTriBody)), 'imported triangle table')
  eq(jzEdges.EDGE_TABLE.length, 256, 'edge table length')
  eq(edgeValues(jzEdgeBody).length, 256, 'edge literal length')
  eq(jzEdges.EDGE_TABLE.join(','), edgeValues(spEdgeBodies[0]).join(','), 'imported edge table against spoint literal')
})

gate('triangle table has 256 rows, each ending in -1 with edge indices 0 to 11, and the edge table masks fit 12 bits', () => {
  const rows = JSON.parse(spTriBody)
  eq(rows.length, 256, 'row count')
  rows.forEach((row, index) => {
    eq(row[row.length - 1], -1, `row ${index} terminator`)
    eq((row.length - 1) % 3, 0, `row ${index} length`)
    for (const edge of row.slice(0, -1)) {
      if (!(edge >= 0 && edge <= 11)) throw new Error(`row ${index} edge ${edge}`)
    }
  })
  for (const mask of jzEdges.EDGE_TABLE) {
    if (!(mask >= 0 && mask <= 0xfff)) throw new Error(`mask ${mask} outside 12 bits`)
  }
})

gate('negative control: a one-digit change to the edge table literal is detected', () => {
  refutes(() => eq(jzEdgeBody.replace('0x109', '0x108'), spEdgeBodies[0], 'edge body'), 'mutated edge literal')
  refutes(() => eq(jzTriBody.replace('[-1]', '[-2]'), spTriBody, 'triangle body'), 'mutated triangle row')
})

gate('marchRockSurface on spoint fields, marched by jayzee, matches spoint at resolutions 2 to 16', () => {
  for (const res of RESOLUTIONS) {
    for (const spec of fieldSpecs) {
      const field = spec.build(spLib)
      sameMesh(jzRock.marchRockSurface(res, field), spRock.marchRockSurface(res, field), `${spec.name} res ${res}`)
    }
  }
})

gate('polygonizeCaveSDF on spoint fields, polygonized by jayzee, matches spoint at resolutions 2 to 16', () => {
  for (const res of RESOLUTIONS) {
    for (const spec of fieldSpecs) {
      const field = spec.build(spLib)
      sameMesh(jzCave.polygonizeCaveSDF(field, res), spCave.polygonizeCaveSDF(field, res), `${spec.name} res ${res}`)
    }
  }
})

gate('jayzee-built fields with jayzee marching match spoint end to end at resolutions 2 to 16', () => {
  for (const res of RESOLUTIONS) {
    for (const spec of fieldSpecs) {
      sameMesh(jzCave.polygonizeCaveSDF(spec.build(jzLib), res), spCave.polygonizeCaveSDF(spec.build(spLib), res), `${spec.name} res ${res}`)
    }
  }
})

gate('jayzee-built fields agree with spoint fields bit for bit on 512 seeded probe points', () => {
  for (const spec of fieldSpecs) {
    const jzField = spec.build(jzLib)
    const spField = spec.build(spLib)
    for (const [x, y, z] of probes) {
      if (!Object.is(jzField(x, y, z), spField(x, y, z))) throw new Error(`${spec.name} differs at ${x},${y},${z}`)
    }
  }
})

gate('marching at resolutions 0 and 1 returns the empty mesh on both sides', () => {
  const field = spCave.makeSphereCaveSDF(0, 0, 0, 1)
  for (const res of [0, 1]) {
    sameMesh(jzRock.marchRockSurface(res, field), spRock.marchRockSurface(res, field), `res ${res}`)
    eq(jzRock.marchRockSurface(res, field).vc, 0, `res ${res} vertex count`)
  }
})

gate('the comparison is not vacuous: every field yields triangles at resolution 16 on both sides, and most at resolution 8', () => {
  for (const spec of fieldSpecs) {
    for (const lib of [spLib, jzLib]) {
      const mesh = spRock.marchRockSurface(16, spec.build(lib))
      if (!(mesh.ic > 0 && mesh.vc > 0)) throw new Error(`${spec.name} res 16 produced no triangles`)
    }
  }
  const at8 = fieldSpecs.filter((spec) => spRock.marchRockSurface(8, spec.build(spLib)).ic > 0).length
  if (at8 < fieldSpecs.length - 2) throw new Error(`only ${at8} of ${fieldSpecs.length} fields produce triangles at resolution 8`)
})

gate('negative control: resolution 7 against 8 and a radius change of 0.001 are detected', () => {
  const field = spCave.makeSphereCaveSDF(0, 0, 0, 1)
  refutes(() => sameMesh(jzRock.marchRockSurface(7, field), spRock.marchRockSurface(8, field), 'res 7 against 8'), 'resolution 7 against 8')
  const nearby = spCave.makeSphereCaveSDF(0, 0, 0, 1.001)
  refutes(() => sameMesh(jzRock.marchRockSurface(8, nearby), spRock.marchRockSurface(8, field), 'radius 1.001 against 1'), 'radius change of 0.001')
})

gate('marchCaveSurface in src/terrain-pure/cavePatches.js matches spoint CavePatches.js at resolutions 2 to 16 with asymmetric bounds', () => {
  const bounds = [-1.2, 1.5, -1.5, 1.4, -1.45, 1.5]
  for (const res of RESOLUTIONS) {
    for (const spec of fieldSpecs) {
      const field = spec.build(spLib)
      sameMesh(
        jzCavePatches.marchCaveSurface(res, field, ...bounds),
        spCavePatches.marchCaveSurface(res, field, ...bounds),
        `${spec.name} cave res ${res}`,
      )
    }
  }
})

gate('negative control: a moved marchCaveSurface bound is detected', () => {
  const field = spCave.makeSphereCaveSDF(0, 0, 0, 1)
  refutes(
    () => sameMesh(
      jzCavePatches.marchCaveSurface(8, field, -1.2, 1.5, -1.5, 1.5, -1.5, 1.5),
      spCavePatches.marchCaveSurface(8, field, -1.5, 1.5, -1.5, 1.5, -1.5, 1.5),
      'moved x bound',
    ),
    'x bound moved from -1.5 to -1.2',
  )
})

gate('negative control: a shifted vertex or index in a jayzee mesh is detected', () => {
  const field = spCave.makeSphereCaveSDF(0, 0, 0, 1)
  const reference = spRock.marchRockSurface(8, field)
  const shifted = jzRock.marchRockSurface(8, field)
  shifted.positions = Float32Array.from(shifted.positions)
  shifted.positions[0] += 1e-6
  refutes(() => sameMesh(shifted, reference, 'shifted vertex'), 'vertex shifted by 1e-6')
  const swapped = jzRock.marchRockSurface(8, field)
  swapped.indices = Uint32Array.from(swapped.indices)
  const first = swapped.indices[0]
  swapped.indices[0] = swapped.indices[1]
  swapped.indices[1] = first
  refutes(() => sameMesh(swapped, reference, 'swapped index'), 'index order swapped')
})

finish()
