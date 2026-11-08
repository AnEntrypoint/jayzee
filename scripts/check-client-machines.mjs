import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { stateMatches } from '../src/client-pure/stateValue.js'
import {
  compileInputActions,
  actionsFor,
  touchActionsFor,
  InputActionError,
} from '../src/client-pure/inputActionCompile.js'
import { createInputStepper, MAX_CATCH_UP_MS } from '../src/client-pure/inputStepper.js'
import { createClientStateMachine } from '../src/client-pure/clientMachine.js'
import {
  createLoadingStateMachine,
  LOADING_FALLBACK_MS,
  LOADING_HARD_MS,
} from '../src/client-pure/loadingMachine.js'

const refusalOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}

const refusedWith = (fn, reasonCode) => {
  const error = refusalOf(fn)
  assert.ok(error instanceof InputActionError, 'expected an InputActionError, got ' + (error && error.name))
  assert.equal(error.reasonCode, reasonCode)
}

const ready = (regions = {}) => ({
  ready: {
    mode: 'playing', gizmo: 'translate', select: 'none', snap: 'off',
    docks: { left: 'expanded', right: 'expanded' },
    ...regions,
  },
})

const drive = (machine, events) => {
  for (const event of events) machine.send(event)
  return machine
}

const fakeClock = () => {
  let t = 0
  let seq = 0
  const timers = new Map()
  const earliest = (limit) => {
    let best = null
    for (const [handle, timer] of timers) {
      if (timer.due > limit) continue
      if (best === null || timer.due < best.timer.due || (timer.due === best.timer.due && timer.seq < best.timer.seq)) {
        best = { handle, timer }
      }
    }
    return best
  }
  const runOne = (best) => {
    timers.delete(best.handle)
    best.timer.fn()
  }
  return {
    now: () => t,
    setTimer(fn, ms) {
      seq++
      timers.set(seq, { due: t + ms, fn, seq })
      return seq
    },
    clearTimer(handle) {
      timers.delete(handle)
    },
    get pending() {
      return timers.size
    },
    dueTimes() {
      return [...timers.values()].map((timer) => timer.due).sort((a, b) => a - b)
    },
    set(to) {
      t = to
    },
    fire() {
      for (let best = earliest(t); best !== null; best = earliest(t)) runOne(best)
    },
    advance(to) {
      for (let best = earliest(to); best !== null; best = earliest(to)) {
        t = best.timer.due
        runOne(best)
      }
      t = to
    },
  }
}

const ACTIONS = {
  jump: { keys: ['Space', 'KeyW'], gamepad: 'a', touch: { slot: 1, label: 'Jump' } },
  fire: { mouse: 'left', keys: ['KeyF'] },
  look: { gamepad: 'Gamepad:Button12', activeOn: 'hold', modifiers: ['Shift'] },
}

gate('compile maps each key, mouse, gamepad and touch slot to its action', () => {
  const c = compileInputActions(ACTIONS)
  assert.deepEqual(c.actions.map((a) => a.name), ['jump', 'fire', 'look'])
  assert.deepEqual(c.byKey.get('Space'), ['jump'])
  assert.deepEqual(c.byKey.get('KeyW'), ['jump'])
  assert.deepEqual(c.byKey.get('KeyF'), ['fire'])
  assert.deepEqual(c.byMouse.get('left'), ['fire'])
  assert.deepEqual(c.byGamepad.get('a'), ['jump'])
  assert.deepEqual(c.byGamepad.get('Gamepad:Button12'), ['look'])
  assert.deepEqual(c.byTouchSlot.get(1), 'jump')
})

gate('compiled action fields take the spoint defaults', () => {
  const c = compileInputActions(ACTIONS)
  const jump = c.actions[0]
  assert.deepEqual(jump, {
    name: 'jump',
    keys: ['Space', 'KeyW'],
    mouse: null,
    gamepad: 'a',
    modifiers: [],
    activeOn: 'keydown',
    touch: { button: false, label: 'Jump', slot: 1, gesture: 'tap' },
  })
  const look = c.actions[2]
  assert.equal(look.activeOn, 'hold')
  assert.deepEqual(look.modifiers, ['Shift'])
  assert.equal(look.touch, null)
  assert.equal(Object.isFrozen(c), true)
  assert.equal(Object.isFrozen(jump.touch), true)
})

