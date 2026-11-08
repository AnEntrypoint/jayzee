import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { runTickOrder, simulateTickSteps, snapshotDue } from '../src/tick-authority-pure/tickOrder.js'

const recorder = ({ players = [{ id: 'a' }, { id: 'b' }], hasConnections = true, snapshotInterval = 3, noDrain = false } = {}) => {
  const trace = []
  const steps = {
    beginTick: (tick) => trace.push(['beginTick', tick]),
    setTick: (tick) => trace.push(['setTick', tick]),
    connectedPlayers: () => { trace.push(['connectedPlayers']); return players },
    updateStall: (list) => trace.push(['updateStall', list.length]),
    adjustSnapshotRate: (tick, list) => trace.push(['adjustSnapshotRate', tick, list.length]),
    movement: (list, tick, dt, inputs) => trace.push(['movement', list.length, tick, dt, inputs]),
    playerCollisions: (list, dt) => trace.push(['playerCollisions', list.length, dt]),
    drainBodyQueue: () => trace.push(['drainBodyQueue']),
    chartReanchor: (tick) => trace.push(['chartReanchor', tick]),
    physicsStep: (dt) => trace.push(['physicsStep', dt]),
    appRuntimeTick: (tick, dt) => trace.push(['appRuntimeTick', tick, dt]),
    hasConnections,
    collisionTiles: (tick, list) => trace.push(['collisionTiles', tick, list.length]),
    snapshotInterval: () => snapshotInterval,
    snapshot: (tick, list) => trace.push(['snapshot', tick, list.length]),
  }
  if (noDrain) delete steps.drainBodyQueue
  return { steps, trace }
}

const DT = 1 / 60

gate('simulate runs movement, player collisions, body drain, re-anchor, physics, then the app tick', () => {
  const { steps, trace } = recorder()
  simulateTickSteps(steps, 7, DT, [{ id: 'a' }, { id: 'b' }])
  assert.deepEqual(trace, [
    ['movement', 2, 7, DT, null],
    ['playerCollisions', 2, DT],
    ['drainBodyQueue'],
    ['chartReanchor', 7],
    ['physicsStep', DT],
    ['appRuntimeTick', 7, DT],
  ])
})

gate('explicit inputs reach movement and skip the chart re-anchor', () => {
  const { steps, trace } = recorder()
  simulateTickSteps(steps, 7, DT, [{ id: 'a' }], { buttons: 1 })
  assert.deepEqual(trace, [
    ['movement', 1, 7, DT, { buttons: 1 }],
    ['playerCollisions', 1, DT],
    ['drainBodyQueue'],
    ['physicsStep', DT],
    ['appRuntimeTick', 7, DT],
  ])
})

gate('a physics without drainBodyQueue skips the drain and still steps physics', () => {
  const { steps, trace } = recorder({ noDrain: true })
  simulateTickSteps(steps, 4, DT, [])
  assert.deepEqual(trace.map(([name]) => name), ['movement', 'playerCollisions', 'chartReanchor', 'physicsStep', 'appRuntimeTick'])
})

gate('a reversed collision and physics order is a different trace, so the pin above is order-sensitive', () => {
  const { steps, trace } = recorder()
  simulateTickSteps(steps, 7, DT, [])
  const reversed = ['movement', 'physicsStep', 'playerCollisions', 'drainBodyQueue', 'chartReanchor', 'appRuntimeTick']
  assert.notDeepEqual(trace.map(([name]) => name), reversed)
})

gate('runTickOrder runs begin, set tick, players, stall, rate, simulate, tiles, snapshot in that order', () => {
  const { steps, trace } = recorder()
  const players = runTickOrder(steps, 6, DT)
  assert.deepEqual(trace.map(([name]) => name), [
    'beginTick',
    'setTick',
    'connectedPlayers',
    'updateStall',
    'adjustSnapshotRate',
    'movement',
    'playerCollisions',
    'drainBodyQueue',
    'chartReanchor',
    'physicsStep',
    'appRuntimeTick',
    'collisionTiles',
    'snapshot',
  ])
  assert.deepEqual(trace.find(([name]) => name === 'snapshot'), ['snapshot', 6, 2])
  assert.deepEqual(players, [{ id: 'a' }, { id: 'b' }])
})

gate('runTickOrder with connections runs collision tiles even with no players, and no snapshot', () => {
  const { steps, trace } = recorder({ players: [] })
  runTickOrder(steps, 6, DT)
  assert.deepEqual(trace.filter(([name]) => name === 'collisionTiles'), [['collisionTiles', 6, 0]])
  assert.equal(trace.some(([name]) => name === 'snapshot'), false)
})

gate('runTickOrder without connections never runs collision tiles', () => {
  const { steps, trace } = recorder({ hasConnections: false })
  runTickOrder(steps, 6, DT)
  assert.equal(trace.some(([name]) => name === 'collisionTiles'), false)
  assert.equal(trace.some(([name]) => name === 'snapshot'), true)
})

gate('a snapshot is due only on a tick that is a multiple of the interval, with at least one player', () => {
  assert.equal(snapshotDue(2, 6, 3), true)
  assert.equal(snapshotDue(2, 7, 3), false)
  assert.equal(snapshotDue(0, 6, 3), false)
  assert.equal(snapshotDue(1, 0, 3), true)
})

gate('runTickOrder skips the snapshot on a non-due tick and reports the same players it simulated', () => {
  const { steps, trace } = recorder()
  const players = runTickOrder(steps, 7, DT)
  assert.equal(trace.some(([name]) => name === 'snapshot'), false)
  assert.equal(players.length, 2)
})

finish()
