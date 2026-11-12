import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { repoRoot, readRepoText, sha1Hex } from './lib/bakePins.mjs'
import { HEIGHTFIELD_BAKE_ENTRIES, bakeHeightfield, quantizeSectors, tangentBasis } from '../src/terrain-pure/heightfieldBake.js'
import { heightfieldBakeInputs, heightfieldCodeVersion } from '../src/bundle/bakePins.js'
import { bakeCodeVersion } from '../src/terrain-pure/bakeCodeVersion.js'
import { encodeHeightfield, decodeHeightfield } from '../src/packages/mapspinner/heightfield-codec.js'
import { createHeightField, resolveBakedField, dequantizeSectors } from '../src/terrain-pure/heightfieldPhysics.js'
import { createHeightSampler } from '../src/packages/mapspinner/height-cpu.js'

const version = heightfieldCodeVersion(readRepoText, sha1Hex)
const inputs = heightfieldBakeInputs(readRepoText)
const overlay = (path, suffix) => (p) => (p === path ? readRepoText(p) + suffix : readRepoText(p))
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code ?? error.constructor.name
  }
  return null
}
const hill = (dir) => {
  const l = Math.hypot(dir[0], dir[1], dir[2])
  return 120 * Math.sin(dir[0] / l * 900) + 40 * Math.cos(dir[2] / l * 2300) + 300 * dir[0] / l
}

gate('the heightfield code version is the bake version of the import closure of the height sampler, the codec and the bake', () => {
  assert.match(version, /^[0-9a-f]{12}$/)
  assert.equal(version, bakeCodeVersion(inputs, readRepoText, sha1Hex))
  for (const entry of HEIGHTFIELD_BAKE_ENTRIES) assert.ok(inputs.includes(entry), entry)
  for (const reached of ['src/packages/mapspinner/height-eval.js', 'src/packages/mapspinner/height-spec.js', 'src/packages/mapspinner/anchor-field.js', 'src/packages/mapspinner/anchor-field-bands.js', 'src/packages/mapspinner/glsl-rt.js', 'src/terrain-pure/terrainDefaults.js']) assert.ok(inputs.includes(reached), reached)
  assert.deepEqual(inputs, [...inputs].sort())
  assert.ok(!inputs.some((path) => path.startsWith('src/bundle/')), 'the version tooling is not height code')
})

gate('a change to any file in the closure changes the version, a change outside it does not', () => {
  for (const path of inputs) assert.notEqual(heightfieldCodeVersion(overlay(path, '\nexport const touched = 1\n'), sha1Hex), version, path)
  assert.equal(heightfieldCodeVersion(overlay('src/packages/mapspinner/sea-waves.js', '\nexport const touched = 1\n'), sha1Hex), version, 'negative control: sea waves are not height code')
  assert.equal(heightfieldCodeVersion((p) => readRepoText(p).replace(/\n/g, '\r\n'), sha1Hex), version, 'line endings do not move the version')
})

gate('a new import pulls the imported file into the closure and a broken import refuses the version', () => {
  const extra = 'src/packages/mapspinner/sea-waves.js'
  const grown = overlay('src/packages/mapspinner/heightfield-codec.js', "\nimport { seaHeightMean } from './sea-waves.js'\nexport const sea = seaHeightMean\n")
  assert.ok(heightfieldBakeInputs(grown).includes(extra))
  assert.ok(!inputs.includes(extra))
  const broken = overlay('src/packages/mapspinner/heightfield-codec.js', "\nimport { nothing } from './no-such-file.js'\n")
  assert.equal(code(() => heightfieldCodeVersion(broken, sha1Hex)), 'import-unresolved')
})

gate('a bake round-trips through the codec and the physics field inside the quantization step', () => {
  const N = 49
  const extent = 3000
  const radius = 6360000
  const anchorDir = [0.3, 0.9, -0.2]
  const artifact = bakeHeightfield({ heightAt: hill, radius, extent, N, anchorDir, center: [150, -75], codeVersion: version, hashVersion: 1, seed: 5, nodesPerSector: 16, bits: 16 })
  assert.equal(artifact.sectors.gridS, 4)
  assert.equal(artifact.codeVersion, version)
  const decoded = decodeHeightfield(encodeHeightfield(artifact))
  assert.equal(decoded.codeVersion, version)
  assert.equal(decoded.sectors.qmax, 65535)
  const field = createHeightField(decoded)
  const { up, east, north } = tangentBasis(anchorDir)
  const step = extent / (N - 1)
  let worst = 0
  for (let iz = 0; iz < N; iz += 3) {
    for (let ix = 0; ix < N; ix += 5) {
      const x = 150 - extent / 2 + ix * step
      const z = -75 - extent / 2 + iz * step
      const want = hill([radius * up[0] + x * east[0] + z * north[0], radius * up[1] + x * east[1] + z * north[1], radius * up[2] + x * east[2] + z * north[2]])
      worst = Math.max(worst, Math.abs(field.heightAtLocal(x, z) - want))
    }
  }
  assert.ok(worst < 0.02, `worst error ${worst} m`)
  assert.ok(field.covers(150, -75) && !field.covers(150 + extent, -75))
  const coarse = bakeHeightfield({ heightAt: hill, radius, extent, N, anchorDir, codeVersion: version, bits: 8 })
  const heights = dequantizeSectors({ ...coarse, sectors: { ...coarse.sectors } })
  let coarseWorst = 0
  const fine = dequantizeSectors({ ...artifact, center: [0, 0] })
  for (let i = 0; i < heights.length; i++) coarseWorst = Math.max(coarseWorst, Math.abs(heights[i] - hill([radius * up[0] + (-extent / 2 + (i % N) * step) * east[0] + (-extent / 2 + Math.floor(i / N) * step) * north[0], radius * up[1] + (-extent / 2 + (i % N) * step) * east[1] + (-extent / 2 + Math.floor(i / N) * step) * north[1], radius * up[2] + (-extent / 2 + (i % N) * step) * east[2] + (-extent / 2 + Math.floor(i / N) * step) * north[2]])))
  assert.ok(coarseWorst > worst && coarseWorst < 2, `negative control: 8 bits is coarser, ${coarseWorst} m`)
  assert.equal(fine.length, N * N)
})

