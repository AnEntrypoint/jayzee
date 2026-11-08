import { JoltLimitsError, joltReservationBytes, resolveJoltLimits } from '../motion-pure/joltLimits.js'
import { createStaticTileIndex, STATIC_TILE_M } from './staticTileIndex.js'

const LAYER_STATIC = 0
const LAYER_DYNAMIC = 1
const NUM_LAYERS = 2

let joltModule = null

export function loadJolt() {
  if (!joltModule) joltModule = import('jolt-physics/wasm-compat').then((m) => m.default())
  return joltModule
}

export async function createJoltHost({ gravity = [0, -9.81, 0], joltLimits = null } = {}) {
  const limits = resolveJoltLimits(joltLimits)
  const J = await loadJolt()
  const objFilter = new J.ObjectLayerPairFilterTable(NUM_LAYERS)
  objFilter.EnableCollision(LAYER_STATIC, LAYER_DYNAMIC)
  objFilter.EnableCollision(LAYER_DYNAMIC, LAYER_DYNAMIC)
  const bpInterface = new J.BroadPhaseLayerInterfaceTable(NUM_LAYERS, 2)
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, new J.BroadPhaseLayer(0))
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_DYNAMIC, new J.BroadPhaseLayer(1))
  const ovbp = new J.ObjectVsBroadPhaseLayerFilterTable(bpInterface, 2, objFilter, NUM_LAYERS)
  const settings = new J.JoltSettings()
  settings.mObjectLayerPairFilter = objFilter
  settings.mBroadPhaseLayerInterface = bpInterface
  settings.mObjectVsBroadPhaseLayerFilter = ovbp
  if (limits) {
    settings.mMaxBodies = limits.maxBodies
    settings.mMaxBodyPairs = limits.maxBodyPairs
    settings.mMaxContactConstraints = limits.maxContactConstraints
  }
  const jolt = new J.JoltInterface(settings)
  J.destroy(settings)
  const physicsSystem = jolt.GetPhysicsSystem()
  const bodyInterface = physicsSystem.GetBodyInterface()
  const gv = new J.Vec3(gravity[0], gravity[1], gravity[2])
  physicsSystem.SetGravity(gv)
  J.destroy(gv)

  const origin = new J.RVec3(0, 0, 0)
  const dir = new J.Vec3(0, 0, 0)
  const ray = new J.RRayCast()
  const raySettings = new J.RayCastSettings()
  const collector = new J.CastRayClosestHitCollisionCollector()
  const broadPhaseFilter = new J.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), LAYER_DYNAMIC)
  const objectLayerFilter = new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), LAYER_DYNAMIC)
  const bodyFilter = new J.BodyFilter()
  const shapeFilter = new J.ShapeFilter()
  const normalPoint = new J.RVec3(0, 0, 0)

  const bodies = new Map()
  const bodyIds = new Map()
  const shapeKeys = new Map()
  let staticTiles = null

  const host = {
    Jolt: J,
    jolt,
    physicsSystem,
    bodyInterface,
    bodies,
    bodyIds,
    shapeKeys,
    reservationBytes: limits ? joltReservationBytes(limits) : null,
    addBody,
    addStaticTriangles,
    enableStaticTiles,
    castRay,
    boundsOf,
    bodyCount: () => physicsSystem.GetNumBodies(),
    destroy,
  }

  function addBody(shape, position, motionType, layer) {
    const resident = physicsSystem.GetNumBodies()
    if (limits && resident >= limits.maxBodies) {
      throw new JoltLimitsError('jolt-body-limit', resident + ' bodies are resident and maxBodies is ' + limits.maxBodies + '; raise joltLimits.maxBodies above ' + resident)
    }
    const pos = new J.RVec3(position[0], position[1], position[2])
    const rot = new J.Quat(0, 0, 0, 1)
    const cs = new J.BodyCreationSettings(shape, pos, rot, motionType, layer)
    J.destroy(pos)
    J.destroy(rot)
    const body = bodyInterface.CreateBody(cs)
    const bodyID = body.GetID()
    const id = bodyID.GetIndexAndSequenceNumber()
    if (!id) {
      J.destroy(cs)
      throw new JoltLimitsError('jolt-body-refused', resident + ' bodies are resident and Jolt gave the new body no slot; raise joltLimits.maxBodies above ' + (resident + 1))
    }
    bodyInterface.AddBody(bodyID, motionType === J.EMotionType_Static ? J.EActivation_DontActivate : J.EActivation_Activate)
    J.destroy(cs)
    bodies.set(id, body)
    bodyIds.set(id, bodyID)
    if (staticTiles) staticTiles.update(id)
    return id
  }

  function addStaticTriangles(vertices, indices, position = [0, 0, 0]) {
    const triCount = indices.length / 3
    const list = new J.TriangleList()
    list.resize(triCount)
    const f3 = new J.Float3(0, 0, 0)
    for (let t = 0; t < triCount; t++) {
      const tri = list.at(t)
      for (let k = 0; k < 3; k++) {
        const i = indices[t * 3 + k]
        f3.x = vertices[i * 3]
        f3.y = vertices[i * 3 + 1]
        f3.z = vertices[i * 3 + 2]
        tri.set_mV(k, f3)
      }
    }
    const settingsMesh = new J.MeshShapeSettings(list)
    const result = settingsMesh.Create()
    J.destroy(f3)
    J.destroy(list)
    if (!result.IsValid()) {
      J.destroy(settingsMesh)
      J.destroy(result)
      return null
    }
    const id = addBody(result.Get(), position, J.EMotionType_Static, LAYER_STATIC)
    J.destroy(settingsMesh)
    J.destroy(result)
    return id
  }

  function enableStaticTiles(tileM = STATIC_TILE_M) {
    if (!staticTiles) {
      staticTiles = createStaticTileIndex(host, tileM)
      for (const id of bodies.keys()) staticTiles.update(id)
    }
    return staticTiles
  }

  function castRay(from, direction, maxDistance = 1000) {
    const len = Math.hypot(direction[0], direction[1], direction[2])
    const dx = len > 0 ? direction[0] / len : direction[0]
    const dy = len > 0 ? direction[1] / len : direction[1]
    const dz = len > 0 ? direction[2] / len : direction[2]
    origin.Set(from[0], from[1], from[2])
    dir.Set(dx * maxDistance, dy * maxDistance, dz * maxDistance)
    ray.set_mOrigin(origin)
    ray.set_mDirection(dir)
    collector.Reset()
    physicsSystem.GetNarrowPhaseQuery().CastRay(ray, raySettings, collector, broadPhaseFilter, objectLayerFilter, bodyFilter, shapeFilter)
    if (!collector.HadHit()) return { hit: false, distance: maxDistance, bodyId: null, normal: null, position: null }
    const hit = collector.get_mHit()
    const distance = hit.mFraction * maxDistance
    const position = [from[0] + dx * distance, from[1] + dy * distance, from[2] + dz * distance]
    const bodyId = hit.mBodyID.GetIndexAndSequenceNumber()
    normalPoint.Set(position[0], position[1], position[2])
    const n = bodies.get(bodyId).GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, normalPoint)
    const normal = [n.GetX(), n.GetY(), n.GetZ()]
    J.destroy(n)
    return { hit: true, distance, bodyId, normal, position }
  }

  function boundsOf(id) {
    const bb = bodies.get(id).GetWorldSpaceBounds()
    return {
      min: [bb.mMin.GetX(), bb.mMin.GetY(), bb.mMin.GetZ()],
      max: [bb.mMax.GetX(), bb.mMax.GetY(), bb.mMax.GetZ()],
    }
  }

  function destroy() {
    if (staticTiles) staticTiles.destroy()
    staticTiles = null
    for (const v of [origin, dir, normalPoint]) J.destroy(v)
    for (const v of [ray, raySettings, collector, broadPhaseFilter, objectLayerFilter, bodyFilter, shapeFilter]) J.destroy(v)
    bodies.clear()
    bodyIds.clear()
    J.destroy(jolt)
  }

  return host
}
