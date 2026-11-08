import { stateMatches } from './stateValue.js'

export const SNAP_DEFAULT_SIZE = 0.25

const EDITOR_EVENTS = new Set(['EXIT_EDITOR', 'TOGGLE_EDITOR'])

const table = (entries) => new Map(entries)

const MODE_TRANSITIONS = {
  playing: table([['TOGGLE_EDITOR', 'editor'], ['OPEN_LOBBY', 'lobby'], ['ENTER_SPECTATOR', 'spectator']]),
  editor: table([['TOGGLE_EDITOR', 'playing'], ['EXIT_EDITOR', 'playing'], ['PLAYTEST', 'playtesting']]),
  playtesting: table([['PLAYTEST_STOP', 'editor'], ['EXIT_EDITOR', 'playing']]),
  lobby: table([['CLOSE_LOBBY', 'playing'], ['OPEN_LOBBY', 'playing']]),
}

const SPECTATOR_TRANSITIONS = {
  free: table([['SPECTATE_FOLLOW', 'follow']]),
  follow: table([['SPECTATE_FREE', 'free']]),
}

const GIZMO_TRANSITIONS = {
  translate: table([['ROTATE', 'rotate'], ['SCALE', 'scale'], ['DRAG', 'translateDrag']]),
  translateDrag: table([['DROP', 'translate']]),
  rotate: table([['TRANSLATE', 'translate'], ['SCALE', 'scale'], ['DRAG', 'rotateDrag']]),
  rotateDrag: table([['DROP', 'rotate']]),
  scale: table([['TRANSLATE', 'translate'], ['ROTATE', 'rotate'], ['DRAG', 'scaleDrag']]),
  scaleDrag: table([['DROP', 'scale']]),
}

const SELECT_TRANSITIONS = {
  none: table([['SELECT', 'selected']]),
  selected: table([['SELECT', 'selected'], ['DESELECT', 'none']]),
}

const SNAP_TRANSITIONS = {
  off: table([['SNAP_ON', 'on']]),
  on: table([['SNAP_OFF', 'off']]),
}

const LEFT_DOCK_TRANSITIONS = {
  expanded: table([['COLLAPSE_LEFT', 'collapsed']]),
  collapsed: table([['EXPAND_LEFT', 'expanded']]),
}

const RIGHT_DOCK_TRANSITIONS = {
  expanded: table([['COLLAPSE_RIGHT', 'collapsed']]),
  collapsed: table([['EXPAND_RIGHT', 'expanded']]),
}

const readyRegions = () => ({
  mode: 'playing', spectator: 'free', gizmo: 'translate', select: 'none', snap: 'off', left: 'expanded', right: 'expanded',
})

const regionStep = (transitions, current, type, resetTo) => {
  const next = transitions[current].get(type)
  if (next !== undefined) return next
  if (resetTo !== null && EDITOR_EVENTS.has(type)) return resetTo
  return current
}

const modeStep = (regions, type) => {
  if (regions.mode === 'spectator') {
    if (type === 'EXIT_SPECTATOR') return { mode: 'playing', spectator: 'free' }
    const next = SPECTATOR_TRANSITIONS[regions.spectator].get(type)
    return next === undefined ? {} : { spectator: next }
  }
  const next = MODE_TRANSITIONS[regions.mode].get(type)
  if (next === undefined) return {}
  return next === 'spectator' ? { mode: 'spectator', spectator: 'free' } : { mode: next }
}

const readyStep = (regions, type) => {
  const next = {
    ...regions,
    ...modeStep(regions, type),
    gizmo: regionStep(GIZMO_TRANSITIONS, regions.gizmo, type, 'translate'),
    select: regionStep(SELECT_TRANSITIONS, regions.select, type, 'none'),
    snap: regionStep(SNAP_TRANSITIONS, regions.snap, type, 'off'),
    left: regionStep(LEFT_DOCK_TRANSITIONS, regions.left, type, null),
    right: regionStep(RIGHT_DOCK_TRANSITIONS, regions.right, type, null),
  }
  return Object.keys(next).every((key) => next[key] === regions[key]) ? regions : next
}

const loadingStep = (type) => {
  if (type === 'ASSETS_READY') return { top: 'ready', regions: readyRegions() }
  if (type === 'TOGGLE_EDITOR') return { top: 'ready', regions: { ...readyRegions(), mode: 'editor' } }
  if (type === 'OPEN_LOBBY') return { top: 'ready', regions: { ...readyRegions(), mode: 'lobby' } }
  return null
}

const stateStep = (state, type) => {
  if (state.top === 'loading') {
    const entered = loadingStep(type)
    return entered ?? state
  }
  const regions = readyStep(state.regions, type)
  return regions === state.regions ? state : { top: 'ready', regions }
}

const valueOf = (state) => {
  if (state.top === 'loading') return 'loading'
  const r = state.regions
  return {
    ready: {
      mode: r.mode === 'spectator' ? { spectator: r.spectator } : r.mode,
      gizmo: r.gizmo,
      select: r.select,
      snap: r.snap,
      docks: { left: r.left, right: r.right },
    },
  }
}

const contextStep = (context, event) => {
  if (event.type === 'SNAP') {
    return { ...context, snapSize: event.size != null ? event.size : SNAP_DEFAULT_SIZE }
  }
  if (event.type === 'SET_CAMERA_MODE') {
    return { ...context, headBoneHidden: !!event.inHead }
  }
  return context
}

export function createClientStateMachine() {
  let state = { top: 'loading' }
  let context = { snapSize: SNAP_DEFAULT_SIZE, headBoneHidden: false }
  const listeners = new Set()

  const readRegion = (key) => (state.top === 'ready' ? state.regions[key] : undefined)
  const inReady = (mode) => state.top === 'ready' && state.regions.mode === mode

  const send = (type) => {
    const event = typeof type === 'string' ? { type } : type
    if (event === null || typeof event !== 'object' || typeof event.type !== 'string') {
      throw new TypeError('client machine events need a string type')
    }
    const nextContext = contextStep(context, event)
    const nextState = stateStep(state, event.type)
    const changed = nextState !== state || nextContext !== context
    state = nextState
    context = nextContext
    if (changed) {
      const value = valueOf(state)
      for (const listener of listeners) listener(value, { value, context })
    }
    return changed
  }

  return {
    send,
    matches: (pattern) => stateMatches(valueOf(state), pattern),
    get state() { return valueOf(state) },
    get context() { return context },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    get isReady() { return state.top === 'ready' },
    get isEditor() { return inReady('editor') },
    get isLobby() { return inReady('lobby') },
    get isPlaying() { return inReady('playing') },
    get isPlaytesting() { return inReady('playtesting') },
    get isSpectator() { return inReady('spectator') },
    get spectatorSubmode() { return inReady('spectator') ? state.regions.spectator : null },
    get isSelected() { return readRegion('select') === 'selected' },
    get gizmoMode() { return state.top === 'ready' ? state.regions.gizmo.replace('Drag', '') : 'translate' },
    get isDragging() { return state.top === 'ready' && state.regions.gizmo.endsWith('Drag') },
    get snapOn() { return readRegion('snap') === 'on' },
    get snapSize() { return context.snapSize },
    get dockLeftCollapsed() { return readRegion('left') === 'collapsed' },
    get dockRightCollapsed() { return readRegion('right') === 'collapsed' },
    get editMode() { return inReady('editor') },
    get headBoneHidden() { return context.headBoneHidden },
  }
}
