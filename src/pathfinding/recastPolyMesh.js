export const NAVMESH_FORMAT_VERSION = 1
const RC_MESH_NULL_INDEX = 0xffff
const RC_PORTAL_FLAG = 0x8000

export const DEFAULT_AGENT = { cellSize: 0.3, cellHeight: 0.2, agentHeight: 1.7, agentRadius: 0.4, agentMaxClimb: 0.5, agentMaxSlope: 45, regionMinSize: 8, regionMergeSize: 20, maxVertsPerPoly: 6, detailSampleDist: 6, detailSampleMaxError: 1 }

export const agentWith = (overrides) => ({ ...DEFAULT_AGENT, ...overrides })

export function assertBakeInput(positions, indices) {
  if (!(positions?.length >= 9) || positions.length % 3 !== 0) throw new TypeError(`bakeNavmesh: positions must be a flat xyz array with at least one triangle, got length ${positions?.length}`)
  if (!(indices?.length >= 3) || indices.length % 3 !== 0) throw new TypeError(`bakeNavmesh: indices must be a flat triangle list, got length ${indices?.length}`)
}

export function recastConfigFor(agent) {
  return {
    cs: agent.cellSize,
    ch: agent.cellHeight,
    walkableSlopeAngle: agent.agentMaxSlope,
    walkableHeight: Math.ceil(agent.agentHeight / agent.cellHeight),
    walkableClimb: Math.floor(agent.agentMaxClimb / agent.cellHeight),
    walkableRadius: Math.ceil(agent.agentRadius / agent.cellSize),
    minRegionArea: agent.regionMinSize,
    mergeRegionArea: agent.regionMergeSize,
    maxVertsPerPoly: agent.maxVertsPerPoly,
    detailSampleDist: agent.detailSampleDist,
    detailSampleMaxError: agent.detailSampleMaxError,
  }
}

export function ringTurning(vertices, ring) {
  const n = ring.length
  let turn = 0
  for (let i = 0; i < n; i++) {
    const a = vertices[ring[i]]
    const b = vertices[ring[(i + 1) % n]]
    const c = vertices[ring[(i + 2) % n]]
    const abx = b[0] - a[0]
    const abz = b[2] - a[2]
    const bcx = c[0] - b[0]
    const bcz = c[2] - b[2]
    turn += Math.atan2(abx * bcz - abz * bcx, abx * bcx + abz * bcz)
  }
  return turn
}

export function polyMeshToJSON(pm, rc) {
  const cs = pm.cs()
  const ch = pm.ch()
  const bmin = pm.bmin()
  const bmax = pm.bmax()
  const nvp = pm.nvp()
  const vertices = new Array(pm.nverts())
  for (let i = 0; i < vertices.length; i++) {
    vertices[i] = [bmin.x + pm.verts(i * 3) * cs, bmin.y + pm.verts(i * 3 + 1) * ch, bmin.z + pm.verts(i * 3 + 2) * cs]
  }
  const polygons = []
  const links = []
  for (let p = 0, polyCount = pm.npolys(); p < polyCount; p++) {
    const base = p * nvp * 2
    const ring = []
    const neighbors = []
    for (let j = 0; j < nvp; j++) {
      const vertex = pm.polys(base + j)
      if (vertex === RC_MESH_NULL_INDEX) break
      ring.push(vertex)
      const neighbor = pm.polys(base + nvp + j)
      if (neighbor !== RC_MESH_NULL_INDEX && !(neighbor & RC_PORTAL_FLAG)) neighbors.push(neighbor)
    }
    ring.reverse()
    const turn = ringTurning(vertices, ring)
    if (turn <= -Math.PI) throw new Error(`recast polygon ${p} winds clockwise in x/z after the winding reversal (turning ${turn.toFixed(4)} rad, expected +2pi): NavmeshQuery rejects every point of a clockwise polygon, so locate() would return -1 and findPath() null across the whole navmesh -- polyMeshToJSON must keep reversing recast's vertex order`)
    polygons.push({ vertices: ring, flags: pm.flags(p), area: pm.areas(p) })
    if (neighbors.length) links.push({ polygon: p, neighbors })
  }
  return {
    version: NAVMESH_FORMAT_VERSION,
    config: { cellSize: cs, cellHeight: ch, agentHeight: rc.walkableHeight * ch, agentRadius: rc.walkableRadius * cs, agentMaxClimb: rc.walkableClimb * ch, agentMaxSlope: rc.walkableSlopeAngle },
    bounds: { min: [bmin.x, bmin.y, bmin.z], max: [bmax.x, bmax.y, bmax.z] },
    vertices,
    polygons,
    links,
  }
}
