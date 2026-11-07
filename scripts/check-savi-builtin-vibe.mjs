import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  validateAudio, setBpm, setCps, setSwing, resolveSample, pattern, VIBE_NAMES, VIBE_DEFAULT_BUS, VIBE_GAIN_RANGE,
} from '../src/savi-builtins/vibe.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-vibe.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'vibe.js')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

gate('the savi section gives the default bus, the gain range, the tempo setters and the manifest pointer', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('ctx.setBpm(n), ctx.setCps(n), or ctx.setSwing(amount)'), true, 'tempo setters')
  same(section.includes('The default bus is Music.'), true, 'default bus')
  same(section.includes('gain ranges from 0 to 2; 0 is silent and paused: true stops the transport.'), true, 'gain sentence')
  same(section.includes('Sample names are listed at /cdn/vibe-samples/manifest.json.'), true, 'manifest pointer')
  same(section.includes('an instrument word alone (violins, harp) is a silent voice and a vibe.sample.unknown DM'), true, 'instrument word sentence')
  sameJson(VIBE_NAMES, ['pattern', 'setBpm', 'setCps', 'setSwing', 'validateAudio', 'resolveSample'], 'exported names')
  same(VIBE_DEFAULT_BUS, 'Music', 'default bus constant')
  sameJson(VIBE_GAIN_RANGE, [0, 2], 'gain range')
})

gate('validateAudio keeps the documented units: gain 0 to 2 inclusive, paused a boolean, the Music bus by default', () => {
  const a = validateAudio({ kind: 'vibe', gain: 1 })
  sameJson(a, { gain: 1, paused: false, bus: 'Music' }, 'defaults')
  same(validateAudio({ kind: 'vibe', gain: 0, paused: true }).paused, true, 'paused stops the transport')
  same(validateAudio({ kind: 'vibe', gain: 0 }).gain, 0, 'gain 0 is silent and accepted')
  same(validateAudio({ kind: 'vibe', gain: 2 }).gain, 2, 'gain 2 is accepted')
})

gate('the tempo setters take positive beats per minute and cycles per second, and a non-negative swing', () => {
  same(setBpm(120), 120, 'bpm')
  same(setCps(0.5), 0.5, 'cps')
  same(setSwing(0), 0, 'swing zero')
  same(setSwing(0.25), 0.25, 'swing')
})

gate('resolveSample names the documented families: short words, synths, the vsco pitched list, one-shot prefixes', () => {
  sameJson(resolveSample('bd'), { kind: 'short', name: 'bd' }, 'short word')
  sameJson(resolveSample('sawtooth'), { kind: 'synth', name: 'sawtooth' }, 'synth')
  sameJson(resolveSample('vsco_harp'), { kind: 'pitched', name: 'vsco_harp' }, 'pitched harp')
  sameJson(resolveSample('vsco_cellos_trem'), { kind: 'pitched', name: 'vsco_cellos_trem' }, 'pitched nested name')
  sameJson(resolveSample('vsco_timpani'), { kind: 'pitched', name: 'vsco_timpani' }, 'pitched timpani')
  sameJson(resolveSample('bd_kick_01'), { kind: 'one-shot', name: 'bd_kick_01' }, 'one-shot prefix')
})

gate('an instrument word alone is a silent voice with the vibe.sample.unknown note, as savi states', () => {
  sameJson(resolveSample('harp'), { kind: 'silent', name: 'harp', dm: 'vibe.sample.unknown' }, 'harp alone')
  sameJson(resolveSample('violins'), { kind: 'silent', name: 'violins', dm: 'vibe.sample.unknown' }, 'violins alone')
})

gate('the manifest is not in this repo, so the full name list cannot be checked here; the witness paths are absent', () => {
  same(existsSync(join(root, 'scripts', 'fixtures', 'savi', 'vibe-samples', 'manifest.json')), false, 'no manifest in the savi fixtures')
  same(existsSync(join(root, 'scripts', 'fixtures', 'vibe-samples', 'manifest.json')), false, 'no manifest in the fixtures root')
})

gate('scoped negatives: the pattern language, unlisted vsco names, unknown names and other buses are refused', () => {
  mustThrow(() => pattern())
  mustThrow(() => resolveSample('vsco_violins'))
  mustThrow(() => resolveSample('xyz'))
  mustThrow(() => resolveSample('bd_'))
  mustThrow(() => resolveSample(''))
  mustThrow(() => validateAudio({ kind: 'vibe', gain: 1, bus: 'SFX' }))
})

gate('negative controls: a missing or out-of-range gain, a non-boolean paused, a wrong kind and bad tempo values are refused', () => {
  mustThrow(() => validateAudio({ kind: 'vibe' }))
  mustThrow(() => validateAudio({ kind: 'vibe', gain: 2.01 }))
  mustThrow(() => validateAudio({ kind: 'vibe', gain: -0.1 }))
  mustThrow(() => validateAudio({ kind: 'vibe', gain: 1, paused: 'yes' }))
  mustThrow(() => validateAudio({ kind: 'synth', gain: 1 }))
  mustThrow(() => setBpm(0))
  mustThrow(() => setCps(-1))
  mustThrow(() => setSwing(-1))
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const withoutStrings = (source) => source.replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, "''")

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(withoutStrings(source).split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-builtins/vibe.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
