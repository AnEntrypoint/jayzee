export const DEFAULT_SPEEDS = Object.freeze({ walkSpeed: 1.5, runSpeed: 5, sprintSpeed: 10 })

export const LAND_DELAY_MS = 500

const WALK_STOP_SPEED = 0.1
const SETTLE_SPEED = 0.5

export const FADE_SECONDS = Object.freeze({
  idle: 0.3,
  walk: 0.3,
  run: 0.3,
  sprint: 0.2,
  jump: 0.1,
  land: 0.15,
  attack: 0.1,
  die: 0.3,
})

const EVENT_FOR_REQUEST = Object.freeze({
  idle: 'IDLE',
  walk: 'WALK',
  run: 'RUN',
  sprint: 'SPRINT',
  jump: 'JUMP',
  attack: 'ATTACK',
  die: 'DIE',
})

const TRANSITIONS = Object.freeze({
  idle: Object.freeze({ WALK: 'walk', RUN: 'run', SPRINT: 'sprint', JUMP: 'jump', ATTACK: 'attack', DIE: 'die' }),
  walk: Object.freeze({ IDLE: 'idle', RUN: 'run', SPRINT: 'sprint', JUMP: 'jump', ATTACK: 'attack', DIE: 'die' }),
  run: Object.freeze({ IDLE: 'idle', WALK: 'walk', SPRINT: 'sprint', JUMP: 'jump', ATTACK: 'attack', DIE: 'die' }),
  sprint: Object.freeze({ RUN: 'run', IDLE: 'idle', JUMP: 'jump', ATTACK: 'attack', DIE: 'die' }),
  jump: Object.freeze({ LAND: 'land', DIE: 'die' }),
  land: Object.freeze({ IDLE: 'idle', WALK: 'walk', RUN: 'run', DIE: 'die' }),
  attack: Object.freeze({ DIE: 'die' }),
  die: Object.freeze({}),
})

export function settledState(speed, runSpeed) {
  if (speed < SETTLE_SPEED) return 'idle'
  if (speed <= runSpeed) return 'walk'
  if (speed > runSpeed) return 'run'
  return null
}

const idleEvents = ({ speed, isGrounded }, speeds) => {
  const events = []
  if (speed > speeds.runSpeed) events.push('RUN')
  else if (speed > speeds.walkSpeed) events.push('WALK')
  if (!isGrounded) events.push('JUMP')
  return events
}

const walkEvents = ({ speed, isGrounded }, speeds) => {
  const events = []
  if (speed < WALK_STOP_SPEED) events.push('IDLE')
  else if (speed > speeds.runSpeed) events.push('RUN')
  if (!isGrounded) events.push('JUMP')
  return events
}

const runEvents = ({ speed, isGrounded }, speeds) => {
  const events = []
  if (speed < speeds.walkSpeed) events.push('IDLE')
  else if (speed < speeds.runSpeed) events.push('WALK')
  else if (speed > speeds.sprintSpeed) events.push('SPRINT')
  if (!isGrounded) events.push('JUMP')
  return events
}

const sprintEvents = ({ speed, isGrounded }, speeds) => {
  const events = []
  if (speed < speeds.runSpeed) events.push('RUN')
  if (!isGrounded) events.push('JUMP')
  return events
}

const jumpEvents = ({ isGrounded, verticalVelocity }) =>
  isGrounded && verticalVelocity <= 0 ? ['LAND'] : []

const attackEvents = ({ timeInStateMs, clipSeconds }) =>
  timeInStateMs > clipSeconds * 1000 ? ['ATTACK_END'] : []

const EVENTS_BY_STATE = Object.freeze({
  idle: idleEvents,
  walk: walkEvents,
  run: runEvents,
  sprint: sprintEvents,
  jump: jumpEvents,
  land: () => [],
  attack: attackEvents,
  die: () => [],
})

export function tickEvents(state, context, speeds = DEFAULT_SPEEDS) {
  return EVENTS_BY_STATE[state](context, speeds)
}

export function nextState(state, event, context, speeds = DEFAULT_SPEEDS) {
  if (state === 'attack' && event === 'ATTACK_END') return settledState(context.speed, speeds.runSpeed)
  const table = TRANSITIONS[state]
  return Object.hasOwn(table, event) ? table[event] : null
}

export function runTick(state, context, speeds = DEFAULT_SPEEDS) {
  let current = state
  for (const event of tickEvents(state, context, speeds)) {
    const target = nextState(current, event, context, speeds)
    if (target !== null) current = target
  }
  return current
}

export function requestState(state, requested, context, speeds = DEFAULT_SPEEDS) {
  if (!Object.hasOwn(EVENT_FOR_REQUEST, requested)) return null
  return nextState(state, EVENT_FOR_REQUEST[requested], context, speeds)
}
