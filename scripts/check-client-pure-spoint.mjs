import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runClientPure } from './lib/clientPureScenario.mjs'
import { macrotaskYield } from '../src/client-pure/macrotaskYield.js'
import { captureHudFreeFrame } from '../src/client-pure/frameCapture.js'
import { paintChunkGlyphs, paintFootprints } from '../src/client-pure/minimapGlyphs.js'
import { SHADOW_CASTER_ONLY_LAYER } from '../src/client-pure/cascadeShadow.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/client-pure.json', import.meta.url), 'utf8'))
const ours = await runClientPure({ macrotaskYield, captureHudFreeFrame, paintChunkGlyphs, paintFootprints, SHADOW_CASTER_ONLY_LAYER })
const section = (log, prefix) => log.filter((line) => line.startsWith(prefix))
const spoint = fixture.log

gate('macrotaskYield matches spoint on the channel branch and the setTimeout fallback', () => {
  assert.deepEqual(section(ours, 'macro '), section(spoint, 'macro '))
})

gate('captureHudFreeFrame matches spoint on the blob, the hidden HUD, the null blob and the render failure, with the visibility restored', () => {
  assert.deepEqual(section(ours, 'frame '), section(spoint, 'frame '))
})

gate('paintChunkGlyphs matches spoint on every class, shade level, rock path and device-pixel scale', () => {
  assert.deepEqual(section(ours, 'glyph '), section(spoint, 'glyph '))
})

gate('paintFootprints matches spoint on the outline and the minimum-size rect', () => {
  assert.deepEqual(section(ours, 'footprint '), section(spoint, 'footprint '))
})

gate('the cascade shadow caster layer equals spoint ShadowLayers', () => {
  assert.deepEqual(section(ours, 'shadow '), section(spoint, 'shadow '))
})

gate('the fixture covers both macrotaskYield branches, a null blob, a render failure and the rock and rect paths', () => {
  assert.ok(spoint.includes('macro channel created'), 'the channel branch did not run')
  assert.ok(spoint.includes('macro setTimeout 0'), 'the setTimeout fallback did not run')
  assert.ok(spoint.includes('frame error capture_unavailable'), 'the null blob was not refused')
  assert.ok(spoint.includes('frame error gpu lost'), 'the render failure was not propagated')
  assert.ok(spoint.includes('frame visibility after render failure visible|'), 'the HUD was not restored after a failure')
  assert.ok(spoint.some((line) => line.startsWith('glyph lineTo')), 'no rock path was painted')
  assert.ok(spoint.some((line) => line.startsWith('footprint rect')), 'no minimum-size footprint was drawn')
})

finish()
