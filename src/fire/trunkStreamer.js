const EMPTY_KEY = -1

export function createTrunkStreamer({ capacity, maxChunks }) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`[fire] the trunk streamer needs a positive integer capacity, got ${String(capacity)}`)
  if (!Number.isInteger(maxChunks) || maxChunks < 1) throw new RangeError(`[fire] the trunk streamer needs a positive integer maxChunks, got ${String(maxChunks)}`)
  const cellIds = new Float64Array(capacity)
  const stages = new Uint8Array(capacity)
  const positions = new Float32Array(capacity * 3)
  const chunkSlot = new Int32Array(capacity)
  const chunkKeys = new Float64Array(maxChunks).fill(EMPTY_KEY)
  const chunkCounts = new Int32Array(maxChunks)
  const stats = { loads: 0, unloads: 0, refusedFull: 0, refusedChunks: 0, stageWrites: 0 }
  let count = 0
  let chunks = 0
  let generation = 0

  function slotOf(key) {
    for (let s = 0; s < maxChunks; s++) if (chunkKeys[s] === key) return s
    return -1
  }

  function checkIndex(i) {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new RangeError(`[fire] trunk index ${String(i)} is outside the ${count} loaded trunks`)
  }

  function loadChunk(key, placements) {
    if (!Number.isSafeInteger(key) || key < 0) throw new RangeError(`[fire] a trunk chunk key is a non-negative integer, got ${String(key)}`)
    if (!Array.isArray(placements)) throw new TypeError('[fire] loadChunk needs the placement records of the chunk in an array')
    if (slotOf(key) !== -1) throw new RangeError(`[fire] trunk chunk ${key} is already loaded`)
    for (let p = 0; p < placements.length; p++) {
      const id = placements[p].trunkId
      if (!Number.isSafeInteger(id) || id < 0) throw new TypeError(`[fire] placement ${p} of chunk ${key} has trunkId ${String(id)}: a trunk carries the id of its placement cell`)
    }
    const slot = slotOf(EMPTY_KEY)
    if (slot === -1) { stats.refusedChunks++; return false }
    if (count + placements.length > capacity) { stats.refusedFull++; return false }
    for (let p = 0; p < placements.length; p++) {
      const record = placements[p]
      const i = count + p
      cellIds[i] = record.trunkId
      stages[i] = 0
      positions[i * 3] = record.x
      positions[i * 3 + 1] = record.y
      positions[i * 3 + 2] = record.z
      chunkSlot[i] = slot
    }
    count += placements.length
    chunkKeys[slot] = key
    chunkCounts[slot] = placements.length
    chunks++
    generation++
    stats.loads++
    return true
  }

  function unloadChunk(key) {
    const slot = slotOf(key)
    if (slot === -1 || key === EMPTY_KEY) return false
    let write = 0
    for (let read = 0; read < count; read++) {
      if (chunkSlot[read] === slot) continue
      if (write !== read) {
        cellIds[write] = cellIds[read]
        stages[write] = stages[read]
        positions[write * 3] = positions[read * 3]
        positions[write * 3 + 1] = positions[read * 3 + 1]
        positions[write * 3 + 2] = positions[read * 3 + 2]
        chunkSlot[write] = chunkSlot[read]
      }
      write++
    }
    count = write
    chunkKeys[slot] = EMPTY_KEY
    chunkCounts[slot] = 0
    chunks--
    generation++
    stats.unloads++
    return true
  }

  return {
    capacity,
    maxChunks,
    stats,
    stages,
    positions,
    get count() { return count },
    get generation() { return generation },
    get chunkCount() { return chunks },
    hasChunk: (key) => key !== EMPTY_KEY && slotOf(key) !== -1,
    cellIdAt(i) { checkIndex(i); return cellIds[i] },
    stageAt(i) { checkIndex(i); return stages[i] },
    setBurnStage(i, stage) {
      checkIndex(i)
      if (!Number.isInteger(stage) || stage < 0 || stage > 255) throw new RangeError(`[fire] a burn stage is a byte, got ${String(stage)}`)
      stages[i] = stage
      stats.stageWrites++
    },
    loadChunk,
    unloadChunk,
  }
}
