export function numberToJson(value) {
  if (Object.is(value, -0)) return { $num: '-0' }
  if (typeof value === 'number' && !Number.isFinite(value)) return { $num: String(value) }
  return value
}

export function numberFromJson(value) {
  return value !== null && typeof value === 'object' && typeof value.$num === 'string' ? Number(value.$num) : value
}

export function build(j) {
  if (Array.isArray(j)) return j.map(build)
  if (j === null || typeof j !== 'object') return j
  if ('$map' in j) return new Map(j.$map.map(([k, v]) => [build(k), build(v)]))
  if ('$set' in j) return new Set(j.$set.map(build))
  if ('$undef' in j) return undefined
  if ('$num' in j) return Number(j.$num)
  if ('$date' in j) return new Date(j.$date)
  if ('$fn' in j) return () => 1
  const out = {}
  for (const [k, v] of Object.entries(j)) out[k] = build(v)
  return out
}

export function canon(v) {
  if (v === undefined) return { $undef: true }
  if (typeof v === 'function') return { $fn: true }
  if (typeof v === 'bigint') return { $big: String(v) }
  if (typeof v === 'number') return numberToJson(v)
  if (v === null || typeof v !== 'object') return v
  if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [canon(k), canon(x)]) }
  if (v instanceof Set) return { $set: [...v.values()].map(canon) }
  if (v instanceof Date) return { $date: v.toISOString() }
  if (Array.isArray(v)) return v.map(canon)
  const out = {}
  for (const [k, x] of Object.entries(v)) out[k] = canon(x)
  return out
}

export function snapshotJson(value) {
  return JSON.stringify(canon(value))
}