gate('actionsFor and touchActionsFor read the compiled tables by source', () => {
  const c = compileInputActions(ACTIONS)
  assert.deepEqual(actionsFor(c, 'key', 'KeyW'), ['jump'])
  assert.deepEqual(actionsFor(c, 'mouse', 'left'), ['fire'])
  assert.deepEqual(actionsFor(c, 'gamepad', 'a'), ['jump'])
  assert.deepEqual(actionsFor(c, 'mouse', 'right'), [])
  assert.deepEqual(actionsFor(c, 'key', 'Digit9'), [])
  assert.deepEqual(touchActionsFor(c, 1), ['jump'])
  assert.deepEqual(touchActionsFor(c, 2), [])
})

gate('a key shared by two actions lists both in declaration order', () => {
  const c = compileInputActions({ jump: { keys: ['Space'] }, hop: { keys: ['Space'] } })
  assert.deepEqual(c.byKey.get('Space'), ['jump', 'hop'])
})

gate('a touch-only action is bound and an unlisted field is not copied', () => {
  const c = compileInputActions({ tap: { touch: { slot: 2 } }, named: { keys: ['KeyQ'], active: 'menu' } })
  assert.deepEqual(touchActionsFor(c, 2), ['tap'])
  assert.equal(c.actions[1].active, undefined)
  assert.equal(c.actions[0].touch.gesture, 'tap')
})

gate('prototype-named keys and slots find no action', () => {
  const c = compileInputActions(ACTIONS)
  assert.deepEqual(actionsFor(c, 'key', 'constructor'), [])
  assert.deepEqual(actionsFor(c, 'key', '__proto__'), [])
  assert.deepEqual(touchActionsFor(c, 'constructor'), [])
})

gate('a non-object actions table is refused with bad-actions', () => {
  refusedWith(() => compileInputActions([]), 'bad-actions')
  refusedWith(() => compileInputActions(null), 'bad-actions')
})

gate('an empty action name and a non-object action are refused', () => {
  refusedWith(() => compileInputActions({ '': { keys: ['x'] } }), 'bad-name')
  refusedWith(() => compileInputActions({ a: 'Space' }), 'bad-action')
})

gate('an unknown action field is refused by name', () => {
  refusedWith(() => compileInputActions({ a: { keys: ['x'], rumble: 1 } }), 'unknown-field')
  refusedWith(() => compileInputActions({ a: { keys: ['x'], touch: { slot: 1, color: 'red' } } }), 'unknown-field')
})

gate('a bad key list or modifier list is refused with bad-list', () => {
  refusedWith(() => compileInputActions({ a: { keys: ['x', ''] } }), 'bad-list')
  refusedWith(() => compileInputActions({ a: { keys: 'Space' } }), 'bad-list')
  refusedWith(() => compileInputActions({ a: { keys: ['x'], modifiers: [3] } }), 'bad-list')
})

gate('a mouse button outside the list is refused and a listed one is accepted', () => {
  refusedWith(() => compileInputActions({ a: { mouse: 'mouse6' } }), 'bad-mouse')
  assert.doesNotThrow(() => compileInputActions({ a: { mouse: 'wheelDown' } }))
})

gate('gamepad names must be listed or Gamepad:ButtonN', () => {
  refusedWith(() => compileInputActions({ a: { gamepad: 'Gamepad:Button' } }), 'bad-gamepad')
  refusedWith(() => compileInputActions({ a: { gamepad: 'Gamepad:Button7x' } }), 'bad-gamepad')
  refusedWith(() => compileInputActions({ a: { gamepad: 'z' } }), 'bad-gamepad')
  assert.doesNotThrow(() => compileInputActions({ a: { gamepad: 'Gamepad:Button7' } }))
})

gate('activeOn and active are checked against their sets', () => {
  refusedWith(() => compileInputActions({ a: { keys: ['x'], activeOn: 'press' } }), 'bad-active-on')
  refusedWith(() => compileInputActions({ a: { keys: ['x'], active: '' } }), 'bad-active')
  assert.doesNotThrow(() => compileInputActions({ a: { keys: ['x'], activeOn: 'keyup' } }))
})

gate('touch fields are checked one by one', () => {
  refusedWith(() => compileInputActions({ a: { touch: 'slot1' } }), 'bad-touch')
  refusedWith(() => compileInputActions({ a: { touch: { slot: 1, button: 'yes' } } }), 'bad-touch-button')
  refusedWith(() => compileInputActions({ a: { touch: { slot: 1, label: '' } } }), 'bad-touch-label')
  refusedWith(() => compileInputActions({ a: { touch: { slot: 5 } } }), 'bad-touch-slot')
  refusedWith(() => compileInputActions({ a: { touch: { slot: 1, gesture: 'swipe' } } }), 'bad-touch-gesture')
})

