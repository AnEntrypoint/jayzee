import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  THREE_NAMES, materialDeclaration, planMaterial, dataTextureSpec,
  storageTextureSpec, storage3DTextureSpec, nodeProperty, contextRoot,
} from '../src/upstream-builtins/three.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-three.md')
const section = readFileSync(sectionPath, 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check, fragment) => {
  let message = null
  try {
    check()
  } catch (error) {
    message = error.message
  }
  assert(message !== null, 'negative control was accepted')
  assert(message.includes(fragment), 'refused for the wrong reason: ' + message)
}

gate('the upstream section states the opacity range, the transparent rule and the points and line widths this module carries', () => {
  same(section.includes('Material opacity is 0 to 1.'), true, 'opacity sentence')
  same(section.includes('Set transparent when the material uses alpha.'), true, 'transparent sentence')
  same(section.includes('A PointsNodeMaterial draws round, unlit points'), true, 'points sentence')
  same(section.includes('(sizeAttenuation)'), true, 'size attenuation')
  same(section.includes('linewidth is its width in CSS pixels at every distance.'), true, 'line width sentence')
  same(section.includes('ctx.param(name, default) is a shader node'), true, 'param sentence')
})

gate('every name in THREE_NAMES is spelled as the section spells it, with the counts the section lists', () => {
  const counts = { materials: 12, sides: 3, blendings: 6, equations: 5, factors: 11, mappings: 1, wrappings: 3, filters: 6, colorSpaces: 2, formats: 6, types: 4, values: 4 }
  for (const [key, count] of Object.entries(counts)) {
    same(THREE_NAMES[key].length, count, key + ' count')
    for (const name of THREE_NAMES[key]) {
      assert(section.includes(name), key + ' name ' + name + ' is not in the section')
    }
  }
  mustThrow(() => planMaterial({ type: 'MeshBogusNodeMaterial', opacity: 1 }), 'material type')
})

gate('a scripted material declaration keeps its kind, script and params, and refuses any other shape', () => {
  const decl = materialDeclaration({ kind: 'scripted', script: 'shade', params: { tint: 1 } })
  sameJson(decl, { kind: 'scripted', script: 'shade', params: { tint: 1 } }, 'declaration')
  same(Object.isFrozen(decl.params), true, 'params frozen')
  mustThrow(() => materialDeclaration({ kind: 'node', script: 'shade', params: {} }), 'scripted')
  mustThrow(() => materialDeclaration({ kind: 'scripted', script: '', params: {} }), 'non-empty string')
  mustThrow(() => materialDeclaration({ kind: 'scripted', script: 'shade', params: [] }), 'params is an object')
  mustThrow(() => materialDeclaration({ kind: 'scripted', script: 'shade', params: {}, extra: 1 }), 'material option extra')
})

gate('opacity is required and 0 to 1, and an opacity below 1 needs transparent', () => {
  const plan = planMaterial({ type: 'MeshStandardNodeMaterial', opacity: 1 })
  same(plan.transparent, false, 'opaque by default at opacity 1')
  same(planMaterial({ type: 'MeshStandardNodeMaterial', opacity: 0.5, transparent: true }).opacity, 0.5, 'transparent half')
  mustThrow(() => planMaterial({ type: 'MeshStandardNodeMaterial' }), 'opacity is required')
  mustThrow(() => planMaterial({ type: 'MeshStandardNodeMaterial', opacity: 1.5 }), 'opacity is required')
  mustThrow(() => planMaterial({ type: 'MeshStandardNodeMaterial', opacity: 0.5 }), 'needs transparent: true')
  mustThrow(() => planMaterial({ type: 'MeshStandardNodeMaterial', opacity: 1, transparent: 'yes' }), 'transparent is true or false')
})

gate('blending and side are the upstream names; anything else is refused', () => {
  same(planMaterial({ type: 'MeshBasicNodeMaterial', opacity: 1, blending: 'AdditiveBlending', side: 'DoubleSide' }).blending, 'AdditiveBlending', 'blending')
  mustThrow(() => planMaterial({ type: 'MeshBasicNodeMaterial', opacity: 1, blending: 'Bogus' }), 'blending Bogus is not an upstream name')
  mustThrow(() => planMaterial({ type: 'MeshBasicNodeMaterial', opacity: 1, side: 'Both' }), 'side Both is not an upstream name')
})

