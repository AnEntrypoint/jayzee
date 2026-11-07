const INVALID_INPUT = 'invalid-input'
const UNREACHABLE = 'unreachable'
const BUDGET_EXHAUSTED = 'budget-exhausted'
const NUMERIC_KEY = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

const identityKeys = new WeakMap()
let nextIdentityKey = 0

const identityKeyOf = (value) => {
  let key = identityKeys.get(value)
  if (key === undefined) {
    key = nextIdentityKey++
    identityKeys.set(value, key)
  }
  return key
}

const isPlainObject = (value) => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const encodeNode = (value, active) => {
  if (value === null) return ['null']
  const type = typeof value
  if (type === 'string') return ['string', value]
  if (type === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)]
  if (type === 'boolean') return ['boolean', value]
  if (type === 'bigint') return ['bigint', String(value)]
  if (type === 'symbol') return ['symbol', String(value)]
  if (type === 'undefined') return ['undefined']
  if (active.has(value)) return ['identity', identityKeyOf(value)]
  active.add(value)
  let encoded
  if (Array.isArray(value)) encoded = ['array', value.map((item) => encodeNode(item, active))]
  else if (isPlainObject(value)) encoded = ['object', Object.keys(value).sort().map((key) => [key, encodeNode(value[key], active)])]
  else encoded = ['identity', identityKeyOf(value)]
  active.delete(value)
  return encoded
}

const nodeKeyOf = (value) => JSON.stringify(encodeNode(value, new Set()))

const refusal = (reasonCode, expanded = 0, truncated = false) => ({ ok: false, reasonCode, points: [], cost: Infinity, expanded, truncated })

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

const isPrimitiveKey = (node) => typeof node === 'string' || typeof node === 'number' || typeof node === 'symbol'

const isIterable = (value) => value !== null && value !== undefined && typeof value !== 'string' && typeof value[Symbol.iterator] === 'function'

const isRecordObject = (entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry) && isPlainObject(entry)

const isFiniteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

const isValidBudget = (budget) => budget === Infinity || isFiniteNonNegative(budget)

const adjacencyFor = (neighbors, node, key) => {
  if (typeof neighbors === 'function') return neighbors(node)
  if (neighbors instanceof Map) {
    if (neighbors.has(node)) return neighbors.get(node)
    if (neighbors.has(key)) return neighbors.get(key)
    return undefined
  }
  if (isPrimitiveKey(node) && hasOwn(neighbors, node)) return neighbors[node]
  if (hasOwn(neighbors, key)) return neighbors[key]
  return undefined
}

const neighborRecords = (adjacency, preferNumbers) => {
  if (adjacency === null || adjacency === undefined) return []
  if (typeof adjacency === 'string') return null
  if (adjacency instanceof Map) return Array.from(adjacency.entries(), ([node, cost]) => ({ node, explicitCost: cost }))
  if (isIterable(adjacency)) {
    return Array.from(adjacency, (entry) => {
      if (isRecordObject(entry)) {
        const node = entry.node !== undefined ? entry.node : entry.to
        if (node !== undefined) return { node, explicitCost: entry.cost }
      }
      return { node: entry, explicitCost: undefined }
    })
  }
  if (typeof adjacency === 'object') {
    return Object.keys(adjacency).map((key) => ({ node: preferNumbers && NUMERIC_KEY.test(key) ? Number(key) : key, explicitCost: adjacency[key] }))
  }
  return null
}

const nestedCost = (outer, to, toKey, explicitCost) => {
  const fallback = explicitCost === undefined ? NaN : explicitCost
  if (outer === null || outer === undefined) return fallback
  if (typeof outer === 'number') return outer
  if (typeof outer === 'function') return outer(to)
  if (outer instanceof Map) {
    if (outer.has(to)) return outer.get(to)
    if (outer.has(toKey)) return outer.get(toKey)
    return fallback
  }
  if (outer && typeof outer === 'object') {
    if (isPrimitiveKey(to) && hasOwn(outer, to)) return outer[to]
    if (hasOwn(outer, toKey)) return outer[toKey]
    return fallback
  }
  return fallback
}

const edgeCostBetween = (edgeCost, from, to, fromKey, toKey, explicitCost) => {
  if (typeof edgeCost === 'function') return edgeCost(from, to)
  if (edgeCost === null || edgeCost === undefined) return explicitCost === undefined ? NaN : explicitCost
  if (edgeCost instanceof Map) {
    const outer = edgeCost.has(from) ? edgeCost.get(from) : edgeCost.get(fromKey)
    return nestedCost(outer, to, toKey, explicitCost)
  }
  const outer = isPrimitiveKey(from) && hasOwn(edgeCost, from) ? edgeCost[from] : edgeCost[fromKey]
  return nestedCost(outer, to, toKey, explicitCost)
}

const heapBefore = (a, b) => a.cost < b.cost || (a.cost === b.cost && a.seq < b.seq)

const heapPush = (heap, item) => {
  heap.push(item)
  let i = heap.length - 1
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (!heapBefore(item, heap[parent])) break
    heap[i] = heap[parent]
    i = parent
  }
  heap[i] = item
}

