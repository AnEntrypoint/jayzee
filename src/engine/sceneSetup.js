import { planetCellSize } from './pageLayout.js'
import { readLayout } from './bridge.js'
import { solverIterationsFor } from './solverIterations.js'

export const PLANET_RADIUS_M = 6371000
export const PLANET = Object.freeze({ radius: PLANET_RADIUS_M, cellSize: planetCellSize(PLANET_RADIUS_M), gravity: 9.8, maxHeight: 8000 })
export const GROUND = Object.freeze([-200, -1, -200, 200, 0, 200])
export const TIER_1024 = Object.freeze({ players: 1024, bodies: 10240, capacity: 10240, tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0 })
export const BODY_SPACING_M = 1.2

export const configureWorld = (module, solverIterations = solverIterationsFor(readLayout(module).players), baseY = 0) => {
  const status = module._engine_world_configure(TIER_1024.capacity, TIER_1024.tickRate, TIER_1024.gravity, TIER_1024.drag, TIER_1024.radius, TIER_1024.restitution, solverIterations)
  if (status !== 0) throw new Error('world configure status ' + status)
  if (baseY === 0) module._engine_world_add_box(...GROUND)
  for (let i = 0; i < TIER_1024.bodies; i++) module._engine_spawn((i % 100) * BODY_SPACING_M - 30, baseY + 1 + (i % 5), Math.floor(i / 100) * BODY_SPACING_M - 30, 0, 0, 0)
  return solverIterations
}

export const configurePlanet = (module) => {
  const status = module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight)
  if (status !== 0) throw new Error('planet configure status ' + status)
  return planetSurface(module)
}

export const planetSurface = (module) => {
  const at = module._engine_frame_scratch() >> 3
  const heap = module.HEAPF64
  const height = (x, z) => {
    heap[at] = x
    heap[at + 1] = PLANET.radius
    heap[at + 2] = z
    module._engine_planet_height_scratch()
    return heap[at + 3]
  }
  const anchor = height(0, 0)
  return (x, z) => height(x, z) - anchor
}

export const locateCell = (module, x, y, z, out) => {
  module._engine_planet_locate(x, y, z)
  const at = module._engine_planet_scratch() >> 2
  out.face = module.HEAPU32[at]
  out.cx = module.HEAPU32[at + 1]
  out.cy = module.HEAPU32[at + 2]
  return out
}

export const cellOf = (module, x, y, z) => locateCell(module, x, y, z, { face: 0, cx: 0, cy: 0 })
