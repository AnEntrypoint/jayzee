export const STATIC_TILE_M = 16
export const STATIC_TILE_MARGIN_M = 3
export const STATIC_COLUMN_HALF_Y_M = 10000
export const STATIC_MAX_TILES_PER_BODY = 256

export function staticTileKey(tx, tz) {
  return tx + ',' + tz
}

export function staticTileSpan(bounds, tileM = STATIC_TILE_M, marginM = STATIC_TILE_MARGIN_M) {
  const excluded = bounds.minY > STATIC_COLUMN_HALF_Y_M || bounds.maxY < -STATIC_COLUMN_HALF_Y_M
  const tx0 = Math.floor((bounds.minX - marginM) / tileM)
  const tx1 = Math.floor((bounds.maxX + marginM) / tileM)
  const tz0 = Math.floor((bounds.minZ - marginM) / tileM)
  const tz1 = Math.floor((bounds.maxZ + marginM) / tileM)
  const big = !excluded && (tx1 - tx0 + 1) * (tz1 - tz0 + 1) > STATIC_MAX_TILES_PER_BODY
  return { excluded, big, tx0, tx1, tz0, tz1 }
}

export function staticTileKeysOf(span) {
  const keys = []
  for (let tx = span.tx0; tx <= span.tx1; tx++) {
    for (let tz = span.tz0; tz <= span.tz1; tz++) keys.push(staticTileKey(tx, tz))
  }
  return keys
}

export function staticTileExtent(tx, tz, tileM = STATIC_TILE_M, marginM = STATIC_TILE_MARGIN_M) {
  const x0 = tx * tileM
  const z0 = tz * tileM
  return {
    min: [x0 - marginM, -STATIC_COLUMN_HALF_Y_M, z0 - marginM],
    max: [x0 + tileM + marginM, STATIC_COLUMN_HALF_Y_M, z0 + tileM + marginM],
  }
}