gate('every spoint mouse button, gamepad name, gesture, active mode and touch slot is accepted', () => {
  const mouse = ['left', 'right', 'middle', 'mouse4', 'mouse5', 'wheelUp', 'wheelDown']
  const gamepad = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'start', 'select', 'l3', 'r3', 'dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight']
  const gestures = ['tap', 'double-tap', 'hold', 'press']
  const activeOn = ['keydown', 'hold', 'keyup']
  for (const name of mouse) assert.doesNotThrow(() => compileInputActions({ a: { mouse: name } }), 'mouse ' + name)
  for (const name of gamepad) assert.doesNotThrow(() => compileInputActions({ a: { gamepad: name } }), 'gamepad ' + name)
  for (const gesture of gestures) assert.doesNotThrow(() => compileInputActions({ a: { touch: { slot: 1, gesture } } }), 'gesture ' + gesture)
  for (const mode of activeOn) assert.doesNotThrow(() => compileInputActions({ a: { keys: ['x'], activeOn: mode } }), 'activeOn ' + mode)
  for (const slot of [1, 2, 3, 4]) assert.doesNotThrow(() => compileInputActions({ a: { touch: { slot } } }), 'slot ' + slot)
  refusedWith(() => compileInputActions({ a: { gamepad: 'dpadCenter' } }), 'bad-gamepad')
  refusedWith(() => compileInputActions({ a: { touch: { slot: 0 } } }), 'bad-touch-slot')
})

gate('an action with nothing bound is refused with unbound-action', () => {
  refusedWith(() => compileInputActions({ a: { modifiers: ['Shift'] } }), 'unbound-action')
  refusedWith(() => compileInputActions({ a: {} }), 'unbound-action')
})

gate('two actions on one touch slot are refused with touch-slot-taken', () => {
  refusedWith(() => compileInputActions({ a: { touch: { slot: 1 } }, b: { touch: { slot: 1 } } }), 'touch-slot-taken')
  assert.doesNotThrow(() => compileInputActions({ a: { touch: { slot: 1 } }, b: { touch: { slot: 2 } } }))
})

gate('the refusal carries its reason code and the input-actions prefix', () => {
  const error = refusalOf(() => compileInputActions({ a: { keys: ['x'], rumble: 1 } }))
  assert.equal(error.name, 'InputActionError')
  assert.equal(error.reasonCode, 'unknown-field')
  assert.ok(error.message.startsWith('[input-actions] unknown-field: actions.a.rumble'))
})

const clientBoot = () => createClientStateMachine()

gate('the client machine starts loading with snap 0.25 and the head bone shown', () => {
  const m = clientBoot()
  assert.equal(m.state, 'loading')
  assert.deepEqual(m.context, { snapSize: 0.25, headBoneHidden: false })
  assert.equal(m.isReady, false)
})

gate('ASSETS_READY enters ready in playing with every region at its initial state', () => {
  const m = drive(clientBoot(), ['ASSETS_READY'])
  assert.deepEqual(m.state, ready())
  assert.equal(m.isPlaying, true)
})

gate('TOGGLE_EDITOR and OPEN_LOBBY from loading enter ready in editor and lobby', () => {
  const editor = drive(clientBoot(), [{ type: 'TOGGLE_EDITOR' }])
  assert.deepEqual(editor.state, ready({ mode: 'editor' }))
  assert.equal(editor.isEditor, true)
  const lobby = drive(clientBoot(), ['OPEN_LOBBY'])
  assert.deepEqual(lobby.state, ready({ mode: 'lobby' }))
  assert.equal(lobby.isLobby, true)
})

gate('ENTER_SPECTATOR is ignored while loading', () => {
  const m = drive(clientBoot(), ['ENTER_SPECTATOR', 'SELECT', 'COLLAPSE_LEFT'])
  assert.equal(m.state, 'loading')
})

gate('SNAP sets the size, defaults to 0.25 for a missing or null size, and works while loading', () => {
  const m = clientBoot()
  m.send({ type: 'SNAP', size: 0.5 })
  assert.equal(m.snapSize, 0.5)
  assert.equal(m.state, 'loading')
  m.send('SNAP')
  assert.equal(m.snapSize, 0.25)
  m.send({ type: 'SNAP', size: 1 })
  m.send({ type: 'SNAP', size: null })
  assert.equal(m.snapSize, 0.25)
})

