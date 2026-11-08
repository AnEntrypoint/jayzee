import { canon } from './canon.mjs'

export const SCENE = [
  { kind: 'box', half: [40, 0.5, 40], position: [0, -0.5, 0] },
  { kind: 'box', half: [1, 1, 1], position: [5, 1, 5] },
  { kind: 'box', half: [3, 2, 1.5], position: [-20, 2, -3] },
  { kind: 'sphere', radius: 0.5, position: [0, 0, 0] },
]

const FLOOR = 0, BOX_A = 1, BOX_B = 2, SPHERE = 3

export const OVERLAP_CASES = [
  { label: 'sphere at the origin reaches the sphere and the floor', kind: 'sphere', centre: [0, 0, 0], radius: 0.4 },
  { label: 'sphere above box A overlaps its top only', kind: 'sphere', centre: [5, 2.9, 5], radius: 1 },
  { label: 'sphere touching the top of box A from above', kind: 'sphere', centre: [5, 3, 5], radius: 1 },
  { label: 'sphere far from the scene hits nothing', kind: 'sphere', centre: [100, 0, 100], radius: 1 },
  { label: 'sphere with the floor excluded keeps only the sphere', kind: 'sphere', centre: [0, 0, 0], radius: 0.4, exclude: FLOOR },
  { label: 'sphere with an unknown id excluded changes nothing', kind: 'sphere', centre: [0, 0, 0], radius: 0.4, exclude: 'missing' },
  { label: 'box around box B hits box B only', kind: 'box', min: [-22, 0, -5], max: [-18, 4, -1] },
  { label: 'box spanning the floor top hits the floor and the sphere', kind: 'box', min: [-1, -1, -1], max: [1, 1, 1] },
  { label: 'box touching the x face of box A', kind: 'box', min: [6, 0, 4], max: [7, 2, 6] },
  { label: 'box over box A with box A excluded hits nothing', kind: 'box', min: [4, 0.5, 4], max: [6, 1.5, 6], exclude: BOX_A },
  { label: 'box far from the scene hits nothing', kind: 'box', min: [50, 50, 50], max: [51, 51, 51] },
  { label: 'box lying on the floor hits the floor', kind: 'box', min: [10, -0.2, 10], max: [11, 0.8, 11] },
]

export const OVERLAP_CASE_LABELS = OVERLAP_CASES.map((c) => c.label)

export function runOverlapScenario(adapter) {
  const ids = SCENE.map((body) => (body.kind === 'sphere' ? adapter.addSphere(body.radius, body.position) : adapter.addBox(body.half, body.position)))
  const toId = (ref) => (ref === 'missing' ? 999999 : ids[ref])
  const rows = OVERLAP_CASES.map((c) => {
    let value
    try {
      const exclude = c.exclude === undefined ? null : toId(c.exclude)
      value = c.kind === 'sphere' ? adapter.sphere(c.centre, c.radius, exclude) : adapter.box(c.min, c.max, exclude)
    } catch (error) {
      value = { threw: error.message }
    }
    return canon({ label: c.label, value })
  })
  adapter.destroy()
  return { rows }
}
