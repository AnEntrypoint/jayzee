const pathRefusal = (reasonCode, message) => {
  const error = new TypeError(`[find-path-status] ${reasonCode}: ${message}`)
  error.reasonCode = reasonCode
  return error
}

const unreachable = () => ({ ok: false, points: [], partial: false, reasonCode: 'path-unreachable' })

const failedQuery = (reasonCode, error) => ({ ok: false, points: [], partial: false, reasonCode, message: String(error?.message ?? error) })

export const readPoint = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw pathRefusal('path-point-invalid', `${name} must be an array of three finite numbers`)
  return value
}

const routeFrom = async (query, from, to, options) => {
  try {
    return { value: await query(from, to, options) }
  } catch (error) {
    return { failure: failedQuery('path-query-failed', error) }
  }
}

const nearestFrom = async (nearest, from, to, options) => {
  try {
    return { value: await nearest(from, to, options) }
  } catch (error) {
    return { failure: failedQuery('path-nearest-failed', error) }
  }
}

export async function findPathWithStatus({ query, from, to, nearest = null, options = {} } = {}) {
  if (typeof query !== 'function') throw pathRefusal('path-query-invalid', 'query must be a function')
  readPoint(from, 'from')
  readPoint(to, 'to')
  if (nearest !== null && typeof nearest !== 'function') throw pathRefusal('path-nearest-invalid', 'nearest must be a function or null')
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw pathRefusal('path-options-invalid', 'options must be an object')

  const route = await routeFrom(query, from, to, options)
  if (route.failure) return route.failure
  const points = route.value
  if (Array.isArray(points) && points.length >= 2) {
    points.forEach((point, index) => readPoint(point, `points[${index}]`))
    return { ok: true, points, partial: false, reasonCode: null }
  }
  if (points !== null && points !== undefined) throw pathRefusal('path-result-invalid', 'query must return null or an array of at least two points')
  if (nearest === null) return unreachable()

  const cutoff = await nearestFrom(nearest, from, to, options)
  if (cutoff.failure) return cutoff.failure
  if (cutoff.value === null || cutoff.value === undefined) return unreachable()
  readPoint(cutoff.value, 'nearest')
  return { ok: false, points: [from, cutoff.value], partial: true, reasonCode: 'path-partial' }
}