gate('SET_CAMERA_MODE reads inHead and treats a missing inHead as false', () => {
  const m = clientBoot()
  m.send({ type: 'SET_CAMERA_MODE', inHead: true })
  assert.equal(m.headBoneHidden, true)
  m.send({ type: 'SET_CAMERA_MODE', inHead: 0 })
  assert.equal(m.headBoneHidden, false)
  m.send({ type: 'SET_CAMERA_MODE', inHead: true })
  m.send('SET_CAMERA_MODE')
  assert.equal(m.headBoneHidden, false)
})

gate('playing reaches spectator free and follow and returns to playing', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'ENTER_SPECTATOR'])
  assert.deepEqual(m.state, ready({ mode: { spectator: 'free' } }))
  assert.equal(m.isSpectator, true)
  assert.equal(m.spectatorSubmode, 'free')
  drive(m, ['SPECTATE_FOLLOW'])
  assert.equal(m.spectatorSubmode, 'follow')
  drive(m, ['SPECTATE_FREE'])
  assert.equal(m.spectatorSubmode, 'free')
  drive(m, ['EXIT_SPECTATOR'])
  assert.equal(m.isPlaying, true)
  assert.equal(m.spectatorSubmode, null)
})

gate('spectator ignores TOGGLE_EDITOR for the mode but still resets the other regions', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'ENTER_SPECTATOR', 'SELECT', 'SNAP_ON', 'TOGGLE_EDITOR'])
  assert.equal(m.isSpectator, true)
  assert.equal(m.isSelected, false)
  assert.equal(m.snapOn, false)
})

gate('the editor round trip runs through playtesting and back', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'TOGGLE_EDITOR'])
  assert.equal(m.isEditor, true)
  drive(m, ['PLAYTEST'])
  assert.equal(m.isPlaytesting, true)
  drive(m, ['PLAYTEST_STOP'])
  assert.equal(m.isEditor, true)
  drive(m, ['EXIT_EDITOR'])
  assert.equal(m.isPlaying, true)
})

gate('playtesting ignores TOGGLE_EDITOR and lobby ignores everything but its two events', () => {
  const testing = drive(clientBoot(), ['ASSETS_READY', 'TOGGLE_EDITOR', 'PLAYTEST', 'TOGGLE_EDITOR'])
  assert.equal(testing.isPlaytesting, true)
  const lobby = drive(clientBoot(), ['ASSETS_READY', 'OPEN_LOBBY', 'TOGGLE_EDITOR', 'ENTER_SPECTATOR'])
  assert.equal(lobby.isLobby, true)
  drive(lobby, ['CLOSE_LOBBY'])
  assert.equal(lobby.isPlaying, true)
  drive(lobby, ['OPEN_LOBBY', 'OPEN_LOBBY'])
  assert.equal(lobby.isPlaying, true)
})

gate('TOGGLE_EDITOR resets gizmo, select and snap but not the docks', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'ROTATE', 'SELECT', 'SNAP_ON', 'COLLAPSE_LEFT'])
  assert.equal(m.gizmoMode, 'rotate')
  assert.equal(m.isSelected, true)
  assert.equal(m.snapOn, true)
  drive(m, ['TOGGLE_EDITOR'])
  assert.deepEqual(m.state, ready({ mode: 'editor', docks: { left: 'collapsed', right: 'expanded' } }))
})

gate('EXIT_EDITOR resets a dragging gizmo back to translate', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'TOGGLE_EDITOR', 'DRAG', 'SELECT'])
  assert.equal(m.isDragging, true)
  drive(m, ['EXIT_EDITOR'])
  assert.equal(m.isDragging, false)
  assert.equal(m.gizmoMode, 'translate')
  assert.equal(m.isSelected, false)
  assert.equal(m.isPlaying, true)
})

gate('the gizmo cycles through its modes and drag states', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'ROTATE', 'DRAG'])
  assert.equal(m.gizmoMode, 'rotate')
  assert.equal(m.isDragging, true)
  drive(m, ['DROP'])
  assert.equal(m.isDragging, false)
  drive(m, ['SCALE', 'DRAG'])
  assert.equal(m.gizmoMode, 'scale')
  assert.equal(m.isDragging, true)
  drive(m, ['TRANSLATE'])
  assert.equal(m.isDragging, true, 'scaleDrag handles only DROP, so TRANSLATE must be ignored')
  drive(m, ['DROP', 'TRANSLATE'])
  assert.equal(m.gizmoMode, 'translate')
})

