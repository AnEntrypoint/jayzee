import { FACE_FRAME } from '../terrain-pure/cubeSphereCells.js'
import { MAX_PATCH_LEVEL, PATCH_FACES, leafPatchId } from './vegetationPatches.js'

const FACE_ANGLE = Math.PI / 4

export const createLeafBlock = ({ level, block }) => {
  if (!Number.isInteger(level) || level < 1 || level > MAX_PATCH_LEVEL) throw new RangeError('level must be a whole number in 1..' + MAX_PATCH_LEVEL)
  const side = 2 ** level
  if (!Number.isInteger(block) || block < 2 || block % 2 !== 0 || block > side) throw new RangeError('block must be an even whole number from 2 to the face side, ' + side)
  const ids = new Array(block * block).fill(0)
  const half = block / 2
  let face = -1
  let tx0 = -1
  let ty0 = -1
  let moves = 0

  const firstCell = (w) => {
    const cell = Math.round(((Math.atan(w) / FACE_ANGLE + 1) / 2) * side) - half
    return cell < 0 ? 0 : cell > side - block ? side - block : cell
  }

  const update = (x, y, z) => {
    let best = 0
    let bestDot = -Infinity
    for (let f = 0; f < PATCH_FACES; f++) {
      const c = FACE_FRAME[f].c
      const d = x * c[0] + y * c[1] + z * c[2]
      if (d > bestDot) {
        bestDot = d
        best = f
      }
    }
    if (!(bestDot > 0)) throw new RangeError('the direction must not be zero')
    const F = FACE_FRAME[best]
    const nx = firstCell((x * F.u[0] + y * F.u[1] + z * F.u[2]) / bestDot)
    const ny = firstCell((x * F.v[0] + y * F.v[1] + z * F.v[2]) / bestDot)
    if (best === face && nx === tx0 && ny === ty0) return false
    face = best
    tx0 = nx
    ty0 = ny
    for (let j = 0; j < block; j++) for (let i = 0; i < block; i++) ids[j * block + i] = leafPatchId(face, level, tx0 + i, ty0 + j)
    moves += 1
    return true
  }

  return {
    ids,
    update,
    get face() { return face },
    get first() { return [tx0, ty0] },
    get moves() { return moves },
  }
}

const SETTLED_FRAMES = 2

export const createVegetationFollower = ({ scene, block, radiusM }) => {
  let settled = 0
  return (x, heightM, z, pagesPending) => {
    settled = pagesPending > 0 ? 0 : settled + 1
    const moved = settled >= SETTLED_FRAMES && block.update(x, radiusM + heightM, z)
    scene.streamStep(moved ? block.ids : null)
    return moved
  }
}
