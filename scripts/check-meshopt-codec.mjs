import assert from 'node:assert/strict'
import { MeshoptDecoder } from 'meshoptimizer'
import { MeshoptEncoder } from 'meshoptimizer/encoder'
import { gate, finish } from './lib/gate.mjs'
import { extractStandardMeshAt, parseGlb } from '../src/physics-extras/glb.js'
import { MESHOPT_FILTERS, MESHOPT_MODES, applyMeshoptFilter, decodeGltfBuffer, decodeIndexBuffer, decodeIndexSequence, decodeVertexBuffer } from '../src/physics-extras/meshoptCodec.js'

await MeshoptEncoder.ready
await MeshoptDecoder.ready

let seed = 1
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 4294967296
}

const refusesWith = (fn, code) => {
  let caught = null
  try {
    fn()
  } catch (error) {
    caught = error
  }
  assert.ok(caught, `accepted, expected refusal ${code}`)
  assert.equal(caught.reasonCode, code)
}

const refusesAny = (fn) => {
  let caught = null
  try {
    fn()
  } catch (error) {
    caught = error
  }
  assert.ok(caught && typeof caught.reasonCode === 'string' && caught.reasonCode.startsWith('meshopt-'), 'accepted, expected a meshopt refusal')
}

const encoder = new TextEncoder()
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const vertexSource = (count, stride, kind) => {
  const src = new Uint8Array(count * stride)
  if (kind === 'noise') for (let i = 0; i < src.length; i++) src[i] = rnd() * 256
  if (kind === 'floats') { const f = new Float32Array(src.buffer); for (let i = 0; i < f.length; i++) f[i] = Math.sin(i * 0.01) * 100 }
  if (kind === 'shorts') { const f = new Uint16Array(src.buffer); for (let i = 0; i < f.length; i++) f[i] = (i * 3 + ((rnd() * 4) | 0)) & 0xffff }
  return src
}

const triangleSource = (triangles) => {
  const idx = new Uint32Array(triangles * 3)
  for (let t = 0; t < triangles; t++) {
    const b = t >> 1
    if (rnd() < 0.7) idx.set([b, b + 1 + (t & 1), b + 2 + (t & 1)], t * 3)
    else idx.set([(rnd() * 60000) | 0, (rnd() * 60000) | 0, (rnd() * 60000) | 0], t * 3)
  }
  return idx
}

const indexBytes = (idx, stride) => (stride === 2 ? new Uint8Array(new Uint16Array(idx).buffer) : new Uint8Array(idx.buffer.slice(0)))

gate('the vertex codec decodes versions 0 and 1 of the reference encoder byte for byte across strides, counts and data shapes', () => {
  let cases = 0
  for (const stride of [4, 8, 12, 16, 20, 32]) {
    for (const count of [0, 1, 15, 16, 17, 255, 256, 257, 1000, 3000]) {
      for (const version of [0, 1]) {
        for (const kind of ['noise', 'floats', 'shorts']) {
          const src = vertexSource(count, stride, kind)
          const enc = MeshoptEncoder.encodeVertexBufferLevel(src, count, stride, 2, version)
          assert.equal(enc[0], 0xa0 | version)
          const out = new Uint8Array(count * stride)
          decodeVertexBuffer(out, count, stride, enc)
          assert.deepEqual(out, src, `stride ${stride} count ${count} version ${version} ${kind}`)
          cases += 1
        }
      }
    }
  }
  assert.equal(cases, 360)
})

gate('the triangle codec and the index sequence codec match the reference decoder for 16-bit and 32-bit indices', () => {
  for (const stride of [2, 4]) {
    for (const triangles of [0, 1, 2, 50, 2000]) {
      const src = indexBytes(triangleSource(triangles), stride)
      const n = triangles * 3
      const tri = MeshoptEncoder.encodeIndexBuffer(src, n, stride)
      const seq = MeshoptEncoder.encodeIndexSequence(src, n, stride)
      const refTri = new Uint8Array(n * stride)
      MeshoptDecoder.decodeIndexBuffer(refTri, n, stride, tri)
      assert.deepEqual(decodeIndexBuffer(new Uint8Array(n * stride), n, stride, tri), refTri)
      assert.deepEqual(decodeIndexSequence(new Uint8Array(n * stride), n, stride, seq), src)
    }
  }
})