gate('DROP outside a drag state is ignored', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'DROP'])
  assert.equal(m.gizmoMode, 'translate')
  assert.equal(m.isDragging, false)
})

gate('select and deselect toggle the selection and ignore a repeat', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'DESELECT'])
  assert.equal(m.isSelected, false)
  drive(m, ['SELECT', 'SELECT'])
  assert.equal(m.isSelected, true)
  drive(m, ['DESELECT'])
  assert.equal(m.isSelected, false)
})

gate('snap on and snap off toggle and expose snapOn', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'SNAP_ON'])
  assert.equal(m.snapOn, true)
  drive(m, ['SNAP_OFF'])
  assert.equal(m.snapOn, false)
})

gate('the docks collapse and expand on their own sides', () => {
  const m = drive(clientBoot(), ['ASSETS_READY', 'COLLAPSE_LEFT'])
  assert.equal(m.dockLeftCollapsed, true)
  assert.equal(m.dockRightCollapsed, false)
  drive(m, ['COLLAPSE_RIGHT', 'COLLAPSE_LEFT'])
  assert.equal(m.dockRightCollapsed, true)
  drive(m, ['EXPAND_LEFT'])
  assert.equal(m.dockLeftCollapsed, false)
  assert.equal(m.dockRightCollapsed, true)
  drive(m, ['EXPAND_RIGHT', 'EXPAND_RIGHT'])
  assert.equal(m.dockRightCollapsed, false)
})

gate('unknown and prototype-named events change nothing and do not throw', () => {
  const m = drive(clientBoot(), ['ASSETS_READY'])
  const before = m.state
  for (const type of ['constructor', 'toString', '__proto__', 'NOT_AN_EVENT']) {
    assert.equal(m.send(type), false)
  }
  assert.deepEqual(m.state, before)
})

gate('an event without a string type is refused with a TypeError', () => {
  const m = clientBoot()
  assert.ok(refusalOf(() => m.send({})) instanceof TypeError)
  assert.ok(refusalOf(() => m.send(null)) instanceof TypeError)
  assert.ok(refusalOf(() => m.send({ type: 4 })) instanceof TypeError)
})

gate('subscribe fires on a change, not on an ignored event, and unsubscribe stops it', () => {
  const m = clientBoot()
  const seen = []
  const stop = m.subscribe((value) => seen.push(value))
  m.send('SELECT')
  assert.equal(seen.length, 0)
  m.send('ASSETS_READY')
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], ready())
  stop()
  m.send('SELECT')
  assert.equal(seen.length, 1)
})

gate('matches uses xstate partial patterns over the state value', () => {
  const m = clientBoot()
  assert.equal(m.matches('loading'), true)
  assert.equal(m.matches('ready'), false)
  drive(m, ['ASSETS_READY'])
  assert.equal(m.matches('ready'), true)
  assert.equal(m.matches({ ready: { mode: 'playing' } }), true)
  assert.equal(m.matches({ ready: { docks: { left: 'expanded' } } }), true)
  assert.equal(m.matches({ ready: { mode: 'editor' } }), false)
  assert.equal(m.matches({ ready: { mode: 'nope' } }), false)
  assert.equal(m.matches('constructor'), false)
})

gate('the client machine state matches the spoint state value at each step of a fixed run', () => {
  const m = clientBoot()
  const run = [
    ['ENTER_SPECTATOR', 'loading'],
    ['ASSETS_READY', ready()],
    ['ENTER_SPECTATOR', ready({ mode: { spectator: 'free' } })],
    ['TOGGLE_EDITOR', ready({ mode: { spectator: 'free' } })],
    ['SPECTATE_FOLLOW', ready({ mode: { spectator: 'follow' } })],
    ['EXIT_SPECTATOR', ready({ mode: 'playing' })],
    ['DRAG', ready({ mode: 'playing', gizmo: 'translateDrag' })],
    ['TOGGLE_EDITOR', ready({ mode: 'editor' })],
  ]
  for (const [type, expected] of run) {
    m.send(type)
    assert.deepEqual(m.state, expected, 'after ' + type)
  }
})

const loadingBoot = (t = { now: 0 }) => createLoadingStateMachine({ now: () => t.now })

