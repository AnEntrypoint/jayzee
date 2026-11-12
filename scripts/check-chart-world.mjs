import { gate, finish } from './lib/gate.mjs'
import { StageLoader } from '../src/stage-pure/stageLoader.js'
import { createStageResolvers } from '../src/stage-pure/stageResolvers.js'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'
import { createChartReanchorService } from '../src/chart-pure/chartReanchorService.js'
import { createTerrainReanchor } from '../src/terrain-pure/chartReanchorTerrain.js'
import { createFieldLattice, LATTICE_FOLLOW_TILT_DEG, LATTICE_RESET_FORCED_TILT_DEG } from '../src/terrain-pure/fieldLattice.js'
import { createHeightFieldStreamer, createHeightFieldPhysics } from '../src/terrain-pure/heightFieldStreamer.js'
import { pickFace, worldToCell, resolveCell, neighborCells, packCellKey } from '../src/terrain-pure/cubeSphereCells.js'
import { chartAnchorKeyOfDir } from '../src/chart-pure/chartAnchor.js'

const fail = (what) => { throw new Error(what) }
const expect = (actual, expected, what) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) fail(`${what}: expected ${e} got ${a}`)
}

const RADIUS = 20000
const JOLT = { heapBytes: 134217728, residentBytes: 1157976, mirrorReserve: 2, mirrorMarginalBytes: 11278387, worldMarginalBytes: 20238432, reserveFraction: 0.1 }
const WORLD = {
  name: 'walkabout',
  planetRadius: RADIUS,
  entities: [
    { id: 'ground', app: 'terrain', config: { radius: RADIUS, clusters: { enabled: true } } },
    { id: 'beacon-px', model: 'beacon.glb', position: [RADIUS, 0, 0] },
    { id: 'beacon-nx', model: 'beacon.glb', position: [-RADIUS, 0, 0] },
    { id: 'beacon-py', model: 'beacon.glb', position: [0, RADIUS, 0] },
    { id: 'beacon-ny', model: 'beacon.glb', position: [0, -RADIUS, 0] },
    { id: 'beacon-pz', model: 'beacon.glb', position: [0, 0, RADIUS] },
    { id: 'beacon-nz', model: 'beacon.glb', position: [0, 0, -RADIUS] },
  ],
}

const sampler = {
  radius: RADIUS,
  hashVersion: 1,
  heightAt: (d) => 30 * Math.sin(7 * d[0] + 1) * Math.cos(5 * d[1]) + 15 * Math.sin(11 * d[2] + 2 * d[0]),
}

const makeRuntime = () => {
  const entities = new Map()
  return {
    _appDefs: new Map(),
    spawnEntity(id, config) { const entity = { id, position: config.position, spawnConfig: config }; entities.set(id, entity); return entity },
    destroyEntity(id) { entities.delete(id) },
    getEntity(id) { return entities.get(id) ?? null },
  }
}

const WAYPOINTS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1], [1, 0, 0]]
const STEP_M = 150
const STEPS_PER_LEG = Math.ceil((Math.PI / 2) * RADIUS / STEP_M)
const CELLS_PER_FACE = 16
const CELL_SIZE = 2 * RADIUS / CELLS_PER_FACE

const pathDir = (leg, step) => {
  const a = WAYPOINTS[leg], b = WAYPOINTS[leg + 1], t = (step / STEPS_PER_LEG) * Math.PI / 2
  return [a[0] * Math.cos(t) + b[0] * Math.sin(t), a[1] * Math.cos(t) + b[1] * Math.sin(t), a[2] * Math.cos(t) + b[2] * Math.sin(t)]
}

const localOf = (frame, d) => {
  const r = RADIUS + sampler.heightAt(d)
  const dot = (v) => r * (d[0] * v[0] + d[1] * v[1] + d[2] * v[2])
  return [dot(frame.east), dot(frame.up) - (RADIUS + frame.anchorHeight), dot(frame.north)]
}