gate('the triangle codec keeps every triangle as the same vertex cycle the encoder was given', () => {
  const idx = triangleSource(400)
  const enc = MeshoptEncoder.encodeIndexBuffer(indexBytes(idx, 4), idx.length, 4)
  const out = new Uint32Array(decodeIndexBuffer(new Uint8Array(idx.length * 4), idx.length, 4, enc).buffer)
  for (let t = 0; t < 400; t++) {
    const a = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]
    const b = [out[t * 3], out[t * 3 + 1], out[t * 3 + 2]]
    const rotations = [a.join(','), [a[1], a[2], a[0]].join(','), [a[2], a[0], a[1]].join(',')]
    assert.ok(rotations.includes(b.join(',')), `triangle ${t}`)
  }
})

gate('the octahedral, quaternion and colour filters land within one unit of the reference decoder and the exponential filter is bit exact', () => {
  const count = 500
  const unit = new Float32Array(count * 4)
  const quat = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const v = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]
    const l = Math.hypot(...v)
    unit.set([v[0] / l, v[1] / l, v[2] / l, i & 1 ? 1 : -1], i * 4)
    const q = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]
    const ql = Math.hypot(...q)
    quat.set(q.map((c) => c / ql), i * 4)
  }
  const cases = [
    ['OCTAHEDRAL', MeshoptEncoder.encodeFilterOct(unit, count, 4, 8), 4, Int8Array, 1],
    ['OCTAHEDRAL', MeshoptEncoder.encodeFilterOct(unit, count, 8, 12), 8, Int16Array, 1],
    ['QUATERNION', MeshoptEncoder.encodeFilterQuat(quat, count, 8, 12), 8, Int16Array, 1],
    ['COLOR', MeshoptEncoder.encodeFilterColor(unit.map(Math.abs), count, 4, 8), 4, Uint8Array, 1],
    ['COLOR', MeshoptEncoder.encodeFilterColor(unit.map(Math.abs), count, 8, 12), 8, Uint16Array, 1],
    ['EXPONENTIAL', MeshoptEncoder.encodeFilterExp(unit, count, 16, 12), 16, Uint8Array, 0],
  ]
  for (const [filter, filtered, stride, View, tolerance] of cases) {
    const enc = MeshoptEncoder.encodeVertexBuffer(filtered, count, stride)
    const ref = new Uint8Array(count * stride)
    MeshoptDecoder.decodeVertexBuffer(ref, count, stride, enc, filter)
    const out = decodeGltfBuffer(new Uint8Array(count * stride), count, stride, enc, 'ATTRIBUTES', filter)
    const a = new View(out.buffer)
    const b = new View(ref.buffer)
    let worst = 0
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
    assert.ok(worst <= tolerance, `${filter} stride ${stride} differs by ${worst}`)
    const raw = decodeVertexBuffer(new Uint8Array(count * stride), count, stride, enc)
    assert.deepEqual(raw, filtered, `${filter} control: the unfiltered bytes are the encoder input`)
    assert.notDeepEqual(raw, out, `${filter} control: the filter changed the bytes`)
  }
})

gate('the octahedral filter gives unit normals close to the source directions', () => {
  const src = new Float32Array([0, 0, 1, 0, 1, 0, 0, 0, 0.6, -0.8, 0, 0, -0.577, 0.577, -0.577, 0])
  const filtered = MeshoptEncoder.encodeFilterOct(src, 4, 8, 16)
  const out = new Int16Array(applyMeshoptFilter(filtered.slice(), 4, 8, 'OCTAHEDRAL').buffer)
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[i * 4 + k] / 32767 - src[i * 4 + k]) < 2e-3, `normal ${i} component ${k}`)
  }
})

