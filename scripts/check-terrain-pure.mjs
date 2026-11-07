import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createPlacementLattice, cubeFaceOf } from '../src/terrain-pure/placementLattice.js'
import { TRI_TABLE } from '../src/terrain-pure/rockTriTable.js'
import { EDGE_TABLE } from '../src/terrain-pure/marchingEdges.js'
import { marchBox } from '../src/terrain-pure/marchingCubes.js'
import { ROCK_MESH_RES, makeRockSDF, marchRockSurface, generateRockHullData } from '../src/terrain-pure/rockShapes.js'
import { makeSphereCaveSDF, makeCylinderCaveSDF, makeTunnelCaveSDF, createCaveVolume, loadCaveCarveLayer, createCaveCarveLayer } from '../src/terrain-pure/caveSdf.js'
import { sdfSphere, sdfCylinder, sdfTorus, unionSDF, subtractCaveFromHeightfield, createSphericalCave } from '../src/terrain-pure/cavePatches.js'
import { createCachedAnchorField, SECTOR_M } from '../src/terrain-pure/climateCache.js'
import { seaLevelDirOf, seaLevelXZOfDir, reanchoredSeaLevelXZ } from '../src/terrain-pure/chartLocalPoint.js'
import { resolveGroundDetailReach } from '../src/terrain-pure/groundDetailReach.js'
import { createWaterLevel } from '../src/terrain-pure/waterLevel.js'
import { pickFace, worldToCell, resolveCell, packCellKey, neighborCells, verifyCubeSphereAdjacency } from '../src/terrain-pure/cubeSphereCells.js'
import { brushPrecondition, brushApplied, STRENGTH_REQUIRES } from '../src/terrain-pure/brushResult.js'
import { STROKE_KINDS, heightStrokeIsLoadable, biomeStrokeIsLoadable, heightStrokeReplay, biomeStrokeReplay, replayStrokes } from '../src/terrain-pure/brushStroke.js'
import { createHeightDelta } from '../src/terrain-pure/heightDelta.js'
import { createBiomeOverride, BIOME_NAMES } from '../src/terrain-pure/biomeOverride.js'
import { defineStructureTemplate, stampStructures } from '../src/terrain-pure/structureStamp.js'
import { isCarved, createCarvedClimateFilter } from '../src/terrain-pure/splineCarve.js'
import { thermalErode } from '../src/terrain-pure/terrainErosion.js'
import { createFieldLayers } from '../src/terrain-pure/fieldLayers.js'
import { wrapHeightWithFieldPaint, createHostFieldPaint, FIELD_LAYER_NAMES } from '../src/terrain-pure/fieldPaint.js'
import { rockContactStamps, treeContactStamps } from '../src/terrain-pure/contactOcclusionField.js'
import { createModelExclusionField } from '../src/terrain-pure/modelExclusionField.js'
import { createNearFieldLattice } from '../src/terrain-pure/nearFieldLattice.js'
import { sphereDropBelowTangent, isSurfaceRootWithin, isNoGroundHeight, waterlineLocalY, guardedGroundHeight } from '../src/terrain-pure/planetFrame.js'
import { quatMulF32, tangentToLocal, tangentFrameQuat, tangentHeadingInChart, valueNoise3, climateAt } from '../src/terrain-pure/placementChart.js'
import { paintedSlopeOf, renderedSoilWeight, tintMultiplier, leanQuat, reliefMarginScaleOf, hash3, rand } from '../src/terrain-pure/vegPlacement.js'
import { ROCK, ROCK_SCALE_TABLE, ROCK_SQUASH_TABLE, rockScaleLevel, rockSquashLevel, rockDensity, classify as classifyRock } from '../src/terrain-pure/rockPlacement.js'
import { parseDecorationDef, acceptsCell, decorateCells } from '../src/terrain-pure/decorationLayers.js'
import { compileTerrainMarks } from '../src/terrain-pure/terrainMarks.js'
import { seededStream, buildProceduralGeometry } from '../src/terrain-pure/proceduralGeometry.js'
import { createScriptedTerrain } from '../src/terrain-pure/scriptedTerrain.js'
import { scriptMeshKey, createScriptMeshCache } from '../src/terrain-pure/scriptMeshCache.js'
import { createGrassDecal, loadGrassDecal } from '../src/terrain-pure/grassDecal.js'

const here = dirname(fileURLToPath(import.meta.url))
const pureDir = join(here, '..', 'src', 'terrain-pure')

const sameNumber = (a, b) => Object.is(a, b) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9)

const sameShape = (actual, expected) => {
  if (typeof actual === 'number' && typeof expected === 'number') return sameNumber(actual, expected)
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((item, i) => sameShape(item, expected[i]))
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const keys = Object.keys(expected)
    return Object.keys(actual).length === keys.length && keys.every(key => sameShape(actual[key], expected[key]))
  }
  return Object.is(actual, expected)
}

