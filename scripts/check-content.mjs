import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint-content.json'), 'utf8'))

const COLLISION_PORT = 3002
const NAMED_COLLISION_FILES = ['tps-game.js', 'tutorial.js', 'tutorial-rpg.js']
const MEASURED_COLLISION_FILES = ['construct.js', 'deathrun.js', 'tps-game.js', 'tutorial.js', 'tutorial-rpg.js']

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const assertCount = (actual, expected, what) => {
  assert(actual === expected, what + ': expected ' + expected + ', found ' + actual)
}

const assertSameMembers = (actual, expected, what) => {
  const sortedActual = [...actual].sort().join(',')
  const sortedExpected = [...expected].sort().join(',')
  assert(sortedActual === sortedExpected, what + ': expected [' + sortedExpected + '], found [' + sortedActual + ']')
}

const expectRefused = (what, check) => {
  let refused = false
  try {
    check()
  } catch {
    refused = true
  }
  assert(refused, what + ' was accepted')
}

const withWorldDefs = (worldDefs) => ({ ...fixture, worldDefs })
const portFilesFor = (content, port) => content.worldDefs.filter((def) => def.ports.includes(port)).map((def) => def.file)
const placedAppNames = fixture.placedApps.directories
const worldFileNames = fixture.worldDefs.map((def) => def.file)
const glbNames = fixture.maps.glb

gate('the fixture lists 29 built-in placed-app directories', () => {
  assertCount(placedAppNames.length, 29, 'placed-app directories')
  assertCount(fixture.placedApps.nonDirectories.length, 0, 'non-directory entries in src/stdlib-apps')
})

gate('negative control: a 28-directory listing is refused', () => {
  expectRefused('28 placed-app directories', () => assertCount(placedAppNames.slice(1).length, 29, 'placed-app directories'))
})

gate('the fixture lists 12 world definitions with index.js excluded', () => {
  assertCount(worldFileNames.length, 12, 'world definitions')
  assert(!worldFileNames.includes('index.js'), 'index.js is listed as a world definition')
})

gate('negative control: a world list that keeps index.js is refused', () => {
  expectRefused('index.js as a world definition', () => {
    const polluted = withWorldDefs([...fixture.worldDefs, { file: 'index.js', ports: [] }]).worldDefs.map((def) => def.file)
    assertCount(polluted.length, 12, 'world definitions')
    assert(!polluted.includes('index.js'), 'index.js is listed as a world definition')
  })
})

gate('the fixture lists 16 GLB maps, each ending in .glb', () => {
  assertCount(glbNames.length, 16, 'GLB maps')
  assert(glbNames.every((name) => name.endsWith('.glb')), 'a GLB map has the wrong extension')
})

gate('the fixture records only the .glb-cache entry as a non-GLB item in apps/maps', () => {
  assertSameMembers(fixture.maps.other, ['.glb-cache'], 'non-GLB entries in apps/maps')
})

gate('negative control: a GLB sitting in the non-GLB list is refused', () => {
  expectRefused('a .glb in the non-GLB list', () => {
    assertSameMembers([...fixture.maps.other, 'aim_sillos.glb'], ['.glb-cache'], 'non-GLB entries in apps/maps')
  })
})

gate('negative control: a directory counted as a GLB map is refused', () => {
  expectRefused('_shared as a GLB map', () => {
    const polluted = [...glbNames, '_shared']
    assert(polluted.every((name) => name.endsWith('.glb')), '_shared is not a .glb map')
  })
})

gate('tps-game.js, tutorial.js and tutorial-rpg.js all declare port 3002', () => {
  const declaring = portFilesFor(fixture, COLLISION_PORT)
  for (const file of NAMED_COLLISION_FILES) {
    assert(declaring.includes(file), file + ' does not declare port 3002')
  }
})

gate('negative control: a named collision file moved off 3002 is refused', () => {
  expectRefused('tutorial.js off port 3002', () => {
    const moved = withWorldDefs(fixture.worldDefs.map((def) => (def.file === 'tutorial.js' ? { ...def, ports: [8123] } : def)))
    for (const file of NAMED_COLLISION_FILES) {
      assert(portFilesFor(moved, COLLISION_PORT).includes(file), file + ' does not declare port 3002')
    }
  })
})

gate('the port 3002 set is exactly the five measured files', () => {
  assertSameMembers(portFilesFor(fixture, COLLISION_PORT), MEASURED_COLLISION_FILES, 'files declaring port 3002')
})

gate('negative control: agent-demo.js (port 8123) is not in the 3002 set', () => {
  expectRefused('agent-demo.js in the port 3002 set', () => {
    assertSameMembers([...portFilesFor(fixture, COLLISION_PORT), 'agent-demo.js'], MEASURED_COLLISION_FILES, 'files declaring port 3002')
  })
})

finish()