gate('truncated, trailing and mislabelled data is refused with a reason code instead of decoding to garbage', () => {
  const src = vertexSource(300, 12, 'floats')
  const enc = MeshoptEncoder.encodeVertexBuffer(src, 300, 12)
  const out = new Uint8Array(300 * 12)
  refusesWith(() => decodeVertexBuffer(out, 300, 12, enc.subarray(0, 20)), 'meshopt-source-truncated')
  refusesWith(() => decodeVertexBuffer(out, 300, 12, concat(enc.subarray(0, 200), enc.subarray(enc.length - 32))), 'meshopt-source-truncated')
  refusesAny(() => decodeVertexBuffer(out, 300, 12, enc.subarray(0, enc.length - 40)))
  refusesAny(() => decodeVertexBuffer(out, 299, 12, enc))
  refusesWith(() => decodeVertexBuffer(out, 300, 12, concat(enc.subarray(0, enc.length - 32), new Uint8Array(3), enc.subarray(enc.length - 32))), 'meshopt-source-trailing')
  refusesWith(() => decodeVertexBuffer(out, 300, 12, enc.map((b, i) => (i === 0 ? 0xe1 : b))), 'meshopt-header-invalid')
  refusesWith(() => decodeVertexBuffer(out, 300, 12, enc.map((b, i) => (i === 0 ? 0xa7 : b))), 'meshopt-version-unsupported')
  refusesWith(() => decodeVertexBuffer(out, 300, 10, enc), 'meshopt-stride-invalid')
  refusesWith(() => decodeVertexBuffer(new Uint8Array(10), 300, 12, enc), 'meshopt-target-small')
  const idx = indexBytes(triangleSource(100), 2)
  const tri = MeshoptEncoder.encodeIndexBuffer(idx, 300, 2)
  refusesWith(() => decodeIndexBuffer(new Uint8Array(600), 300, 2, tri.subarray(0, 60)), 'meshopt-source-truncated')
  refusesWith(() => decodeIndexBuffer(new Uint8Array(600), 300, 3, tri), 'meshopt-index-stride-invalid')
  refusesWith(() => decodeIndexBuffer(new Uint8Array(600), 299, 2, tri), 'meshopt-count-invalid')
  refusesWith(() => decodeIndexBuffer(new Uint8Array(600), 300, 2, enc), 'meshopt-header-invalid')
  const seq = MeshoptEncoder.encodeIndexSequence(idx, 300, 2)
  refusesWith(() => decodeIndexSequence(new Uint8Array(600), 300, 2, tri), 'meshopt-header-invalid')
  refusesWith(() => decodeIndexSequence(new Uint8Array(600), 299, 2, seq), 'meshopt-source-trailing')
  refusesWith(() => decodeGltfBuffer(out, 300, 12, enc, 'POINTS'), 'meshopt-mode-unknown')
  refusesWith(() => decodeGltfBuffer(out, 300, 12, enc, 'ATTRIBUTES', 'WAVELET'), 'meshopt-filter-unknown')
  refusesWith(() => decodeGltfBuffer(new Uint8Array(600), 300, 2, tri, 'TRIANGLES', 'OCTAHEDRAL'), 'meshopt-filter-mode-invalid')
  assert.deepEqual(decodeGltfBuffer(out, 300, 12, enc, 'ATTRIBUTES', 'NONE'), src)
  assert.deepEqual([...MESHOPT_MODES], ['ATTRIBUTES', 'TRIANGLES', 'INDICES'])
  assert.deepEqual([...MESHOPT_FILTERS], ['NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL', 'COLOR'])
})

const buildGlb = (json, bin) => {
  const jsonBytes = encoder.encode(JSON.stringify(json))
  const binStart = 20 + jsonBytes.length
  const out = new Uint8Array(binStart + 8 + bin.length)
  const view = new DataView(out.buffer)
  out.set(encoder.encode('glTF'), 0)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, jsonBytes.length, true)
  out.set(encoder.encode('JSON'), 16)
  out.set(jsonBytes, 20)
  view.setUint32(binStart, bin.length, true)
  out.set(encoder.encode('BIN\0'), binStart + 4)
  out.set(bin, binStart + 8)
  return out
}

const gridMesh = (n) => {
  const positions = new Float32Array(n * n * 3)
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) positions.set([x * 0.5, Math.sin(x * 0.3) * Math.cos(z * 0.2), z * 0.5], (z * n + x) * 3)
  const indices = []
  for (let z = 0; z < n - 1; z++) {
    for (let x = 0; x < n - 1; x++) {
      const a = z * n + x
      indices.push(a, a + 1, a + n, a + 1, a + n + 1, a + n)
    }
  }
  return { positions, indices: new Uint32Array(indices) }
}

