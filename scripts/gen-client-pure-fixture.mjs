import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runClientPure } from './lib/clientPureScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const clientDir = join(spointRoot, 'client')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'client-pure.json')
const load = (rel) => import(pathToFileURL(join(clientDir, rel)).href)

const placements = readFileSync(join(clientDir, 'hud/MinimapPlacements.js'), 'utf8')
const constant = (name) => {
  const match = placements.match(new RegExp(`^export const ${name} = (\\d+)$`, 'm'))
  if (!match) throw new Error(`${name} is not an integer constant in spoint hud/MinimapPlacements.js`)
  return Number(match[1])
}
const stubDir = mkdtempSync(join(tmpdir(), 'client-pure-'))
writeFileSync(join(stubDir, 'MinimapPlacements.js'), ['GLYPH_STRIDE', 'GLYPH_ROCK', 'GLYPH_CLASS_COUNT'].map((name) => `export const ${name} = ${constant(name)}\n`).join(''))
copyFileSync(join(clientDir, 'hud/MinimapGlyphs.js'), join(stubDir, 'MinimapGlyphs.js'))

const macrotask = await load('core/macrotaskYield.js')
const frame = await load('core/frameCapture.js')
const shadow = await load('core/ShadowLayers.js')
const glyphs = await import(pathToFileURL(join(stubDir, 'MinimapGlyphs.js')).href)

const log = await runClientPure({
  macrotaskYield: macrotask.macrotaskYield,
  captureHudFreeFrame: frame.captureHudFreeFrame,
  paintChunkGlyphs: glyphs.paintChunkGlyphs,
  paintFootprints: glyphs.paintFootprints,
  SHADOW_CASTER_ONLY_LAYER: shadow.SHADOW_CASTER_ONLY_LAYER,
})

const fixture = {
  source: {
    modules: ['client/core/macrotaskYield.js', 'client/core/frameCapture.js', 'client/core/ShadowLayers.js', 'client/hud/MinimapGlyphs.js'],
    stubs: 'client/hud/MinimapGlyphs.js imports MinimapPlacements.js, which imports /src/terrain/* paths that do not resolve in Node. The stub exports GLYPH_STRIDE, GLYPH_ROCK and GLYPH_CLASS_COUNT with the integer values read from spoint client/hud/MinimapPlacements.js. No other spoint code is replaced.',
    globals: 'macrotaskYield reads MessageChannel and setTimeout from globalThis, so the scenario installs fakes there for each branch and restores the originals afterward.',
  },
  log,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote client-pure.json', log.length, 'lines')
