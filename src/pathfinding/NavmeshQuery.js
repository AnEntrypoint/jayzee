const NO_POLYGON = -1
const INSIDE_EPSILON = 1e-3
const WINDING_EPSILON = 1e-9
const PATH_CACHE_LIMIT = 100

const cross2 = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax)

const pushFrontier = (heap, node, estimate) => {
  heap.push([estimate, node])
  let i = heap.length - 1
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap[parent][0] <= heap[i][0]) break
    ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
    i = parent
  }
}

const popFrontier = (heap) => {
  const top = heap[0]
  const last = heap.pop()
  if (heap.length) {
    heap[0] = last
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let smallest = i
      if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left
      if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right
      if (smallest === i) break
      ;[heap[smallest], heap[i]] = [heap[i], heap[smallest]]
      i = smallest
    }
  }
  return top[1]
}

export class NavmeshQuery {
  constructor(navmeshData) {
    const { vertices, polygons, links = [] } = navmeshData
    this.data = navmeshData
    this.vertices = vertices
    this.polygons = polygons
    this.bounds = navmeshData.bounds
    this.config = navmeshData.config || {}
    const polygonCount = polygons.length
    this.neighbors = Array.from({ length: polygonCount }, () => [])
    for (const link of links) {
      if (link.polygon >= 0 && link.polygon < polygonCount) this.neighbors[link.polygon] = link.neighbors.filter((k) => k >= 0 && k < polygonCount && k !== link.polygon)
    }
    this.centroids = new Float64Array(polygonCount * 3)
    this.boxes = new Float64Array(polygonCount * 4)
    for (let i = 0; i < polygonCount; i++) this.measurePolygon(i)
    this.pathCache = new Map()
  }

