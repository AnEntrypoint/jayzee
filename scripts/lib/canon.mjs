export const canon = (value) => {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'number') return Object.is(value, -0) ? 'n:-0' : 'n:' + String(value)
  if (typeof value === 'string') return 's:' + JSON.stringify(value)
  if (typeof value === 'boolean') return 'b:' + String(value)
  if (typeof value === 'function') return 'fn'
  if (ArrayBuffer.isView(value)) return 'view:' + value.constructor.name + '[' + Array.from(value, canon).join(',') + ']'
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']'
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canon(value[key])).join(',') + '}'
}

export const firstDivergence = (got, want) => {
  const length = Math.max(got.length, want.length)
  for (let index = 0; index < length; index++) {
    if (got[index] !== want[index]) return { index, got: got[index] ?? '(missing)', want: want[index] ?? '(missing)' }
  }
  return null
}
