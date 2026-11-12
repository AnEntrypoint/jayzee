export class GameFSMError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'GameFSMError'
    this.code = code
  }
}

const STATE_KEYS = ['enter', 'entry', 'exit', 'tick', 'on', 'after', 'final', 'type']
const MS_KEY = /^\d+$/

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const quote = (value) => JSON.stringify(value ?? null)

function describeDef(d) {
  if (typeof d === 'string') return `"${d}"`
  if (d === null) return 'null'
  if (d === undefined) return 'undefined'
  if (typeof d === 'function') return 'a function'
  if (Array.isArray(d)) return 'an array'
  return String(d)
}

function checkTransition(stateName, what, def, names) {
  if (def === null || def === undefined || (typeof def !== 'string' && (typeof def !== 'object' || Array.isArray(def)))) {
    throw new GameFSMError('game-fsm-transition-shape', `state "${stateName}" ${what} must be a target state name or a transition object, got ${describeDef(def)}: a definition that is neither is never taken, so the event is dead in every state that receives it`)
  }
  if (typeof def === 'string') {
    if (!names.includes(def)) throw new GameFSMError('game-fsm-transition-unknown-target', `state "${stateName}" ${what} targets unknown state "${def}" (have: ${names.join(', ')}): the machine can never enter it, so the transition is dead rather than refused`)
    return
  }
  if (def.target !== undefined) {
    if (typeof def.target !== 'string' || !names.includes(def.target)) {
      throw new GameFSMError('game-fsm-transition-unknown-target', `state "${stateName}" ${what} targets unknown state ${quote(def.target)} (have: ${names.join(', ')})`)
    }
  } else if (typeof def.action !== 'function') {
    throw new GameFSMError('game-fsm-transition-dead', `state "${stateName}" ${what} resolves to no transition: it declares neither a target nor an action, so the event is dead in every state that receives it`)
  }
  if (def.guard !== undefined && typeof def.guard !== 'function') {
    throw new GameFSMError('game-fsm-transition-guard-not-function', `state "${stateName}" ${what} declares a guard of type ${typeof def.guard}: it is never called, so the transition is taken unconditionally instead of being gated`)
  }
  if (def.action !== undefined && typeof def.action !== 'function') {
    throw new GameFSMError('game-fsm-transition-action-not-function', `state "${stateName}" ${what} declares an action of type ${typeof def.action}: it is never called, so the transition runs without the effect the spec wrote for it`)
  }
}

export function validateGameFSMSpec(spec) {
  if (!isPlainObject(spec)) throw new GameFSMError('game-fsm-spec-not-object', `spec is ${describeDef(spec)}: the machine is read from spec.states, so a value that is not a plain object carries no state to read and the failure would surface with no spec named`)
  if (spec.id !== undefined && (typeof spec.id !== 'string' || spec.id.length === 0)) {
    throw new GameFSMError('game-fsm-spec-id-not-string', `spec.id is ${describeDef(spec.id)}: it becomes the machine id, so a value that is not a non-empty string is coerced into an id no caller can look this machine up by`)
  }
  if (spec.context !== undefined && !isPlainObject(spec.context)) {
    throw new GameFSMError('game-fsm-context-not-object', `spec.context is ${describeDef(spec.context)}: it is spread into the machine context, so a value that is not a plain object either contributes no field or contributes its own indices as field names, and every fsm.context.<field> read then answers undefined in place of the seeded value`)
  }
  const states = spec.states
  if (!isPlainObject(states) || !Object.keys(states).length) {
    throw new GameFSMError('game-fsm-states-not-object', `spec.states is ${describeDef(states)}: it must be a non-empty plain object of state definitions, and an empty or non-object one leaves the machine with no state to enter`)
  }
  const names = Object.keys(states)
  if (!spec.initial) throw new GameFSMError('game-fsm-initial-required', 'spec.initial is required: the machine enters it on start, so without one there is no state to enter')
  if (!names.includes(spec.initial)) {
    throw new GameFSMError('game-fsm-initial-undeclared', `spec.initial "${spec.initial}" is not a declared state (have: ${names.join(', ')})`)
  }
  for (const name of names) {
    const st = states[name]
    if (!isPlainObject(st)) {
      throw new GameFSMError('game-fsm-state-def-not-object', `state "${name}" is ${describeDef(st)}: a state definition must be a plain object of hooks and transitions, and any other value reads as an empty state, so every hook and transition written for it is dropped without being reported`)
    }
    if (st.type !== undefined && st.type !== 'final') {
      throw new GameFSMError('game-fsm-state-type-unsupported', `state "${name}" declares type ${quote(st.type)}: this module builds a flat machine and reads only "final", so any other type is dropped and the state is entered as an ordinary one, which is what makes a "parallel" state behave as if it were a single state`)
    }
    if (st.final !== undefined && typeof st.final !== 'boolean') {
      throw new GameFSMError('game-fsm-state-final-not-boolean', `state "${name}" declares final ${quote(st.final)}: only true marks the state terminal, so a truthy value that is not true leaves the machine running in a state the author meant to be final, and its tick hook keeps being called`)
    }
    if (st.enter != null && st.entry != null) {
      throw new GameFSMError('game-fsm-state-enter-and-entry', `state "${name}" declares both "enter" and "entry": "enter" is read and "entry" is dropped, so one of the two hooks never runs and the state enters half-initialised`)
    }
    const eachTransition = (what, def) => {
      const list = Array.isArray(def) ? def : [def]
      if (list.length === 0) throw new GameFSMError('game-fsm-transition-list-empty', `state "${name}" ${what} declares no transition: an empty candidate list matches nothing, so the event is dead rather than refused`)
      for (const one of list) checkTransition(name, what, one, names)
    }
    for (const k of Object.keys(st)) {
      if (!STATE_KEYS.includes(k)) throw new GameFSMError('game-fsm-state-unknown-key', `state "${name}" declares unknown key "${k}" (handled: ${STATE_KEYS.join(', ')}): an unhandled key is never read, so the hook or transition it names is silently absent from the machine`)
    }
    for (const [evt, def] of Object.entries(st.on || {})) {
      eachTransition(`event "${evt}"`, def)
    }
    for (const [ms, def] of Object.entries(st.after || {})) {
      if (!MS_KEY.test(ms)) throw new GameFSMError('game-fsm-after-delay-not-ms', `state "${name}" declares after(${ms}); the key is a delay in milliseconds and must be a non-negative integer, so any other key is a timer that never fires`)
      eachTransition(`after(${ms})`, def)
    }
  }
}

