import { HISTORY_CAPACITY } from './lagCompensation.js'
import { reexpressYawQuat } from '../client/chartReexpress.js'

const TRANSFER_METHODS = ['point', 'vec', 'look']

export function applyChartTransfer(compensator, transfer) {
  if (!compensator || !(compensator.playerHistory instanceof Map)) throw new TypeError('applyChartTransfer needs a LagCompensator with a playerHistory map')
  const missing = TRANSFER_METHODS.filter((name) => typeof transfer?.[name] !== 'function')
  if (missing.length > 0) throw new TypeError(`applyChartTransfer needs a chart transfer with ${missing.join(', ')}`)
  let samples = 0
  for (const ring of compensator.playerHistory.values()) {
    for (let i = 0; i < ring.len; i++) {
      const sample = ring.buf[(ring.head + i) % HISTORY_CAPACITY]
      transfer.point(sample.position, sample.position)
      transfer.vec(sample.velocity, sample.velocity)
      reexpressYawQuat(transfer, sample.rotation)
      samples++
    }
  }
  return samples
}