const heapPop = (heap) => {
  const top = heap[0]
  const last = heap.pop()
  if (heap.length) {
    heap[0] = last
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let smallest = i
      if (left < heap.length && heapBefore(heap[left], heap[smallest])) smallest = left
      if (right < heap.length && heapBefore(heap[right], heap[smallest])) smallest = right
      if (smallest === i) break
      const swap = heap[smallest]
      heap[smallest] = heap[i]
      heap[i] = swap
      i = smallest
    }
  }
  return top
}

const tracePath = (goalKey, startKey, previous, nodeByKey) => {
  const maxPoints = nodeByKey.size + 1
  const points = []
  let cursor = goalKey
  while (cursor !== undefined) {
    points.push(nodeByKey.get(cursor))
    if (cursor === startKey) break
    cursor = previous.get(cursor)
    if (points.length > maxPoints) return null
  }
  return points.reverse()
}

const hasInvalidShape = ({ start, goal, neighbors, edgeCost, costAt, budget, ignore }) => {
  if (start === undefined || start === null || goal === undefined || goal === null) return true
  if (typeof neighbors !== 'function' && (!neighbors || typeof neighbors !== 'object')) return true
  if (edgeCost !== null && edgeCost !== undefined && typeof edgeCost !== 'function' && typeof edgeCost !== 'object') return true
  if (costAt !== null && typeof costAt !== 'function') return true
  if (!isValidBudget(budget)) return true
  return !ignore || typeof ignore === 'string' || typeof ignore[Symbol.iterator] !== 'function'
}

export function findCostCorridor(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return refusal(INVALID_INPUT)
  const { start, goal, neighbors, edgeCost, costAt = null, budget = Infinity, ignore = [] } = options
  if (hasInvalidShape({ start, goal, neighbors, edgeCost, costAt, budget, ignore })) return refusal(INVALID_INPUT)

  let startKey
  let goalKey
  let ignored
  try {
    startKey = nodeKeyOf(start)
    goalKey = nodeKeyOf(goal)
    ignored = new Set(Array.from(ignore, (node) => nodeKeyOf(node)))
  } catch {
    return refusal(INVALID_INPUT)
  }

  const nodeByKey = new Map()
  const register = (node) => {
    const key = nodeKeyOf(node)
    if (!nodeByKey.has(key)) nodeByKey.set(key, node)
    return key
  }
  register(start)
  register(goal)
  if (ignored.has(startKey) || ignored.has(goalKey)) return refusal(UNREACHABLE)

  const preferNumbers = typeof start === 'number' || typeof goal === 'number'
  const bestCost = new Map([[startKey, 0]])
  const previous = new Map()
  const settled = new Set()
  const frontier = []
  let sequence = 0
  let expanded = 0
  let budgetCut = false
  heapPush(frontier, { cost: 0, key: startKey, seq: sequence++ })

  while (frontier.length) {
    const current = heapPop(frontier)
    if (settled.has(current.key) || current.cost > (bestCost.get(current.key) ?? Infinity)) continue
    settled.add(current.key)
    expanded += 1
    if (current.key === goalKey) {
      const points = tracePath(goalKey, startKey, previous, nodeByKey)
      if (points === null) return refusal(INVALID_INPUT, expanded)
      return { ok: true, points, cost: current.cost, expanded, truncated: false }
    }

    const fromNode = nodeByKey.get(current.key)
    let records
    try {
      records = neighborRecords(adjacencyFor(neighbors, fromNode, current.key), preferNumbers)
    } catch {
      return refusal(INVALID_INPUT, expanded)
    }
    if (records === null) return refusal(INVALID_INPUT, expanded)

    for (const record of records) {
      if (record.node === undefined || record.node === null) return refusal(INVALID_INPUT, expanded)
      let toKey
      let toNode
      try {
        toKey = register(record.node)
        toNode = nodeByKey.get(toKey)
      } catch {
        return refusal(INVALID_INPUT, expanded)
      }
      if (ignored.has(toKey) || settled.has(toKey)) continue

      let edge
      let multiplier
      try {
        edge = edgeCostBetween(edgeCost, fromNode, toNode, current.key, toKey, record.explicitCost)
        multiplier = costAt === null ? 1 : costAt(toNode)
      } catch {
        return refusal(INVALID_INPUT, expanded)
      }
      if (!isFiniteNonNegative(edge) || !isFiniteNonNegative(multiplier)) return refusal(INVALID_INPUT, expanded)
      const stepCost = edge * multiplier
      if (!Number.isFinite(stepCost)) return refusal(INVALID_INPUT, expanded)
      const tentative = current.cost + stepCost
      if (!Number.isFinite(tentative)) return refusal(INVALID_INPUT, expanded)
      if (tentative > budget) {
        budgetCut = true
        continue
      }
      const known = bestCost.get(toKey)
      if (known === undefined || tentative < known) {
        bestCost.set(toKey, tentative)
        previous.set(toKey, current.key)
        heapPush(frontier, { cost: tentative, key: toKey, seq: sequence++ })
      }
    }
  }

  if (budgetCut) return refusal(BUDGET_EXHAUSTED, expanded, true)
  return refusal(UNREACHABLE, expanded, false)
}

export default findCostCorridor
