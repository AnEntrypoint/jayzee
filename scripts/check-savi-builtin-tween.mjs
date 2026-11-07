import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createTween, TWEEN_NAME } from '../src/savi-builtins/tween.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-tween.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'tween.js')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const near = (actual, expected, label, tolerance = 1e-9) => {
  assert(Math.abs(actual - expected) <= tolerance, label + ' is ' + actual + ', expected ' + expected)
}
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

gate('the name and the signature line are the ones savi documents for tween', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('Keyframes use dot paths into target fields.'), true, 'dot path sentence')
  same(section.includes('duration and delay use seconds.'), true, 'seconds sentence')
  same(section.includes('animate(ctx, target: string, keyframes: Record<string, AnimationKeyframeValue>, opts?: { duration?: number, easing?: string, delay?: number, direction?: "normal" | "reverse" | "alternate", loop?: boolean | number }): void'), true, 'signature')
  same(TWEEN_NAME, 'animate', 'exported name')
})

gate('a scalar keyframe interpolates from the start value to the target over duration seconds', () => {
  const tw = createTween({ start: { 'pos.x': 0 }, keyframes: { 'pos.x': 10 }, opts: { duration: 2 } })
  same(tw.total, 2, 'total')
  near(tw.valueAt(0)['pos.x'], 0, 'at 0')
  near(tw.valueAt(1)['pos.x'], 5, 'at the midpoint')
  near(tw.valueAt(2)['pos.x'], 10, 'at the duration')
  near(tw.valueAt(3)['pos.x'], 10, 'after the duration holds the target')
})

gate('a relative +=n value adds n to the start value, including a negative n', () => {
  const up = createTween({ start: { 'rot.y': 10 }, keyframes: { 'rot.y': '+=5' }, opts: { duration: 1 } })
  near(up.valueAt(1)['rot.y'], 15, 'plus five')
  const down = createTween({ start: { 'rot.y': 10 }, keyframes: { 'rot.y': '+=-2.5' }, opts: { duration: 1 } })
  near(down.valueAt(1)['rot.y'], 7.5, 'minus two and a half')
})

gate('a per-segment object takes its own value, duration and easing', () => {
  const tw = createTween({ start: { s: 0 }, keyframes: { s: { value: 4, duration: 4, easing: 'easeInQuad' } }, opts: { duration: 1 } })
  same(tw.total, 4, 'segment duration wins over the default')
  near(tw.valueAt(2).s, 1, 'quadratic ease at half time')
  near(tw.valueAt(4).s, 4, 'at the segment end')
})

gate('a segment without its own duration or easing takes the option defaults', () => {
  const tw = createTween({ start: { a: 0 }, keyframes: { a: { value: 8 } }, opts: { duration: 2, easing: 'easeOutQuad' } })
  same(tw.total, 2, 'default duration')
  near(tw.valueAt(1).a, 8 * (1 - (1 - 0.5) ** 2), 'default easing at half time')
})

gate('delay holds every path at its start for delay seconds, and the total includes it', () => {
  const tw = createTween({ start: { x: 0, y: 3 }, keyframes: { x: 10, y: '+=1' }, opts: { duration: 2, delay: 1 } })
  same(tw.total, 3, 'total is duration plus delay')
  near(tw.valueAt(0.5).x, 0, 'before the delay ends')
  near(tw.valueAt(1).x, 0, 'exactly at the delay')
  near(tw.valueAt(2).x, 5, 'halfway through the movement')
  near(tw.valueAt(2).y, 3.5, 'relative path halfway')
})

gate('scoped negative: waypoint arrays, direction other than normal, and loop are refused, because savi documents their names only', () => {
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: [0, 5, 10] }, opts: { duration: 1 } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1, direction: 'reverse' } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1, direction: 'alternate' } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1, loop: true } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1, loop: 3 } }))
  const plain = createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1, direction: 'normal', loop: false } })
  near(plain.valueAt(1).a, 5, 'normal and no loop are accepted')
})

gate('a malformed relative string, an unknown easing and a prototype key are refused', () => {
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: '+5' }, opts: { duration: 1 } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: '=5' }, opts: { duration: 1 } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1, easing: 'bounceIn' } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1, easing: 'constructor' } }))
})

gate('a path without a numeric start, a non-positive duration, a negative delay and a negative time are refused', () => {
  mustThrow(() => createTween({ start: {}, keyframes: { a: 5 }, opts: { duration: 1 } }))
  mustThrow(() => createTween({ start: { a: Number.NaN }, keyframes: { a: 5 }, opts: { duration: 1 } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 0 } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1, delay: -1 } }))
  mustThrow(() => createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: {} }))
  const tw = createTween({ start: { a: 0 }, keyframes: { a: 5 }, opts: { duration: 1 } })
  mustThrow(() => tw.valueAt(-1))
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-builtins/tween.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn("const t = performance.now() // x").length > 0, true, 'negative sample is caught')
})

finish()