gate('the loading timeouts are spoint values, 10 s fallback and 45 s hard', () => {
  assert.equal(LOADING_FALLBACK_MS, 10000)
  assert.equal(LOADING_HARD_MS, 45000)
})

gate('the loading machine starts loading with the connecting label and progress 1/6', () => {
  const t = { now: 0 }
  const m = loadingBoot(t)
  assert.equal(m.state, 'loading')
  assert.equal(m.label, 'Connecting...')
  assert.ok(Math.abs(m.progress - 1 / 6) < 1e-12)
  assert.equal(m.inputsDone, false)
  assert.equal(m.isReady, false)
})

gate('ASSETS_DONE moves through checking and stays loading until every step is done', () => {
  const m = loadingBoot()
  m.send('ASSETS_DONE')
  assert.equal(m.state, 'loading')
  assert.equal(m.label, 'Loading environment...')
  assert.ok(Math.abs(m.progress - 2 / 6) < 1e-12)
})

gate('the full path reaches ready, then worldReady once the world exists', () => {
  const m = loadingBoot()
  for (const type of ['ASSETS_DONE', 'ENVIRONMENT_DONE', 'FIRST_SNAPSHOT', 'MODELS_DONE']) m.send(type)
  assert.equal(m.state, 'ready')
  assert.equal(m.label, 'Starting game...')
  assert.equal(m.inputsDone, true)
  assert.equal(m.isReady, false)
  m.send('WORLD_EXISTS')
  assert.equal(m.state, 'worldReady')
  assert.equal(m.isWorldReady, true)
  assert.equal(m.isReady, true)
  assert.equal(m.progress, 1)
})

gate('a world that exists before readiness goes to worldReady on entry', () => {
  const m = loadingBoot()
  m.send('WORLD_EXISTS')
  assert.equal(m.state, 'loading')
  for (const type of ['ASSETS_DONE', 'ENVIRONMENT_DONE', 'FIRST_SNAPSHOT', 'MODELS_DONE']) m.send(type)
  assert.equal(m.state, 'worldReady')
})

gate('progress counts the four steps, the pending count and the world', () => {
  const m = loadingBoot()
  for (const type of ['ASSETS_DONE', 'ENVIRONMENT_DONE', 'FIRST_SNAPSHOT', 'MODELS_DONE']) m.send(type)
  assert.equal(m.state, 'ready')
  assert.ok(Math.abs(m.progress - 5 / 6) < 1e-12)
  const partial = loadingBoot()
  partial.send('ASSETS_DONE')
  partial.send('WORLD_CONFIG')
  assert.equal(partial.label, 'Syncing with server...')
  assert.ok(Math.abs(partial.progress - 2 / 6) < 1e-12)
})

gate('pending entities block readiness until each one loads', () => {
  const m = loadingBoot()
  for (const type of ['ASSETS_DONE', 'ENVIRONMENT_DONE', 'FIRST_SNAPSHOT']) m.send(type)
  m.send({ type: 'SET_PENDING', count: 2 })
  m.send('MODELS_DONE')
  assert.equal(m.state, 'loading')
  m.send('ENTITY_LOADED')
  assert.equal(m.state, 'loading')
  m.send('ENTITY_LOADED')
  assert.equal(m.state, 'ready')
})

gate('ENTITY_LOADED never takes the pending count below zero and SET_PENDING without a count sets zero', () => {
  const m = loadingBoot()
  m.send('ENTITY_LOADED')
  assert.equal(m.context.entityPending, 0)
  m.send({ type: 'SET_PENDING', count: 3 })
  m.send({ type: 'SET_PENDING' })
  assert.equal(m.context.entityPending, 0)
})

gate('MODEL_LOAD_FAILED sets the failure label with its reason and keeps the machine loading', () => {
  const m = loadingBoot()
  m.send({ type: 'MODEL_LOAD_FAILED', reasonCode: 'boom' })
  assert.equal(m.state, 'loading')
  assert.equal(m.label, 'Connection failed: boom -- reload to retry')
  const bare = loadingBoot()
  bare.send('MODEL_LOAD_FAILED')
  assert.equal(bare.label, 'Connection failed: model load failed -- reload to retry')
})

gate('the 10 s fallback goes ready once a first snapshot and an environment exist', () => {
  const t = { now: 0 }
  const m = loadingBoot(t)
  m.send('FIRST_SNAPSHOT')
  m.send('ENVIRONMENT_DONE')
  t.now = LOADING_FALLBACK_MS - 1
  m.tick()
  assert.equal(m.state, 'loading')
  t.now = LOADING_FALLBACK_MS
  m.tick()
  assert.equal(m.state, 'ready')
  assert.equal(m.label, 'Starting game...')
})

