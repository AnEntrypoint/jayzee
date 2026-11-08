import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { RADIUS, LATTICE_SPEC, STREAMER_RADIUS, CENTRES, runStreamerScenario, runFieldLatticeScenario } from './lib/colliderStreamerScenario.mjs'
import { createColliderStreamer } from '../src/terrain-pure/colliderStreamer.js'
import { createFieldLattice } from '../src/terrain-pure/fieldLattice.js'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'
import { snapshotChart } from '../src/chart-pure/chartAnchor.js'
import { createChartTransfer } from '../src/client/chartTransfer.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/collider-streamer.json', import.meta.url), 'utf8'))
const deps = { createColliderStreamer, createFieldLattice, createPlanetFrame, snapshotChart, createChartTransfer }

const sync = await runStreamerScenario(deps)
const queued = await runStreamerScenario(deps, { queued: true })
const capped = await runStreamerScenario(deps, { maxCenters: 2, cap: 4 })
const lattice = runFieldLatticeScenario(deps)

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const byLabel = (records, name) => records.find((r) => r.event === name || r.label === name)

gate('the fixture was written from the same radius, lattice, centres and streamer radius this gate runs', () => {
  assert.equal(fixture.radius, RADIUS)
  assert.deepEqual(fixture.latticeSpec, LATTICE_SPEC)
  assert.equal(fixture.streamerRadius, STREAMER_RADIUS)
  assert.deepEqual(fixture.centres, CENTRES)
})

gate('the jayzee streamer reproduces every spoint record on the synchronous physics path: start, refresh, sweep, release, reanchor and stop', () => {
  assert.ok(same(sync.records, fixture.streamer.sync.records), 'records differ from spoint')
})

gate('the jayzee streamer issues the same physics calls as spoint, in the same order, on the synchronous path', () => {
  assert.ok(same(sync.log, fixture.streamer.sync.log), 'physics call log differs from spoint')
})

gate('the queued physics path reproduces spoint records and its queued physics calls, including the drain before reanchor', () => {
  assert.ok(same(queued.records, fixture.streamer.queued.records), 'queued records differ from spoint')
  assert.ok(same(queued.log, fixture.streamer.queued.log), 'queued physics call log differs from spoint')
})

gate('the capped run reproduces spoint records, physics calls and the drop warning, with the timings normalised', () => {
  assert.ok(same(capped.records, fixture.streamer.capped.records), 'capped records differ from spoint')
  assert.ok(same(capped.log, fixture.streamer.capped.log), 'capped physics call log differs from spoint')
  assert.ok(same(capped.messages, fixture.streamer.capped.messages), 'capped console lines differ from spoint')
})

gate('the console lines match spoint verbatim, so the drop warning and the initial ring line are the same text', () => {
  assert.ok(same(sync.messages, fixture.streamer.sync.messages), 'sync console lines differ from spoint')
  assert.ok(same(queued.messages, fixture.streamer.queued.messages), 'queued console lines differ from spoint')
  assert.match(capped.messages[0], /^warn \[gate\] 1 of 4 collider cluster\(s\) get no veg or rock colliders: maxCenters is 2 \(world config\)/)
})

gate('the clustering merges a centre 90 m from another (inside 0.75 of the radius) and keeps the rest', () => {
  assert.equal(byLabel(sync.records, 'start').centers.length, 3)
  assert.deepEqual(byLabel(sync.records, 'start').centers, [[0, 0], [-400, 260], [410, -120]])
})

gate('the sweep releases only the excluded placements and no live id keeps the excluded suffix', () => {
  const swept = byLabel(sync.records, 'sweep-excluded')
  assert.equal(swept.swept, 4)
  assert.equal(swept.liveCount, 20)
  assert.ok(swept.live.every(([id]) => !id.endsWith(':0')))
})

gate('the reanchor moves every live body once, and a second reanchor on the same epoch moves none', () => {
  const before = byLabel(sync.records, 'release').liveCount
  const re = byLabel(sync.records, 'reanchor')
  assert.equal(re.moved, before)
  assert.equal(re.repeat, 0)
})

gate('stop removes every live body and leaves the live set empty', () => {
  const stopped = byLabel(sync.records, 'stop')
  assert.equal(stopped.liveCount, 0)
  assert.equal(stopped.live.length, 0)
  assert.ok(sync.log.some((entry) => entry[0] === 'remove' && entry[2] === true))
})

gate('the field lattice reproduces spoint anchor, tilt, placements, transfers and the height at the probe', () => {
  assert.ok(same(lattice, fixture.fieldLattice), 'field lattice output differs from spoint')
})

gate('a NaN ground sample reads as height 0 and a throwing height function leaves the transfer finite', () => {
  assert.ok(lattice.toLattice.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)))
  assert.ok(Number.isFinite(lattice.tiltDeg))
})

gate('the uncapped runs drop nothing and warn nothing', () => {
  assert.equal(byLabel(sync.records, 'start').droppedCenters, 0)
  assert.ok(sync.messages.every((m) => !m.startsWith('warn')))
  assert.ok(queued.messages.every((m) => !m.startsWith('warn')))
})

finish()
