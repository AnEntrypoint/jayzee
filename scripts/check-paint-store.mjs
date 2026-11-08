import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createFieldPaint } from '../src/terrain-pure/fieldPaint.js'
import { PAINT_STORE_KEY, persistPaintDocument, restorePaintDocument } from '../src/terrain-pure/paintStore.js'

const memoryStorage = (initial = new Map()) => {
  const store = new Map(initial)
  const calls = { get: 0, set: [] }
  return {
    store,
    calls,
    get: async (key) => { calls.get++; return store.get(key) },
    set: async (key, value) => { calls.set.push(key); store.set(key, structuredClone(value)) },
  }
}

const blankDoc = () => createFieldPaint({ cellSize: 1, chunkCells: 64 }).toJSON()

const paintedFieldPaint = () => {
  const paint = createFieldPaint({ cellSize: 1, chunkCells: 64 })
  paint.stroke({ field: 'terrain:height', layer: 'PLAYER', center: [0, 0], radius: 3, fn: () => 1 })
  return paint
}

const cases = {}

const probe = async (label, fn) => {
  try {
    await fn()
    cases[label] = null
  } catch (error) {
    cases[label] = error
  }
}

const check = (label) => gate(label, () => {
  if (!(label in cases)) throw new Error('no probe recorded ' + label)
  if (cases[label]) throw cases[label]
})

await probe('empty', async () => {
  const storage = memoryStorage()
  const { fieldPaint, marks } = await restorePaintDocument(storage, undefined)
  assert.deepEqual(fieldPaint.toJSON(), blankDoc())
  assert.equal(marks, undefined)
  assert.equal(storage.calls.get, 1)
})

await probe('round-trip', async () => {
  const painted = paintedFieldPaint()
  assert.notDeepEqual(painted.toJSON(), blankDoc(), 'the stroke must change the document or the round trip proves nothing')
  const storage = memoryStorage()
  await persistPaintDocument(storage, painted, undefined)
  const restored = await restorePaintDocument(storage, undefined)
  assert.deepEqual(restored.fieldPaint.toJSON(), painted.toJSON())
})

await probe('saved shape', async () => {
  const storage = memoryStorage()
  await persistPaintDocument(storage, paintedFieldPaint(), { zones: [1] })
  assert.deepEqual(storage.calls.set, [PAINT_STORE_KEY])
  const saved = storage.store.get(PAINT_STORE_KEY)
  assert.deepEqual(Object.keys(saved).sort(), ['marks', 'paint'])
  assert.deepEqual(saved.marks, { zones: [1] })
})

await probe('missing marks persist as null', async () => {
  const storage = memoryStorage()
  await persistPaintDocument(storage, createFieldPaint({ cellSize: 1, chunkCells: 64 }), undefined)
  assert.equal(storage.store.get(PAINT_STORE_KEY).marks, null)
})

await probe('configured marks win over saved marks', async () => {
  const storage = memoryStorage()
  await persistPaintDocument(storage, paintedFieldPaint(), { zones: ['saved'] })
  const restored = await restorePaintDocument(storage, { marks: { zones: ['config'] } })
  assert.deepEqual(restored.marks, { zones: ['config'] })
})

await probe('saved marks used when config has none', async () => {
  const storage = memoryStorage()
  await persistPaintDocument(storage, paintedFieldPaint(), { zones: ['saved'] })
  const restored = await restorePaintDocument(storage, {})
  assert.deepEqual(restored.marks, { zones: ['saved'] })
})

await probe('null saved marks restore as undefined', async () => {
  const storage = memoryStorage()
  await persistPaintDocument(storage, paintedFieldPaint(), null)
  const restored = await restorePaintDocument(storage, undefined)
  assert.equal(restored.marks, undefined)
})

await probe('absent document with config marks returns the config marks', async () => {
  const restored = await restorePaintDocument(memoryStorage(), { marks: 'cfg' })
  assert.equal(restored.marks, 'cfg')
})

await probe('a stored undefined reads as absent, not malformed', async () => {
  const storage = memoryStorage(new Map([[PAINT_STORE_KEY, undefined]]))
  const restored = await restorePaintDocument(storage, undefined)
  assert.deepEqual(restored.fieldPaint.toJSON(), blankDoc())
})

for (const [label, value] of [['a string', 'x'], ['a number', 3], ['a document with no paint field', { marks: null }]]) {
  await probe('malformed: ' + label, async () => {
    const storage = memoryStorage(new Map([[PAINT_STORE_KEY, value]]))
    await assert.rejects(restorePaintDocument(storage, undefined), (error) => error instanceof TypeError && /stored paint document is malformed/.test(error.message))
  })
}

await probe('an unknown saved field is refused by fromJSON', async () => {
  const storage = memoryStorage(new Map([[PAINT_STORE_KEY, { paint: { 'terrain:bogus': {} }, marks: null }]]))
  await assert.rejects(restorePaintDocument(storage, undefined), /saved field "terrain:bogus"/)
})

await probe('an unknown saved layer is refused', async () => {
  const storage = memoryStorage(new Map([[PAINT_STORE_KEY, { paint: { 'terrain:height': { ENEMY: {} } }, marks: null }]]))
  await assert.rejects(restorePaintDocument(storage, undefined), /layer "ENEMY" is not one of/)
})

await probe('an invalid fieldPaint config is refused before storage is read', async () => {
  const storage = memoryStorage()
  await assert.rejects(restorePaintDocument(storage, { fieldPaint: 3 }), /terrain\.fieldPaint must be an object/)
  assert.equal(storage.calls.get, 0)
})

gate('the store key is terrain-paint', () => {
  assert.equal(PAINT_STORE_KEY, 'terrain-paint')
})

check('empty')
check('round-trip')
check('saved shape')
check('missing marks persist as null')
check('configured marks win over saved marks')
check('saved marks used when config has none')
check('null saved marks restore as undefined')
check('absent document with config marks returns the config marks')
check('a stored undefined reads as absent, not malformed')
check('malformed: a string')
check('malformed: a number')
check('malformed: a document with no paint field')
check('an unknown saved field is refused by fromJSON')
check('an unknown saved layer is refused')
check('an invalid fieldPaint config is refused before storage is read')

finish()
