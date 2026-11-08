const requireFunction = (value, name) => {
  if (typeof value !== 'function') throw new TypeError(`EventBus ${name} must be a function`)
  return value
}

const requireChannel = (channel) => {
  if (typeof channel !== 'string') throw new TypeError('EventBus channel must be a string')
  return channel
}

const isWildcard = (channel) => channel.endsWith('*')

const emptyNode = () => ({ children: new Map(), handlers: [] })

const describeError = (error) => (error instanceof Error ? error.message : String(error))

export class EventBus {
  #now
  #error
  #warn
  #handlers = new Map()
  #scoped = new Map()
  #wildcards = emptyNode()

  constructor({ now, error, warn } = {}) {
    this.#now = requireFunction(now, 'now')
    this.#error = requireFunction(error, 'error')
    this.#warn = requireFunction(warn, 'warn')
  }

  on(channel, handler) {
    requireChannel(channel)
    requireFunction(handler, 'handler')
    if (!this.#handlers.has(channel)) this.#handlers.set(channel, new Set())
    this.#handlers.get(channel).add(handler)
    if (isWildcard(channel)) this.#rebuildWildcards()
    return () => this.off(channel, handler)
  }

  off(channel, handler) {
    const set = this.#handlers.get(channel)
    if (set) {
      for (const fn of set) {
        if (fn === handler || fn._original === handler) set.delete(fn)
      }
      if (set.size === 0) this.#handlers.delete(channel)
    }
    if (isWildcard(channel)) this.#rebuildWildcards()
  }

  once(channel, handler) {
    requireChannel(channel)
    requireFunction(handler, 'handler')
    const wrapper = (...args) => {
      this.off(channel, wrapper)
      handler(...args)
    }
    wrapper._original = handler
    return this.on(channel, wrapper)
  }

  #rebuildWildcards() {
    const root = emptyNode()
    for (const [pattern, handlers] of this.#handlers) {
      if (!isWildcard(pattern)) continue
      let node = root
      for (let i = 0; i < pattern.length - 1; i++) {
        const unit = pattern[i]
        if (!node.children.has(unit)) node.children.set(unit, emptyNode())
        node = node.children.get(unit)
      }
      node.handlers = [...handlers]
    }
    this.#wildcards = root
  }

  #invoke(fn, event, label) {
    try {
      fn(event)
    } catch (error) {
      this.#error(label, describeError(error))
    }
  }

  emit(channel, data, meta = {}) {
    const event = { channel, data, meta: { ...meta, timestamp: this.#now() } }
    const exact = this.#handlers.get(channel)
    if (exact) for (const fn of exact) this.#invoke(fn, event, `[EventBus] ${channel}:`)
    let node = this.#wildcards
    for (let i = 0; i < channel.length && node; i++) {
      for (const fn of node.handlers) this.#invoke(fn, event, `[EventBus] *${channel.slice(0, i)}*:`)
      node = node.children.get(channel[i])
    }
    if (node) for (const fn of node.handlers) this.#invoke(fn, event, '[EventBus]:')
    return event
  }

  scope(entityId) {
    const unsubscribers = []
    let released = false

    const subscribe = (channel, handler) => {
      if (released) {
        this.#warn(`[EventBus] ${entityId}: ignored '${channel}' subscription on a released scope`)
        return () => {}
      }
      const unsubscribe = this.on(channel, handler)
      unsubscribers.push(unsubscribe)
      return unsubscribe
    }

    const scoped = {
      on: subscribe,
      off: (channel, handler) => this.off(channel, handler),
      once: (channel, handler) => {
        const wrapper = (...args) => {
          scoped.off(channel, wrapper)
          handler(...args)
        }
        wrapper._original = handler
        return subscribe(channel, wrapper)
      },
      emit: (channel, data, meta = {}) => this.emit(channel, data, { ...meta, sourceEntity: entityId }),
      handover: (targetEntityId, stateData) => this.emit('system.handover', { targetEntityId, stateData }, { sourceEntity: entityId }),
      destroy: () => {
        released = true
        for (const unsubscribe of unsubscribers) unsubscribe()
        unsubscribers.length = 0
      },
    }
    this.#scoped.set(entityId, scoped)
    return scoped
  }

  destroyScope(entityId) {
    const scoped = this.#scoped.get(entityId)
    if (!scoped) return
    scoped.destroy()
    this.#scoped.delete(entityId)
  }

  clear() {
    for (const scoped of this.#scoped.values()) scoped.destroy()
    this.#scoped.clear()
    this.#handlers.clear()
    this.#wildcards = emptyNode()
  }
}
