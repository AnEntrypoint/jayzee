import { stateMatches } from './stateValue.js'

export const LOADING_FALLBACK_MS = 10000
export const LOADING_HARD_MS = 45000
export const LOADING_STEPS = ['assets', 'environment', 'firstSnapshot', 'models']

export const LOADING_STRINGS = Object.freeze({
  loadingConnecting: 'Connecting...',
  loadingEnvironment: 'Loading environment...',
  loadingSyncingServer: 'Syncing with server...',
  loadingStartingGame: 'Starting game...',
  connectionFailed: (msg) => 'Connection failed: ' + msg + ' -- reload to retry',
})

const allDone = (c) => !c.modelFailure && LOADING_STEPS.every((s) => c[s]) && c.entityPending <= 0
const hasContent = (c) => !c.modelFailure && Boolean(c.firstSnapshot && c.environment)
const notModelFailure = (c) => c.modelFailure !== true

const TIMERS = [
  { delayMs: LOADING_FALLBACK_MS, flag: 'fallbackFired', guard: hasContent },
  { delayMs: LOADING_HARD_MS, flag: 'hardFired', guard: notModelFailure },
]

const CHECKING_PATCHES = new Map([
  ['ASSETS_DONE', (c, strings) => ({ ...c, assets: true, label: strings.loadingEnvironment })],
  ['WORLD_CONFIG', (c, strings) => ({ ...c, worldConfig: true, label: strings.loadingSyncingServer })],
  ['ENVIRONMENT_DONE', (c) => ({ ...c, environment: true })],
  ['FIRST_SNAPSHOT', (c) => ({ ...c, firstSnapshot: true })],
  ['MODELS_DONE', (c) => ({ ...c, models: true })],
  ['SET_PENDING', (c, _strings, event) => ({ ...c, entityPending: event.count ?? 0 })],
  ['ENTITY_LOADED', (c) => ({ ...c, entityPending: Math.max(0, c.entityPending - 1) })],
])

export function createLoadingStateMachine(options = {}) {
  const { now } = options
  if (typeof now !== 'function') throw new TypeError('createLoadingStateMachine needs a clock with now()')
  const strings = options.strings ?? LOADING_STRINGS

  let value = 'loading'
  let context = {
    assets: false, worldConfig: false, environment: false, firstSnapshot: false, models: false,
    entityPending: 0, world: false, modelFailure: false, label: strings.loadingConnecting,
  }
  let enteredAt = now()
  let fired = { fallbackFired: false, hardFired: false }
  const listeners = new Set()

  const commit = (nextValue, nextContext) => {
    const changed = nextValue !== value || nextContext !== context
    value = nextValue
    context = nextContext
    if (changed) {
      const snapshot = { value, context }
      for (const listener of listeners) listener(value, snapshot)
    }
    return changed
  }

  const enterReady = (c) => {
    const next = { ...c, label: strings.loadingStartingGame }
    return commit(next.world ? 'worldReady' : 'ready', next)
  }

  const enterLoading = (c, at) => {
    enteredAt = at
    fired = { fallbackFired: false, hardFired: false }
    return commit('loading', c)
  }

  const afterChecking = (c, at) => (allDone(c) ? enterReady(c) : enterLoading(c, at))

  const settle = () => {
    const at = now()
    for (const timer of TIMERS) {
      if (value !== 'loading') return
      if (fired[timer.flag] || at - enteredAt < timer.delayMs) continue
      fired = { ...fired, [timer.flag]: true }
      if (timer.guard(context)) enterReady(context)
    }
  }

  const applyLoading = (type, event) => {
    if (type === 'MODEL_LOAD_FAILED') {
      return commit('loading', {
        ...context,
        modelFailure: true,
        label: strings.connectionFailed(event.reasonCode || 'model load failed'),
      })
    }
    if (type === 'WORLD_EXISTS') return commit('loading', { ...context, world: true })
    if (type === 'FORCE_READY') return notModelFailure(context) ? enterReady(context) : false
    const patch = CHECKING_PATCHES.get(type)
    if (patch === undefined) return false
    return afterChecking(patch(context, strings, event), now())
  }

  const applyReady = (type) => {
    if (type !== 'WORLD_EXISTS') return false
    const next = { ...context, world: true }
    return value === 'ready' ? enterReady(next) : commit(value, next)
  }

  const send = (type, extra) => {
    const event = typeof type === 'string' ? { type, ...extra } : type
    if (event === null || typeof event !== 'object' || typeof event.type !== 'string') {
      throw new TypeError('loading machine events need a string type')
    }
    settle()
    return value === 'loading' ? applyLoading(event.type, event) : applyReady(event.type)
  }

  return {
    send,
    tick: settle,
    matches: (pattern) => stateMatches(value, pattern),
    get state() { return value },
    get context() { return context },
    get label() { return context.label },
    get inputsDone() { return value === 'ready' || value === 'worldReady' },
    get isReady() { return value === 'worldReady' },
    get isWorldReady() { return value === 'worldReady' },
    get progress() {
      const done = LOADING_STEPS.filter((s) => context[s]).length + (context.entityPending <= 0 ? 1 : 0) + (context.world ? 1 : 0)
      return Math.min(1, done / (LOADING_STEPS.length + 2))
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