const worldOf = (frame, p) => {
  const lift = RADIUS + frame.anchorHeight + p[1]
  return [0, 1, 2].map((i) => frame.up[i] * lift + frame.east[i] * p[0] + frame.north[i] * p[2])
}

const buildWorld = ({ withTerrainConsumer }) => {
  const loader = new StageLoader(makeRuntime(), createStageResolvers({ jolt: JOLT }))
  const stage = loader.loadFromDefinition(WORLD.name, WORLD)
  const frame = createPlanetFrame({ sampler, anchorDir: [1, 0, 0], offsetY: 0 })
  const player = { pos: localOf(frame, [1, 0, 0]) }
  const streamer = createHeightFieldStreamer({ frame, fieldCount: 1, nodes: 33, spacing: 2, defer: () => Promise.resolve() })
  const physics = createHeightFieldPhysics(streamer)
  const service = createChartReanchorService({ frame, radius: RADIUS, playerDirs: () => [frame.localToDir(player.pos[0], player.pos[2], player.pos[1])] })
  const markers = { points: [[40, 0, 25], [-300, 0, 90]], moved: 0, reanchor(event) { this.points = this.points.map((p) => event.transfer.point(p)); this.moved += this.points.length; return this.points.length } }
  let clock = 0
  const terrain = createTerrainReanchor({
    frame, sampler, offsetY: 0, reliefScale: undefined, physics, heightStreamer: streamer, colliderStreamers: [markers],
    getPlayers: () => [[player.pos[0], player.pos[2]]], blockers: [], now: () => clock++, createFieldLattice,
  })
  if (withTerrainConsumer) service.addTerrainMigrator(terrain)
  const worldDrift = []
  service.onReanchor((event) => {
    const before = worldOf({ up: event.from.up, east: event.from.east, north: event.from.north, anchorHeight: event.from.anchorHeight }, player.pos)
    player.pos = event.transfer.point(player.pos)
    const after = worldOf(frame, player.pos)
    worldDrift.push(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]))
  })
  return { stage, frame, player, streamer, service, terrain, markers, worldDrift }
}

const walk = async (world, legs, onStep, onReanchor = () => {}) => {
  const { frame, player, streamer, service } = world
  for (let leg = 0; leg < legs; leg++) {
    for (let step = 1; step <= STEPS_PER_LEG; step++) {
      const d = pathDir(leg, step)
      player.pos = localOf(frame, d)
      streamer.update([[player.pos[0], player.pos[2]]])
      for (let attempt = 0; attempt < 6; attempt++) {
        const refusalsBefore = service.refusalCount
        const event = service.step()
        if (event) { onReanchor(); streamer.update([[player.pos[0], player.pos[2]]]); break }
        if (service.refusalCount === refusalsBefore) break
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      }
      onStep(d, leg, step)
    }
  }
}

