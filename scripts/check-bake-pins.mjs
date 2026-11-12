import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { repoPinTable, readPins, readRepoText, sha1Hex, PINS_PATH } from './lib/bakePins.mjs'
import { createBakePinTable, BAKE_KINDS, PIN_PINNED, PIN_DRIFTED, PIN_UNRECORDED, PIN_UNKNOWN_KIND } from '../src/bundle/bakePins.js'
import { bakeCodeVersion } from '../src/terrain-pure/bakeCodeVersion.js'

const files = {
  'a/main.js': "import { helper } from './helper.js'\nimport { shared } from '../lib/shared.js'\nexport const main = () => helper() + shared\n",
  'a/helper.js': "import { shared } from '../lib/shared.js'\nexport const helper = () => shared\n",
  'lib/shared.js': 'export const shared = 1\n',
  'lib/unused.js': 'export const unused = 2\n',
  'tex/a.js': 'export const a = 1\n',
  'tex/b.js': 'export const b = 2\n',
}
const reader = (overrides = {}) => {
  const reads = []
  const readText = (path) => {
    reads.push(path)
    const all = { ...files, ...overrides }
    if (!(path in all)) throw new Error('no file ' + path)
    return all[path]
  }
  return { readText, reads }
}
const kinds = { mesh: { entries: ['a/main.js'] }, texture: { inputs: ['tex/b.js', 'tex/a.js'] } }
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code ?? error.constructor.name
  }
  return null
}

gate('a kind with entries is pinned to its import closure and a kind with inputs to its list in the order given', () => {
  const table = createBakePinTable({ kinds, ...reader(), sha1Hex })
  assert.deepEqual(table.names, ['mesh', 'texture'])
  assert.deepEqual(table.inputsOf('mesh'), ['a/helper.js', 'a/main.js', 'lib/shared.js'])
  assert.deepEqual(table.inputsOf('texture'), ['tex/b.js', 'tex/a.js'])
  assert.equal(table.versionOf('mesh'), bakeCodeVersion(['a/helper.js', 'a/main.js', 'lib/shared.js'], reader().readText, sha1Hex))
  assert.equal(table.versionOf('texture'), bakeCodeVersion(['tex/b.js', 'tex/a.js'], reader().readText, sha1Hex))
  assert.deepEqual(Object.keys(table.versions()), ['mesh', 'texture'])
})

gate('the table reads each file through the injected reader and reads a kind once', () => {
  const { readText, reads } = reader()
  const table = createBakePinTable({ kinds, readText, sha1Hex })
  assert.equal(reads.length, 0, 'nothing is read before a version is asked for')
  table.versionOf('texture')
  assert.deepEqual(reads, ['tex/b.js', 'tex/a.js'])
  table.versionOf('texture')
  assert.equal(reads.length, 2)
  assert.ok(!reads.includes('lib/unused.js'))
})

gate('check reports pinned, drifted, unrecorded and unknown kinds, and is ok only when all are pinned', () => {
  const base = createBakePinTable({ kinds, ...reader(), sha1Hex })
  const pins = base.versions()
  assert.deepEqual(base.check(pins), { ok: true, rows: [{ name: 'mesh', recorded: pins.mesh, current: pins.mesh, status: PIN_PINNED }, { name: 'texture', recorded: pins.texture, current: pins.texture, status: PIN_PINNED }] })
  const edited = createBakePinTable({ kinds, ...reader({ 'lib/shared.js': 'export const shared = 2\n' }), sha1Hex })
  const drift = edited.check(pins)
  assert.equal(drift.ok, false)
  assert.deepEqual(drift.rows.map((r) => r.status), [PIN_DRIFTED, PIN_PINNED])
  assert.notEqual(drift.rows[0].current, pins.mesh)
  const untouched = createBakePinTable({ kinds, ...reader({ 'lib/unused.js': 'export const unused = 3\n' }), sha1Hex })
  assert.equal(untouched.check(pins).ok, true, 'negative control: a file outside every closure moves no pin')
  const partial = base.check({ mesh: pins.mesh, ghost: 'abc' })
  assert.deepEqual(partial.rows.map((r) => [r.name, r.status]), [['mesh', PIN_PINNED], ['texture', PIN_UNRECORDED], ['ghost', PIN_UNKNOWN_KIND]])
  assert.equal(partial.ok, false)
})

gate('require passes the current stamp and refuses a stale or missing one', () => {
  const table = createBakePinTable({ kinds, ...reader(), sha1Hex })
  assert.equal(table.require('mesh', table.versionOf('mesh')), table.versionOf('mesh'))
  assert.equal(code(() => table.require('mesh', '000000000000')), 'pin-stale-artifact')
  assert.equal(code(() => table.require('mesh', undefined)), 'pin-stale-artifact')
  assert.equal(code(() => table.require('nope', 'x')), 'pin-unknown-kind')
})

gate('a malformed table, a missing reader and a broken closure are refused', () => {
  assert.equal(code(() => createBakePinTable({ kinds: {}, ...reader(), sha1Hex })), 'pin-table-empty')
  assert.equal(code(() => createBakePinTable({ kinds: { x: {} }, ...reader(), sha1Hex })), 'pin-kind-needs-one-list')
  assert.equal(code(() => createBakePinTable({ kinds: { x: { entries: ['a'], inputs: ['b'] } }, ...reader(), sha1Hex })), 'pin-kind-needs-one-list')
  assert.equal(code(() => createBakePinTable({ kinds, sha1Hex })), 'TypeError')
  assert.equal(code(() => createBakePinTable({ kinds, ...reader() })), 'TypeError')
  const broken = createBakePinTable({ kinds, ...reader({ 'a/helper.js': "import { gone } from './gone.js'\nexport const helper = gone\n" }), sha1Hex })
  assert.equal(code(() => broken.versionOf('mesh')), 'import-unresolved')
  assert.equal(code(() => createBakePinTable({ kinds, ...reader(), sha1Hex }).check(null)), 'pin-record-not-object')
})

gate('the recorded pins of this tree match its sources, so a baked artifact stamped today is accepted', () => {
  const table = repoPinTable()
  const report = table.check(readPins())
  const drifted = report.rows.filter((row) => row.status !== PIN_PINNED).map((row) => `${row.name} ${row.status}: recorded ${row.recorded}, tree ${row.current}`)
  assert.deepEqual(drifted, [], `${PINS_PATH} is behind the bake sources; if the change is meant run node scripts/bake-heightfield.mjs --pin and re-bake`)
  assert.deepEqual(table.names, Object.keys(BAKE_KINDS).sort())
  assert.ok(table.names.includes('heightfield'))
  const touched = createBakePinTable({ readText: (p) => (p === 'src/packages/mapspinner/height-eval.js' ? readRepoText(p) + '\nexport const t = 1\n' : readRepoText(p)), sha1Hex })
  assert.equal(touched.check(readPins()).rows[0].status, PIN_DRIFTED, 'negative control: an edit to the height evaluator drifts the pin')
})

finish()
