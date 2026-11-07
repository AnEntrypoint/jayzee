import {
  LOCKSTEP_CTRL_PREFIX,
  controlFrameHandlers,
  dispatchControlFrame,
  encodeControlFrame,
  parseControlFrame,
} from '../control-frame-pure/controlFrame.js'

export { LOCKSTEP_CTRL_PREFIX }

export const encodeLockstepFrame = (frame) => encodeControlFrame(LOCKSTEP_CTRL_PREFIX, frame)

export const parseLockstepFrame = (data) => parseControlFrame(LOCKSTEP_CTRL_PREFIX, data)

export const lockstepFrameArms = (handlers) => controlFrameHandlers(LOCKSTEP_CTRL_PREFIX, handlers)

export const dispatchLockstepFrame = (arms, data, { from = null, selfId = null, clock, onReject = null, onOrder = null }) =>
  dispatchControlFrame(LOCKSTEP_CTRL_PREFIX, arms, data, onReject, { from, selfId, clock, onOrder, tickOf: (frame) => frame.tick })
