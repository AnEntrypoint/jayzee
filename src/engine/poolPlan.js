export const BODY_POOL_CAPACITY = Object.freeze({ standard: 2048, large: 12288 })

export const bodyPoolCapacity = (players) => {
  if (!Number.isInteger(players) || players < 1) throw new RangeError('players must be a whole number at least 1')
  return players >= 1024 ? BODY_POOL_CAPACITY.large : BODY_POOL_CAPACITY.standard
}