const lap = (async () => {
  const world = buildWorld({ withTerrainConsumer: true })
  const { stage, frame, player, streamer, service, terrain } = world
  const anchorFaces = new Set(), anchorKeys = new Set(), playerCells = new Set(), beaconsSeen = new Set(), seamCrossings = []
  let missingAtReanchor = 0, worstGapAtReanchor = 0, worstSurfaceGap = 0, worstSolveGap = 0, worstTilt = 0, missingSurface = 0, brokenAdjacency = 0, faceMismatch = 0
  let lastCell = null
  await walk(world, 6, (d) => {
    anchorFaces.add(pickFace(frame.up[0], frame.up[1], frame.up[2]))
    anchorKeys.add(chartAnchorKeyOfDir(service.lattice, frame.up))
    const x = player.pos[0], z = player.pos[2]
    const solved = frame.groundHeightLocal(x, z)
    worstSolveGap = Math.max(worstSolveGap, Math.abs(solved - player.pos[1]))
    const surface = streamer.surfaceY(x, z)
    if (surface === null) missingSurface++
    else worstSurfaceGap = Math.max(worstSurfaceGap, Math.abs(surface - solved))
    if (streamer.lattice) worstTilt = Math.max(worstTilt, streamer.lattice.tiltDeg)
    const w = worldOf(frame, player.pos)
    const raw = worldToCell(w[0], w[1], w[2], RADIUS, CELL_SIZE)
    if (raw.face !== pickFace(d[0], d[1], d[2])) faceMismatch++
    const cell = resolveCell(raw.face, raw.cx, raw.cy, CELLS_PER_FACE)
    playerCells.add(packCellKey(cell.face, cell.cx, cell.cy, CELLS_PER_FACE))
    if (lastCell && (lastCell.face !== cell.face || lastCell.cx !== cell.cx || lastCell.cy !== cell.cy)) {
      const adjacent = neighborCells(lastCell.face, lastCell.cx, lastCell.cy, CELLS_PER_FACE).some((n) => n.face === cell.face && n.cx === cell.cx && n.cy === cell.cy)
      if (!adjacent) brokenAdjacency++
      if (lastCell.face !== cell.face) seamCrossings.push([lastCell.face, cell.face])
    }
    lastCell = cell
    for (const id of stage.getRelevantEntitiesForCell(w, 400)) beaconsSeen.add(id)
  }, () => {
    const surface = streamer.surfaceY(player.pos[0], player.pos[2])
    if (surface === null) missingAtReanchor++
    else worstGapAtReanchor = Math.max(worstGapAtReanchor, Math.abs(surface - frame.groundHeightLocal(player.pos[0], player.pos[2])))
  })
  return { missingAtReanchor, worstGapAtReanchor, world, anchorFaces, anchorKeys, playerCells, beaconsSeen, seamCrossings, worstSurfaceGap, worstSolveGap, worstTilt, missingSurface, brokenAdjacency, faceMismatch, service, terrain, stage, streamer }
})()

gate('the world definition loads through the real resolvers as a planet stage on the cube-sphere anchor lattice', async () => {
  const { stage, service } = await lap
  expect([stage.shape.id, stage.spatial.planetRadius], ['planet', RADIUS], 'stage')
  expect(service.lattice.chunksPerFace, 32, 'anchors per face')
  let refused = null
  try { stage.getRelevantEntitiesHorizontal([RADIUS, 0, 0], 100) } catch (error) { refused = error }
  if (!refused) fail('the planet stage answered a flat horizontal query')
})

gate('a player walking through all six axes re-anchors the chart onto every cube face, more than a hundred times', async () => {
  const { anchorFaces, anchorKeys, service } = await lap
  expect([...anchorFaces].sort(), [0, 1, 2, 3, 4, 5], 'cube faces that held the chart anchor')
  if (!(service.reanchorCount > 100)) fail(`${service.reanchorCount} re-anchors`)
  if (!(anchorKeys.size > 100)) fail(`${anchorKeys.size} distinct anchors`)
})

gate('every re-anchor keeps the player at the same planet-centred point to within a micrometre', async () => {
  const { world, service } = await lap
  expect(world.worldDrift.length, service.reanchorCount, 'one state migration per re-anchor')
  const worst = Math.max(...world.worldDrift)
  if (!(worst < 1e-6)) fail(`a re-anchor moved the player ${worst} m`)
})