const compileCandidate = (def) => typeof def === 'string'
  ? { target: def, guard: null, action: null }
  : {
    target: def.target,
    guard: typeof def.guard === 'function' ? def.guard : null,
    action: typeof def.action === 'function' ? def.action : null,
  }

const compileCandidates = (def) => (Array.isArray(def) ? def : [def]).map(compileCandidate)

function compileState(raw) {
  const st = raw || {}
  const enterHook = st.enter ?? st.entry
  return {
    final: st.final === true || st.type === 'final',
    enter: typeof enterHook === 'function' ? enterHook : null,
    exit: typeof st.exit === 'function' ? st.exit : null,
    tick: typeof st.tick === 'function' ? st.tick : null,
    on: new Map(Object.entries(st.on || {}).map(([evt, def]) => [evt, compileCandidates(def)])),
    delayed: Object.entries(st.after || {})
      .map(([ms, def]) => ({ ms: Number(ms), candidates: compileCandidates(def) }))
      .sort((a, b) => a.ms - b.ms),
  }
}

export function defineGameFSM(spec, appCtx, options = {}) {
  validateGameFSMSpec(spec)
  if (appCtx !== undefined && !isPlainObject(appCtx)) {
    throw new GameFSMError('game-fsm-appctx-not-object', `appCtx is ${describeDef(appCtx)}: every hook is called as hook(appCtx, ...) and every guard reads it, so a value that is not a plain object turns each of those reads into a failure raised inside the hook, far from this call that could have named it`)
  }
  const { now = Date.now } = options
  if (typeof now !== 'function') {
    throw new GameFSMError('game-fsm-clock-not-function', `now is ${describeDef(now)}: timeInState and the after timers read the clock through it, so a value that is not a function leaves them with no clock to read`)
  }

  const declaredStates = Object.keys(spec.states)
  const stateArg = (s, method) => {
    if (typeof s !== 'string' || !declaredStates.includes(s)) {
      throw new GameFSMError('game-fsm-undeclared-state-name', `${method} was given the state ${quote(s)}: this machine declares ${declaredStates.join(', ')}, and any other name matches nothing, so the call answers false forever and a typo reads as "not in that state" instead of being refused here`)
    }
    return s
  }
  const eventArg = (evt, method) => {
    if (typeof evt !== 'string' || evt.length === 0) {
      throw new GameFSMError('game-fsm-event-name-not-string', `${method} was given the event ${quote(evt)}: events are matched by their name, so a name that is not a non-empty string matches no transition and the call answers false or delivers nothing instead of being refused here`)
    }
    return evt
  }

  const compiled = new Map(Object.entries(spec.states).map(([name, raw]) => [name, compileState(raw)]))
  const context = { ...(spec.context || {}) }
  const subscribers = new Set()
  const delayedFired = new Set()
  let current = null
  let enteredAt = 0
  let done = false
  let stopped = false

  function pick(candidates, payload) {
    for (const candidate of candidates) {
      if (candidate.guard && !candidate.guard(appCtx, runtime, payload)) continue
      return candidate
    }
    return null
  }

  function resolveEvent(name, payload) {
    if (done) return null
    const candidates = compiled.get(current).on.get(name)
    return candidates ? pick(candidates, payload) : null
  }

  function notify() {
    for (const listener of subscribers) {
      try {
        listener(current, runtime)
      } catch (error) {
        console.error(`game-fsm-listener-threw: ${error?.message ?? error}: the throw is contained so the transition still completes, so a listener that throws would otherwise vanish without a trace and read as a machine that never transitions`)
      }
    }
  }

  function enter(name) {
    const changed = name !== current
    const state = compiled.get(name)
    current = name
    enteredAt = now()
    delayedFired.clear()
    done = state.final
    if (state.enter) state.enter(appCtx, runtime)
    if (changed) notify()
  }

  function take(candidate, payload) {
    if (candidate.target === undefined) {
      if (candidate.action) candidate.action(appCtx, runtime, payload)
      return
    }
    const leaving = compiled.get(current).exit
    if (leaving) leaving(appCtx, runtime)
    if (candidate.action) candidate.action(appCtx, runtime, payload)
    enter(candidate.target)
  }

  function fireDelayed() {
    const elapsed = now() - enteredAt
    for (const delayed of compiled.get(current).delayed) {
      if (delayed.ms > elapsed || delayedFired.has(delayed.ms)) continue
      delayedFired.add(delayed.ms)
      const candidate = pick(delayed.candidates, null)
      if (candidate) {
        take(candidate, null)
        return
      }
    }
  }

  const runtime = {
    get context() { return context },
    get state() { return current },
    get timeInState() { return stopped ? 0 : now() - enteredAt },
    is(s) { return current === stateArg(s, 'is') },
    matches(s) { return current === stateArg(s, 'matches') },
    can(evt) { return resolveEvent(eventArg(evt, 'can'), null) !== null },
    send(type, payload) {
      const eventName = eventArg(type, 'send')
      if (payload != null && !isPlainObject(payload)) {
        throw new GameFSMError('game-fsm-payload-not-object', `send("${eventName}") was given the payload ${describeDef(payload)}: it is spread into the event, so a value that is not a plain object reaches the guard and action as fields that were never sent -- a primitive contributes nothing at all and an array contributes its own indices -- instead of being refused here`)
      }
      if (payload != null && Object.hasOwn(payload, 'type')) {
        throw new GameFSMError('game-fsm-payload-overrides-type', `send("${eventName}") was given a payload carrying its own "type" ${quote(payload.type)}: the payload is spread over { type }, so it replaces the event name and a different event is delivered from the one the call named`)
      }
      const eventPayload = payload != null ? { ...payload } : null
      if (stopped) return { ok: false, reason: 'stopped', event: eventName, state: current }
      const candidate = resolveEvent(eventName, eventPayload)
      if (!candidate) return { ok: false, reason: 'unhandled', event: eventName, state: current }
      take(candidate, eventPayload)
      return { ok: true, event: eventName, state: current }
    },
    onTransition(fn) {
      if (typeof fn !== 'function') {
        throw new GameFSMError('game-fsm-listener-not-function', `onTransition was given ${describeDef(fn)}: it is stored as a listener and called on every transition, and the notify loop contains each listener's throw so the transition still completes, so a non-function is a listener that never reports anything and never reports why`)
      }
      if (stopped) return () => {}
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    tick(dt) {
      if (!Number.isFinite(dt)) {
        throw new GameFSMError('game-fsm-dt-not-finite-number', `tick was given dt ${quote(dt)}: it is passed straight to the active state's tick hook, so a value that is not a finite number arrives there as NaN and every comparison against it is false, which reads as "nothing happened" instead of as a bad dt`)
      }
      if (stopped || done) return
      fireDelayed()
      if (done) return
      const hook = compiled.get(current).tick
      if (hook) hook(appCtx, dt, runtime)
    },
    stop() {
      if (stopped) return
      stopped = true
      subscribers.clear()
    }
  }

  enter(spec.initial)
  return runtime
}

export default defineGameFSM
