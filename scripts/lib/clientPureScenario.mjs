export async function runClientPure(lib) {
  const log = []
  const note = (line) => log.push(line)
  await macrotaskCases(lib, note)
  await captureCases(lib, note)
  paintCases(lib, note)
  note('shadow layer ' + JSON.stringify(lib.SHADOW_CASTER_ONLY_LAYER))
  return log
}

async function macrotaskCases(lib, note) {
  const names = ['MessageChannel', 'setTimeout']
  const original = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const install = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
  class FakeChannel {
    constructor() {
      note('macro channel created')
      this.port1 = { onmessage: null, close: () => note('macro port1 closed') }
      this.port2 = {
        close: () => note('macro port2 closed'),
        postMessage: (value) => {
          note('macro postMessage ' + value)
          Promise.resolve().then(() => this.port1.onmessage?.({ data: value }))
        },
      }
    }
  }
  const fakeTimeout = (fn, ms) => {
    note('macro setTimeout ' + ms)
    Promise.resolve().then(fn)
  }
  try {
    install('MessageChannel', FakeChannel)
    install('setTimeout', fakeTimeout)
    await lib.macrotaskYield()
    note('macro resolved with a channel')
    install('MessageChannel', undefined)
    await lib.macrotaskYield()
    note('macro resolved with a timeout')
  } finally {
    for (const name of names) {
      if (original[name]) Object.defineProperty(globalThis, name, original[name])
      else delete globalThis[name]
    }
  }
}

async function captureCases(lib, note) {
  const visibility = (els) => els.map((el) => el.style.visibility).join('|')
  const hudElements = () => [{ style: { visibility: 'visible' } }, { style: { visibility: '' } }]
  const canvas = (blobFor) => ({
    toBlob(resolve, type, quality) {
      note(`frame toBlob ${type} ${quality}`)
      resolve(blobFor(type))
    },
  })
  const renderer = (domElement, hud, fail) => ({
    domElement,
    render(scene, camera) {
      note(`frame render ${scene.name} ${camera.name} hidden ${visibility(hud)}`)
      if (fail) throw new Error(fail)
    },
  })
  const scene = { name: 'scene' }
  const camera = { name: 'camera' }

  const hudA = hudElements()
  const blob = await lib.captureHudFreeFrame({ renderer: renderer(canvas((type) => ({ size: 4, type })), hudA), scene, camera, hudElements: hudA, quality: 0.5 })
  note('frame blob ' + JSON.stringify(blob))
  note('frame visibility after capture ' + visibility(hudA))

  const hudB = hudElements()
  try {
    await lib.captureHudFreeFrame({ renderer: renderer(canvas(() => null), hudB), scene, camera, hudElements: hudB })
  } catch (error) {
    note('frame error ' + error.message)
  }
  note('frame visibility after null blob ' + visibility(hudB))

  const hudC = hudElements()
  try {
    await lib.captureHudFreeFrame({ renderer: renderer(canvas(() => ({})), hudC, 'gpu lost'), scene, camera, hudElements: hudC })
  } catch (error) {
    note('frame error ' + error.message)
  }
  note('frame visibility after render failure ' + visibility(hudC))
}

function recordingContext(note, prefix) {
  const ctx = {}
  for (const name of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'rect', 'fill', 'stroke']) {
    ctx[name] = (...args) => note(`${prefix}${name} ${JSON.stringify(args)}`)
  }
  for (const key of ['lineWidth', 'fillStyle', 'strokeStyle']) {
    let value
    Object.defineProperty(ctx, key, {
      get: () => value,
      set: (next) => {
        value = next
        note(`${prefix}set ${key} ${JSON.stringify(next)}`)
      },
      enumerable: true,
    })
  }
  return ctx
}

function paintCases(lib, note) {
  const relief = { cells: 4, cellMeters: 25, shade: [0.5, 0.9, 1.1, 1.3, 0.6, 0.85, 1.0, 1.25, 0.7, 0.75, 0.95, 1.2, 0.4, 0.99, 1.05, 1.5] }
  const packed = [10, 12, 0, 2, 40, 30, 2, 3, 55, 55, 5, 1.5, 5, 5, 1, 0.2, 20, 20, 3, 4, 80, 10, 0, 1, 60, 45, 4, 2, 30, 80, 1, 0.6]

  lib.paintChunkGlyphs(recordingContext(note, 'glyph '), packed, 0, 0, 2, 1, relief)
  lib.paintChunkGlyphs(recordingContext(note, 'glyph dpr2 '), packed, 0, 0, 2, 2, relief)
  lib.paintChunkGlyphs(recordingContext(note, 'glyph empty '), [], 0, 0, 2, 1, relief)
  note('glyph empty chunk done')

  const corners = [0, 0, 20, 0, 20, 20, 0, 20, 5, 5, 5.1, 5, 5.1, 5.1, 5, 5.1]
  lib.paintFootprints(recordingContext(note, 'footprint '), corners, 2, 0, 0, 2, 1)
  lib.paintFootprints(recordingContext(note, 'footprint dpr2 '), corners, 2, 0, 0, 2, 2)
  lib.paintFootprints(recordingContext(note, 'footprint none '), corners, 0, 0, 0, 2, 1)
  note('footprint none done')
}
