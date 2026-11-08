export function installCustomVersion(entity) {
  if (Object.getOwnPropertyDescriptor(entity, 'custom')?.get) return
  const initial = entity.custom
  entity._customRaw = null
  entity._customV = 0
  Object.defineProperty(entity, 'custom', {
    enumerable: true,
    configurable: true,
    get() { return entity._customRaw },
    set(value) {
      if (value !== null && value !== undefined && (typeof value !== 'object' || Array.isArray(value))) {
        throw new TypeError('entity.custom must be null or a plain object')
      }
      entity._customRaw = value == null ? null : wrapMutable(value, entity)
      entity._customV++
    },
  })
  entity.custom = initial || null
}

const bump = (entity) => { entity._customV++ }

const isWrappable = (value) => value !== null && typeof value === 'object' && !value.__isCustomVersionProxy && (value.constructor === Object || Array.isArray(value))

function wrapMutable(obj, entity) {
  if (obj === null || typeof obj !== 'object' || obj.__isCustomVersionProxy) return obj
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === '__isCustomVersionProxy') return true
      if (isWrappable(value)) {
        const wrapped = wrapMutable(value, entity)
        Reflect.set(target, prop, wrapped)
        return wrapped
      }
      return value
    },
    set(target, prop, value, receiver) {
      const ok = Reflect.set(target, prop, value, receiver)
      if (ok) bump(entity)
      return ok
    },
    deleteProperty(target, prop) {
      const ok = Reflect.deleteProperty(target, prop)
      if (ok) bump(entity)
      return ok
    },
  })
}
