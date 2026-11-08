import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = process.argv[2] || '/workspace/spoint'
const spoint = await import(pathToFileURL(join(spointRoot, 'src', 'shared', 'vec3.js')).href)

const encode = (value) => {
  if (value === undefined) return { $undef: true }
  if (typeof value === 'number' && !Number.isFinite(value)) return { $num: String(value) }
  if (Array.isArray(value)) return value.map(encode)
  return value
}

const CASES = [
  ['a valid vector is returned as the same array', [[1, 2, 3]]],
  ['a valid vector with signed zero and a large component', [[-0, 0, 1e308]]],
  ['a valid vector takes the name it is given', [[0, 0, 0], 'position']],
  ['a two element array is refused under the default name', [[1, 2]]],
  ['a four element array is refused', [[1, 2, 3, 4]]],
  ['a string is refused', ['123']],
  ['null is refused', [null]],
  ['undefined is refused', [undefined]],
  ['a plain object with index keys is refused', [{ 0: 1, 1: 2, 2: 3 }]],
  ['a NaN component is refused', [[1, NaN, 3]]],
  ['an infinite component is refused', [[Infinity, 0, 0]]],
  ['a string component is refused', [[1, '2', 3]]],
  ['a null component is refused', [[1, null, 3]]],
  ['the refusal names the argument', [[1, 2], 'velocity']],
]

const cases = CASES.map(([label, raw]) => {
  let expect
  try {
    const out = spoint.readVec3(...raw)
    expect = { returns: true, same: out === raw[0] }
  } catch (error) {
    expect = { returns: false, type: error.constructor.name, message: error.message, reasonCode: error.reasonCode }
  }
  return { label, args: raw.map(encode), expect }
})

writeFileSync(join(here, 'fixtures', 'spoint', 'vec3-read.json'), JSON.stringify({ source: 'spoint src/shared/vec3.js readVec3', cases }, null, 2) + '\n')
console.log('wrote', cases.length, 'cases')
