import { canon } from './canon.mjs'

const mulberry32 = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const range = (rand, low, high) => low + (high - low) * rand()
const roundTo = (value, step) => Math.round(value / step) * step
const vec3 = (rand, low, high, step) => [0, 1, 2].map(() => (step ? roundTo(range(rand, low, high), step) : range(rand, low, high)))
const matrix = (rand) => Array.from({ length: 16 }, () => range(rand, -3, 3))

export const runMat4Scenario = (api) => {
  const rand = mulberry32(41)
  const sections = {}

  sections.textureUnits = [canon(api.TU)]

  sections.mul = []
  for (let index = 0; index < 200; index++) {
    const a = matrix(rand)
    const b = matrix(rand)
    sections.mul.push(canon(api.M4.mul(a, b)))
    if (index % 4 === 0) sections.mul.push(canon(api.M4.mul(Float32Array.from(a), Float32Array.from(b), new Float32Array(16))))
  }
  sections.mul.push(canon(api.M4.mul(matrix(rand), new Float64Array(16).fill(0))))

  sections.perspective = []
  for (let index = 0; index < 160; index++) {
    const fovy = range(rand, 0.1, 3)
    const aspect = index === 0 ? 0 : range(rand, 0.2, 4)
    const near = range(rand, 0.01, 5)
    const far = index === 1 ? near : near + range(rand, 1, 1000)
    sections.perspective.push(canon(api.M4.perspective(fovy, aspect, near, far)))
    if (index % 3 === 0) sections.perspective.push(canon(api.M4.perspective(fovy, aspect, near, far, new Float32Array(16))))
  }

  sections.translate = []
  for (let index = 0; index < 60; index++) {
    const t = vec3(rand, -50, 50, index % 5 === 0 ? 1 : 0)
    sections.translate.push(canon(api.M4.translate(t)))
    if (index % 3 === 0) sections.translate.push(canon(api.M4.translate(t, new Float32Array(16))))
  }
  sections.translate.push(canon(api.M4.translate([-0, 0, -0])))

  sections.lookAt = []
  for (let index = 0; index < 240; index++) {
    const eye = vec3(rand, -20, 20, index % 4 === 0 ? 1 : 0)
    const center = vec3(rand, -20, 20, index % 4 === 0 ? 1 : 0)
    const up = index % 2 === 0 ? [0, 1, 0] : vec3(rand, -1, 1, 0)
    sections.lookAt.push(canon(api.M4.lookAt(eye, center, up)))
    if (index % 5 === 0) sections.lookAt.push(canon(api.M4.lookAt(eye, center, up, new Float32Array(16))))
  }
  const degenerate = [
    [[1, 2, 3], [1, 2, 3], [0, 1, 0]],
    [[0, 5, 0], [0, 0, 0], [0, 1, 0]],
    [[0, -5, 0], [0, 0, 0], [0, 1, 0]],
    [[5, 0, 0], [0, 0, 0], [1, 0, 0]],
    [[0, 0, 5], [0, 0, 0], [0, 0, 1]],
    [[0, 0, 5], [0, 0, 0], [0, 0, 0]],
    [[3, 4, 5], [0, 0, 0], [0, 0, 0]],
    [[0, 0, 0], [0, 0, 0], [0, 1, 0]],
    [[2, 0, 0], [0, 0, 0], [0, 0, 1]],
    [[0, 0, -2], [0, 0, 0], [0, 0, -1]],
    [[0, 0, 1e-9], [0, 0, 0], [0, 1, 0]],
    [[1, 1, 1], [0, 0, 0], [-1, -1, -1]],
  ]
  for (const [eye, center, up] of degenerate) {
    sections.lookAt.push(canon(api.M4.lookAt(eye, center, up)))
    sections.lookAt.push(canon(api.M4.lookAt(eye, center, up, new Float32Array(16))))
  }

  return sections
}
