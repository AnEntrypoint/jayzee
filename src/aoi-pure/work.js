export const AOI_WORK_COUNTERS = Object.freeze([
  'ringComputes',
  'ringHits',
  'cellComputes',
  'cellHits',
  'cellCentreSolves',
  'neighbourCellsCalls',
  'cellBaseComputes',
  'cellBaseHits',
  'cellBaseMisses',
  'cellBaseStaleDrops',
  'cellBaseUnusable',
  'statefulQueries',
  'evictions',
  'epochDrops',
  'epochRefusedCodeEpochNotInstalled',
  'epochRefusedMutationsNotACount',
  'epochRefusedRelevanceRadiusNotPositive',
  'epochRefusedPlanetRadiusNegative',
  'positionOfEntityResolves',
  'positionOfEntityNoPosition',
  'positionOfEntityUnknownEntity',
])

export function createAoiWork() {
  return Object.fromEntries(AOI_WORK_COUNTERS.map((name) => [name, 0]))
}

export function resetAoiWork(work) {
  for (const name of Object.keys(work)) work[name] = 0
  return work
}