gate('the fallback needs both the snapshot and the environment', () => {
  const t = { now: 0 }
  const m = loadingBoot(t)
  m.send('FIRST_SNAPSHOT')
  t.now = LOADING_FALLBACK_MS
  m.tick()
  assert.equal(m.state, 'loading')
  t.now = LOADING_HARD_MS - 1
  m.tick()
  assert.equal(m.state, 'loading')
})

gate('the 45 s hard timeout goes ready from entry, with no repeat of the fallback', () => {
  const t = { now: 0 }
  const m = loadingBoot(t)
  t.now = LOADING_FALLBACK_MS
  m.tick()
  assert.equal(m.state, 'loading')
  t.now = LOADING_HARD_MS - 1
  m.tick()
  assert.equal(m.state, 'loading')
  t.now = LOADING_HARD_MS
  m.tick()
  assert.equal(m.state, 'ready')
})

gate('a model failure blocks both timeouts', () => {
  const t = { now: 0 }
  const m = loadingBoot(t)
  m.send('FIRST_SNAPSHOT')
  m.send('ENVIRONMENT_DONE')
  m.send('MODEL_LOAD_FAILED')
  t.now = LOADING_FALLBACK_MS
  m.tick()
  assert.equal(m.state, 'loading')
  t.now = LOADING_HARD_MS
  m.tick()
  assert.equal(m.state, 'loading')
})

gate('FORCE_READY goes ready without a model failure and is refused with one', () => {
  const free = loadingBoot()
  free.send('FORCE_READY')
  assert.equal(free.state, 'ready')
  const failed = loadingBoot()
  failed.send('MODEL_LOAD_FAILED')
  failed.send('FORCE_READY')
  assert.equal(failed.state, 'loading')
})

gate('re-entering loading from checking restarts both timers from that moment', () => {
  const t = { now: 0 }
  const m = loadingBoot(t)
  t.now = 5000
  m.send('FIRST_SNAPSHOT')
  m.send('ENVIRONMENT_DONE')
  assert.equal(m.state, 'loading')
  t.now = 5000 + LOADING_FALLBACK_MS - 1
  m.tick()
  assert.equal(m.state, 'loading')
  t.now = 5000 + LOADING_FALLBACK_MS
  m.tick()
  assert.equal(m.state, 'ready')
})

gate('a world that exists during the timeouts still reaches worldReady on entry', () => {
  const t = { now: 0 }
  const m = loadingBoot(t)
  m.send('FIRST_SNAPSHOT')
  m.send('ENVIRONMENT_DONE')
  m.send('WORLD_EXISTS')
  t.now = LOADING_FALLBACK_MS
  m.tick()
  assert.equal(m.state, 'worldReady')
})

gate('the loading machine refuses a missing clock and an event without a type', () => {
  assert.ok(refusalOf(() => createLoadingStateMachine({})) instanceof TypeError)
  assert.ok(refusalOf(() => loadingBoot().send({})) instanceof TypeError)
})

gate('an unknown loading event changes nothing', () => {
  const m = loadingBoot()
  const before = m.context
  assert.equal(m.send('constructor'), false)
  assert.equal(m.send('NOT_AN_EVENT'), false)
  assert.equal(m.context, before)
})

gate('subscribe reports the ready entry and matches uses the state name', () => {
  const m = loadingBoot()
  const seen = []
  m.subscribe((value) => seen.push(value))
  assert.equal(m.matches('loading'), true)
  for (const type of ['ASSETS_DONE', 'ENVIRONMENT_DONE', 'FIRST_SNAPSHOT', 'MODELS_DONE']) m.send(type)
  assert.equal(seen[seen.length - 1], 'ready')
  assert.equal(m.matches('ready'), true)
  assert.equal(m.matches('worldReady'), false)
})

gate('a clock at zero steps at once and then waits one period', () => {
  const clock = fakeClock()
  const calls = []
  const stepper = createInputStepper({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getPeriodMs: () => 100,
    onStep: (at, period) => calls.push([at, period]),
    onError: (error) => { throw error },
  })
  stepper.start()
  assert.deepEqual(calls, [[0, 100]])
  assert.deepEqual(clock.dueTimes(), [100])
  clock.advance(100)
  assert.deepEqual(calls, [[0, 100], [100, 100]])
})

