const LOOP_ONCE = 2200
const LOOP_REPEAT = 2201
const DEFAULT_FADE_SECONDS = 0.2
const MIXER_METHODS = ['clipAction', 'update']
const ACTION_METHODS = ['play', 'stop', 'reset', 'fadeIn', 'fadeOut', 'setLoop', 'setEffectiveWeight', 'setEffectiveTimeScale', 'getEffectiveWeight', 'isRunning']

export const BLENDER_REFUSAL = Object.freeze({
  MIXER: 'animation-blender-mixer',
  CLIP: 'animation-blender-clip',
  DUPLICATE: 'animation-blender-duplicate-name',
  UNKNOWN: 'animation-blender-unknown-name',
  NUMBER: 'animation-blender-number',
  TREE: 'animation-blender-tree',
  DISPOSED: 'animation-blender-disposed',
})

export class AnimationBlenderError extends Error {
  constructor(code, message) {
    super(code + ': ' + message)
    this.name = 'AnimationBlenderError'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new AnimationBlenderError(code, message)
}

const missingMethods = (value, names) => names.filter((name) => typeof value?.[name] !== 'function')

const finiteAtLeastZero = (value, what) => {
  if (!Number.isFinite(value) || value < 0) refuse(BLENDER_REFUSAL.NUMBER, what + ' must be a finite number of at least 0, got ' + String(value))
  return value
}

const finite = (value, what) => {
  if (!Number.isFinite(value)) refuse(BLENDER_REFUSAL.NUMBER, what + ' must be a finite number, got ' + String(value))
  return value
}

export class AnimationBlender {
  constructor(mixer, options = {}) {
    const missing = missingMethods(mixer, MIXER_METHODS)
    if (missing.length > 0) refuse(BLENDER_REFUSAL.MIXER, 'the mixer needs ' + missing.join(', '))
    this.mixer = mixer
    this.defaultFade = finiteAtLeastZero(options.defaultFade ?? DEFAULT_FADE_SECONDS, 'defaultFade')
    this.entries = new Map()
    this.order = []
    this.current = null
    this.tree = null
    this.treeNames = []
    this.disposed = false
  }

  _live() {
    if (this.disposed) refuse(BLENDER_REFUSAL.DISPOSED, 'the blender was disposed and holds no action')
  }

  _entry(name) {
    const entry = this.entries.get(name)
    if (!entry) refuse(BLENDER_REFUSAL.UNKNOWN, 'no clip is registered as ' + JSON.stringify(name ?? null) + ' (have: ' + this.order.join(', ') + ')')
    return entry
  }

  addClip(name, clip, options = {}) {
    this._live()
    if (typeof name !== 'string' || name.length === 0) refuse(BLENDER_REFUSAL.CLIP, 'a clip name must be a non-empty string')
    if (clip === null || typeof clip !== 'object') refuse(BLENDER_REFUSAL.CLIP, 'clip ' + JSON.stringify(name) + ' is ' + String(clip))
    if (this.entries.has(name)) refuse(BLENDER_REFUSAL.DUPLICATE, 'clip ' + JSON.stringify(name) + ' is already registered')
    const timeScale = finite(options.timeScale ?? 1, 'timeScale')
    const action = this.mixer.clipAction(clip)
    const missing = missingMethods(action, ACTION_METHODS)
    if (missing.length > 0) refuse(BLENDER_REFUSAL.MIXER, 'the action for ' + JSON.stringify(name) + ' needs ' + missing.join(', '))
    const loop = options.loop !== false
    action.setLoop(loop ? LOOP_REPEAT : LOOP_ONCE, loop ? Infinity : 1)
    action.clampWhenFinished = !loop
    const duration = Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 0
    this.entries.set(name, { name, clip, action, loop, timeScale, duration, weight: 0, active: false })
    this.order.push(name)
    return this
  }

  has(name) {
    return this.entries.has(name)
  }

  names() {
    return this.order.slice()
  }

  _start(entry, weight, fade) {
    entry.action.reset()
    entry.action.setEffectiveTimeScale(entry.timeScale)
    entry.action.setEffectiveWeight(weight)
    if (fade > 0) entry.action.fadeIn(fade)
    entry.action.play()
    entry.weight = weight
    entry.active = true
  }

  _end(entry, fade) {
    if (!entry.active) return
    if (fade > 0) entry.action.fadeOut(fade)
    else entry.action.stop()
    entry.active = false
    entry.weight = 0
  }

