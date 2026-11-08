import { canon } from './canon.mjs'

const plane = ({ nx, nz, size, y = 0, x0 = 0, z0 = 0 }) => {
  const cols = nx + 1
  const positions = []
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) positions.push(x0 + (i / nx) * size, y, z0 + (j / nz) * size)
  }
  const indices = []
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  return { positions, indices }
}

const box = ({ cx, cy, cz, hx, hy, hz }) => {
  const corners = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ]
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]
  const indices = []
  for (const [a, b, c, d] of faces) indices.push(a, b, c, a, c, d)
  return { positions: corners.flat(), indices }
}

const join = (...parts) => {
  const positions = []
  const indices = []
  for (const part of parts) {
    const offset = positions.length / 3
    positions.push(...part.positions)
    for (const i of part.indices) indices.push(i + offset)
  }
  return { positions, indices }
}

const ramp = () => {
  const positions = []
  const indices = []
  const steps = 10
  for (let i = 0; i <= steps; i++) {
    const x = i
    positions.push(x, 0.3 * x, -5, x, 0.3 * x, 5)
  }
  for (let i = 0; i < steps; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, b, c, b, d, c)
  }
  return { positions, indices }
}

const cases = [
  { label: 'flat ground 10 m, default agent', mesh: () => plane({ nx: 4, nz: 4, size: 10 }), overrides: {} },
  { label: 'ground with an elevated 2 m box', mesh: () => join(plane({ nx: 8, nz: 8, size: 20 }), box({ cx: 0, cy: 1, cz: 0, hx: 1, hy: 1, hz: 1 })), overrides: {} },
  { label: 'ramp rising 3 m over 10 m, 0.5 m cells', mesh: () => ramp(), overrides: { cellSize: 0.5 } },
  { label: 'two levels that do not connect', mesh: () => join(plane({ nx: 4, nz: 4, size: 6 }), plane({ nx: 4, nz: 4, size: 6, y: 1.2, x0: 20 })), overrides: {} },
  { label: 'custom agent', mesh: () => plane({ nx: 8, nz: 8, size: 12 }), overrides: { cellSize: 0.25, cellHeight: 0.15, agentHeight: 1.8, agentRadius: 0.3, agentMaxClimb: 0.4, agentMaxSlope: 30, regionMinSize: 4, regionMergeSize: 10, maxVertsPerPoly: 4, detailSampleDist: 3, detailSampleMaxError: 0.5 } },
  { label: 'positions as a Float32Array', mesh: () => { const p = plane({ nx: 3, nz: 3, size: 6 }); return { positions: Float32Array.from(p.positions), indices: Uint32Array.from(p.indices) } }, overrides: {} },
  { label: 'an unknown override key is ignored', mesh: () => plane({ nx: 4, nz: 4, size: 10 }), overrides: { notAnOption: 1 } },
  { label: 'positions too short', mesh: () => ({ positions: [0, 0, 0], indices: [0, 0, 0] }), overrides: {} },
  { label: 'indices that are not triangles', mesh: () => ({ positions: plane({ nx: 2, nz: 2, size: 4 }).positions, indices: [0, 1] }), overrides: {} },
  { label: 'zero-area triangles', mesh: () => ({ positions: [0, 0, 0, 0, 0, 0, 0, 0, 0], indices: [0, 1, 2] }), overrides: {} },
]

export const RECAST_CASE_LABELS = cases.map(({ label }) => label)

export const runRecastBakeScenario = async (api) => {
  const bakes = []
  for (const { label, mesh, overrides } of cases) {
    const { positions, indices } = mesh()
    try {
      const result = await api.bakeNavmesh({ positions, indices, ...overrides })
      bakes.push(canon({ label, result }))
    } catch (error) {
      bakes.push(canon({ label, threw: error.message, name: error.name }))
    }
  }
  return { bakes }
}

export const bakeCase = (label) => {
  const found = cases.find((c) => c.label === label)
  if (!found) throw new Error('no case ' + label)
  return found
}
