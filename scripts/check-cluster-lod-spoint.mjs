import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { canon, firstDivergence } from './lib/canon.mjs'
import { runClusterLodScenario, summarizeBuild, buildCase, CASE_LABELS } from './lib/clusterLodScenario.mjs'
import { buildClusterLod } from '../src/packages/streaming-gltf/meshlet-codec.js'
import { buildClusterLodExtra, lod0OnlyClusterLodExtras, parseClusterLod } from '../src/packages/streaming-gltf/cluster-lod-extras.js'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'cluster-lod.json'), 'utf8'))
const got = await runClusterLodScenario({ buildClusterLod, buildClusterLodExtra, lod0OnlyClusterLodExtras, parseClusterLod })

gate('the fixture was generated from spoint packages/streaming-gltf/src/meshlet-codec.js with the pinned meshoptimizer', () => {
  assert.equal(fixture.source.file, 'packages/streaming-gltf/src/meshlet-codec.js')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
  assert.equal(fixture.source.meshoptimizer, '1.2.0')
})

gate('the fixture covers every scenario case, including the error case, in order', () => {
  assert.equal(fixture.sections.build.length, CASE_LABELS.length)
  assert.ok(fixture.sections.build.some((row) => row.includes('buildClusterLod: missing position attribute')))
})

gate('buildClusterLod equals spoint on every case: vertex attributes, index streams, LOD counts and cluster bounds', () => {
  assert.equal(firstDivergence(got.build, fixture.sections.build), null)
})

gate('the cluster record built from buildClusterLod equals spoint, with lod0Only, parse and a radius-only sphere', () => {
  assert.ok(fixture.sections.records.length >= 12)
  assert.equal(firstDivergence(got.records, fixture.sections.records), null)
})

gate('parseClusterLod refuses the same malformed records as spoint', () => {
  assert.equal(firstDivergence(got.malformed, fixture.sections.malformed), null)
  assert.ok(fixture.sections.malformed.every((row) => row.includes('ClusterLodRecordError')))
})

gate('negative control: a changed lodError moves the cluster LOD output away from the spoint fixture', async () => {
  const geo = buildCase('grid 10x10 with small clusters and two LODs, uvAware off').geo()
  const label = 'grid 10x10 with small clusters and two LODs, uvAware off'
  const changed = canon({ label, summary: summarizeBuild(await buildClusterLod(geo, { maxVertices: 32, maxTriangles: 64, lodRatios: [1, 0.5], lodError: 0.5, uvAware: false })) })
  assert.notEqual(changed, fixture.sections.build[CASE_LABELS.indexOf(label)])
})

finish()
