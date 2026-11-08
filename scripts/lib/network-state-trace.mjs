const snap = (value) => (value === undefined ? 'undefined' : JSON.parse(JSON.stringify(value)))

export const makeClock = () => {
  let t = 0
  return { now: () => t, set: (value) => { t = value } }
}

const attempt = (fn) => {
  try {
    return fn()
  } catch (error) {
    return { error: error.constructor.name, message: error.message }
  }
}

export const runNetworkStateTrace = (makeState, clock, guard) => {
  const steps = []
  const log = (label, value) => steps.push([label, snap(value)])
  const state = makeState(clock)

  clock.set(1000)
  state.addPlayer(1)
  log('addPlayer with no state stamps lastUpdate and applies the defaults', state.getPlayer(1))

  state.addPlayer(2, { position: [1, 2, 3], rotation: [0, 0, 0, 1], velocity: [0.5, 0, 0], onGround: true, health: 0, crouch: 1, lookPitch: 0.25, lookYaw: -1, expr: 3, weapon: 2 })
  log('addPlayer keeps an explicit health of zero and the given pose', state.getPlayer(2))

  state.addPlayer(3, { onGround: 0, health: null })
  log('addPlayer keeps a falsy onGround and treats a null health as absent', state.getPlayer(3))

  clock.set(1100)
  state.setTick(5)
  log('setTick without a timestamp takes the clock', { tick: state.tick, timestamp: state.timestamp })

  state.updatePlayer(1, [1, 2, 3], [0, 0, 0, 1], [0, 0, 0], true, 90, 7, 1, 0.1, 0.2, undefined, undefined)
  log('updatePlayer with valid vectors and no expr or weapon zeroes both', state.getPlayer(1))

  state.updatePlayer(2, [1, 2], [0, 0, 0, 1], [1, 'x', 3], false, 80, 8, 0, 0, 0, 2, 1, [0, 1, 0], [[0, 0, 1]])
  log('updatePlayer keeps the previous position and velocity when they are invalid', state.getPlayer(2))

  state.updatePlayer(2, [1, Infinity, 3], [0, 0, 0, 1, 1], [0, 0, 0], true, 70, 9, 0, 0, 0, 0, 0)
  log('updatePlayer refuses a non-finite position and a five-element rotation', state.getPlayer(2))

  state.updatePlayer(99, [0, 0, 0], [0, 0, 0, 1], [0, 0, 0], false, 1, 1, 0, 0, 0, 0, 0)
  log('updatePlayer on an unknown id changes nothing', state.getAllPlayers().map((p) => p.id))

  log('getSnapshot copies every player with the tick and timestamp', state.getSnapshot())
  log('getSnapshot returns one reused output object', state.getSnapshot() === state.getSnapshot())

  clock.set(2000)
  state.addPlayer(4)
  state.setTick(6, 2500)
  log('addPlayer after a clock move stamps the new time, and setTick takes an explicit timestamp', { p4: state.getPlayer(4), tick: state.tick, timestamp: state.timestamp })

  state.removePlayer(3)
  log('getSnapshot prunes a removed player from the pooled list', state.getSnapshot())

  const saved = state.snapshotState()
  log('snapshotState holds a copy of each player', { tick: saved.tick, timestamp: saved.timestamp, players: [...saved.players.entries()] })

  state.updatePlayer(1, [9, 9, 9], [0, 0, 0, 1], [0, 0, 0], false, 10, 99, 0, 0, 0, 0, 0)
  state.setTick(7, 3000)
  state.restoreState(saved)
  log('restoreState puts back the saved tick, timestamp and players', { tick: state.tick, timestamp: state.timestamp, p1: state.getPlayer(1) })

  state.restoreState({ tick: 9, timestamp: 9000, players: { 2: { id: 2, health: 33 }, 77: { id: 77, health: 1 } } })
  log('restoreState from a plain object restores known ids only', { tick: state.tick, p2: state.getPlayer(2), p77: state.getPlayer(77) })

  state.restoreState({ tick: 10, timestamp: 10000, players: new Map([[4, { id: 4, health: 5 }]]) })
  log('restoreState from a Map restores its ids', { tick: state.tick, p4: state.getPlayer(4) })

  log('getAllPlayers lists the live players in insertion order', state.getAllPlayers().map((p) => p.id))

  state.clear()
  log('clear removes every player and keeps the tick', { players: state.getAllPlayers(), tick: state.tick, p1: state.getPlayer(1) })
  log('getSnapshot after clear has no players', state.getSnapshot())

  const inputs = [[1, 2, 3], [1, 2], [1, 'x', 3], [1, Infinity, 3], [1, 2, 3, 4], 'nope']
  log('vecOK on valid, short, non-number, non-finite, long and non-array inputs', inputs.map((v) => guard.vecOK(v, 3)))
  log('vec3 returns a valid vector and throws the spoint message otherwise', inputs.map((v) => attempt(() => guard.vec3(v, 'position'))))
  log('vec4 refuses a three-element vector', attempt(() => guard.vec4([1, 2, 3], 'rotation')))
  log('num accepts a finite number and refuses NaN, Infinity and a string', [5, NaN, Infinity, '5'].map((v) => attempt(() => guard.num(v, 'health'))))
  log('nonNeg accepts zero and refuses a negative number', [0, -1, 2].map((v) => attempt(() => guard.nonNeg(v, 'speed'))))

  return steps
}
