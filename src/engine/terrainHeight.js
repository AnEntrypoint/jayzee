import { PLANET_RADIUS_M } from './sphere.js'
import { placePopulation } from './population.js'
import { densityFor } from './populationDensity.js'

export const createEngineHeightAt = (module, radiusM = PLANET_RADIUS_M) => {
  if (typeof module?._engine_planet_height !== 'function') {
    throw new TypeError('createEngineHeightAt needs a module with _engine_planet_height, the patch height store the rendered terrain reads')
  }
  return (n) => module._engine_planet_height(n[0] * radiusM, n[1] * radiusM, n[2] * radiusM)
}

export const canEngineHeightInto = (module) => typeof module?._engine_planet_height_scratch === 'function' && typeof module?._engine_frame_scratch === 'function' && module.HEAPF64 !== undefined

export const createEngineHeightInto = (module, radiusM = PLANET_RADIUS_M) => {
  if (!canEngineHeightInto(module)) {
    throw new TypeError('createEngineHeightInto needs a module with _engine_planet_height_scratch, _engine_frame_scratch and HEAPF64')
  }
  const at = module._engine_frame_scratch() >> 3
  return (n, out) => {
    const heap = module.HEAPF64
    heap[at] = n[0] * radiusM
    heap[at + 1] = n[1] * radiusM
    heap[at + 2] = n[2] * radiusM
    module._engine_planet_height_scratch()
    out[0] = heap[at + 3]
  }
}

export const placeOnPlanet = ({ module, seed, category, centreLatRad, centreLonRad, capRad, radiusM = PLANET_RADIUS_M }) => {
  const heightAt = createEngineHeightAt(module, radiusM)
  return placePopulation({ seed, densityPerKm2: densityFor(category), centreLatRad, centreLonRad, capRad, radiusM, heightAt })
}