const meshoptGlb = ({ quantized = false, indexMode = 'TRIANGLES', translation = [100, 0, 0] } = {}) => {
  const { positions, indices } = gridMesh(20)
  const count = positions.length / 3
  let vertexBytes
  let accessor
  let stride
  if (quantized) {
    stride = 8
    const q = new Int16Array(count * 4)
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) q[i * 4 + k] = Math.round((positions[i * 3 + k] / 16) * 32767)
    vertexBytes = new Uint8Array(q.buffer)
    accessor = { bufferView: 0, componentType: 5122, normalized: true, count, type: 'VEC3' }
  } else {
    stride = 12
    vertexBytes = new Uint8Array(positions.buffer)
    accessor = { bufferView: 0, componentType: 5126, count, type: 'VEC3' }
  }
  const encodedVertices = (MeshoptEncoder.encodeVertexBuffer(vertexBytes, count, stride))
  const rawIndex = new Uint8Array(new Uint16Array(indices).buffer)
  const encodedIndexExact = indexMode === 'TRIANGLES' ? MeshoptEncoder.encodeIndexBuffer(rawIndex, indices.length, 2) : MeshoptEncoder.encodeIndexSequence(rawIndex, indices.length, 2)
  const json = {
    asset: { version: '2.0' },
    extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [{ byteLength: encodedVertices.length + encodedIndexExact.length }, { byteLength: vertexBytes.length + rawIndex.length, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    nodes: [{ mesh: 0, translation }],
    meshes: [{ name: 'grid', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [accessor, { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }],
    bufferViews: [
      { buffer: 1, byteOffset: 0, byteLength: vertexBytes.length, byteStride: stride, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: encodedVertices.length, byteStride: stride, count, mode: 'ATTRIBUTES' } } },
      { buffer: 1, byteOffset: vertexBytes.length, byteLength: rawIndex.length, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: encodedVertices.length, byteLength: encodedIndexExact.length, byteStride: 2, count: indices.length, mode: indexMode } } },
    ],
  }
  return { glb: buildGlb(json, concat(encodedVertices, encodedIndexExact)), json, positions, indices, translation }
}

const triangleSet = (indices) => {
  const set = []
  for (let t = 0; t < indices.length; t += 3) set.push([indices[t], indices[t + 1], indices[t + 2]].sort((a, b) => a - b).join(','))
  return set.join(';')
}

gate('a Meshopt-compressed GLB yields the source float positions with the node translation and the source triangles', () => {
  const file = meshoptGlb()
  const mesh = extractStandardMeshAt(file.glb, parseGlb(file.glb), 0)
  assert.equal(mesh.vertexCount, 400)
  assert.equal(mesh.triangleCount, 19 * 19 * 2)
  for (let i = 0; i < 400; i++) {
    assert.ok(mesh.vertices[i * 3] === Math.fround(file.positions[i * 3] + 100), `x of vertex ${i}`)
    assert.ok(mesh.vertices[i * 3 + 1] === file.positions[i * 3 + 1], `y of vertex ${i}`)
    assert.ok(mesh.vertices[i * 3 + 2] === file.positions[i * 3 + 2], `z of vertex ${i}`)
  }
  assert.equal(triangleSet(mesh.indices), triangleSet(file.indices))
})

gate('a Meshopt GLB with normalized int16 positions and an index sequence decodes to within the quantization step', () => {
  const file = meshoptGlb({ quantized: true, indexMode: 'INDICES', translation: [0, 0, 0] })
  const mesh = extractStandardMeshAt(file.glb, parseGlb(file.glb), 0)
  assert.deepEqual(Array.from(mesh.indices), Array.from(file.indices))
  for (let i = 0; i < file.positions.length; i++) assert.ok(Math.abs(mesh.vertices[i] * 16 - file.positions[i]) < 16 / 32767, `component ${i}`)
})

gate('control: a Meshopt GLB whose encoded bytes are cut short or point outside the file is refused', () => {
  const file = meshoptGlb()
  const cut = structuredClone(file.json)
  cut.bufferViews[0].extensions.EXT_meshopt_compression.byteLength -= 64
  const cutGlb = buildGlb(cut, file.glb.subarray(parseGlb(file.glb).binOffset))
  refusesAny(() => extractStandardMeshAt(cutGlb, parseGlb(cutGlb), 0))
  const far = structuredClone(file.json)
  far.bufferViews[1].extensions.EXT_meshopt_compression.byteOffset = 1 << 24
  const farGlb = buildGlb(far, file.glb.subarray(parseGlb(file.glb).binOffset))
  refusesWith(() => extractStandardMeshAt(farGlb, parseGlb(farGlb), 0), 'glb-meshopt-range-invalid')
  const external = structuredClone(file.json)
  external.buffers[0].uri = 'mesh.bin'
  const externalGlb = buildGlb(external, file.glb.subarray(parseGlb(file.glb).binOffset))
  refusesWith(() => extractStandardMeshAt(externalGlb, parseGlb(externalGlb), 0), 'glb-meshopt-external-buffer')
})

finish()
