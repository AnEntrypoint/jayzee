import { PLANET_RADIUS_M } from './sphere.js'
import { placePopulation } from './population.js'
import { densityFor } from './populationDensity.js'

export const createEngineHeightAt = (module, radiusM = PLANET_RADIUS_M) => {
  if (typeof module?._engine_planet_height !== 'function') {
    throw new TypeError('createEngineHeightAt needs a module with _engine_planet_height, the patch height store the rendered terrain reads')
  }
  return (n) => module._engine_planet_height(n[0] * radiusM, n[1] * radiusM, n[2] * radiusM)
}

export const placeOnPlanet = ({ module, seed, category, centreLatRad, centreLonRad, capRad, radiusM = PLANET_RADIUS_M }) => {
  const heightAt = createEngineHeightAt(module, radiusM)
  return placePopulation({ seed, densityPerKm2: densityFor(category), centreLatRad, centreLonRad, capRad, radiusM, heightAt })
}
