import { AOI_CELL_BASE_MAX, AOI_CODE_EPOCH_LEN } from './constants.js'

export const AOI_EPOCH_CASE = Object.freeze({
  unset: 'unset',
  disabled: 'disabled',
  unrepresentable: 'unrepresentable',
  active: 'active',
})

export const AOI_EPOCH_REFUSAL = Object.freeze({
  codeEpochNotInstalled: 'codeEpochNotInstalled',
  mutationsNotACount: 'mutationsNotACount',
  relevanceRadiusNotPositive: 'relevanceRadiusNotPositive',
  planetRadiusNegative: 'planetRadiusNegative',
})

export const AOI_EPOCH_RADIUS_SOURCE = Object.freeze({
  index: 'index',
  caller: 'caller',
  callerAgainstIndex: 'callerAgainstIndex',
})

export const AOI_CELL_BASE_CASE = Object.freeze({
  hit: 'hit',
  miss: 'miss',
  stale: 'stale',
  unusable: 'unusable',
})

const AOI_EPOCH_UNSET = Object.freeze({ case: AOI_EPOCH_CASE.unset, key: null })
const AOI_EPOCH_DISABLED = Object.freeze({ case: AOI_EPOCH_CASE.disabled, key: null })
const AOI_CELL_BASE_MISS = Object.freeze({ case: AOI_CELL_BASE_CASE.miss })
const AOI_CELL_BASE_STALE = Object.freeze({ case: AOI_CELL_BASE_CASE.stale })
const AOI_CELL_BASE_UNUSABLE = Object.freeze({ case: AOI_CELL_BASE_CASE.unusable })

const REFUSAL_COUNTER = {
  [AOI_EPOCH_REFUSAL.codeEpochNotInstalled]: 'epochRefusedCodeEpochNotInstalled',
  [AOI_EPOCH_REFUSAL.mutationsNotACount]: 'epochRefusedMutationsNotACount',
  [AOI_EPOCH_REFUSAL.relevanceRadiusNotPositive]: 'epochRefusedRelevanceRadiusNotPositive',
  [AOI_EPOCH_REFUSAL.planetRadiusNegative]: 'epochRefusedPlanetRadiusNegative',
}

const refused = (refusal) => Object.freeze({ case: AOI_EPOCH_CASE.unrepresentable, refusal, key: null })

const radiusSource = (indexRadius, relevanceRadius) => {
  if (indexRadius === null) return AOI_EPOCH_RADIUS_SOURCE.caller
  return indexRadius === relevanceRadius ? AOI_EPOCH_RADIUS_SOURCE.index : AOI_EPOCH_RADIUS_SOURCE.callerAgainstIndex
}

export function createCellBaseCache({ codeEpoch = '', work }) {
  const entries = new Map()
  let installedCodeEpoch = codeEpoch
  let epoch = AOI_EPOCH_UNSET

  const parseEpoch = (mutations, relevanceRadius, planetRadius, indexRadius) => {
    if (installedCodeEpoch.length !== AOI_CODE_EPOCH_LEN) return refused(AOI_EPOCH_REFUSAL.codeEpochNotInstalled)
    if (!Number.isInteger(mutations) || mutations < 0) return refused(AOI_EPOCH_REFUSAL.mutationsNotACount)
    if (!Number.isFinite(relevanceRadius) || relevanceRadius <= 0) return refused(AOI_EPOCH_REFUSAL.relevanceRadiusNotPositive)
    if (!Number.isFinite(planetRadius) || planetRadius < 0) return refused(AOI_EPOCH_REFUSAL.planetRadiusNegative)
    const key = `${installedCodeEpoch}|${mutations}|${relevanceRadius}|${planetRadius}|${indexRadius}`
    if (epoch.case === AOI_EPOCH_CASE.active && epoch.key === key) return epoch
    return Object.freeze({
      case: AOI_EPOCH_CASE.active,
      key,
      codeEpoch: installedCodeEpoch,
      mutations,
      relevanceRadius,
      planetRadius,
      indexRadius,
      radiusSource: radiusSource(indexRadius, relevanceRadius),
    })
  }

  const invalidate = () => {
    epoch = AOI_EPOCH_UNSET
    entries.clear()
  }

  return {
    codeEpoch: () => installedCodeEpoch,
    cellBaseEpoch: () => epoch,
    size: () => entries.size,
    installCodeEpoch(next) {
      if (installedCodeEpoch !== next) {
        installedCodeEpoch = next
        entries.clear()
      }
      return next
    },
    invalidate,
    disable() {
      installedCodeEpoch = ''
      invalidate()
      epoch = AOI_EPOCH_DISABLED
    },
    setEpoch(relevanceRadius, planetRadius, spatial) {
      const mutations = spatial ? spatial.mutations : null
      const indexRadius = spatial && Number.isFinite(spatial.relevanceRadius) ? spatial.relevanceRadius : null
      epoch = parseEpoch(mutations, relevanceRadius, planetRadius, indexRadius)
      if (epoch.case !== AOI_EPOCH_CASE.active) {
        work.epochDrops += entries.size
        entries.clear()
        const counter = REFUSAL_COUNTER[epoch.refusal]
        if (counter !== undefined) work[counter]++
      }
      return epoch
    },
    read(key) {
      if (epoch.case !== AOI_EPOCH_CASE.active) { work.cellBaseUnusable++; return AOI_CELL_BASE_UNUSABLE }
      const hit = entries.get(key)
      if (hit === undefined) { work.cellBaseMisses++; return AOI_CELL_BASE_MISS }
      if (hit.epoch !== epoch) {
        entries.delete(key)
        work.epochDrops++
        work.cellBaseStaleDrops++
        return AOI_CELL_BASE_STALE
      }
      entries.delete(key)
      entries.set(key, hit)
      return hit
    },
    store(key, cellViewerPos, baseRelevantIds) {
      if (epoch.case !== AOI_EPOCH_CASE.active) return
      entries.set(key, { case: AOI_CELL_BASE_CASE.hit, epoch, cellViewerPos, baseRelevantIds })
      if (entries.size > AOI_CELL_BASE_MAX) {
        const oldest = entries.keys().next().value
        entries.delete(oldest)
        work.evictions++
      }
    },
  }
}
