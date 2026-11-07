import { GAP_WAIT_MAX_TICKS, INPUT_STEP_BANK } from './constants.js'

export function accrueStepBudget(player, tickMs, stepsTaken, now = performance.now()) {
  const elapsedSteps = player.inputBudgetAt ? (now - player.inputBudgetAt) / tickMs : 1
  player.inputBudgetAt = now
  player.inputStepBudget = Math.max(-1, Math.min(INPUT_STEP_BANK, (player.inputStepBudget || 0) + elapsedSteps - stepsTaken))
}

export function sequenceGapAhead(player, inputs) {
  const next = inputs[0].sequence
  return next != null && !!player.ackSequence && next > player.ackSequence + 1
}

export function waitForSequenceGap(player, inputs) {
  if (!sequenceGapAhead(player, inputs)) {
    player.gapWaitTicks = 0
    return false
  }
  if ((player.gapWaitTicks || 0) >= GAP_WAIT_MAX_TICKS) {
    player.gapWaitTicks = 0
    player.inputGapsSkipped = (player.inputGapsSkipped || 0) + (inputs[0].sequence - player.ackSequence - 1)
    return false
  }
  player.gapWaitTicks = (player.gapWaitTicks || 0) + 1
  return true
}

export function neutralInput(last) {
  return { yaw: last.yaw || 0, pitch: last.pitch || 0, crouch: !!last.crouch, expr: last.expr || 0 }
}

export function takeNextInput(player, inputs) {
  const next = inputs.shift()
  player.lastInput = next.data
  if (next.sequence != null) player.ackSequence = next.sequence
  player.hasSentInput = true
}
