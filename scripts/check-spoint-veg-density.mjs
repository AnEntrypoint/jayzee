import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { POPULATION_DENSITY_PER_KM2, ROCK_CELL_M, VEG_BASE_DENSITY_CEILING, VEG_CELL_M } from '../src/engine/populationDensity.js'

const SPOINT = process.argv[2] ?? '/workspace/spoint'
const WORLD = 'tps-game'
const TILE_M = 1000
const TILES_PER_SIDE = 3
const PROBE_STEP_M = 8
const KM2_PER_M2 = 1e-6

if (!existsSync(resolve(SPOINT, 'src/terrain/VegPlacement.js'))) {
  gate('the spoint checkout holds src/terrain/VegPlacement.js', () => assert.fail('no spoint checkout at ' + SPOINT))
  finish()
} else {
  process.env.SPOINT_NO_WATCH = '1'
  process.env.SPOINT_SKIP_PREWARM = '1'
  const href = (p) => pathToFileURL(resolve(SPOINT, p)).href
  const { loadWorldModule } = await import(href('src/sdk/WorldLocator.js'))
  const { createPlanetFrame } = await import(href('src/terrain/PlanetFrame.js'))
  const { terrainHashVersionOf, terrainCarvesOf } = await import(href('src/shared/terrainConfig.js'))
  const { placementsForChunk, VEG, SPECIES, baseDensity } = await import(href('src/terrain/VegPlacement.js'))
  const { placementsForRockChunk, ROCK } = await import(href('src/terrain/RockPlacement.js'))
  const { chunkKeyAtLocal, latticeFor } = await import(href('src/terrain/PlacementChart.js'))
  const { createCachedAnchorField } = await import(href('src/terrain/ClimateCache.js'))
  const { createHeightSampler } = await import(href('packages/mapspinner/src/height-cpu.js'))

  const loaded = await loadWorldModule(resolve(SPOINT, 'apps', 'world', WORLD + '.js'))
  const tcfg = loaded.terrain
  const worldSeed = (tcfg.seed ?? 0) | 0
  const sampler = createHeightSampler({ radius: tcfg.radius, seed: tcfg.seed, reliefScale: tcfg.reliefScale, hashVersion: terrainHashVersionOf(tcfg), carves: terrainCarvesOf(tcfg) })
  const frame = createPlanetFrame({ sampler, anchorDir: tcfg.anchorDir || [0, 1, 0], offsetY: tcfg.offsetY || 0, reliefScale: tcfg.reliefScale })
  const anchorField = createCachedAnchorField(sampler.anchorField, frame)
  const lattice = latticeFor(frame, VEG)
  const rockLattice = latticeFor(frame, ROCK)
  const isBush = SPECIES.map((name) => name.startsWith('Bush'))

  const tile = (x0, z0) => {
    const keys = new Set()
    for (let z = z0 - VEG.CHUNK; z <= z0 + TILE_M + VEG.CHUNK; z += PROBE_STEP_M) {
      for (let x = x0 - VEG.CHUNK; x <= x0 + TILE_M + VEG.CHUNK; x += PROBE_STEP_M) keys.add(chunkKeyAtLocal(lattice, frame, x, z))
    }
    let placed = 0
    let bushes = 0
    let produced = 0
    for (const key of keys) {
      const list = placementsForChunk(key, frame, anchorField, worldSeed)
      produced += list.length
      for (const p of list) {
        if (p.x < x0 || p.x >= x0 + TILE_M || p.z < z0 || p.z >= z0 + TILE_M) continue
        placed += 1
        if (isBush[p.species]) bushes += 1
      }
    }
    const rockKeys = new Set()
    for (let z = z0 - ROCK.CHUNK; z <= z0 + TILE_M + ROCK.CHUNK; z += PROBE_STEP_M) {
      for (let x = x0 - ROCK.CHUNK; x <= x0 + TILE_M + ROCK.CHUNK; x += PROBE_STEP_M) rockKeys.add(chunkKeyAtLocal(rockLattice, frame, x, z))
    }
    let rocks = 0
    for (const key of rockKeys) {
      for (const p of placementsForRockChunk(key, frame, anchorField, worldSeed)) {
        if (p.x >= x0 && p.x < x0 + TILE_M && p.z >= z0 && p.z < z0 + TILE_M) rocks += 1
      }
    }
    return { x0, z0, rocks, rockCells: rockKeys.size * ROCK.GRID * ROCK.GRID, chunks: keys.size, cells: keys.size * VEG.GRID * VEG.GRID, produced, placed, bushes, trees: placed - bushes }
  }

  const started = Date.now()
  const tiles = []
  const half = (TILES_PER_SIDE * TILE_M) / 2
  for (let tz = 0; tz < TILES_PER_SIDE; tz++) {
    for (let tx = 0; tx < TILES_PER_SIDE; tx++) tiles.push(tile(tx * TILE_M - half, tz * TILE_M - half))
  }
  const wallMs = Date.now() - started
  const tileKm2 = TILE_M * TILE_M * KM2_PER_M2
  const perKm2 = tiles.map((t) => t.placed / tileKm2).sort((a, b) => a - b)
  const totalPlaced = tiles.reduce((acc, t) => acc + t.placed, 0)
  const totalBushes = tiles.reduce((acc, t) => acc + t.bushes, 0)
  const meanPerKm2 = totalPlaced / (tiles.length * tileKm2)
  const ceiling = POPULATION_DENSITY_PER_KM2.trees.value
  const rockCeiling = POPULATION_DENSITY_PER_KM2.rocks.value
  const rocksPerKm2 = tiles.map((t) => t.rocks / tileKm2).sort((a, b) => a - b)
  const meanRocksPerKm2 = tiles.reduce((acc, t) => acc + t.rocks, 0) / (tiles.length * tileKm2)
  const cellsPerKm2 = (1000 / VEG_CELL_M) ** 2

  for (const t of tiles) console.log('tile x ' + t.x0 + ' z ' + t.z0 + ': ' + t.chunks + ' chunks, ' + t.cells + ' cells tried, ' + t.placed + ' placed in 1 km2 (' + t.trees + ' trees, ' + t.bushes + ' bushes), ' + (100 * t.placed / ceiling).toFixed(2) + '% of the ceiling; ' + t.rocks + ' rocks from ' + t.rockCells + ' cells, ' + (100 * t.rocks / rockCeiling).toFixed(2) + '% of the rock ceiling')
  console.log('spoint world ' + WORLD + ', radius ' + tcfg.radius + ' m, seed ' + worldSeed + ', reliefScale ' + tcfg.reliefScale + ', ' + tiles.length + ' tiles of 1 km2 around the anchor')
  console.log('realised per km2: mean ' + meanPerKm2.toFixed(1) + ', min ' + perKm2[0] + ', median ' + perKm2[Math.floor(perKm2.length / 2)] + ', max ' + perKm2[perKm2.length - 1] + '; bushes ' + (100 * totalBushes / Math.max(1, totalPlaced)).toFixed(1) + '% of the placements')
  console.log('rocks realised per km2: mean ' + meanRocksPerKm2.toFixed(1) + ', min ' + rocksPerKm2[0] + ', median ' + rocksPerKm2[Math.floor(rocksPerKm2.length / 2)] + ', max ' + rocksPerKm2[rocksPerKm2.length - 1] + '; jayzee value ' + rockCeiling + ' per km2 (' + POPULATION_DENSITY_PER_KM2.rocks.kind + '); realised mean is ' + (100 * meanRocksPerKm2 / rockCeiling).toFixed(2) + '% of it')
  console.log('jayzee value ' + ceiling + ' per km2 (' + POPULATION_DENSITY_PER_KM2.trees.kind + '); realised mean is ' + (100 * meanPerKm2 / ceiling).toFixed(2) + '% of it; wall ' + wallMs + ' ms')

  gate('spoint VegPlacement imports in Node and its constants are the ones jayzee derived its ceiling from', () => {
    assert.equal(VEG.CELL, VEG_CELL_M)
    assert.equal(VEG.CHUNK, VEG.CELL * VEG.GRID)
    assert.equal(baseDensity(1, 1, 0), VEG_BASE_DENSITY_CEILING)
    assert.equal(ceiling, Math.round(VEG_BASE_DENSITY_CEILING * cellsPerKm2))
    assert.equal(ROCK.CELL, ROCK_CELL_M)
    assert.equal(rockCeiling, (1000 / ROCK_CELL_M) ** 2)
  })

  gate('every tile is covered: the chunks tried hold at least the 62,500 cells of one square kilometre', () => {
    for (const t of tiles) assert.ok(t.cells >= cellsPerKm2, 'tile ' + t.x0 + ',' + t.z0 + ' tried ' + t.cells + ' cells')
  })

  gate('the realised spoint vegetation and rock densities are at or below the jayzee ceilings on every tile, and vegetation is at or below one placement per cell', () => {
    for (const t of tiles) {
      assert.ok(t.placed <= cellsPerKm2, 'tile ' + t.x0 + ',' + t.z0 + ' placed ' + t.placed)
      assert.ok(t.placed <= ceiling, 'tile ' + t.x0 + ',' + t.z0 + ' placed ' + t.placed + ', above ' + ceiling)
      assert.ok(t.rocks <= rockCeiling, 'tile ' + t.x0 + ',' + t.z0 + ' placed ' + t.rocks + ' rocks, above ' + rockCeiling)
    }
  })

  finish()
}
