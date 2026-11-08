import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = process.argv[2] || '/workspace/spoint'
const spoint = await import(pathToFileURL(join(spointRoot, 'src', 'game', 'playerId.js')).href)

const encode = (value) => {
  if (value === undefined) return { $undef: true }
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) return { $num: Object.is(value, -0) ? '-0' : String(value) }
  if (Array.isArray(value)) return value.map(encode)
  return value
}

const CASES = [
  ['a non-empty string is its own key', ['alice']],
  ['a numeric string keeps its digits', ['42']],
  ['the empty string is refused', ['']],
  ['a positive integer becomes its decimal string', [42]],
  ['zero becomes "0"', [0]],
  ['negative zero becomes "0"', [-0]],
  ['a negative integer keeps its sign', [-7]],
  ['a safe integer is exact', [9007199254740991]],
  ['an integer above 2^53 uses exponent form', [1e21]],
  ['a fraction is refused', [1.5]],
  ['NaN is refused', [NaN]],
  ['an infinity is refused', [Infinity]],
  ['null is refused', [null]],
  ['undefined is refused', [undefined]],
  ['a boolean is refused', [true]],
  ['an array is refused', [[1]]],
  ['an object is refused', [{ id: 1 }]],
]

const cases = CASES.map(([label, raw]) => {
  const tryReturns = spoint.tryParsePlayerId(...raw)
  let parse
  try {
    parse = { returns: spoint.parsePlayerId(...raw) }
  } catch (error) {
    parse = { throws: true, type: error.constructor.name, message: error.message }
  }
  return { label, args: raw.map(encode), expect: { tryReturns, parse } }
})

writeFileSync(join(here, 'fixtures', 'spoint', 'player-id.json'), JSON.stringify({ source: 'spoint src/game/playerId.js', cases }, null, 2) + '\n')
console.log('wrote', cases.length, 'cases')
