export const REMOTE_CHECKSUM_PAST_HORIZON_ROWS = 16

export function isInChecksumHorizon(tick, localTick, checksumIntervalTicks, maxPendingRows) {
  const local = localTick || 0
  const futureRows = maxPendingRows - REMOTE_CHECKSUM_PAST_HORIZON_ROWS - 1
  return tick <= local + futureRows * checksumIntervalTicks && tick > local - REMOTE_CHECKSUM_PAST_HORIZON_ROWS * checksumIntervalTicks
}
