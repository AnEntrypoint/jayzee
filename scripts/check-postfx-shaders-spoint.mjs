import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import * as shaders from '../src/render/postFxShaders.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/postfx-shaders.json', import.meta.url), 'utf8'))

gate('the post-fx shader fixture was generated from spoint Bloom.js, FSR1.js and SSR.js at a pinned commit', () => {
  assert.match(fixture.source.commit, /^[0-9a-f]{7,}$/)
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['client/core/Bloom.js', 'client/core/FSR1.js', 'client/core/SSR.js'])
})

const SHADERS = [
  ['the Bloom threshold vertex shader', fixture.bloom.threshold.vertexShader, shaders.BLOOM_FULLSCREEN_VERT],
  ['the Bloom threshold fragment shader', fixture.bloom.threshold.fragmentShader, shaders.BLOOM_THRESHOLD_FRAG],
  ['the Bloom blur fragment shader', fixture.bloom.blur.fragmentShader, shaders.BLOOM_BLUR_FRAG],
  ['the Bloom composite fragment shader', fixture.bloom.composite.fragmentShader, shaders.BLOOM_COMPOSITE_FRAG],
  ['the FSR1 EASU fragment shader', fixture.fsr1.easu.fragmentShader, shaders.FSR1_EASU_FRAG],
  ['the FSR1 RCAS fragment shader', fixture.fsr1.rcas.fragmentShader, shaders.FSR1_RCAS_FRAG],
  ['the FSR1 composite vertex shader', fixture.fsr1.composite.vertexShader, shaders.FSR1_FULLSCREEN_VERT],
  ['the FSR1 composite fragment shader', fixture.fsr1.composite.fragmentShader, shaders.FSR1_COMPOSITE_FRAG],
  ['the SSR fullscreen vertex shader', fixture.ssr.ssr.vertexShader, shaders.SSR_FULLSCREEN_VERT],
  ['the SSR trace fragment shader', fixture.ssr.ssr.fragmentShader, shaders.SSR_FRAG],
  ['the SSR wetness vertex shader', fixture.ssr.wetness.vertexShader, shaders.SSR_WETNESS_GBUFFER_VERT],
  ['the SSR wetness fragment shader', fixture.ssr.wetness.fragmentShader, shaders.SSR_WETNESS_GBUFFER_FRAG],
  ['the SSR composite fragment shader', fixture.ssr.composite.fragmentShader, shaders.SSR_COMPOSITE_FRAG],
]

for (const [label, want, got] of SHADERS) {
  gate(label + ' is spoint text exactly', () => {
    assert.equal(typeof want, 'string')
    assert.equal(got, want)
  })
}

gate('the Bloom blur shader carries spoint taps, so a dead blur would show', () => {
  assert.ok(shaders.BLOOM_BLUR_FRAG.includes('0.227'))
})

finish()
