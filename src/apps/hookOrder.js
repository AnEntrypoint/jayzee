export const HOOK_NAMES = Object.freeze(['onSpawn', 'onDestroy', 'update', 'lateUpdate', 'onInput'])

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0

export const createHookRunner = ({ tickDt, physics = null }) => {
  if (!(typeof tickDt === 'number' && tickDt > 0 && Number.isFinite(tickDt))) throw new RangeError('tickDt must be a positive finite number')
  if (physics !== null && typeof physics !== 'function') throw new TypeError('physics must be a function or null')
  const objects = new Map()
  const queued = []

  const add = (id, hooks = {}, { every = 1, ctx } = {}) => {
    if (objects.has(id)) throw new RangeError('object ' + id + ' is already bound')
    if (!isPositiveInteger(every)) throw new RangeError('every must be a positive integer, got ' + every)
    for (const name of Object.keys(hooks)) {
      if (!HOOK_NAMES.includes(name)) throw new RangeError('unknown hook ' + name)
      if (typeof hooks[name] !== 'function') throw new TypeError('hook ' + name + ' must be a function')
    }
    const updateImplied = hooks.lateUpdate !== undefined && hooks.update === undefined
    objects.set(id, { id, hooks, every, ctx, spawned: false, phase: id % every, updateImplied })
  }

  const remove = (id) => {
    const object = objects.get(id)
    if (!object) return []
    objects.delete(id)
    const errors = []
    if (typeof object.hooks.onDestroy === 'function') {
      try {
        object.hooks.onDestroy(object.ctx)
      } catch (error) {
        errors.push({ id, hook: 'onDestroy', message: error && error.message ? error.message : String(error) })
      }
    }
    return errors
  }

  const deliverInput = (id, input) => {
    if (!objects.has(id)) throw new RangeError('no object ' + id + ' to receive input')
    queued.push({ id, input })
  }

  const guard = (log, errors, id, hook, call) => {
    try {
      call()
      log.push({ phase: hook, id })
    } catch (error) {
      errors.push({ id, hook, message: error && error.message ? error.message : String(error) })
    }
  }

  const tick = (tickNumber) => {
    if (!Number.isInteger(tickNumber) || tickNumber < 0) throw new RangeError('tickNumber must be a non-negative integer')
    const log = []
    const errors = []
    const ordered = [...objects.values()].sort((a, b) => a.id - b.id)

    for (const object of ordered) {
      if (object.spawned) continue
      object.spawned = true
      if (typeof object.hooks.onSpawn === 'function') guard(log, errors, object.id, 'onSpawn', () => object.hooks.onSpawn(object.ctx))
    }

    while (queued.length > 0) {
      const { id, input } = queued.shift()
      const object = objects.get(id)
      if (!object || typeof object.hooks.onInput !== 'function') continue
      guard(log, errors, id, 'onInput', () => object.hooks.onInput(object.ctx, input))
    }

    const ranUpdate = []
    for (const object of ordered) {
      if (tickNumber % object.every !== object.phase) continue
      const dt = tickDt * object.every
      if (typeof object.hooks.update === 'function') {
        guard(log, errors, object.id, 'update', () => object.hooks.update(object.ctx, dt))
      }
      ranUpdate.push({ object, dt })
    }

    if (physics !== null) {
      try {
        physics(tickNumber)
        log.push({ phase: 'physics', id: null })
      } catch (error) {
        errors.push({ id: null, hook: 'physics', message: error && error.message ? error.message : String(error) })
      }
    }

    for (const { object, dt } of ranUpdate) {
      if (typeof object.hooks.lateUpdate !== 'function') continue
      guard(log, errors, object.id, 'lateUpdate', () => object.hooks.lateUpdate(object.ctx, dt))
    }

    return { tick: tickNumber, log, errors }
  }

  return {
    add,
    remove,
    deliverInput,
    tick,
    has: (id) => objects.has(id),
    isSpawned: (id) => objects.has(id) && objects.get(id).spawned,
    updateImplied: (id) => objects.has(id) && objects.get(id).updateImplied,
  }
}

export const phaseOrderHolds = (log) => {
  const updateAt = new Map()
  const lateAt = new Map()
  let physicsAt = -1
  log.forEach((entry, index) => {
    if (entry.phase === 'update') updateAt.set(entry.id, index)
    if (entry.phase === 'lateUpdate') lateAt.set(entry.id, index)
    if (entry.phase === 'physics') physicsAt = index
  })
  for (const [id, late] of lateAt) {
    if (!updateAt.has(id)) continue
    if (!(updateAt.get(id) < physicsAt && physicsAt < late)) return false
  }
  return true
}
