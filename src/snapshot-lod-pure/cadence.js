import { PLAYER_LOD_REDUCED_HZ } from './constants.js'

const checkRate = (name, hz) => {
  if (!(typeof hz === 'number' && Number.isFinite(hz) && hz > 0)) throw new RangeError(name + ' must be a finite rate above zero')
}

export const reducedPoseDue = (tick, snapshotHz, reducedHz = PLAYER_LOD_REDUCED_HZ) => {
  if (!(Number.isSafeInteger(tick) && tick >= 0)) throw new RangeError('tick must be a whole number, zero or above')
  checkRate('snapshotHz', snapshotHz)
  checkRate('reducedHz', reducedHz)
  if (snapshotHz <= reducedHz) return true
  return Math.floor(((tick + 1) * reducedHz) / snapshotHz) !== Math.floor((tick * reducedHz) / snapshotHz)
}

export const reducedPosesIn = (firstTick, tickCount, snapshotHz, reducedHz = PLAYER_LOD_REDUCED_HZ) => {
  let sent = 0
  for (let tick = firstTick; tick < firstTick + tickCount; tick++) if (reducedPoseDue(tick, snapshotHz, reducedHz)) sent++
  return sent
}
