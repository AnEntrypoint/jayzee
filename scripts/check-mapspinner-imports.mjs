import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { importClosure, unresolvedBindings, assertClosed, listImports, listExports, resolveRelative, exportedNames, SourceClosureError } from '../src/bundle/sourceClosure.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'src/packages/mapspinner'
const readText = (path) => readFileSync(join(root, path), 'utf8')
const modules = readdirSync(join(root, DIR)).filter((name) => name.endsWith('.js')).sort().map((name) => `${DIR}/${name}`)
const closure = importClosure(modules, readText)
const memory = (files) => (path) => {
  if (!(path in files)) throw new Error('no file ' + path)
  return files[path]
}

gate('every relative import across the mapspinner sources names a file that exists', () => {
  assert.ok(modules.length >= 25, `only ${modules.length} modules found`)
  assert.deepEqual(closure.missing, [])
  const relative = closure.edges.filter((e) => e.from.startsWith(DIR))
  assert.ok(relative.length >= 30, `only ${relative.length} relative imports found`)
  for (const edge of relative) assert.ok(closure.files.includes(edge.to), `${edge.from} -> ${edge.specifier}`)
})

gate('every named binding a mapspinner module imports is exported by the module it names', () => {
  assert.deepEqual(unresolvedBindings(closure), [])
  const named = closure.edges.reduce((n, e) => n + e.names.length, 0)
  assert.ok(named >= 60, `only ${named} named bindings checked`)
  assert.equal(assertClosed(closure), closure)
})

gate('the scan agrees with the module loader: each module loads and exports what the scan lists', async () => {
  for (const path of modules) {
    const loaded = await import(pathToFileURL(join(root, path)).href)
    const scanned = [...exportedNames(path, closure.texts)].sort()
    assert.deepEqual(scanned, Object.keys(loaded).sort(), path)
  }
})

gate('the mapspinner sources import no bare package and reach outside the package only into terrain-pure', () => {
  assert.deepEqual(closure.bare, [])
  const outside = [...new Set(closure.files.filter((f) => !f.startsWith(DIR + '/')).map((f) => f.split('/').slice(0, 2).join('/')))]
  assert.deepEqual(outside, ['src/terrain-pure'])
})

gate('negative control: a missing file, a missing binding and an escaping path are each reported', () => {
  const gone = importClosure(['a/x.js'], memory({ 'a/x.js': "import { y } from './y.js'\nexport const x = y\n" }))
  assert.deepEqual(gone.missing, [{ from: 'a/x.js', specifier: './y.js', path: 'a/y.js' }])
  assert.throws(() => assertClosed(gone), (e) => e instanceof SourceClosureError && e.code === 'import-unresolved')
  const wrong = importClosure(['a/x.js'], memory({ 'a/x.js': "import { y, z as w } from './y.js'\nexport const x = y + w\n", 'a/y.js': 'export const y = 1\n' }))
  assert.deepEqual(unresolvedBindings(wrong), [{ from: 'a/x.js', to: 'a/y.js', name: 'z' }])
  assert.throws(() => assertClosed(wrong), (e) => e.code === 'binding-unresolved')
  assert.throws(() => resolveRelative('x.js', '../../y.js'), (e) => e.code === 'import-escapes-root')
  assert.throws(() => importClosure(['nope.js'], memory({})), (e) => e.code === 'entry-unreadable')
})

gate('the scan reads default, namespace, renamed, re-exported, star and dynamic forms', () => {
  const text = [
    "import d, { a, b as c } from './one.js'",
    "import * as ns from './two.js'",
    "import './three.js'",
    "export { e as f } from './four.js'",
    "export * from './five.js'",
    "export * as six from './six.js'",
    "const lazy = () => import('./seven.js')",
    'export const { g, h: i } = ns',
    'export async function j() {}',
    'export default class {}',
    'const k = 1',
    'export { k as l }',
  ].join('\n')
  const imports = listImports(text)
  assert.deepEqual(imports.map((i) => i.specifier).sort(), ['./five.js', './four.js', './one.js', './seven.js', './six.js', './three.js', './two.js'])
  assert.deepEqual(imports.find((i) => i.specifier === './one.js').names, ['default', 'a', 'b'])
  assert.deepEqual(imports.find((i) => i.specifier === './four.js').names, ['e'])
  assert.equal(imports.find((i) => i.specifier === './two.js').namespace, true)
  const exports = listExports(text)
  assert.deepEqual([...exports.names].sort(), ['default', 'f', 'g', 'i', 'j', 'l', 'six'])
  assert.deepEqual(exports.stars, ['./five.js'])
  const texts = new Map([['p/a.js', "export * from './b.js'\nexport const a = 1\n"], ['p/b.js', "export * from './a.js'\nexport const b = 2\nexport default 3\n"]])
  assert.deepEqual([...exportedNames('p/a.js', texts)].sort(), ['a', 'b'])
})

finish()
