import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { resolveSurfaceControls as resolveControls, resolveControls as resolveDocument, MAX_TOUCH_CHIPS, TOUCH_SURFACE_UNUSABLE, surfaceFromDraft, parseTouchSurfaces, TOUCH_CHIP_CAP, DRAFT_SURFACE_NAME } from '../src/client-pure/touchSurfaceSpec.js'
import { touchDraftFromBindings } from '../src/client-pure/touchDraft.js'

const stick = { id: 'move', kind: 'stick', anchor: 'left', x: 0.1, y: 0.9, size: 40, action: 'move' }
const chip = (i) => ({ id: 'b' + i, kind: 'button', anchor: 'right', x: 0.9, y: 0.1 * i, size: 20, action: 'act' + i })
const chips = (n) => Array.from({ length: n }, (_, i) => chip(i))
const draft = { surfaces: [stick, chip(0)] }
const codes = (r) => r.diagnostics.map((d) => d.code)

gate('a declared usable surface resolves to its own controls with no diagnostics', () => {
  const r = resolveControls({ surfaces: { combat: { surfaces: [stick, ...chips(4)] } }, active: 'combat', draft })
  assert.equal(r.surface.name, 'combat')
  assert.equal(r.surface.source, 'surface')
  assert.deepEqual(r.surface.controls.map((c) => c.id), ['move', 'b0', 'b1', 'b2', 'b3'])
  assert.deepEqual(r.diagnostics, [])
  assert.ok(Object.isFrozen(r.surface) && Object.isFrozen(r.surface.controls))
})

gate('a surface with more than four button chips keeps the first four and reports the cap', () => {
  assert.equal(TOUCH_CHIP_CAP, 4)
  const r = resolveControls({ surfaces: { s: { surfaces: [chip(0), stick, ...chips(7).slice(1)] } } }, 's')
  assert.deepEqual(r.surface.controls.map((c) => c.id), ['b0', 'move', 'b1', 'b2', 'b3'])
  assert.deepEqual(codes(r), ['chip-cap-exceeded'])
  assert.match(r.diagnostics[0].message, /7 button chips/)
  const four = resolveControls({ surfaces: { s: { surfaces: chips(4) } } }, 's')
  assert.deepEqual(codes(four), [], 'negative control: exactly four chips is not over the cap')
})

gate('sticks, pads and orientation controls do not count against the chip cap', () => {
  const pad = { ...chip(9), id: 'pad', kind: 'pad' }
  const tilt = { ...chip(8), id: 'tilt', kind: 'orientation' }
  const r = resolveControls({ surfaces: { s: { surfaces: [stick, pad, tilt, ...chips(4)] } } }, 's')
  assert.equal(r.surface.controls.length, 7)
  assert.deepEqual(codes(r), [])
})

gate('an explicit surface name wins over the active one', () => {
  const touch = { surfaces: { a: { surfaces: [stick] }, b: { surfaces: [chip(1)] } }, active: 'a', draft }
  assert.equal(resolveControls(touch, 'b').surface.name, 'b')
  assert.equal(resolveControls(touch).surface.name, 'a')
})

gate('an unknown, malformed or empty surface falls back to the draft and says why', () => {
  const touch = { surfaces: { bad: { surfaces: [{ ...stick, x: 2 }] }, dup: { surfaces: [stick, stick] }, empty: { surfaces: [] }, none: {} }, draft }
  for (const [name, code] of [['ghost', 'surface-unknown'], ['bad', 'bad-field'], ['dup', 'duplicate-id'], ['empty', 'surface-empty'], ['none', 'no-surfaces-array'], ['toString', 'surface-unknown']]) {
    const r = resolveControls(touch, name)
    assert.equal(r.surface.source, 'draft', name)
    assert.equal(r.surface.name, DRAFT_SURFACE_NAME)
    assert.deepEqual(r.surface.controls.map((c) => c.id), ['move', 'b0'], name)
    assert.deepEqual(codes(r), [code], name)
  }
})

gate('with no surface named the draft is used silently, and the draft is capped too', () => {
  const quiet = resolveControls({ draft })
  assert.equal(quiet.surface.source, 'draft')
  assert.deepEqual(quiet.diagnostics, [])
  const big = resolveControls({ draft: { surfaces: chips(6) } })
  assert.equal(big.surface.controls.length, 4)
  assert.deepEqual(codes(big), ['chip-cap-exceeded'])
})

gate('a missing or unusable draft yields an empty surface with a diagnostic, never a throw', () => {
  const none = resolveControls({ surfaces: {} }, 'x')
  assert.deepEqual(codes(none), ['surface-unknown', 'draft-missing'])
  assert.deepEqual(none.surface.controls, [])
  const broken = resolveControls({ draft: { surfaces: [{}] } })
  assert.deepEqual(codes(broken), ['bad-field'])
  assert.deepEqual(broken.surface.controls, [])
  assert.throws(() => resolveControls(null), TypeError)
})

