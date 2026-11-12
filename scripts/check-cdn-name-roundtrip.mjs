import { gate, finish } from './lib/gate.mjs'
import { decodeName, encodeName } from '../src/spawn/cdnName.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}

const lcg = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

gate('every one of the 128 ASCII characters encodes to a literal or a two-digit escape and decodes back to itself', () => {
  for (let code = 0; code < 128; code++) {
    const ch = String.fromCharCode(code)
    const encoded = encodeName(ch)
    assert(encoded === ch || /^~[0-9a-f]{2}$/.test(encoded), 'character ' + code + ' encodes to ' + encoded)
    same(decodeName(encoded), ch, 'decode of character ' + code)
  }
})

gate('the tilde is written as ~7e, so an encoded name never holds a bare tilde and a name that already looks escaped survives', () => {
  same(encodeName('~'), '~7e', 'tilde')
  same(encodeName('a~2fb'), 'a~7e2fb', 'a name that already looks escaped')
  same(decodeName(encodeName('a~2fb')), 'a~2fb', 'round trip of a name that already looks escaped')
  same(decodeName(encodeName('~~7e~')), '~~7e~', 'round trip of repeated tildes')
})

gate('negative control: an encoder that left the tilde as a literal would not round trip a name that looks escaped', () => {
  const leaky = (name) => encodeName(name).replace(/~7e/g, '~')
  mustReject(() => same(decodeName(leaky('a~2fb')), 'a~2fb', 'leaky round trip'))
})

gate('only lower-case letters, digits, dot, dash and underscore are written as themselves', () => {
  let literals = ''
  for (let code = 0; code < 128; code++) {
    const ch = String.fromCharCode(code)
    if (encodeName(ch) === ch) literals += ch
  }
  same(literals, '-.0123456789_abcdefghijklmnopqrstuvwxyz', 'literal set')
})

gate('1000 seeded names over ASCII, accented, CJK and emoji characters round trip, and two different names never share an encoding', () => {
  const random = lcg(2024)
  const pool = ['a', 'Z', '0', '/', ':', '~', '.', '-', '_', ' ', '%', 'é', 'ß', '中', '文', '😀', '\u0000', '\u007f']
  const seen = new Map()
  for (let i = 0; i < 1000; i++) {
    let name = ''
    const length = 1 + Math.floor(random() * 12)
    for (let k = 0; k < length; k++) name += pool[Math.floor(random() * pool.length)]
    const encoded = encodeName(name)
    assert(/^[a-z0-9._~-]*$/.test(encoded), 'encoding of ' + JSON.stringify(name) + ' holds a character outside the key alphabet')
    same(decodeName(encoded), name, 'round trip of ' + JSON.stringify(name))
    if (seen.has(encoded)) same(seen.get(encoded), name, 'two names with the encoding ' + encoded)
    seen.set(encoded, name)
  }
})

gate('a name outside ASCII is written as its UTF-8 bytes and read back, where the earlier decoder refused its own output', () => {
  same(encodeName('é'), '~c3~a9', 'two-byte character')
  same(decodeName('~c3~a9'), 'é', 'two-byte character decoded')
  same(decodeName(encodeName('木.glb')), '木.glb', 'three-byte character')
  same(decodeName(encodeName('😀')), '😀', 'four-byte character')
})

gate('a lone continuation byte, a cut multi-byte sequence, a bare tilde, an upper-case escape and a raw character outside ASCII are refused', () => {
  mustReject(() => decodeName('a~80b'))
  mustReject(() => decodeName('~c3'))
  mustReject(() => decodeName('~e6~9c'))
  mustReject(() => decodeName('a~b'))
  mustReject(() => decodeName('a~'))
  mustReject(() => decodeName('~2F'))
  mustReject(() => decodeName('é'))
  mustReject(() => decodeName(5))
})

finish()
