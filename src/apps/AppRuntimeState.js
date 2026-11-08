export function tagAppState(state) {
  if (!state) return null
  const replacer = (key, value) => {
    if (value instanceof Map) return { __type: 'Map', entries: [...value.entries()] }
    if (value instanceof Set) return { __type: 'Set', values: [...value.values()] }
    return value
  }
  return JSON.parse(JSON.stringify(state, replacer))
}

export function untagAppState(state) {
  if (!state) return null
  const reviver = (key, value) => {
    if (value && typeof value === 'object' && value.__type === 'Map' && Array.isArray(value.entries)) return new Map(value.entries)
    if (value && typeof value === 'object' && value.__type === 'Set' && Array.isArray(value.values)) return new Set(value.values)
    return value
  }
  return JSON.parse(JSON.stringify(state), reviver)
}
