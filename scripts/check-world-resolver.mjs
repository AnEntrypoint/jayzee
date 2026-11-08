import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as site from '../src/site/worldName.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'world-resolver.json'), 'utf8'))

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const errorName = (fn) => {
  try {
    fn()
    return null
  } catch (error) {
    return error.constructor.name
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

gate('isWorldName accepts and refuses the same names and non-string values as spoint', () => {
  for (const entry of fixture.names) {
    assert(site.isWorldName(entry.value) === entry.valid, JSON.stringify(entry.value) + ' accepted=' + site.isWorldName(entry.value))
  }
})

gate('worldFileRel and worldFileCandidates give spoint paths for every valid name and refuse the rest with TypeError', () => {
  for (const entry of fixture.names) {
    if (entry.valid) {
      assert(site.worldFileRel(entry.value) === entry.rel, 'rel differs for ' + entry.value)
      assert(same(site.worldFileCandidates(entry.value), entry.candidates), 'candidates differ for ' + entry.value)
    } else {
      assert(errorName(() => site.worldFileRel(entry.value)) === 'TypeError', 'no TypeError for ' + JSON.stringify(entry.value))
    }
  }
})

gate('defaultWorldNameOf matches spoint on every index module shape, including the refusals', () => {
  for (const entry of fixture.defaults) {
    if (entry.error) assert(errorName(() => site.defaultWorldNameOf(entry.module)) === entry.error, 'expected ' + entry.error + ' for ' + JSON.stringify(entry.module))
    else assert(site.defaultWorldNameOf(entry.module) === entry.name, 'default differs for ' + JSON.stringify(entry.module))
  }
})

gate('locateWorld finds the same file, falls back to the fixture, takes the default and refuses the same names as spoint', () => {
  for (const c of fixture.locate) {
    const exists = (rel) => c.files.includes(rel)
    const run = () => site.locateWorld({ name: c.name, defaultName: c.defaultName, exists })
    if (c.result.error) assert(errorName(run) === c.result.error, c.id + ': spoint refuses with ' + c.result.error)
    else assert(same(run(), c.result), c.id + ': got ' + JSON.stringify(run()))
  }
})

gate('worldRequestOf reads ?world the way the client boot does, merging the hash and refusing a bad name', () => {
  for (const c of fixture.search) {
    const run = () => site.worldRequestOf(c.search, c.hash)
    if (c.refused) assert(errorName(run) === c.refused, 'no ' + c.refused + ' for ' + c.search + ' ' + c.hash)
    else assert(run() === c.requested, 'requested differs for ' + c.search + ' ' + c.hash)
  }
})

gate('an invalid name is refused before any layout is probed', () => {
  let probed = false
  const exists = () => {
    probed = true
    return false
  }
  assert(errorName(() => site.locateWorld({ name: 'a/b', exists })) === 'TypeError', 'a/b was not a TypeError')
  assert(probed === false, 'exists was called for a refused name')
})

gate('the site ships no world module, so a named world is refused and no request gives no world', () => {
  assert(Array.isArray(site.SITE_WORLD_FILES) && site.SITE_WORLD_FILES.length === 0, 'the site lists a world module')
  assert(site.locateSiteWorld(null).name === null, 'no request did not give no world')
  assert(site.locateSiteWorld('').name === null, 'an empty request did not give no world')
  assert(errorName(() => site.locateSiteWorld('tps-game')) === 'Error', 'tps-game was accepted by the site')
})

gate('control: a layout that holds the file resolves, so the site refusal comes from its empty shipped list', () => {
  assert(same(site.locateWorld({ name: 'tps-game', exists: () => true }), { name: 'tps-game', path: 'apps/world/tps-game.js' }), 'the layout was not found')
})

gate('control: the fixture holds accepted and refused names, found and missing layouts, and accepted and refused searches', () => {
  assert(fixture.generatedBy === 'scripts/gen-world-resolver.mjs', 'fixture has no generator')
  assert(fixture.names.some((e) => e.valid) && fixture.names.some((e) => !e.valid), 'names lack one side')
  assert(fixture.locate.some((c) => c.result.error) && fixture.locate.some((c) => !c.result.error), 'locate lacks one side')
  assert(fixture.search.some((c) => c.refused) && fixture.search.some((c) => !c.refused), 'search lacks one side')
})

finish()
