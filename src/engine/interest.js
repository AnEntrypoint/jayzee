export const INTEREST = Object.freeze({
  HEADER_BYTES: 16,
  INDEX_BYTES: 4,
  ENTITY_BYTES: 29,
  RECORD_BYTES: 33,
  REMOVED_BYTES: 4,
  CLIENT_BYTES: 20,
})

export const createInterest = (module, layout) => {
  const players = layout.players
  const segmentBytes = module._engine_snapshot_capacity_bytes()
  const base = module._engine_snapshot_offset(0)
  const bytes = module.HEAPU8.subarray(base, base + players * segmentBytes)

  return Object.freeze({
    bytes,
    base,
    segmentBytes,
    configure(players, cellSize, originX, originZ, cellsPerSide, radiusCells) {
      return module._engine_interest_configure(players, cellSize, originX, originZ, cellsPerSide, radiusCells)
    },
    setClient(slot, x, z, active) {
      return module._engine_interest_set_client(slot, x, z, active ? 1 : 0)
    },
    update(tick) {
      return module._engine_interest_update(tick)
    },
    visibleCount(slot) {
      return module._engine_interest_visible_count(slot)
    },
    truncated() {
      return module._engine_interest_truncated()
    },
    outside() {
      return module._engine_interest_outside()
    },
    encode(slot, baselineTick) {
      return module._engine_snapshot_encode(slot, baselineTick)
    },
    segmentOffset(slot) {
      return module._engine_snapshot_offset(slot)
    },
  })
}
