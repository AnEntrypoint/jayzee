import { init } from 'recast-navigation'
import { generateSoloNavMesh } from 'recast-navigation/generators'
import { agentWith, assertBakeInput, polyMeshToJSON, recastConfigFor } from './recastPolyMesh.js'

let ready = null

export async function bakeNavmesh({ positions, indices, ...overrides }) {
  assertBakeInput(positions, indices)
  const agent = agentWith(overrides)
  await (ready || (ready = init()))
  const rc = recastConfigFor(agent)
  const res = generateSoloNavMesh(positions, indices, rc, true)
  try {
    if (!res.success) throw new Error(`recast solo navmesh generation failed: ${res.error}`)
    return polyMeshToJSON(res.intermediates.polyMesh, rc)
  } finally {
    res.navMesh?.destroy?.()
  }
}
