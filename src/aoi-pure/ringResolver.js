import { createCellBaseCache, AOI_CELL_BASE_CASE } from './cellBaseCache.js'
import { flatCellKey, solveCellViewer } from './cellKeys.js'
import { STARVATION_MAX_TICKS } from './constants.js'
import { neighborCells, packCellKey } from './cubeSphereCells.js'
import { ENTITY_POSITION_CASE, withinAnyGate } from './entityPosition.js'

export function createRingResolver({ codeEpoch = '', work, host }) {
  const cellBase = createCellBaseCache({ codeEpoch, work })
  const spatialCache = new Map()
  const ringCache = new Map()

  const gateToCell = (relevantIds, cellViewerPos, planetRadius, relevanceRadius) => {
    const radiusSquared = relevanceRadius * relevanceRadius
    const gate = [cellViewerPos[0], cellViewerPos[1], cellViewerPos[2]]
    const kept = new Set()
    for (const id of relevantIds) {
      const found = host.positionOf(id)
      if (found.case !== ENTITY_POSITION_CASE.position || withinAnyGate(found.position, gate, planetRadius, radiusSquared)) kept.add(id)
    }
    return kept
  }

  const cellEntry = (face, cx, cy, key, planetRadius, relevanceRadius) => {
    const cached = spatialCache.get(key)
    if (cached) { work.cellHits++; return cached }
    work.cellComputes++
    work.statefulQueries += 1
    const base = cellBase.read(key)
    let cellViewerPos, baseRelevantIds
    if (base.case === AOI_CELL_BASE_CASE.hit) {
      cellViewerPos = base.cellViewerPos
      baseRelevantIds = base.baseRelevantIds
      work.cellBaseHits++
    } else {
      work.cellBaseComputes++
      work.cellCentreSolves++
      cellViewerPos = solveCellViewer(face, cx, cy, planetRadius, relevanceRadius)
      baseRelevantIds = host.baseRelevantIds(cellViewerPos, planetRadius, relevanceRadius)
      cellBase.store(key, cellViewerPos, baseRelevantIds)
    }
    let relevantIds = host.dynamicRelevantIds(cellViewerPos, relevanceRadius, key, STARVATION_MAX_TICKS, baseRelevantIds)
    if (relevantIds instanceof Set && relevantIds.size > baseRelevantIds.length) {
      relevantIds = gateToCell(relevantIds, cellViewerPos, planetRadius, relevanceRadius)
    }
    const entry = { relevantIds, cellViewerPos, baseRelevantIds }
    spatialCache.set(key, entry)
    return entry
  }

  const computeRingRelevantIds = (cellKey, cellFace, cellCx, cellCy, cellsPerFace, planetRadius, relevanceRadius) => {
    const cachedRing = ringCache.get(cellKey)
    if (cachedRing) { work.ringHits++; return cachedRing }
    work.ringComputes++
    const relevantSet = new Set()
    const addCell = (face, cx, cy, key) => {
      for (const id of cellEntry(face, cx, cy, key, planetRadius, relevanceRadius).relevantIds) relevantSet.add(id)
    }
    if (planetRadius > 0) {
      work.neighbourCellsCalls++
      for (const n of neighborCells(cellFace, cellCx, cellCy, cellsPerFace)) {
        addCell(n.face, n.cx, n.cy, packCellKey(n.face, n.cx, n.cy, cellsPerFace))
      }
    } else {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue
          const ncx = cellCx + dx, ncy = cellCy + dy
          addCell(-1, ncx, ncy, flatCellKey(ncx, ncy))
        }
      }
    }
    const ring = { relevantIds: relevantSet }
    ringCache.set(cellKey, ring)
    return ring
  }

  return {
    cellBase,
    computeRingRelevantIds,
    spatialCacheSize: () => spatialCache.size,
    ringCacheSize: () => ringCache.size,
  }
}
