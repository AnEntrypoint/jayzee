import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  grade, vignette, blur, dof, bloom, grain, film, tint, scanlines, dotScreen, chromaticAberration, pixelate,
  POSTFX_NAMES, POSTFX_OPTION_DEFAULTS,
} from '../src/savi-builtins/postfx.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-postfx.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'postfx.js')

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

const C = [0.2, 0.5, 0.9]

gate('the savi section states the defaults, the units and the neutral-when-omitted rule this module carries', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('Color adjustments are neutral when omitted.'), true, 'neutral sentence')
  same(section.includes('vignette defaults to roundness 2 and feather 0.45.'), true, 'vignette default sentence')
  same(section.includes('dof focusDistance and focusRange are meters; bokehScale is pixels and defaults to 1.'), true, 'dof sentence')
  same(section.includes('blur amount is 0 to 1.'), true, 'blur sentence')
  same(section.includes('bloom returns the existing color;'), true, 'bloom sentence')
  sameJson(POSTFX_NAMES, ['grade', 'vignette', 'grain', 'film', 'tint', 'scanlines', 'dotScreen', 'chromaticAberration', 'dof', 'pixelate', 'blur', 'bloom'], 'exported names')
  sameJson(POSTFX_OPTION_DEFAULTS, { vignetteRoundness: 2, vignetteFeather: 0.45, dofBokehScale: 1 }, 'stated defaults')
})

gate('an omitted adjustment is neutral, so a grade with no values returns the colour unchanged, as a copy', () => {
  const out = grade(C)
  sameJson(out, C, 'grade with no options')
  same(out === C, false, 'a copy, not the input array')
  sameJson(grade(C, { exposure: undefined }), C, 'an undefined option is omitted')
  sameJson(bloom(C), C, 'bloom returns the existing colour')
})

gate('neutral values are identity: zero vignette, zero blur, zero grain and a pixel size of one', () => {
  sameJson(vignette(C, 0, {}), C, 'vignette at zero intensity')
  sameJson(blur(C, 0), C, 'blur at zero')
  sameJson(grain(C, 0), C, 'grain at zero')
  sameJson(film(C, 0), C, 'film at zero')
  sameJson(tint(C, 'oklch(0.7 0.1 200)', 0), C, 'tint at zero amount')
  sameJson(scanlines(C, 0, 4), C, 'scanlines at zero intensity')
  sameJson(dotScreen(C, 0.5, 0), C, 'dotScreen at zero scale')
  sameJson(chromaticAberration(C, 0), C, 'chromatic aberration at zero')
  sameJson(pixelate(C, 1), C, 'pixelate at one')
})

gate('the documented defaults are the ones the section names: vignette roundness 2 and feather 0.45, dof bokeh 1', () => {
  same(POSTFX_OPTION_DEFAULTS.vignetteRoundness, 2, 'vignette roundness default')
  same(POSTFX_OPTION_DEFAULTS.vignetteFeather, 0.45, 'vignette feather default')
  same(POSTFX_OPTION_DEFAULTS.dofBokehScale, 1, 'dof bokeh default')
  mustThrow(() => dof(C, -5, 4, 2, 1))
})

gate('scoped negatives: non-neutral grades, vignettes, blurs, dof and pixelation are refused, because savi gives no formula for them', () => {
  mustThrow(() => grade(C, { exposure: 0.5 }))
  mustThrow(() => vignette(C, 0.4, {}))
  mustThrow(() => blur(C, 0.5))
  mustThrow(() => dof(C, -5, 4, 2))
  mustThrow(() => pixelate(C, 4))
  mustThrow(() => tint(C, 'oklch(0.7 0.1 200)', 0.5))
  mustThrow(() => grain(C, 0.2))
})

gate('negative controls: bad colours, out-of-range blur, a negative focus distance and a pixel size under one are refused', () => {
  mustThrow(() => grade([0.1, 0.2]))
  mustThrow(() => grade([0.1, Number.NaN, 0.2]))
  mustThrow(() => bloom('red'))
  mustThrow(() => blur(C, 1.5))
  mustThrow(() => blur(C, -0.1))
  mustThrow(() => dof(C, -5, -1, 2))
  mustThrow(() => pixelate(C, 0.5))
  mustThrow(() => vignette(C, -1, {}))
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

gate('src/savi-builtins/postfx.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
