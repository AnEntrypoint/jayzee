import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { planSite, SITE_DIR } from './lib/site.mjs'
import { locateSiteWorld, locateWorld } from '../src/site/worldName.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAMPED = ['index.html', 'play.js', 'kernel.wasm']

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const runBuild = (world) => {
  const env = { ...process.env }
  delete env.WORLD
  if (world !== undefined) env.WORLD = world
  return spawnSync(process.execPath, [join(root, 'scripts', 'build-site.mjs')], { cwd: root, env, encoding: 'utf8' })
}

const stampsOf = () => STAMPED.map((name) => statSync(join(SITE_DIR, name)).mtimeMs)

gate('the build refuses a WORLD the site does not ship: exit 1, the name in the refusal, and no write', () => {
  const before = stampsOf()
  const result = runBuild('tps-game')
  assert(result.status === 1, 'exit ' + result.status)
  assert(result.stderr.includes('build:site refused WORLD') && result.stderr.includes('tps-game'), 'refusal text: ' + result.stderr)
  assert(JSON.stringify(stampsOf()) === JSON.stringify(before), 'the refused build wrote into docs/play')
})

gate('a malformed WORLD is refused by the build with the world-file-stem message and no write', () => {
  const before = stampsOf()
  const result = runBuild('a/b')
  assert(result.status === 1, 'exit ' + result.status)
  assert(result.stderr.includes('must be a world file stem'), 'refusal text: ' + result.stderr)
  assert(JSON.stringify(stampsOf()) === JSON.stringify(before), 'the refused build wrote into docs/play')
})

gate('an empty or unset WORLD is no request, so the build is not refused and writes the site', () => {
  assert(locateSiteWorld('').name === null && locateSiteWorld(undefined).name === null, 'empty or unset WORLD named a world')
  const result = runBuild('')
  assert(result.status === 0, 'exit ' + result.status + ' ' + result.stderr)
  assert(result.stdout.includes('files written'), 'no write report: ' + result.stdout)
})

gate('the page guard uses the same resolver and runs before the kernel loads', () => {
  const text = readFileSync(join(root, 'site', 'play.js'), 'utf8')
  assert(text.includes("from './src/site/worldName.js'"), 'play.js does not import the resolver')
  assert(text.includes('locateSiteWorld(worldRequestOf(location.search, location.hash))'), 'play.js does not resolve ?world')
  assert(text.indexOf('locateSiteWorld(') < text.indexOf('loadKernel('), 'the world guard runs after the kernel loads')
})

gate('the planned site carries the resolver, so the page import resolves in the browser', () => {
  assert(planSite().files.some((file) => file.to === 'src/site/worldName.js'), 'src/site/worldName.js is not in the site plan')
})

gate('control: a site that shipped tps-game would accept it, so the refusal comes from the empty shipped list', () => {
  const found = locateWorld({ name: 'tps-game', exists: (rel) => rel === 'apps/world/tps-game.js' })
  assert(found.name === 'tps-game' && found.path === 'apps/world/tps-game.js', 'the layout was not located')
  assert(locateSiteWorld(null).path === null, 'the shipped site located a world')
})

finish()