gate('the runtime accepts a bake stamped with this tree and refuses one stamped before a height code change', () => {
  const artifact = decodeHeightfield(encodeHeightfield(bakeHeightfield({ heightAt: hill, radius: 1000, extent: 100, N: 17, codeVersion: version, hashVersion: 1 })))
  const world = { url: 'mem.hf', artifact, hashVersion: 1, tcfg: { radius: 1000, anchorDir: [0, 1, 0] }, frame: null }
  const ok = resolveBakedField({ ...world, bakeCode: version })
  assert.equal(ok.fallback, null)
  assert.equal(ok.field.codeVersionVerified, true)
  const next = heightfieldCodeVersion(overlay('src/packages/mapspinner/height-spec.js', '\nexport const changed = true\n'), sha1Hex)
  assert.equal(code(() => resolveBakedField({ ...world, bakeCode: next })), 'stale-bake')
})

gate('quantization keeps a flat sector exact, clamps into the code range and refuses bad input', () => {
  const flat = quantizeSectors(new Float64Array(16).fill(7.5), 4, 2, 8)
  assert.deepEqual(Array.from(flat.q), new Array(16).fill(0))
  assert.deepEqual(Array.from(dequantizeSectors({ N: 4, ...flat })), new Array(16).fill(7.5))
  const ramp = quantizeSectors(Float64Array.from({ length: 9 }, (_, i) => i * 0.1), 3, 3, 8)
  assert.equal(ramp.q[0], 0)
  assert.equal(ramp.q[8], 255)
  assert.equal(code(() => quantizeSectors(new Float64Array(8), 3)), 'bake-sample-count')
  assert.equal(code(() => quantizeSectors(Float64Array.of(1, NaN, 2, 3), 2)), 'bake-height-not-finite')
  assert.equal(code(() => quantizeSectors(new Float64Array(4), 2, 16, 12)), 'bake-bits')
  assert.equal(code(() => bakeHeightfield({ heightAt: hill, radius: 1, extent: 1, N: 2 })), 'bake-no-code-version')
  assert.equal(code(() => bakeHeightfield({ heightAt: hill, radius: 1, extent: 1, N: 2, codeVersion: 'x', anchorDir: [0, 0, 0] })), 'bake-anchor-not-a-direction')
  const basis = tangentBasis([0, 3, 0])
  assert.deepEqual(basis.up, [0, 1, 0])
  assert.ok(Math.abs(basis.east[0] * basis.north[0] + basis.east[1] * basis.north[1] + basis.east[2] * basis.north[2]) < 1e-15)
})

gate('the bake script prints the same version and writes a .hf the codec decodes with the CPU sampler heights', () => {
  const script = join(repoRoot, 'scripts', 'bake-heightfield.mjs')
  const shown = JSON.parse(spawnSync(process.execPath, [script, '--version'], { encoding: 'utf8' }).stdout)
  assert.equal(shown.codeVersion, version)
  assert.deepEqual(shown.inputs, inputs)
  const dir = mkdtempSync(join(tmpdir(), 'jz-hf-'))
  try {
    const out = join(dir, 'patch.hf')
    const ran = spawnSync(process.execPath, [script, '--out', out, '--n', '9', '--extent', '800', '--radius', '6360', '--seed', '3', '--sector', '4'], { encoding: 'utf8' })
    assert.equal(ran.status, 0, ran.stderr)
    const bytes = readFileSync(out)
    const decoded = decodeHeightfield(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    assert.equal(decoded.codeVersion, version)
    assert.equal(decoded.N, 9)
    const sampler = createHeightSampler({ radius: 6360, seed: 3 })
    const field = createHeightField(decoded)
    const centre = sampler.heightAt([0, 1, 0])
    assert.ok(Math.abs(field.heightAtLocal(0, 0) - centre) < 1e-3 * Math.max(1, Math.abs(centre)), `${field.heightAtLocal(0, 0)} against ${centre}`)
    const refused = spawnSync(process.execPath, [script, '--n', '9'], { encoding: 'utf8' })
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /--out is required/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

finish()
