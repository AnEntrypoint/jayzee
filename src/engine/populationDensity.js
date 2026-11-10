const PER_KM2_SIDE_M = 1000

const cellsPerKm2 = (cellM) => (PER_KM2_SIDE_M / cellM) * (PER_KM2_SIDE_M / cellM)

export const VEG_CELL_M = 4
export const ROCK_CELL_M = 8
export const VEG_BASE_DENSITY_CEILING = 0.85
export const ROCK_PROBABILITY_CEILING = 1

export const POPULATION_DENSITY_PER_KM2 = Object.freeze({
  trees: Object.freeze({
    value: Math.round(VEG_BASE_DENSITY_CEILING * cellsPerKm2(VEG_CELL_M)),
    kind: 'upper bound',
    source: '/workspace/spoint/src/terrain/VegPlacement.js: CELL 4, BASE_DENSITY_CEILING = baseDensity(1,1,0) = 0.12 + 0.73 = 0.85',
    method: 'one candidate per 4 m cell (250 by 250 cells per km2 = 62,500), accepted with probability baseDensity, capped by the ceiling 0.85; the grove, soil and paint multipliers in the accept test are data-dependent and not in the repo, so the realised density is this value times those multipliers and is not derived here',
  }),
  rocks: Object.freeze({
    value: Math.round(ROCK_PROBABILITY_CEILING * cellsPerKm2(ROCK_CELL_M)),
    kind: 'upper bound',
    source: '/workspace/spoint/src/terrain/RockPlacement.js: CELL 8, rockDensity clamped to 1, ROCK.FLOOR 0.025',
    method: 'one candidate per 8 m cell (125 by 125 cells per km2 = 15,625), accepted with probability rockDensity times patch times cluster, capped at 1; realised density is at or below this value',
  }),
  buildings: Object.freeze({
    value: 0,
    kind: 'no placement path',
    source: '/workspace/spoint/src/terrain (no building placement; grep for buildings finds none in the terrain sources)',
    method: 'spoint places no buildings procedurally, so the procedural population has zero buildings per km2',
  }),
  props: Object.freeze({
    value: 0,
    kind: 'authored only',
    source: '/workspace/spoint/data/placed-models.json: 4 entries, authored positions, no recorded area',
    method: 'props are authored in spoint, not scattered, and the map area is not recorded in the repo, so no per-km2 count exists; the procedural population uses zero and the 4 authored props are placed by the scene, not by this population',
  }),
})

export const densityFor = (category) => {
  const entry = POPULATION_DENSITY_PER_KM2[category]
  if (entry === undefined) throw new RangeError('unknown population category: ' + category)
  return entry.value
}