  play(name, fade = this.defaultFade) {
    this._live()
    const next = this._entry(name)
    finiteAtLeastZero(fade, 'fade')
    if (this.current === name && this.tree === null && next.active && next.action.isRunning()) return this
    for (const other of this.entries.values()) {
      if (other !== next) this._end(other, fade)
    }
    this.tree = null
    this.treeNames = []
    this._start(next, 1, fade)
    this.current = name
    return this
  }

  stop(name, fade = 0) {
    this._live()
    finiteAtLeastZero(fade, 'fade')
    if (name === undefined) {
      for (const entry of this.entries.values()) this._end(entry, fade)
      this.current = null
      this.tree = null
      this.treeNames = []
      return this
    }
    this._end(this._entry(name), fade)
    if (this.current === name) this.current = null
    return this
  }

  setWeight(name, weight) {
    this._live()
    const entry = this._entry(name)
    finiteAtLeastZero(weight, 'weight')
    entry.weight = weight
    entry.action.setEffectiveWeight(weight)
    return this
  }

  setTimeScale(name, timeScale) {
    this._live()
    const entry = this._entry(name)
    entry.timeScale = finite(timeScale, 'timeScale')
    entry.action.setEffectiveTimeScale(entry.timeScale)
    return this
  }

  playTree(tree, options = {}) {
    this._live()
    if (!tree || !Array.isArray(tree.clips) || typeof tree.getWeight !== 'function') refuse(BLENDER_REFUSAL.TREE, 'a blend tree needs a clips array and getWeight(index)')
    if (tree.clips.length === 0) refuse(BLENDER_REFUSAL.TREE, 'a blend tree with no clip drives nothing')
    const fade = finiteAtLeastZero(options.fade ?? this.defaultFade, 'fade')
    const names = tree.clips.map((slot) => slot.clip)
    const members = names.map((name) => this._entry(name))
    if (new Set(names).size !== names.length) refuse(BLENDER_REFUSAL.TREE, 'a blend tree names one clip twice, so one action would carry two weights')
    for (const other of this.entries.values()) {
      if (!members.includes(other)) this._end(other, fade)
    }
    this.tree = tree
    this.treeNames = names
    this.treeSync = options.sync !== false
    this.current = null
    for (let i = 0; i < members.length; i++) {
      if (!members[i].active) this._start(members[i], 0, 0)
    }
    this.applyTree()
    return this
  }

  applyTree() {
    this._live()
    if (this.tree === null) return this
    const count = this.treeNames.length
    let total = 0
    let blendedDuration = 0
    for (let i = 0; i < count; i++) {
      const weight = this.tree.getWeight(i)
      if (!Number.isFinite(weight) || weight < 0) refuse(BLENDER_REFUSAL.TREE, 'blend tree weight ' + i + ' is ' + String(weight))
      total += weight
    }
    for (let i = 0; i < count; i++) {
      const entry = this.entries.get(this.treeNames[i])
      const weight = total > 0 ? this.tree.getWeight(i) / total : 0
      entry.weight = weight
      entry.action.setEffectiveWeight(weight)
      blendedDuration += weight * entry.duration
    }
    for (let i = 0; i < count; i++) {
      const entry = this.entries.get(this.treeNames[i])
      const synced = this.treeSync && blendedDuration > 0 && entry.duration > 0
      entry.action.setEffectiveTimeScale(synced ? entry.timeScale * entry.duration / blendedDuration : entry.timeScale)
    }
    return this
  }

  update(dt) {
    this._live()
    finiteAtLeastZero(dt, 'dt')
    if (this.tree !== null) this.applyTree()
    this.mixer.update(dt)
    return this
  }

  weightOf(name) {
    return this._entry(name).action.getEffectiveWeight()
  }

  targetWeightOf(name) {
    return this._entry(name).weight
  }

  isPlaying(name) {
    const entry = this._entry(name)
    return entry.active && entry.action.isRunning()
  }

  dispose() {
    if (this.disposed) return
    for (const entry of this.entries.values()) {
      entry.action.stop()
      if (typeof this.mixer.uncacheAction === 'function') this.mixer.uncacheAction(entry.clip)
    }
    this.entries.clear()
    this.order.length = 0
    this.current = null
    this.tree = null
    this.treeNames = []
    this.disposed = true
  }
}

export default AnimationBlender
