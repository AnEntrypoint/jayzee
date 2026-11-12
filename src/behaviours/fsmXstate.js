import { GameFSMError, validateGameFSMSpec } from './game-fsm.js'

const XSTATE_FUNCTIONS = ['createMachine', 'createActor']

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export function createXstateGameFSM(spec, appCtx, options = {}) {
  validateGameFSMSpec(spec)
  if (appCtx !== undefined && !isPlainObject(appCtx)) throw new GameFSMError('game-fsm-appctx-not-object', 'appCtx must be a plain object or undefined')
  const { xstate, now } = options
  const missing = XSTATE_FUNCTIONS.filter((name) => typeof xstate?.[name] !== 'function')
  if (missing.length > 0) throw new GameFSMError('game-fsm-xstate-missing', 'the injected xstate module needs ' + missing.join(', ') + ': this runtime runs the machine on a real xstate actor and imports none itself')
  if (typeof now !== 'function') throw new GameFSMError('game-fsm-clock-not-function', 'now must be a clock function: timeInState and the after timers read the clock through it')

  const stateNames = Object.keys(spec.states)
  const context = { ...(spec.context || {}) }
  const subscribers = new Set()
  const timers = new Map()
  const due = []
  let timerSeq = 0
  let current = null
  let enteredAt = 0
  let done = false
  let stopped = false
  let actor = null

  const clock = {
    setTimeout(fn, ms) {
      timerSeq++
      timers.set(timerSeq, { at: now() + ms, fn, id: timerSeq })
      return timerSeq
    },
    clearTimeout(id) {
      timers.delete(id)
    },
  }

  const stateArg = (name, method) => {
    if (typeof name !== 'string' || !stateNames.includes(name)) throw new GameFSMError('game-fsm-undeclared-state-name', method + ' was given the state ' + JSON.stringify(name ?? null) + ': this machine declares ' + stateNames.join(', '))
    return name
  }

  const eventArg = (name, method) => {
    if (typeof name !== 'string' || name.length === 0) throw new GameFSMError('game-fsm-event-name-not-string', method + ' was given the event ' + JSON.stringify(name ?? null))
    return name
  }

  const notify = () => {
    for (const listener of subscribers) {
      try {
        listener(current, runtime)
      } catch {
        continue
      }
    }
  }

  const candidate = (stateName, def) => {
    const one = typeof def === 'string' ? { target: def } : def
    const out = {}
    if (one.target !== undefined) {
      out.target = one.target
      out.reenter = one.target === stateName
    }
    if (typeof one.guard === 'function') out.guard = ({ event }) => Boolean(one.guard(appCtx, runtime, event.payload ?? null))
    if (typeof one.action === 'function') out.actions = ({ event }) => { one.action(appCtx, runtime, event.payload ?? null) }
    return out
  }

  const candidates = (stateName, def) => (Array.isArray(def) ? def : [def]).map((one) => candidate(stateName, one))

  const states = {}
  for (const name of stateNames) {
    const raw = spec.states[name]
    const final = raw.final === true || raw.type === 'final'
    const enterHook = raw.enter ?? raw.entry
    const node = {
      entry: () => {
        const changed = name !== current
        current = name
        enteredAt = now()
        done = final
        if (typeof enterHook === 'function') enterHook(appCtx, runtime)
        if (changed) notify()
      },
    }
    if (typeof raw.exit === 'function') node.exit = () => { raw.exit(appCtx, runtime) }
    if (final) node.type = 'final'
    else {
      if (raw.on) node.on = Object.fromEntries(Object.entries(raw.on).map(([type, def]) => [type, candidates(name, def)]))
      if (raw.after) node.after = Object.fromEntries(Object.entries(raw.after).map(([ms, def]) => [ms, candidates(name, def)]))
    }
    states[name] = node
  }

  const machine = xstate.createMachine({ id: spec.id || 'game', initial: spec.initial, states })

  const runtime = {
    get context() { return context },
    get state() { return current },
    get timeInState() { return stopped ? 0 : now() - enteredAt },
    get actor() { return actor },
    is(name) { return current === stateArg(name, 'is') },
    matches(name) { return current === stateArg(name, 'matches') },
    can(type) {
      eventArg(type, 'can')
      if (done || stopped) return false
      return actor.getSnapshot().can({ type, payload: null })
    },
    send(type, payload) {
      const eventName = eventArg(type, 'send')
      if (payload != null && !isPlainObject(payload)) throw new GameFSMError('game-fsm-payload-not-object', 'send("' + eventName + '") needs a plain object payload')
      if (payload != null && Object.hasOwn(payload, 'type')) throw new GameFSMError('game-fsm-payload-overrides-type', 'send("' + eventName + '") was given a payload carrying its own type')
      const eventPayload = payload != null ? { ...payload } : null
      if (stopped) return { ok: false, reason: 'stopped', event: eventName, state: current }
      const event = { type: eventName, payload: eventPayload }
      if (done || !actor.getSnapshot().can(event)) return { ok: false, reason: 'unhandled', event: eventName, state: current }
      actor.send(event)
      return { ok: true, event: eventName, state: current }
    },
    onTransition(fn) {
      if (typeof fn !== 'function') throw new GameFSMError('game-fsm-listener-not-function', 'onTransition needs a function')
      if (stopped) return () => {}
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    tick(dt) {
      if (!Number.isFinite(dt)) throw new GameFSMError('game-fsm-dt-not-finite-number', 'tick needs a finite dt, got ' + JSON.stringify(dt ?? null))
      if (stopped || done) return
      const at = now()
      due.length = 0
      for (const timer of timers.values()) if (timer.at <= at) due.push(timer)
      due.sort((a, b) => a.at - b.at || a.id - b.id)
      for (const timer of due) {
        if (!timers.has(timer.id)) continue
        timers.delete(timer.id)
        timer.fn()
      }
      if (done) return
      const hook = spec.states[current].tick
      if (typeof hook === 'function') hook(appCtx, dt, runtime)
    },
    stop() {
      if (stopped) return
      stopped = true
      subscribers.clear()
      actor.stop()
      timers.clear()
    },
  }

  actor = xstate.createActor(machine, { clock })
  actor.start()
  return runtime
}

export default createXstateGameFSM