gate('the terrain consumer follows the lattice on small tilts and resets it from prepared fields on large ones', async () => {
  const { terrain, service, worstTilt, streamer } = await lap
  const follow = terrain.costs.filter((c) => c.mode === 'follow-lattice').length
  const reset = terrain.costs.filter((c) => c.mode === 'reset-lattice').length
  expect(follow + reset, service.reanchorCount, 'the terrain migrated on every re-anchor')
  if (!(follow > 20 && reset > 20)) fail(`${follow} follows and ${reset} resets`)
  if (!(worstTilt > LATTICE_FOLLOW_TILT_DEG * 0.5 && worstTilt <= LATTICE_RESET_FORCED_TILT_DEG + 3)) fail(`worst lattice tilt ${worstTilt}`)
  if (!(service.refusalsByReason['heightfields-not-ready'] > 20)) fail('no re-anchor waited for prepared fields')
  expect([streamer.stats.installed, streamer.stats.prepared >= reset], [reset, true], 'each reset installed a prepared set')
  if (!terrain.costs.every((c) => c.collidersMoved[0] === 2)) fail('a re-anchor did not move the anchored markers')
})

gate('the streamed collision surface stays within 2 cm of the solved ground under the player for the whole walk', async () => {
  const { worstSurfaceGap, worstSolveGap, missingSurface, streamer } = await lap
  expect(missingSurface, 0, 'steps with no field under the player')
  if (!(worstSurfaceGap < 0.02)) fail(`the field surface is ${worstSurfaceGap} m from the ground`)
  if (!(worstSolveGap < 0.01)) fail(`the frame ground solve is ${worstSolveGap} m from the sampler`)
  if (!(streamer.stats.recentred > 500)) fail(`${streamer.stats.recentred} field re-centres`)
})

gate('straight after each re-anchor, before any field is resampled, the field already under the player is still on the ground', async () => {
  const { missingAtReanchor, worstGapAtReanchor } = await lap
  expect(missingAtReanchor, 0, 're-anchors that left no field under the player')
  if (!(worstGapAtReanchor < 0.02)) fail(`after a re-anchor the field surface is ${worstGapAtReanchor} m from the ground`)
})

gate('the player crosses cube-sphere cells only into neighbours, including across six face seams, and the planet stage finds a beacon on every face', async () => {
  const { playerCells, seamCrossings, brokenAdjacency, faceMismatch, beaconsSeen } = await lap
  expect([brokenAdjacency, faceMismatch], [0, 0], 'steps into a non-neighbour cell, steps on the wrong face')
  if (!(seamCrossings.length >= 6)) fail(`${seamCrossings.length} seam crossings`)
  expect(new Set(seamCrossings.map((c) => c[1])).size, 6, 'faces entered across a seam')
  if (!(playerCells.size > 40)) fail(`${playerCells.size} cells visited`)
  expect([...beaconsSeen].sort(), ['beacon-nx', 'beacon-ny', 'beacon-nz', 'beacon-px', 'beacon-py', 'beacon-pz'], 'beacons found by the cell query')
})

gate('negative control: the same walk with no terrain consumer leaves no usable field under the player after each re-anchor', async () => {
  const world = buildWorld({ withTerrainConsumer: false })
  let off = 0
  await walk(world, 1, () => {}, () => {
    const surface = world.streamer.surfaceY(world.player.pos[0], world.player.pos[2])
    if (surface === null || Math.abs(surface - world.frame.groundHeightLocal(world.player.pos[0], world.player.pos[2])) > 1) off++
  })
  if (!(world.service.reanchorCount > 20)) fail('the control walk did not re-anchor')
  expect(off, world.service.reanchorCount, 're-anchors after which the unmigrated field was missing or more than a metre off')
})

gate('negative control: a flat world loads as a flat stage and never holds a cube face', () => {
  const loader = new StageLoader(makeRuntime(), createStageResolvers({ jolt: JOLT }))
  const stage = loader.loadFromDefinition('flat', { name: 'flat', planetRadius: 0, entities: [{ id: 'far-side', model: 'beacon.glb', position: [0, -5000, 0] }] })
  expect([stage.shape.id, stage.spatial.planetRadius], ['flat', 0], 'flat stage')
  expect(stage.getRelevantEntitiesForCell([0, 5000, 0], 100), ['far-side'], 'the flat ring ignores height, which a planet stage does not')
})

finish()