gate('a binding draft converts to a parseable surface that resolveControls accepts', () => {
  const layout = { w: 800, h: 400, buttonsRightOffset: 20, buttonsBottomOffset: 20 }
  const responsive = { buttonSize: 50, spacing: 10, joystickRadius: 45 }
  const bindings = { move: {}, look: {}, jump: { key: 'space' }, fire: { key: 'f', touch: 'drag' }, crouch: { key: 'c' }, reload: { key: 'r' }, use: { key: 'e' }, melee: { key: 'v' } }
  const spec = surfaceFromDraft(touchDraftFromBindings(bindings, layout, responsive), layout)
  const parsed = parseTouchSurfaces(spec)
  assert.deepEqual(parsed.map((c) => c.kind), ['stick', 'stick', 'button', 'pad', 'button', 'button', 'button', 'button'])
  assert.equal(parsed[0].anchor, 'left')
  assert.equal(parsed[1].anchor, 'right')
  const jump = parsed[2]
  assert.ok(Math.abs(jump.x - (1 - (20 + 2 * 60 + 25) / 800)) < 1e-12)
  const r = resolveControls({ draft: spec })
  assert.deepEqual(r.surface.controls.filter((c) => c.kind === 'button').map((c) => c.id), ['jump', 'crouch', 'reload', 'use'])
  assert.deepEqual(codes(r), ['chip-cap-exceeded'])
  assert.throws(() => surfaceFromDraft({ sticks: [], buttons: [] }, { w: 0, h: 1 }), TypeError)
})

const id = (name) => ({ id: name })
const plain = (r) => JSON.parse(JSON.stringify({ ok: r.ok, reasonCode: r.reasonCode, fallback: r.fallback, diagnostics: r.diagnostics, controls: r.controls }))
const documents = [
  { sticks: [id('move')], buttons: [id('jump'), id('fire')], pads: [id('look')], gestures: [id('pinch')], style: { tint: 'red' }, axes: ['a', 7, 'b'] },
  { sticks: [id('move'), id('look')], buttons: [id('a'), id('b'), id('c')], pads: [id('p')] },
  { pads: [id('p')], gestures: [id('g')] },
  { sticks: 'nope', buttons: [id('a'), null, { id: '' }, { id: 5 }, id('b')] },
  { buttons: [id('a')], style: 'loud', axes: 'x' },
  {},
]
const draftDoc = { sticks: [id('draft-move')], buttons: [] }

gate('resolveControls caps sticks, buttons and pads together at four chips in that order and keeps gestures apart', () => {
  assert.equal(MAX_TOUCH_CHIPS, 4)
  const r = resolveDocument(documents[1], draftDoc)
  assert.equal(r.ok, true)
  assert.deepEqual(r.controls.sticks.map((c) => c.id), ['move', 'look'])
  assert.deepEqual(r.controls.buttons.map((c) => c.id), ['a', 'b'])
  assert.deepEqual(r.controls.pads, [])
  assert.deepEqual(r.diagnostics, ['chip-cap-exceeded:6>4'])
  const four = resolveDocument(documents[0], draftDoc)
  assert.deepEqual(four.diagnostics, [], 'negative control: four chips are within the cap')
  assert.deepEqual(four.controls.gestures, [id('pinch')])
  assert.deepEqual(four.controls.style, { tint: 'red' })
  assert.deepEqual(four.controls.axes, ['a', 'b'])
  assert.deepEqual(four.sendAction('jump'), { type: 'action', id: 'jump' })
  assert.deepEqual(four.sendAxis('look', 0.5), { type: 'axis', id: 'look', value: 0.5 })
})

gate('a surface with neither a stick nor a button is unusable and hands back the draft', () => {
  for (const doc of [documents[2], documents[5], { sticks: 'x', buttons: 3 }]) {
    const r = resolveDocument(doc, draftDoc)
    assert.equal(r.ok, false)
    assert.equal(r.reasonCode, TOUCH_SURFACE_UNUSABLE)
    assert.equal(r.fallback, draftDoc)
    assert.equal(r.controls, null)
  }
  assert.deepEqual(resolveDocument({ sticks: 'x', buttons: 3 }, draftDoc).diagnostics, ['sticks-not-array', 'buttons-not-array'])
})

gate('malformed entries are dropped with a diagnostic, defaults fill style and axes, and a bad document or draft is refused', () => {
  const r = resolveDocument(documents[3], draftDoc)
  assert.deepEqual(r.diagnostics, ['sticks-not-array', 'bad-buttons-1', 'bad-buttons-2', 'bad-buttons-3'])
  assert.deepEqual(r.controls.buttons.map((c) => c.id), ['a', 'b'])
  const d = resolveDocument(documents[4], draftDoc)
  assert.deepEqual(d.controls.style, {})
  assert.deepEqual(d.controls.axes, ['touchActive', 'touchTwist'])
  for (const [doc, draftValue, code] of [[null, draftDoc, 'touch-document-invalid'], [[], draftDoc, 'touch-document-invalid'], [{}, null, 'touch-draft-invalid'], [{}, [], 'touch-draft-invalid']]) {
    assert.throws(() => resolveDocument(doc, draftValue), (e) => e instanceof TypeError && e.reasonCode === code)
  }
})

const SPOINT_TOUCH = '/workspace/spoint/src/client/touchSurfaces.js'
if (existsSync(SPOINT_TOUCH)) {
  const spoint = await import(SPOINT_TOUCH)
  gate('resolveControls returns what spoint touchSurfaces.js returns on every fixture document', () => {
    assert.equal(spoint.MAX_TOUCH_CHIPS, MAX_TOUCH_CHIPS)
    for (const doc of [...documents, { sticks: 'x', buttons: 3 }, { buttons: [id('a')], style: [1] }]) assert.deepEqual(plain(resolveDocument(doc, draftDoc)), plain(spoint.resolveControls(doc, draftDoc)), JSON.stringify(doc))
  })
} else {
  console.log('INFO no spoint checkout: the comparison with touchSurfaces.js was not run')
}

finish()
