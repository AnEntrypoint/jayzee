import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { canon, firstDivergence } from './lib/canon.mjs'
import { CASES, RAYCAST_CASE_LABELS, SCENE, runRaycastScenario } from './lib/raycastScenario.mjs'
import { createJoltHost } from '../src/collision/joltHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/raycast.json', import.meta.url), 'utf8'))

const joltAdapter = (host) => ({
  addStatic: (vertices, indices, position) => host.addStaticTriangles(vertices, indices, position),
  cast: (origin, direction, maxDistance, exclude) => host.castRay(origin, direction, maxDistance, exclude),
  park: (bodyId, position) => host.dormantStatics.park([{ bodyId, owner: { position, rotation: [0, 0, 0, 1] } }]),
  drainAll: () => host.dormantStatics.drainAll(),
  destroy: () => host.destroy(),
})

const got = await runRaycastScenario(joltAdapter(await createJoltHost({ gravity: [0, -9.81, 0] })))

gate('the fixture was generated from spoint src/physics/World.js and DormantStatics.js with jolt-physics 1.1.0', () => {
  assert.equal(fixture.source.file, 'src/physics/World.js')
  assert.equal(fixture.source.dormantFile, 'src/physics/DormantStatics.js')
  assert.equal(fixture.source.joltPhysics, '1.1.0')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
  assert.match(fixture.source.dormantSha256, /^[0-9a-f]{64}$/)
})

gate('the fixture covers every raycast case in order, including the exclusions and the dormant steps', () => {
  assert.equal(fixture.rows.length, RAYCAST_CASE_LABELS.length)
  RAYCAST_CASE_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('raycast answers with excludeBodyId and dormant residue equal spoint on every case', () => {
  assert.equal(firstDivergence(got.rows, fixture.rows), null)
})

gate('the fixture holds parked-static refusals, so a missing residue check would show', () => {
  const refusals = fixture.rows.filter((row) => row.includes('"unavailable":s:"static-colliders-migrating"'))
  assert.equal(refusals.length, 2, 'refusals ' + refusals.length)
})

gate('the fixture holds an exclusion that changes the answer, so an ignored exclusion would show', () => {
  const excludedRow = fixture.rows[RAYCAST_CASE_LABELS.indexOf('box top, excluded by a single id')]
  const plainRow = fixture.rows[RAYCAST_CASE_LABELS.indexOf('box top from above, no exclude')]
  assert.notEqual(excludedRow.slice(excludedRow.indexOf('"result"')), plainRow.slice(plainRow.indexOf('"result"')))
})

gate('negative control: a cast with no exclusion does not match the excluded fixture row', async () => {
  const host = await createJoltHost({ gravity: [0, -9.81, 0] })
  for (const body of SCENE) host.addStaticTriangles(body.vertices, body.indices, body.position)
  const excluded = CASES[RAYCAST_CASE_LABELS.indexOf('box top, excluded by a single id')]
  const plain = host.castRay(excluded.origin, excluded.direction, excluded.maxDistance, null)
  host.destroy()
  const plainResult = canon({ label: excluded.label, result: { hit: plain.hit, distance: plain.distance, bodyId: plain.bodyId, normal: plain.normal, position: plain.position, unavailable: null } })
  assert.notEqual(plainResult, fixture.rows[RAYCAST_CASE_LABELS.indexOf(excluded.label)])
})

finish()
