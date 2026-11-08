export function simulateTickSteps(steps, tick, dt, players, explicitInputs = null) {
  steps.movement(players, tick, dt, explicitInputs)
  steps.playerCollisions(players, dt)
  if (typeof steps.drainBodyQueue === 'function') steps.drainBodyQueue()
  if (explicitInputs === null) steps.chartReanchor(tick)
  steps.physicsStep(dt)
  steps.appRuntimeTick(tick, dt)
}

export const snapshotDue = (playerCount, tick, snapshotInterval) => playerCount > 0 && tick % snapshotInterval === 0

export function runTickOrder(steps, tick, dt, explicitInputs = null) {
  steps.beginTick(tick)
  steps.setTick(tick)
  const players = steps.connectedPlayers()
  steps.updateStall(players)
  steps.adjustSnapshotRate(tick, players)
  simulateTickSteps(steps, tick, dt, players, explicitInputs)
  if (steps.hasConnections) steps.collisionTiles(tick, players)
  if (snapshotDue(players.length, tick, steps.snapshotInterval())) steps.snapshot(tick, players)
  return players
}