gate('after a stall the stepper drops to the catch-up cap and steps only the cap count', () => {
  assert.equal(MAX_CATCH_UP_MS, 250)
  const clock = fakeClock()
  const calls = []
  const stepper = createInputStepper({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getPeriodMs: () => 100,
    onStep: (at, period) => calls.push([at, period]),
    onError: (error) => { throw error },
  })
  stepper.start()
  clock.set(1000)
  clock.fire()
  assert.deepEqual(calls, [[0, 100], [750, 100], [850, 100], [950, 100]])
  assert.deepEqual(clock.dueTimes(), [1050])
  clock.advance(1050)
  assert.deepEqual(calls[calls.length - 1], [1050, 100])
})

gate('pump steps when the due time has passed without the timer firing', () => {
  const clock = fakeClock()
  const calls = []
  const stepper = createInputStepper({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getPeriodMs: () => 100,
    onStep: (at) => calls.push(at),
    onError: (error) => { throw error },
  })
  stepper.start()
  clock.set(50)
  stepper.pump()
  assert.deepEqual(calls, [0])
  clock.set(100)
  stepper.pump()
  assert.deepEqual(calls, [0, 100])
  assert.deepEqual(clock.dueTimes(), [200])
})

gate('stop cancels the pending timer and nothing steps afterwards', () => {
  const clock = fakeClock()
  const calls = []
  const stepper = createInputStepper({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getPeriodMs: () => 100,
    onStep: (at) => calls.push(at),
    onError: (error) => { throw error },
  })
  stepper.start()
  stepper.stop()
  assert.equal(clock.pending, 0)
  assert.equal(stepper.running, false)
  clock.advance(500)
  assert.deepEqual(calls, [0])
})

gate('start while running does nothing and a restart steps from the current clock', () => {
  const clock = fakeClock()
  const calls = []
  const stepper = createInputStepper({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getPeriodMs: () => 100,
    onStep: (at) => calls.push(at),
    onError: (error) => { throw error },
  })
  stepper.start()
  stepper.start()
  assert.deepEqual(calls, [0])
  stepper.stop()
  clock.set(500)
  stepper.start()
  assert.deepEqual(calls, [0, 500])
})

gate('a throw from onStep reaches onError and the rest of the burst still runs', () => {
  const clock = fakeClock()
  const calls = []
  const errors = []
  const stepper = createInputStepper({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getPeriodMs: () => 100,
    onStep: (at) => {
      calls.push(at)
      if (at === 850) throw new Error('step failed')
    },
    onError: (error) => errors.push(error.message),
  })
  stepper.start()
  clock.set(1000)
  clock.fire()
  assert.deepEqual(calls, [0, 750, 850, 950])
  assert.deepEqual(errors, ['step failed'])
  assert.equal(stepper.running, true)
})

gate('a period that is not positive and finite is refused and leaves the stepper stopped', () => {
  for (const period of [0, -5, Number.NaN, Infinity]) {
    const clock = fakeClock()
    const stepper = createInputStepper({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      getPeriodMs: () => period,
      onStep: () => {},
      onError: () => {},
    })
    const error = refusalOf(() => stepper.start())
    assert.ok(error instanceof RangeError, 'period ' + period + ' was not refused')
    assert.equal(stepper.running, false)
    assert.equal(clock.pending, 0)
  }
})

gate('the stepper refuses a missing clock, timer, period source, step or error sink', () => {
  const clock = fakeClock()
  const full = {
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getPeriodMs: () => 100,
    onStep: () => {},
    onError: () => {},
  }
  for (const key of ['now', 'setTimer', 'clearTimer', 'getPeriodMs', 'onStep', 'onError']) {
    const partial = { ...full, [key]: undefined }
    assert.ok(refusalOf(() => createInputStepper(partial)) instanceof TypeError, 'missing ' + key + ' was accepted')
  }
  assert.doesNotThrow(() => createInputStepper(full))
})

gate('stateMatches matches a string leaf, a nested object pattern and a missing key, and refuses a non-object value', () => {
  assert.equal(stateMatches('idle', 'idle'), true)
  assert.equal(stateMatches('idle', 'run'), false)
  assert.equal(stateMatches({ a: { b: 'x' } }, { a: 'b' }), true)
  assert.equal(stateMatches({ a: {} }, { a: 'b' }), false)
  assert.equal(stateMatches(null, { a: 'b' }), false)
  assert.equal(stateMatches(3, 'x'), false)
})

finish()