const eq = (actual, expected, what) => {
  if (!sameShape(actual, expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const ok = (condition, what) => {
  if (!condition) throw new Error(what)
}

const refutes = (check, what) => {
  try {
    check()
  } catch {
    return
  }
  throw new Error('negative control was not refuted: ' + what)
}

const throwsCode = (fn, code) => {
  try {
    fn()
  } catch (error) {
    if (error && error.reasonCode === code) return
    throw new Error(`expected reasonCode ${code}, got ${error && error.reasonCode}`)
  }
  throw new Error(`expected reasonCode ${code}, nothing was thrown`)
}

const throwsAny = (fn, what) => {
  try {
    fn()
  } catch {
    return
  }
  throw new Error(`${what}: expected a throw`)
}

const wellFormedTriangles = (list) => list[list.length - 1] === -1 && (list.length - 1) % 3 === 0

const unitSphereDeviation = (mesh) => {
  let worst = 0
  for (let v = 0; v < mesh.vc; v++) {
    const x = mesh.positions[v * 3]
    const y = mesh.positions[v * 3 + 1]
    const z = mesh.positions[v * 3 + 2]
    worst = Math.max(worst, Math.abs(Math.hypot(x, y, z) - 1))
  }
  return worst
}

const sphereSdf = (radius) => (x, y, z) => Math.hypot(x, y, z) - radius

const lattice = createPlacementLattice(100, 10, 2)
const centreOf = (key) => lattice.chunkCentreDir(key, [0, 0, 0])

gate('placement lattice has 16 chunks and 32 cells per face for radius 100, chunk 10, 2 cells', () => {
  eq(lattice.chunksPerFace, 16, 'chunksPerFace')
  eq(lattice.cellsPerFace, 32, 'cellsPerFace')
  eq(lattice.faceCount, 6, 'faceCount')
  refutes(() => eq(createPlacementLattice(100, 20, 2).chunksPerFace, 16, 'chunksPerFace at chunk 20'), 'a chunk of 20 m must give 8 chunks')
})

gate('cubeFaceOf maps the six axis directions to faces 0 to 5 in order', () => {
  eq([cubeFaceOf(1, 0, 0), cubeFaceOf(-1, 0, 0), cubeFaceOf(0, 1, 0), cubeFaceOf(0, -1, 0), cubeFaceOf(0, 0, 1), cubeFaceOf(0, 0, -1)], [0, 1, 2, 3, 4, 5], 'faces')
  refutes(() => eq(cubeFaceOf(0, 0, -1), 4, '-z face'), 'the -z direction is face 5, not the +z face')
})

gate('chunk keys decode back to their face and indices', () => {
  const out = [0, 0, 0]
  lattice.decodeChunk(lattice.chunkKey(3, 5, 7), out)
  eq(out, [3, 5, 7], 'decoded chunk')
  refutes(() => {
    lattice.decodeChunk(lattice.chunkKey(3, 5, 8), out)
    eq(out, [3, 5, 7], 'decoded chunk')
  }, 'a different column must not decode to the original')
})

gate('cell ids and hash rows follow the face-major row layout', () => {
  eq(lattice.cellId(1, 2, 3), 1091, 'cellId(1,2,3)')
  eq(lattice.hashRow(1, 2), 34, 'hashRow(1,2)')
  refutes(() => eq(lattice.cellId(1, 2, 4), 1091, 'cellId(1,2,4)'), 'changing j must change the id')
})

gate('chunk centre directions are unit vectors on their own face', () => {
  const dir = centreOf(lattice.chunkKey(4, 8, 8))
  eq(Math.hypot(dir[0], dir[1], dir[2]), 1, 'norm')
  ok(dir[2] > 0.99, 'face 4 centre points along +z')
  const minus = centreOf(lattice.chunkKey(5, 8, 8))
  refutes(() => ok(minus[2] > 0.99, 'face 5 centre points along +z'), 'a face 5 centre must not point along +z')
})

gate('ring around a chunk centre starts with that chunk', () => {
  const key = lattice.chunkKey(4, 8, 8)
  const dir = centreOf(key)
  const ring = lattice.ringAroundDir(dir[0], dir[1], dir[2], 10)
  eq(ring[0], key, 'nearest chunk')
  refutes(() => eq(lattice.ringAroundDir(...centreOf(lattice.chunkKey(4, 0, 0)), 10)[0], key, 'ring from a far chunk'), 'a far centre must not start with this chunk')
})

gate('cell area over target is the centre value at the face middle', () => {
  const centre = (100 * lattice.cellAngle / lattice.cellM) ** 2
  eq(lattice.cellAreaOverTarget(16, 16), centre, 'centre cell')
  refutes(() => eq(lattice.cellAreaOverTarget(0, 0), centre, 'corner cell'), 'a face corner is not the centre cell')
})

gate('the triangle table has 256 well formed entries with the empty and full cases', () => {
  eq(TRI_TABLE.length, 256, 'entries')
  eq(TRI_TABLE[0], [-1], 'empty case')
  eq(TRI_TABLE[1], [0, 8, 3, -1], 'corner 0 case')
  ok(TRI_TABLE.every(wellFormedTriangles), 'every entry ends with -1 and holds whole triangles')
  refutes(() => ok(wellFormedTriangles([0, 1, -1]), 'two indices'), 'a two-index list is not whole triangles')
})

gate('the edge table has 256 entries, the corner-0 mask and complement symmetry', () => {
  eq(EDGE_TABLE.length, 256, 'entries')
  eq(EDGE_TABLE[1], 0x109, 'corner 0 mask')
  eq(EDGE_TABLE[254], EDGE_TABLE[1], 'complement of case 1 uses the same edges')
  refutes(() => eq(EDGE_TABLE[2], EDGE_TABLE[1], 'corner 1 mask'), 'corner 1 and corner 0 have different masks')
})

gate('marchBox returns nothing below two samples per axis', () => {
  const empty = marchBox(1, sphereSdf(1), -2, 2, -2, 2, -2, 2)
  eq({ vc: empty.vc, ic: empty.ic }, { vc: 0, ic: 0 }, 'res 1')
  eq(marchBox(4, sphereSdf(1), -2, 2, -2, 2, -2, 2).vc, 0, 'res 4 grid has no sample inside the sphere')
  refutes(() => eq(marchBox(5, sphereSdf(1), -2, 2, -2, 2, -2, 2).vc, 0, 'res 5 vertices'), 'a sphere sampled at res 5 must produce vertices')
})

gate('marchBox puts a unit sphere on the unit sphere within 0.1', () => {
  const mesh = marchBox(9, sphereSdf(1), -2, 2, -2, 2, -2, 2)
  ok(mesh.vc > 0, 'vertices produced')
  ok(mesh.indices.length % 3 === 0 && mesh.indices.every(i => i < mesh.vc), 'indices are whole triangles over vertices')
  ok(unitSphereDeviation(mesh) < 0.1, 'vertex radius within 0.1 of 1')
  refutes(() => ok(unitSphereDeviation(marchBox(9, sphereSdf(0.5), -2, 2, -2, 2, -2, 2)) < 0.1, 'radius 0.5 sphere'), 'a radius 0.5 sphere must not satisfy the unit check')
})

gate('marchBox on the plane z=0 keeps every vertex on that plane', () => {
  const mesh = marchBox(3, (x, y, z) => z, -1, 1, -1, 1, -1, 1)
  ok(mesh.vc > 0, 'vertices produced')
  let maxAbsZ = 0
  for (let v = 0; v < mesh.vc; v++) maxAbsZ = Math.max(maxAbsZ, Math.abs(mesh.positions[v * 3 + 2]))
  ok(maxAbsZ < 1e-6, 'vertices stay on z=0')
  let shiftedZ = 0
  const shifted = marchBox(3, (x, y, z) => z - 0.5, -1, 1, -1, 1, -1, 1)
  for (let v = 0; v < shifted.vc; v++) shiftedZ = Math.max(shiftedZ, Math.abs(shifted.positions[v * 3 + 2]))
  refutes(() => ok(shiftedZ < 1e-6, 'plane z=0.5'), 'a plane at z=0.5 must not pass the z=0 check')
})

gate('rock SDF is capped at 0.3 far from the rock and the rock mesh resolution is 16', () => {
  eq(ROCK_MESH_RES, 16, 'mesh resolution')
  eq(makeRockSDF(7)(100, 0, 0), 0.3, 'far field')
  eq(makeRockSDF(7)(0, -50, 3), 0.3, 'far field below')
  refutes(() => eq(makeRockSDF(7)(100, 0, 0), 0.31, 'far field above the cap'), 'the cap is exactly 0.3')
})

gate('marching the rock field keeps a positive field empty and a sphere field non-empty', () => {
  eq(marchRockSurface(8, () => 1).vc, 0, 'all outside')
  refutes(() => eq(marchRockSurface(8, sphereSdf(1)).vc, 0, 'sphere crossing'), 'a crossing sphere must produce vertices')
  const mesh = marchRockSurface(8, sphereSdf(1.2))
  let maxCoord = 0
  for (let v = 0; v < mesh.vc * 3; v++) maxCoord = Math.max(maxCoord, Math.abs(mesh.positions[v]))
  ok(maxCoord <= 1.5 + 1e-6, 'vertices stay in the box')
})

gate('generated rock hulls report height as the spread of their vertices', () => {
  eq(generateRockHullData(0), [], 'no shapes')
  const hulls = generateRockHullData(2, 1337, 8)
  eq(hulls.length, 2, 'shape count')
  let minY = Infinity
  let maxY = -Infinity
  for (let v = 0; v < hulls[0].vCount; v++) {
    minY = Math.min(minY, hulls[0].positions[v * 3 + 1])
    maxY = Math.max(maxY, hulls[0].positions[v * 3 + 1])
  }
  eq(hulls[0].height, maxY - minY, 'height')
  refutes(() => eq(generateRockHullData(1, 1337, 8).length, 2, 'one shape'), 'two shapes were requested')
})

gate('cave SDFs give signed distances for sphere, cylinder and tunnel shapes', () => {
  eq(makeSphereCaveSDF(0, 0, 0, 2)(3, 4, 0), 3, 'sphere outside')
  eq(makeSphereCaveSDF(0, 0, 0, 2)(0, 0, 0), -2, 'sphere centre')
  eq(makeCylinderCaveSDF(0, 0, 0, 1, 2)(0, 0, 0), -1, 'cylinder centre')
  eq(makeCylinderCaveSDF(0, 0, 0, 1, 2)(2, 0, 0), 1, 'cylinder outside')
  eq(makeTunnelCaveSDF(1, 1, 4, 'y', 0, 2.5)(0, 0, 0), -1, 'tunnel centre')
  eq(makeTunnelCaveSDF(1, 1, 4, 'y', 0, 2.5)(0, 3, 0), 1, 'tunnel past its end')
  refutes(() => eq(makeSphereCaveSDF(0, 0, 0, 2)(0, 0, 0), 3, 'sphere centre'), 'the centre of a sphere is inside, not outside')
})

gate('a cave volume scales its local field by the world radius', () => {
  const volume = createCaveVolume(0, 0, 0, 10)
  eq(volume.sdf(0, 0, 0), -10, 'centre')
  eq(volume.sdf(10, 0, 0), 0, 'surface')
  throwsAny(() => createCaveVolume(0, 0, 0, 5, { kind: 'cylinder', halfHeight: -1 }), 'cylinder with negative half height')
  refutes(() => eq(volume.sdf(0, 0, 0), -5, 'centre at radius 5'), 'a radius 10 volume must not read as radius 5')
})

gate('a sphere cave lowers the height inside its footprint and not outside', () => {
  const layer = createCaveCarveLayer()
  eq(layer.addSphereCave(0, 0, 0, 4), { added: true, count: 1 }, 'added')
  eq(layer.heightDeltaAt(0, 0, 0), -8, 'delta under the centre')
  eq(layer.heightDeltaAt(5, 0, 0), 0, 'delta outside the radius')
  eq(layer.wrapHeightFn(() => 0)(0, 0), -8, 'wrapped height')
  refutes(() => eq(layer.wrapHeightFn(() => 0)(5, 0), -8, 'wrapped height outside'), 'outside the cave the height is unchanged')
})

gate('cave layers round trip through JSON and refuse a non-positive radius', () => {
  const layer = createCaveCarveLayer()
  layer.addSphereCave(0, 0, 0, 4)
  eq(loadCaveCarveLayer(layer.toJSON()).volumeCount, 1, 'round trip count')
  refutes(() => eq(loadCaveCarveLayer({ volumes: [{ worldX: 0, worldY: 0, worldZ: 0, worldRadius: -1 }] }).volumeCount, 1, 'bad radius'), 'a negative radius must be dropped')
})

gate('the cave patch SDF helpers match their closed forms', () => {
  eq(sdfSphere(3, 4, 0, 0, 0, 0, 2), 3, 'sphere')
  eq(sdfCylinder(0, 5, 0, 0, 0, 0, 1, 2), 3, 'cylinder above the cap')
  eq(sdfCylinder(0, 0, 0, 0, 0, 0, 1, 2), 0, 'cylinder on the cap')
  eq(sdfTorus(3, 0, 0, 0, 0, 0, 3, 1), -1, 'torus on the ring')
  eq(sdfTorus(0, 0, 0, 0, 0, 0, 3, 1), 2, 'torus at the centre')
  eq(unionSDF(() => 2, () => -1)(0, 0, 0), -1, 'union takes the minimum')
  eq(unionSDF()(0, 0, 0), Infinity, 'empty union')
  refutes(() => eq(sdfSphere(0, 0, 0, 0, 0, 0, 2), 3, 'sphere centre'), 'the centre is inside the sphere')
})

gate('subtracting a sphere lowers only the samples it reaches', () => {
  const heights = Float32Array.of(5, 5, 5, 5)
  const sdf = (x, y, z) => sdfSphere(x, y, z, 0, 5, 0, 1)
  eq(Array.from(subtractCaveFromHeightfield(heights, 2, 1, 0, 0, sdf)), [4, 5, 5, 5], 'carved heights')
  eq(heights[0], 5, 'input unchanged')
  refutes(() => eq(Array.from(subtractCaveFromHeightfield(heights, 2, 1, 0, 0, sdf, 0.5)), [4, 5, 5, 5], 'shallow cut'), 'a 0.5 cut depth must cut 0.5 only')
})

gate('a spherical cave carves the height field and produces a surface', () => {
  const carved = createSphericalCave(Float32Array.of(5, 5, 5, 5), 2, 1, 0, 0, 0, 5, 0, 1)
  eq(carved.heights[0], 4, 'carved height')
  ok(carved.caveGeometry.vc > 0, 'cave surface vertices')
  refutes(() => ok(createSphericalCave(Float32Array.of(5, 5, 5, 5), 2, 1, 0, 0, 0, 5, 0, 0).caveGeometry.vc > 0, 'zero radius'), 'a zero radius cave has no surface')
})

gate('the climate cache samples each chunk once per face and passes null through', () => {
  let calls = 0
  const anchor = { sampleDir: () => { calls++; return { temp: 1, humidity: 2, erosion: 3, seaBias: 4, extra: 9 } } }
  const frame = { radius: 100, localToDir: () => [0, 0, 1] }
  eq(SECTOR_M, 8, 'sector size')
  eq(createCachedAnchorField(null, frame), null, 'no anchor')
  const cached = createCachedAnchorField(anchor, frame)
  eq(cached.climateAtLocal(0, 0, [0, 0, 1]), { temp: 1, humidity: 2, erosion: 3, seaBias: 4 }, 'sampled climate')
  cached.climateAtLocal(0, 0, [0, 0, 1])
  eq(calls, 1, 'repeat hits the cache')
  cached.climateAtLocal(0, 0, [1, 0, 0])
  refutes(() => eq(calls, 1, 'a different face'), 'a different face must be sampled again')
  eq(cached.size, 2, 'cache entries')
})

gate('sea level direction and its planar coordinates round trip on the flat chart', () => {
  const snapshot = { radius: 100, east: [1, 0, 0], north: [0, 0, 1], up: [0, 1, 0] }
  eq(seaLevelDirOf(snapshot, 0, 0), [0, 1, 0], 'direction at the origin')
  eq(seaLevelXZOfDir(snapshot, [1, 0, 0]), [100, 0], 'east direction')
  refutes(() => eq(seaLevelXZOfDir(snapshot, [0, 0, 1]), [100, 0], 'north direction'), 'north is the z axis, not x')
  const big = { radius: 1000, east: [1, 0, 0], north: [0, 0, 1], up: [0, 1, 0] }
  const back = reanchoredSeaLevelXZ(big, big, 1, 1)
  ok(Math.abs(back[0] - 1) < 1e-6 && Math.abs(back[1] - 1) < 1e-6, 'same chart maps back to the same point')
  refutes(() => ok(Math.abs(reanchoredSeaLevelXZ(big, big, 2, 0)[0] - 1) < 1e-6, 'x=2'), 'x=2 must not map back to 1')
})

gate('ground detail reach is tier times device times clip, clamped to the bounds', () => {
  eq(resolveGroundDetailReach().reachM, 120, 'default medium desktop')
  eq(resolveGroundDetailReach({ tier: 'ultra' }).reachM, 280, 'ultra desktop')
  eq(resolveGroundDetailReach({ tier: 'ultra', clipFar: 2000 }).reachM, 400, 'clamped to max')
  eq(resolveGroundDetailReach({ tier: 'low', clipFar: 1 }).reachM, 8, 'clamped to min')
  eq(resolveGroundDetailReach({ enabled: false }), { enabled: false, reachM: 0, tier: 'medium', device: 'desktop' }, 'disabled')
  throwsCode(() => resolveGroundDetailReach({ tier: 'constructor' }), 'reach-tier-invalid')
  refutes(() => eq(resolveGroundDetailReach({ tier: 'ultra' }).reachM, 120, 'ultra'), 'ultra is not the medium value')
})

gate('water level takes the highest of sea, painted and circular bodies', () => {
  const water = createWaterLevel({ seaLevel: 2, lakes: [{ x: 0, z: 0, radius: 10, level: 7 }] })
  eq(water.getWaterLevelAt(3, 4), 7, 'inside the lake')
  eq(water.getWaterLevelAt(20, 0), 2, 'outside the lake')
  refutes(() => eq(water.getWaterLevelAt(20, 0), 7, 'outside the lake'), 'outside the lake is sea level')
  eq(water.liquidStateAt(0, 0, 0), { inWater: true, level: 7, depth: 7, density: 'diving' }, 'deep')
  eq(water.liquidStateAt(0, 0, 6.8).density, 'floating', 'shallow')
  eq(water.liquidStateAt(0, 0, 7), { inWater: false, level: 7, depth: 0, density: 'air' }, 'at the surface')
  throwsCode(() => createWaterLevel({ seaLevel: NaN }), 'water-sea-invalid')
  const sea = createWaterLevel({})
  sea.setSeaLevel(3)
  eq(sea.getWaterLevelAt(0, 0), 3, 'after setSeaLevel')
  refutes(() => eq(sea.getWaterLevelAt(0, 0), 2, 'old sea level'), 'the sea level changed to 3')
})

gate('cube-sphere faces follow the axis order and the adjacency table is reciprocal', () => {
  eq([pickFace(1, 0, 0), pickFace(-1, 0, 0), pickFace(0, 1, 0), pickFace(0, -1, 0), pickFace(0, 0, 1), pickFace(0, 0, -1)], [0, 1, 2, 3, 4, 5], 'faces')
  eq(verifyCubeSphereAdjacency(), true, 'self check')
  eq(worldToCell(0, 0, 1000, 1000, 100), { face: 4, cx: 10, cy: 10 }, 'cell on +z')
  refutes(() => eq(worldToCell(0, 0, -1000, 1000, 100).face, 4, 'cell on -z'), 'the -z cell is on face 5')
})

gate('cube-sphere edge crossings land on the neighbour face', () => {
  eq(resolveCell(0, 20, 3, 20).face, 5, 'across the u+ edge')
  eq(resolveCell(0, 5, 3, 20), { face: 0, cx: 5, cy: 3 }, 'inside the face')
  refutes(() => eq(resolveCell(0, 20, 3, 20).face, 0, 'across the edge'), 'an edge cell is not on the same face')
})

gate('packed cell keys are distinct and interior neighbours are eight distinct cells', () => {
  eq(packCellKey(0, 1, 2, 10), 50, 'key (1,2)')
  eq(packCellKey(0, 2, 1, 10), 97, 'key (2,1)')
  refutes(() => eq(packCellKey(0, 2, 1, 10), 50, 'key (2,1)'), 'swapped indices must not share a key')
  const keys = neighborCells(4, 5, 5, 10).map(n => packCellKey(n.face, n.cx, n.cy, 10))
  eq(new Set(keys).size, 8, 'distinct neighbour keys')
  refutes(() => eq(neighborCells(4, 5, 5, 10).length, 9, 'neighbour count'), 'a cell has eight neighbours')
})

gate('brush preconditions name the first failed clause and applied strokes are recorded', () => {
  eq(brushPrecondition(['a', 'b'], [true, false]), { rejected: true, requires: ['a', 'b'], violates: 'b', touched: 0 }, 'failed clause')
  eq(brushPrecondition(['a', 'b'], [true, true]), null, 'all clauses hold')
  throwsAny(() => brushPrecondition(['a'], [true, true]), 'mismatched checks')
  const strokes = []
  eq(brushApplied(strokes, 3, { s: 1 }), { rejected: false, requires: null, violates: null, touched: 3 }, 'applied')
  eq(strokes.length, 1, 'stroke recorded')
  const untouched = []
  brushApplied(untouched, 0, { s: 1 })
  refutes(() => eq(untouched.length, 1, 'stroke with no touch'), 'a stroke that touched nothing is not recorded')
  eq(STRENGTH_REQUIRES, ['strength clamps above zero'], 'strength clause')
})

gate('brush strokes validate their fields and replay through the matching editor call', () => {
  eq(STROKE_KINDS.flatten, ['radius', 'targetHeight'], 'flatten fields')
  eq(heightStrokeIsLoadable({ brush: 'raise', x: 0, z: 0, strength: 1, radius: 2 }), true, 'raise loads')
  eq(heightStrokeIsLoadable({ brush: 'flatten', x: 0, z: 0, strength: 1, radius: 2 }), false, 'flatten without target')
  refutes(() => eq(heightStrokeIsLoadable({ brush: 'flatten', x: 0, z: 0, strength: 1, radius: 2 }), true, 'flatten without target'), 'a flatten needs a target height')
  eq(biomeStrokeIsLoadable({ x: 0, z: 0, radius: 2, strength: 1, target: { temp: 1, humidity: 0, erosion: 0 } }), true, 'biome loads')
  refutes(() => eq(biomeStrokeIsLoadable({ x: 0, z: 0, radius: 2, strength: 1, target: { temp: 1, humidity: 0 } }), true, 'biome without erosion'), 'a biome target needs erosion')
  eq(replayStrokes([1, 2, 3], x => x > 1), 2, 'replayed count')
  eq(replayStrokes('nope', () => true), 0, 'not a list')
  refutes(() => eq(replayStrokes([1, 2, 3], () => true), 2, 'all replay'), 'every stroke is not replayed when refused')
  const calls = []
  const height = {
    applyRaiseBrush: (...args) => calls.push(['raise', ...args]),
    applySmoothBrush: (...args) => calls.push(['smooth', ...args]),
  }
  eq(heightStrokeReplay(height, null)({ brush: 'raise', x: 1, z: 2, radius: 3, strength: 4 }), true, 'raise replays')
  eq(calls, [['raise', 1, 2, 3, 4]], 'raise call')
  refutes(() => eq(heightStrokeReplay(height, null)({ brush: 'flatten', x: 1, z: 2, radius: 3, targetHeight: 5, strength: 4 }), true, 'flatten without base'), 'a flatten needs a base height function')
  const painted = []
  const biome = { applyPaintBrush: (...args) => painted.push(args) }
  eq(biomeStrokeReplay(biome)({ x: 1, z: 2, radius: 3, strength: 4, target: { temp: 1, humidity: 0, erosion: 0 } }), true, 'biome replays')
  eq(painted, [[1, 2, 3, { temp: 1, humidity: 0, erosion: 0 }, 4]], 'biome call')
})

const scannedSources = readdirSync(pureDir).filter(name => name.endsWith('.js')).sort()
const sourceTextOf = (name) => readFileSync(join(pureDir, name), 'utf8')

const commentPattern = /\/\/|\/\*/
const hookPattern = /__spointHmr|_hotSwap|export let|acceptSelf/
const hostPattern = /from ['"]three['"]|from ['"]node:|import\(|\bdocument\.|\bwindow\.|\bWorker\b|postMessage|\bprocess\.|setTimeout|setImmediate|\bfetch\(|performance\.now|\bJolt\b/

gate('no port file carries a comment', () => {
  for (const name of scannedSources) ok(!commentPattern.test(sourceTextOf(name)), name + ' carries a comment')
  refutes(() => ok(!commentPattern.test('const a = 1 // note'), 'inline control'), 'a line comment must be detected')
})

gate('no port file carries a spoint HMR hook', () => {
  for (const name of scannedSources) ok(!hookPattern.test(sourceTextOf(name)), name + ' carries an HMR hook')
  refutes(() => ok(!hookPattern.test('globalThis.__spointHmr?.acceptSelf(import.meta.url)'), 'inline control'), 'an HMR hook must be detected')
})

gate('no port file imports three, a DOM, a worker, a stream, a process or a timer', () => {
  for (const name of scannedSources) ok(!hostPattern.test(sourceTextOf(name)), name + ' reaches a host API')
  refutes(() => ok(!hostPattern.test("import * as T from 'three'"), 'inline control'), 'a three import must be detected')
  refutes(() => ok(!hostPattern.test('const t = setTimeout(f, 0)'), 'inline control'), 'a timer must be detected')
})

gate('every relative import of a port file names a file that exists', () => {
  for (const name of scannedSources) {
    for (const match of sourceTextOf(name).matchAll(/from '(\.\/[^']+)'/g)) {
      ok(existsSync(join(pureDir, match[1])), name + ' imports missing ' + match[1])
    }
  }
  refutes(() => ok(existsSync(join(pureDir, './missing.js')), 'an absent file'), 'an absent import must be detected')
})

gate('heightDelta raise lowers nothing at zero strength and lifts the centre by the strength', () => {
  const delta = createHeightDelta()
  delta.applyRaiseBrush(0.5, 0.5, 2, 3)
  eq(delta.deltaAt(0, 0), 3, 'centre delta')
  eq(delta.wrapHeightFn(() => 10)(0, 0), 13, 'wrapped height')
  refutes(() => eq(delta.deltaAt(0, 0), 4, 'centre delta'), 'a delta of 4 must fail')
  const zero = createHeightDelta()
  zero.applyRaiseBrush(0.5, 0.5, 2, 0)
  eq(zero.cellCount, 0, 'zero strength touches nothing')
  refutes(() => eq(delta.cellCount, 0, 'real stroke cell count'), 'a real stroke must touch cells')
})

gate('biome paint clamps the target and writes the first cell at full weight', () => {
  const biome = createBiomeOverride()
  biome.applyPaintBrush(4, 4, 3, { temp: 2, humidity: 0.5, erosion: 0.5 }, 1)
  eq(biome.overrideAt(4, 4).temp, 1, 'clamped temp')
  eq(biome.overrideAt(4, 4).w, 1, 'weight at the centre')
  refutes(() => eq(biome.overrideAt(4, 4).temp, 2, 'unclamped temp'), 'the temp must be clamped')
  eq(BIOME_NAMES, ['desert', 'tundra', 'forest', 'grassland', 'wetland'], 'preset order')
  refutes(() => eq(BIOME_NAMES, ['tundra', 'desert', 'forest', 'grassland', 'wetland'], 'reordered'), 'a reordered list must fail')
})

gate('a structure post is placed at its template offset, rotated and removed by a higher footprint', () => {
  defineStructureTemplate('terrain-pure-post', { footprintRadius: 1, parts: [{ model: 'm', x: 1, z: 0 }] })
  defineStructureTemplate('terrain-pure-big', { footprintRadius: 3, parts: [{ model: 'b', x: 0, z: 0 }] })
  const post = stampStructures([{ template: 'terrain-pure-post', x: 10, z: 5 }], () => 2)[0]
  eq([post.x, post.y, post.z], [11, 2, 5], 'unrotated post')
  const turned = stampStructures([{ template: 'terrain-pure-post', x: 10, z: 5, rotY: Math.PI / 2 }], () => 2)[0]
  eq([turned.x, turned.z], [10, 4], 'quarter turn')
  refutes(() => eq([turned.x, turned.z], [11, 5], 'unrotated after rotation'), 'rotation must move the post')
  const covered = stampStructures([
    { template: 'terrain-pure-post', x: 10, z: 5, priority: 0 },
    { template: 'terrain-pure-big', x: 11, z: 5, priority: 1 },
  ], () => 0)
  eq(covered.map(p => p.model), ['b'], 'higher priority footprint removes the post')
})

gate('a carved cell is found by its key and an empty carve set gives no filter', () => {
  const key00 = 4194304 * 8388608 + 4194304
  const cells = new Set([key00])
  ok(isCarved(cells, 0, 0), 'carved origin')
  ok(!isCarved(new Set(), 0, 0), 'empty set carves nothing')
  eq(createCarvedClimateFilter(new Set()), null, 'no filter for an empty carve')
  const filter = createCarvedClimateFilter(cells)
  eq(filter({ t: 1 }, 0, 0), null, 'carved cell drops climate')
  eq(filter({ t: 1 }, 1, 0), { t: 1 }, 'uncarved cell keeps climate')
  refutes(() => ok(isCarved(cells, 0, 1), 'neighbour carved'), 'the neighbour must not be carved')
})

gate('thermal erosion leaves a flat field alone and sheds a spike', () => {
  const flat = new Float32Array(25).fill(3)
  eq(Array.from(thermalErode(flat, 5, 1)), Array(25).fill(3), 'flat field')
  const spike = new Float32Array(25)
  spike[12] = 100
  ok(thermalErode(spike, 5, 1)[12] < 100, 'spike is lowered')
  refutes(() => ok(thermalErode(spike, 5, 1)[12] >= 100, 'spike kept'), 'a spike must be lowered')
})

gate('field layers locate chunk keys with negative cells and read back paint', () => {
  const layers = createFieldLayers({ cellSize: 2, chunkCells: 4 })
  eq(layers.locate(-0.5, 0), { key: '-1,0', index: 3 }, 'negative cell')
  eq(layers.locate(0, 0), { key: '0,0', index: 0 }, 'origin')
  layers.paint(1, 1, 2)
  eq(layers.readField(1, 1), 2, 'painted cell')
  eq(layers.readField(5, 1), 0, 'unpainted cell')
  refutes(() => eq(layers.readField(1, 1), 0, 'painted cell'), 'a painted cell must not read 0')
})

gate('field paint adds the painted value and refuses an invalid cell size', () => {
  const height = () => 10
  ok(wrapHeightWithFieldPaint(null, height) === height, 'no paint returns the height function')
  eq(wrapHeightWithFieldPaint({ read: () => 2 }, height)(0, 0), 12, 'height plus paint')
  refutes(() => eq(wrapHeightWithFieldPaint({ read: () => 2 }, height)(0, 0), 10, 'ignored paint'), 'the paint must be added')
  let refused = false
  try {
    createHostFieldPaint({ fieldPaint: { cellSize: 0 } })
  } catch {
    refused = true
  }
  ok(refused, 'zero cell size refused')
  eq(FIELD_LAYER_NAMES.length > 0, true, 'layer names exist')
})

gate('contact stamps scale their radii and strength by species and size', () => {
  const rock = rockContactStamps([{ x: 1, z: 2, scale: 2 }])[0]
  eq([rock.r0, rock.r1, rock.strength], [1, 3, 0.45], 'rock at scale 2')
  refutes(() => eq(rockContactStamps([{ x: 1, z: 2, scale: 1 }])[0].r0, 1, 'rock at scale 1'), 'scale 1 gives a smaller radius')
  const bush = treeContactStamps([{ x: 0, z: 0, species: 4, scale: 1 }])[0]
  eq([bush.r0, bush.r1, bush.strength], [0.6, 3, 0.35], 'bush at scale 1')
  const tree = treeContactStamps([{ x: 0, z: 0, species: 1, scale: 1 }])[0]
  eq([tree.r0, tree.strength], [0.8125, 0.5], 'pine at scale 1')
  refutes(() => eq(tree.strength, 0.35, 'pine strength'), 'a pine is not a bush')
})

gate('a model exclusion circle blocks strictly inside its radius only', () => {
  const field = createModelExclusionField([{ model: 'm', position: [0, 0, 0] }])
  eq(field.blockedAt(1.4, 0), true, 'inside')
  eq(field.blockedAt(2.5, 0), false, 'at the boundary')
  eq(createModelExclusionField([{ position: [0, 0, 0] }]).circleCount, 0, 'entity without a model')
  refutes(() => eq(field.blockedAt(2.5, 0), true, 'boundary'), 'the boundary must not block')
})

gate('the near-field lattice derives its tile and half extent from the spacing and extent', () => {
  const lattice = createNearFieldLattice({ spacingM: 2, extentM: 100 })
  eq([lattice.tileM, lattice.maxLeafM, lattice.requestedHalfExtentM], [18, 18, 50], 'tile, leaf and half extent')
  refutes(() => eq(lattice.tileM, 20, 'tile'), 'tile of 20 must fail')
})

gate('sphere drop, surface root and missing ground height follow the planet curvature', () => {
  eq(sphereDropBelowTangent(9, 5), 1, 'drop at r2 9 radius 5')
  eq(sphereDropBelowTangent(25, 5), 5, 'drop capped at the radius')
  eq(sphereDropBelowTangent(0, 5), 0, 'no drop at the centre')
  refutes(() => eq(sphereDropBelowTangent(9, 5), 2, 'drop'), 'the drop is 1, not 2')
  eq(isSurfaceRootWithin(0.5, 1), true, 'residual inside tolerance')
  eq(isSurfaceRootWithin(2, 1), false, 'residual outside tolerance')
  eq(isSurfaceRootWithin(0, 0), false, 'zero tolerance')
  eq(isNoGroundHeight(null), true, 'null is no ground')
  eq(isNoGroundHeight(0), false, 'zero is ground')
  refutes(() => eq(isSurfaceRootWithin(2, 1), true, 'residual outside'), 'a residual of 2 must fail a tolerance of 1')
})

gate('the waterline subtracts the anchor height and the curvature drop', () => {
  eq(waterlineLocalY({ offsetY: 10, anchorHeight: 2, radius: 5 }, 3, 0), 7, 'waterline with curvature')
  eq(waterlineLocalY({ offsetY: 10, anchorHeight: 2 }, 3, 0), 8, 'waterline without radius')
  eq(waterlineLocalY({ anchorHeight: 2, radius: 5 }, 3, 0), null, 'missing offset')
  refutes(() => eq(waterlineLocalY({ offsetY: 10, anchorHeight: 2, radius: 5 }, 3, 0), 8, 'waterline'), 'curvature lowers the waterline by 1')
})

gate('guarded ground height passes the sample through', () => {
  eq(guardedGroundHeight('w', (x, z) => x + z)(2, 3), 5, 'sum')
  refutes(() => eq(guardedGroundHeight('w', (x, z) => x + z)(2, 3), 6, 'sum'), 'the sum is 5')
})

gate('placement chart quaternion and tangent maths', () => {
  eq(quatMulF32([0, 0, 0, 1], [0.5, 0.5, 0.5, 0.5]), [0.5, 0.5, 0.5, 0.5], 'identity on the left')
  eq(quatMulF32([0.5, 0.5, 0.5, 0.5], [0, 0, 0, 1]), [0.5, 0.5, 0.5, 0.5], 'identity on the right')
  refutes(() => eq(quatMulF32([0, 0, 0, -1], [0.5, 0.5, 0.5, 0.5]), [0.5, 0.5, 0.5, 0.5], 'negated identity'), 'a negated identity gives the negated quaternion')
  const basis = { eastL: [0, 1, 0], upL: [0, 0, 1], northL: [1, 0, 0] }
  eq(tangentToLocal(basis, 1, 2, 3), [3, 1, 2], 'permuted basis')
  const identity = { eastL: [1, 0, 0], upL: [0, 1, 0], northL: [0, 0, 1] }
  eq(tangentFrameQuat(identity), [0, 0, 0, 1], 'identity basis gives identity quaternion')
  eq(tangentHeadingInChart({ eastL: [0, 0, 1] }), -Math.PI / 2, 'heading')
  refutes(() => eq(tangentToLocal(basis, 1, 2, 3), [1, 2, 3], 'identity assumed'), 'the basis is permuted')
})

gate('value noise and climate lookup return their documented values', () => {
  eq(valueNoise3(() => 2147483648, 0, 1.3, 2.7, 3.1, 1), 0.5, 'constant hash')
  eq(climateAt(null, 0, 0, [0, 1, 0]), null, 'no field')
  eq(climateAt({ sampleDir: d => d[1] }, 0, 0, [0, 7, 0]), 7, 'direction sampler')
  eq(climateAt({ sampleDir: () => 1, climateAtLocal: (x, z) => x + z }, 2, 3, [0, 0, 0]), 5, 'local sampler wins')
  refutes(() => eq(valueNoise3(() => 2147483648, 0, 1.3, 2.7, 3.1, 1), 0.25, 'constant hash'), 'the constant hash gives 0.5')
})

gate('vegetation painted slope, soil weight, tint, lean and relief scale', () => {
  eq(paintedSlopeOf(0, 0), 0, 'flat')
  eq(paintedSlopeOf(2, 2), 2 / 3, 'steep')
  refutes(() => eq(paintedSlopeOf(2, 2), 0, 'steep'), 'a steep cell is not flat')
  eq(renderedSoilWeight(4.5), 0, 'below the sand line')
  eq(renderedSoilWeight(15), 1, 'beach top')
  eq(renderedSoilWeight(9.75), 0.5, 'smoothstep midpoint')
  refutes(() => eq(renderedSoilWeight(9.75), 0.75, 'midpoint'), 'the midpoint is 0.5')
  eq(tintMultiplier(0, 1, 0.5), [0.5, 0.5, 0.5], 'zero hue')
  eq(leanQuat(0, 0), [0, 0, 0, 1], 'zero lean')
  eq(reliefMarginScaleOf({ reliefScale: 0.02 }), 2, 'relief twice baseline')
  eq(reliefMarginScaleOf(null), 1, 'baseline')
  refutes(() => eq(reliefMarginScaleOf({ reliefScale: 0.02 }), 1, 'relief'), 'the relief scale is 2')
})

gate('vegetation hash is unsigned and deterministic and rand stays in the unit interval', () => {
  eq(hash3(1, 2, 3), hash3(1, 2, 3), 'deterministic')
  ok((hash3(1, 2, 3) >>> 0) === hash3(1, 2, 3), 'unsigned')
  const draw = rand(hash3(1, 2, 3), 5)
  ok(draw >= 0 && draw < 1, 'unit interval')
  refutes(() => eq(hash3(1, 2, 3), hash3(1, 3, 2), 'swapped cells'), 'the cell axes are not symmetric')
})

gate('rock scale and squash tables round trip through their level functions and clamp', () => {
  eq(ROCK_SCALE_TABLE.length, 10, 'scale levels')
  eq(ROCK_SQUASH_TABLE.length, 3, 'squash levels')
  for (let i = 0; i < 10; i++) eq(rockScaleLevel(ROCK_SCALE_TABLE[i]), i, 'scale level ' + i)
  for (let i = 0; i < 3; i++) eq(rockSquashLevel(ROCK_SQUASH_TABLE[i]), i, 'squash level ' + i)
  eq(rockScaleLevel(1e9), 9, 'high scale clamps')
  eq(rockSquashLevel(1e9), 2, 'high squash clamps')
  refutes(() => eq(rockScaleLevel(ROCK_SCALE_TABLE[4]), 5, 'entry 4'), 'entry 4 is level 4')
})

gate('rock density scales with aridity and clamps its inputs to one', () => {
  eq(rockDensity(1, 1, 1, 1), 1, 'clamped to one')
  eq(rockDensity(0, 0, 1, 0), 0.036, 'wet cell')
  eq(rockDensity(0, 0, 0, 0), 0.072, 'arid cell doubles')
  refutes(() => eq(rockDensity(0, 0, 0, 0), 0.036, 'arid cell'), 'dry cells are denser')
})

gate('decoration definitions refuse malformed layers and accept valid ones', () => {
  throwsAny(() => parseDecorationDef({ layers: { a: { density: 2 } } }), 'density above one')
  throwsAny(() => parseDecorationDef({ layers: { a: { density: 0.5, budget: -1 } } }), 'negative budget')
  throwsAny(() => parseDecorationDef({ layers: {}, bindings: { m: ['missing'] } }), 'unknown layer binding')
  throwsAny(() => parseDecorationDef(null), 'null definition')
  parseDecorationDef({ layers: { a: { density: 0.5 } }, bindings: { m: ['a'] } })
  refutes(() => throwsAny(() => parseDecorationDef({ layers: { a: { density: 0.5 } } }), 'valid definition'), 'a valid definition must not throw')
})

gate('decoration cells pass the painted and density rules and respect the budget', () => {
  const layerOf = (spec) => parseDecorationDef({ layers: { a: spec }, bindings: { m: ['a'] } }).layers.get('a')
  const cell = { slope: 0.9, height: 5, area: 1, seed: 1, ix: 0, iz: 0, painted: false, waterDepth: 0 }
  eq(acceptsCell(layerOf({ density: 1 }), cell), true, 'full density')
  eq(acceptsCell(layerOf({ density: 0 }), cell), false, 'zero density')
  eq(acceptsCell(layerOf({ density: 1, paintedOnly: true }), cell), false, 'unpainted cell')
  eq(acceptsCell(layerOf({ density: 1, paintedOnly: true }), { ...cell, painted: true }), true, 'painted cell')
  refutes(() => eq(acceptsCell(layerOf({ density: 0 }), cell), true, 'zero density'), 'zero density must reject')
  const decor = parseDecorationDef({ layers: { a: { density: 1, budget: 2 } }, bindings: { m: ['a'] } })
  const cells = [0, 1, 2].map(ix => ({ material: 'm', slope: 0, height: 0, area: 1, seed: 1, ix, iz: 0 }))
  eq(decorateCells(decor, cells).length, 2, 'budget of two')
  refutes(() => eq(decorateCells(decor, cells).length, 3, 'budget'), 'the budget caps the output at two')
})

gate('terrain marks flatten, clear and liquid within their radii and refuse an unknown kind', () => {
  const flat = compileTerrainMarks([{ kind: 'flatten', center: [0, 0], radius: 10, falloff: 5, height: 7 }])
  eq(flat.height(0, 0, 3), 7, 'inside the radius')
  eq(flat.height(15, 0, 3), 3, 'beyond the falloff')
  refutes(() => eq(flat.height(0, 0, 3), 3, 'inside the radius'), 'the origin must be flattened')
  const hole = compileTerrainMarks([{ kind: 'clear', center: [0, 0], radius: 2 }])
  ok(hole.clearsAt(2, 0), 'on the boundary')
  ok(!hole.clearsAt(2.01, 0), 'past the boundary')
  refutes(() => ok(hole.clearsAt(2.01, 0), 'past the boundary'), 'outside must not clear')
  const sea = compileTerrainMarks([{ kind: 'liquid', center: [0, 0], radius: 5, level: 3 }])
  eq(sea.liquidLevelAt(3, 4), 3, 'inside the liquid')
  eq(sea.liquidLevelAt(6, 0), null, 'outside the liquid')
  throwsAny(() => compileTerrainMarks([{ kind: 'bogus' }]), 'unknown kind')
  refutes(() => eq(sea.liquidLevelAt(6, 0), 3, 'outside the liquid'), 'outside must not report the level')
})

gate('procedural geometry counts triangles and repeats, and the stream is seeded', () => {
  const tri = { op: 'tri', a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }
  const quad = buildProceduralGeometry([{ op: 'quad', a: [0, 0, 0], b: [1, 0, 0], c: [1, 1, 0], d: [0, 1, 0] }], { seed: 1 })
  eq(quad.triangleCount, 2, 'quad triangles')
  eq(quad.positions.length, 18, 'quad floats')
  refutes(() => eq(quad.triangleCount, 3, 'quad triangles'), 'a quad is two triangles')
  eq(buildProceduralGeometry([{ op: 'repeat', count: 3, body: [tri] }], { seed: 1 }).triangleCount, 3, 'repeat three times')
  refutes(() => eq(buildProceduralGeometry([{ op: 'repeat', count: 2, body: [tri] }], { seed: 1 }).triangleCount, 3, 'repeat'), 'two repeats give two triangles')
  eq(seededStream(5)(), seededStream(5)(), 'same seed, same draw')
  refutes(() => eq(seededStream(6)(), seededStream(5)(), 'seeds 5 and 6'), 'different seeds must differ')
})

gate('scripted terrain normalises heights and gives a flat normal on flat ground', () => {
  const flat = createScriptedTerrain({ heightAt: () => 5, minHeight: 0, maxHeight: 10 })
  const sample = flat.sample(0, 0)
  eq(sample.height01, 0.5, 'height fraction')
  eq(sample.normal, [0, 1, 0], 'flat normal')
  eq(flat.materialAt(0, 0), null, 'no material')
  refutes(() => eq(sample.height01, 0.6, 'height fraction'), 'the fraction is 0.5')
  const ramp = createScriptedTerrain({ heightAt: ({ x }) => x, minHeight: -100, maxHeight: 100 })
  const slope = ramp.sample(0, 0)
  eq(slope.slope, [1, 0], 'unit ramp slope')
  eq(slope.normal[1], 1 / Math.SQRT2, 'ramp normal')
  refutes(() => eq(slope.normal[1], 1, 'ramp normal'), 'a ramp is not flat')
})

gate('scripted terrain refuses an empty height range and a non-finite height', () => {
  throwsAny(() => createScriptedTerrain({ heightAt: () => 1, minHeight: 1, maxHeight: 1 }), 'empty range')
  throwsAny(() => createScriptedTerrain({ heightAt: () => NaN }).sample(0, 0), 'NaN height')
  let threw = false
  try {
    createScriptedTerrain({ heightAt: () => 1 }).sample(0, 0)
  } catch {
    threw = true
  }
  ok(!threw, 'finite height does not throw')
})

gate('script mesh keys are order independent and fold negative zero', () => {
  eq(scriptMeshKey('s', { a: 2 }, 3), '{"params":{"a":2},"script":"s","seed":3}', 'canonical key')
  eq(scriptMeshKey('s', { b: 1, a: 2 }, 3), scriptMeshKey('s', { a: 2, b: 1 }, 3), 'parameter order')
  eq(scriptMeshKey('s', { a: -0 }, 3), scriptMeshKey('s', { a: 0 }, 3), 'negative zero')
  throwsAny(() => scriptMeshKey('s', {}, 1.5), 'fractional seed')
  refutes(() => eq(scriptMeshKey('s', {}, 1), scriptMeshKey('s', {}, 2), 'seed'), 'the seed is part of the key')
})

gate('script mesh cache evicts its oldest entry and counts hits and misses', () => {
  const cache = createScriptMeshCache({ limit: 2 })
  for (const seed of [1, 2, 3]) cache.getOrBuild('s', {}, seed, () => ({}))
  eq(cache.stats().size, 2, 'size capped at the limit')
  ok(!cache.has('s', {}, 1) && cache.has('s', {}, 3), 'oldest evicted')
  refutes(() => ok(cache.has('s', {}, 1), 'seed 1'), 'seed 1 must be gone')
  const counting = createScriptMeshCache()
  let builds = 0
  counting.getOrBuild('s', {}, 1, () => ++builds)
  counting.getOrBuild('s', {}, 1, () => ++builds)
  eq([builds, counting.stats().hits, counting.stats().misses], [1, 1, 1], 'one build, one hit, one miss')
  refutes(() => eq(counting.stats().hits, 0, 'hits'), 'a repeated key is a hit')
})

gate('grass decal stamps fade with distance and decay by half life', () => {
  const decal = createGrassDecal(null, { now: () => 0 })
  eq(decal.markScorched(0, 0, 4, 1).touched, 12, 'cells within the radius')
  eq(decal.sampleAt(100, 100), 0, 'far away is zero')
  refutes(() => eq(decal.sampleAt(0, 0), 1, 'falloff at the origin'), 'the falloff is below one')
  let clock = 0
  const aging = createGrassDecal(null, { now: () => clock, halfLifeS: 10 })
  aging.markScorched(0, 0, 4, 1)
clock = 10000
  eq(aging.nearestStamps(0, 0, 1)[0].strength, 0.5, 'one half life after 10 s')
  eq(aging.toJSON().stamps[0].strength, 1, 'stored strength is not decayed')
  refutes(() => eq(aging.nearestStamps(0, 0, 1)[0].strength, 1, 'decayed'), 'the stamp must have decayed')
  const slower = createGrassDecal(null, { now: () => clock, halfLifeS: 20 })
  slower.markScorched(0, 0, 4, 1)
  refutes(() => eq(slower.nearestStamps(0, 0, 1)[0].strength, 0.5, 'half life of 20 s'), 'a 20 s half life leaves more than 0.5 after 10 s')
  const good = { x: 0, z: 0, radius: 4, strength: 1, appliedAt: 0 }
  eq(loadGrassDecal({ stamps: [good, { ...good, x: Infinity }] }, { now: () => 0 }).stampCount, 1, 'non-finite stamp dropped')
  refutes(() => eq(loadGrassDecal({ stamps: [good, { ...good, x: Infinity }] }, { now: () => 0 }).stampCount, 2, 'stamp count'), 'a non-finite stamp must not load')
})

finish()