  measurePolygon(index) {
    const ring = this.polygons[index].vertices
    let sumX = 0
    let sumY = 0
    let sumZ = 0
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const vertexIndex of ring) {
      const v = this.vertices[vertexIndex]
      sumX += v[0]
      sumY += v[1]
      sumZ += v[2]
      if (v[0] < minX) minX = v[0]
      if (v[0] > maxX) maxX = v[0]
      if (v[2] < minZ) minZ = v[2]
      if (v[2] > maxZ) maxZ = v[2]
    }
    this.centroids.set([sumX / ring.length, sumY / ring.length, sumZ / ring.length], index * 3)
    this.boxes.set([minX, maxX, minZ, maxZ], index * 4)
    let doubleArea = 0
    for (let j = 0; j < ring.length; j++) {
      const a = this.vertices[ring[j]]
      const c = this.vertices[ring[(j + 1) % ring.length]]
      doubleArea += a[0] * c[2] - c[0] * a[2]
    }
    if (doubleArea < -WINDING_EPSILON) throw new Error(`navmesh polygon ${index} winds clockwise in x/z (signed area ${doubleArea}): _contains rejects every point of a clockwise polygon, so locate() would return -1 and findPath() null for the whole navmesh -- re-bake it`)
  }

  findPath(start, goal) {
    const key = start.map((v) => v.toFixed(2)).join(',') + '_' + goal.map((v) => v.toFixed(2)).join(',')
    let path = this.pathCache.get(key)
    if (path === undefined) {
      path = this.solve(start, goal)
      this.pathCache.set(key, path)
      if (this.pathCache.size > PATH_CACHE_LIMIT) this.pathCache.delete(this.pathCache.keys().next().value)
    }
    return path && path.map((p) => [...p])
  }

  locate(point) {
    let best = NO_POLYGON
    let bestDy = Infinity
    for (let i = 0; i < this.polygons.length; i++) {
      if (!this.contains(point, i)) continue
      const dy = Math.abs(point[1] - this.centroids[i * 3 + 1])
      if (dy < bestDy) {
        bestDy = dy
        best = i
      }
    }
    return best
  }

  clearCache() {
    this.pathCache.clear()
  }

  contains(point, index) {
    const b = this.boxes
    const o = index * 4
    if (point[0] < b[o] || point[0] > b[o + 1] || point[2] < b[o + 2] || point[2] > b[o + 3]) return false
    const ring = this.polygons[index].vertices
    for (let j = 0; j < ring.length; j++) {
      const a = this.vertices[ring[j]]
      const c = this.vertices[ring[(j + 1) % ring.length]]
      if (cross2(a[0], a[2], c[0], c[2], point[0], point[2]) < -INSIDE_EPSILON) return false
    }
    return true
  }

  solve(start, goal) {
    const startPolygon = this.locate(start)
    const goalPolygon = this.locate(goal)
    if (startPolygon === NO_POLYGON || goalPolygon === NO_POLYGON) return null
    const corridor = this.corridor(startPolygon, goalPolygon)
    if (!corridor) return null
    return this.funnel(start, goal, corridor)
  }

  distance(a, b) {
    const C = this.centroids
    return Math.hypot(C[a * 3] - C[b * 3], C[a * 3 + 1] - C[b * 3 + 1], C[a * 3 + 2] - C[b * 3 + 2])
  }

  corridor(startPolygon, goalPolygon) {
    if (startPolygon === goalPolygon) return [startPolygon]
    const n = this.polygons.length
    const cost = new Float64Array(n).fill(Infinity)
    const from = new Int32Array(n).fill(NO_POLYGON)
    const closed = new Uint8Array(n)
    const frontier = []
    cost[startPolygon] = 0
    pushFrontier(frontier, startPolygon, this.distance(startPolygon, goalPolygon))
    while (frontier.length) {
      const current = popFrontier(frontier)
      if (closed[current]) continue
      if (current === goalPolygon) {
        const out = [goalPolygon]
        for (let c = goalPolygon; from[c] !== NO_POLYGON; c = from[c]) out.push(from[c])
        return out.reverse()
      }
      closed[current] = 1
      for (const next of this.neighbors[current]) {
        if (closed[next]) continue
        const tentative = cost[current] + this.distance(current, next)
        if (tentative < cost[next]) {
          cost[next] = tentative
          from[next] = current
          pushFrontier(frontier, next, tentative + this.distance(next, goalPolygon))
        }
      }
    }
    return null
  }

  portal(fromPolygon, toPolygon) {
    const fromRing = this.polygons[fromPolygon].vertices
    const toVertices = new Set(this.polygons[toPolygon].vertices)
    for (let j = 0; j < fromRing.length; j++) {
      const p = fromRing[j]
      const q = fromRing[(j + 1) % fromRing.length]
      if (toVertices.has(p) && toVertices.has(q)) return { left: this.vertices[q], right: this.vertices[p] }
    }
    throw new Error(`navmesh polygons ${fromPolygon} and ${toPolygon} are linked but share no edge`)
  }

  funnel(start, goal, corridor) {
    const portals = [{ left: start, right: start }]
    for (let i = 0; i + 1 < corridor.length; i++) portals.push(this.portal(corridor[i], corridor[i + 1]))
    portals.push({ left: goal, right: goal })
    const out = [[...start]]
    const emit = (point) => {
      const last = out[out.length - 1]
      if (last[0] !== point[0] || last[1] !== point[1] || last[2] !== point[2]) out.push([...point])
    }
    let apex = start
    let left = start
    let right = start
    let apexIndex = 0
    let leftIndex = 0
    let rightIndex = 0
    for (let i = 1; i < portals.length; i++) {
      const portalLeft = portals[i].left
      const portalRight = portals[i].right
      if (cross2(apex[0], apex[2], right[0], right[2], portalRight[0], portalRight[2]) >= 0) {
        if (apex === right || cross2(apex[0], apex[2], left[0], left[2], portalRight[0], portalRight[2]) < 0) {
          right = portalRight
          rightIndex = i
        } else {
          emit(left)
          apex = left
          apexIndex = leftIndex
          right = left = apex
          rightIndex = leftIndex = apexIndex
          i = apexIndex
          continue
        }
      }
      if (cross2(apex[0], apex[2], left[0], left[2], portalLeft[0], portalLeft[2]) <= 0) {
        if (apex === left || cross2(apex[0], apex[2], right[0], right[2], portalLeft[0], portalLeft[2]) > 0) {
          left = portalLeft
          leftIndex = i
        } else {
          emit(right)
          apex = right
          apexIndex = rightIndex
          right = left = apex
          rightIndex = leftIndex = apexIndex
          i = apexIndex
          continue
        }
      }
    }
    emit(goal)
    return out
  }
}