gate('a points row is an instance copy, and any other shape is a vertex; the size is required and attenuates by default', () => {
  const row = planMaterial({ type: 'PointsNodeMaterial', opacity: 1, size: 2, shape: 'points' })
  sameJson(row.points, { size: 2, sizeAttenuation: true, source: 'instance' }, 'points row')
  same(planMaterial({ type: 'PointsNodeMaterial', opacity: 1, size: 2, shape: 'crate' }).points.source, 'vertex', 'other shape')
  same(planMaterial({ type: 'PointsNodeMaterial', opacity: 1, size: 2, shape: 'points', sizeAttenuation: false }).points.sizeAttenuation, false, 'attenuation off')
  mustThrow(() => planMaterial({ type: 'PointsNodeMaterial', opacity: 1, shape: 'points' }), 'size is a positive finite number')
  mustThrow(() => planMaterial({ type: 'PointsNodeMaterial', opacity: 1, size: 0, shape: 'points' }), 'size is a positive finite number')
  mustThrow(() => planMaterial({ type: 'PointsNodeMaterial', opacity: 1, size: 2 }), 'points shape is the row shape name')
  mustThrow(() => planMaterial({ type: 'PointsNodeMaterial', opacity: 1, size: 2, shape: 'points', sizeAttenuation: 'on' }), 'sizeAttenuation is true or false')
})

gate('size, sizeAttenuation and shape belong to points materials; linewidth belongs to line materials', () => {
  mustThrow(() => planMaterial({ type: 'MeshStandardNodeMaterial', opacity: 1, size: 2 }), 'size on MeshStandardNodeMaterial')
  mustThrow(() => planMaterial({ type: 'MeshBasicNodeMaterial', opacity: 1, shape: 'points' }), 'shape on MeshBasicNodeMaterial')
  mustThrow(() => planMaterial({ type: 'MeshBasicNodeMaterial', opacity: 1, linewidth: 2 }), 'linewidth on MeshBasicNodeMaterial')
  sameJson(planMaterial({ type: 'LineBasicNodeMaterial', opacity: 1, linewidth: 3 }).line, { linewidth: 3 }, 'line row')
  sameJson(planMaterial({ type: 'Line2NodeMaterial', opacity: 1, linewidth: 2 }).line, { linewidth: 2 }, 'line2 row')
  mustThrow(() => planMaterial({ type: 'LineBasicNodeMaterial', opacity: 1 }), 'linewidth is a positive finite number')
})

gate('a material plan refuses any option the section does not name', () => {
  mustThrow(() => planMaterial({ type: 'MeshBasicNodeMaterial', opacity: 1, depthWrite: false }), 'material option depthWrite')
  mustThrow(() => planMaterial(null), 'a material plan is an object')
})

gate('a data texture defaults to RGBA bytes, and its data must match its size, its format and its type', () => {
  const bytes = dataTextureSpec({ data: new Uint8Array(16), width: 2, height: 2 })
  sameJson(bytes, { width: 2, height: 2, format: 'RGBAFormat', type: 'UnsignedByteType', values: 16 }, 'RGBA bytes')
  sameJson(dataTextureSpec({ data: new Uint16Array(4), width: 2, height: 2, format: 'RedFormat', type: 'HalfFloatType' }).values, 4, 'half float red')
  mustThrow(() => dataTextureSpec({ data: new Uint8Array(15), width: 2, height: 2 }), 'needs 16')
  mustThrow(() => dataTextureSpec({ data: new Float32Array(16), width: 2, height: 2 }), 'data is a Uint8Array for UnsignedByteType')
  mustThrow(() => dataTextureSpec({ data: new Uint8Array(16), width: 0, height: 2 }), 'width is a whole number of at least 1')
  mustThrow(() => dataTextureSpec({ data: new Uint8Array(16), width: 2, height: 2, format: 'Nope' }), 'format Nope is not an upstream name')
  mustThrow(() => dataTextureSpec({ data: new Uint8Array(16), width: 2, height: 2, mips: 2 }), 'data texture option mips')
})

gate('storage textures take whole sizes, and a 3D storage texture also takes a depth', () => {
  sameJson(storageTextureSpec(4, 4), { width: 4, height: 4 }, 'storage 2D')
  sameJson(storage3DTextureSpec(4, 4, 2), { width: 4, height: 4, depth: 2 }, 'storage 3D')
  mustThrow(() => storageTextureSpec(4, 0), 'height is a whole number')
  mustThrow(() => storage3DTextureSpec(4, 4, 1.5), 'depth is a whole number')
})

gate('scoped negatives: node properties and the ctx roots are named, then refused, because upstream gives no headless node semantics', () => {
  mustThrow(() => nodeProperty('vertexNode'), 'node property vertexNode has no documented headless behaviour')
  mustThrow(() => nodeProperty('sizeNode'), 'scoped negative')
  mustThrow(() => nodeProperty('bogus'), 'node property bogus is not an upstream name')
  mustThrow(() => contextRoot('texture'), 'context root ctx.texture has no documented headless behaviour')
  mustThrow(() => contextRoot('terrain'), 'scoped negative')
  mustThrow(() => contextRoot('nope'), 'context root nope is not an upstream name')
})

finish()
