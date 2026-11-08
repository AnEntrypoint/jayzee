import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = process.argv[2] ?? '/workspace/spoint'
const outPath = join(here, 'fixtures', 'spoint', 'world-resolver.json')

const names = await import(pathToFileURL(join(spointRoot, 'src', 'shared', 'worldName.js')).href)
const locator = await import(pathToFileURL(join(spointRoot, 'src', 'sdk', 'WorldLocator.js')).href)

const errorName = (fn) => {
  try {
    fn()
    return null
  } catch (error) {
    return error.constructor.name
  }
}

const NAME_VALUES = ['tps-game', 'a', 'A_b-9', 'x'.repeat(128), 'x'.repeat(129), '', ' ', 'a/b', '../x', 'a.b', 'a b', 'a%2Fb', 'a+b', '\u00e9', 'index', '_fixtures', 'constructor', 'tps-game.js', 'a\nb', null, 3]

const names_ = NAME_VALUES.map((value) => {
  const valid = names.isWorldName(value)
  const entry = { value, valid }
  if (valid) {
    entry.rel = names.worldFileRel(value)
    entry.candidates = names.worldFileCandidates(value)
  } else {
    entry.refused = errorName(() => names.worldFileRel(value))
  }
  return entry
})

const indexFile = (defaultWorld) => (defaultWorld === undefined ? 'export default {}\n' : 'export const defaultWorld = ' + JSON.stringify(defaultWorld) + '\n')
const DEFAULT_CASES = [
  { module: {}, expect: 'index' },
  { module: null, expect: 'index' },
  { module: { defaultWorld: 'tps-game' }, expect: 'tps-game' },
  { module: { defaultWorld: 'constructor' }, expect: 'constructor' },
  { module: { defaultWorld: 'a/b' }, expect: null },
  { module: { defaultWorld: 3 }, expect: null },
  { module: { defaultWorld: '' }, expect: null },
]
const defaults = DEFAULT_CASES.map(({ module: m }) => {
  const entry = { module: m }
  try {
    entry.name = names.defaultWorldNameOf(m === null ? null : m)
  } catch (error) {
    entry.error = error.constructor.name
  }
  return entry
})

const LOCATE_CASES = [
  { id: 'named-found', files: { 'apps/world/tps-game.js': 'export default {}\n' }, name: 'tps-game' },
  { id: 'fixture-only', files: { 'apps/world/_fixtures/arena.js': 'export default {}\n' }, name: 'arena' },
  { id: 'world-file-wins-over-fixture', files: { 'apps/world/arena.js': 'export default {}\n', 'apps/world/_fixtures/arena.js': 'export default {}\n' }, name: 'arena' },
  { id: 'named-missing', files: {}, name: 'tps-game' },
  { id: 'invalid-name', files: { 'apps/world/a.js': 'export default {}\n' }, name: 'a/b' },
  { id: 'empty-name-uses-default', files: { 'apps/world/index.js': indexFile('arena'), 'apps/world/arena.js': 'export default {}\n' }, name: '' },
  { id: 'default-from-index-fixture', files: { 'apps/world/index.js': indexFile('arena'), 'apps/world/_fixtures/arena.js': 'export default {}\n' }, name: null },
  { id: 'default-missing', files: { 'apps/world/index.js': indexFile('arena') }, name: null },
  { id: 'default-is-index-itself', files: { 'apps/world/index.js': indexFile(undefined) }, name: null },
  { id: 'no-index-no-name', files: {}, name: null },
  { id: 'name-beats-default', files: { 'apps/world/index.js': indexFile('tps-game'), 'apps/world/arena.js': 'export default {}\n' }, name: 'arena' },
  { id: 'name-missing-beats-existing-default', files: { 'apps/world/index.js': indexFile('tps-game'), 'apps/world/tps-game.js': 'export default {}\n' }, name: 'arena' },
]

const locate = []
for (const c of LOCATE_CASES) {
  const dir = mkdtempSync(join(tmpdir(), 'jz-world-'))
  try {
    for (const [rel, text] of Object.entries(c.files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    const defaultName = await locator.readDefaultWorldName([dir])
    let result
    try {
      const found = await locator.locateWorld({ project: dir, name: c.name })
      result = { name: found.name, path: found.path === null ? null : relative(dir, found.path).split('\\').join('/') }
    } catch (error) {
      result = { error: error.constructor.name }
    }
    locate.push({ id: c.id, files: Object.keys(c.files), name: c.name, defaultName, result })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SEARCH_CASES = [
  ['?world=tps-game', ''],
  ['?world=', ''],
  ['', ''],
  ['?world=a/b', ''],
  ['?world=%2e%2e', ''],
  ['?world=a%20b', ''],
  ['?world=x&world=y', ''],
  ['', '#/?world=arena'],
  ['?world=', '#/?world=arena'],
  ['?world=arena', '#/?world=tps-game'],
  ['?world=a+b', ''],
  ['?world=tps.game', ''],
  ['?other=1&world=arena', ''],
  ['?world=' + 'x'.repeat(128), ''],
  ['?world=' + 'x'.repeat(129), ''],
  ['?world=%C3%A9', ''],
  ['?world=arena', ''],
]

const bootWorldOf = (search, hash) => {
  const params = new URLSearchParams(search)
  const hashAt = hash.indexOf('?')
  if (hashAt >= 0) for (const [key, value] of new URLSearchParams(hash.slice(hashAt + 1)).entries()) if (!params.has(key)) params.append(key, value)
  const requested = params.get('world') || null
  if (requested && !names.isWorldName(requested)) return { requested: null, refused: 'TypeError' }
  return { requested, refused: null }
}

const search = SEARCH_CASES.map(([s, h]) => ({ search: s, hash: h, ...bootWorldOf(s, h) }))

const fixture = {
  generatedBy: 'scripts/gen-world-resolver.mjs',
  sources: {
    names: 'src/shared/worldName.js (isWorldName, worldFileRel, worldFileCandidates, defaultWorldNameOf)',
    locate: 'src/sdk/WorldLocator.js (readDefaultWorldName, locateWorld) run on a temporary project tree per case',
    search: 'client/app.js:184-189 and 936-937 (search and hash merge, and the ?world check), transcribed because the client module needs the DOM',
  },
  bootOnMissingModule: 'client/app.js:1189 logs the failure and continues with no world definition; README.md:115 says the boot stops. Jayzee follows the README.',
  names: names_,
  defaults,
  locate,
  search,
}

writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + outPath + ' names=' + names_.length + ' defaults=' + defaults.length + ' locate=' + locate.length + ' search=' + search.length)
