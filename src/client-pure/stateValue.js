const isObject = (value) => typeof value === 'object' && value !== null

export function stateMatches(value, pattern) {
  if (typeof pattern === 'string') {
    if (typeof value === 'string') return value === pattern
    return isObject(value) && Object.hasOwn(value, pattern)
  }
  if (!isObject(pattern) || !isObject(value)) return false
  return Object.keys(pattern).every((key) => Object.hasOwn(value, key) && stateMatches(value[key], pattern[key]))
}
