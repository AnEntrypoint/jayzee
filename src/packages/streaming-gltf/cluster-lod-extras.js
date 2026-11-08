export const CLUSTER_LOD_VERSION = 2
export const CLUSTER_LOD_EXTRA_KEY = 'EP_cluster_lod'

const SPHERE_WITH_CENTER_LENGTH = 4
const SPHERE_RADIUS_ONLY_LENGTH = 1
const ROUNDING_SCALE = 1e4

function roundForExtras(value) {
  return Math.round(value * ROUNDING_SCALE) / ROUNDING_SCALE
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidLodEntry(lod) {
  const offset = Array.isArray(lod) ? lod[0] : lod?.offset
  const count = Array.isArray(lod) ? lod[1] : lod?.count
  return isFiniteNumber(offset) && offset >= 0 && isFiniteNumber(count) && count >= 0
}

function isValidRawCluster(cluster) {
  if (!cluster || typeof cluster !== 'object') return false
  if (!Array.isArray(cluster.aabb) || cluster.aabb.length !== 6 || !cluster.aabb.every(isFiniteNumber)) return false
  const sphereLengthOk = cluster.sphere?.length === SPHERE_WITH_CENTER_LENGTH || cluster.sphere?.length === SPHERE_RADIUS_ONLY_LENGTH
  if (!Array.isArray(cluster.sphere) || !sphereLengthOk || !cluster.sphere.every(isFiniteNumber)) return false
  if (!Array.isArray(cluster.lods) || cluster.lods.length === 0) return false
  return cluster.lods.every(isValidLodEntry)
}

function sphereFromAabb(aabb) {
  return [
    (aabb[0] + aabb[3]) * 0.5,
    (aabb[1] + aabb[4]) * 0.5,
    (aabb[2] + aabb[5]) * 0.5,
    Math.hypot(aabb[3] - aabb[0], aabb[4] - aabb[1], aabb[5] - aabb[2]) * 0.5,
  ]
}

function lodEntryFromRaw(lod) {
  if (Array.isArray(lod)) return { offset: lod[0], count: lod[1], stream: lod[2] || 0 }
  return { offset: lod.offset, count: lod.count, stream: lod.stream || 0 }
}

export function buildClusterLodExtra(result, coarseIndexAccessor = -1, materialBucket = null) {
  const extra = {
    version: CLUSTER_LOD_VERSION,
    clusterCount: result.clusters.length,
    lodCount: result.lodCount,
    coarseIndexAccessor,
    coarseIndexCount: result.indexCoarse.length,
    clusters: result.clusters.map((cluster) => ({
      aabb: cluster.aabb.map(roundForExtras),
      sphere: cluster.sphere.map(roundForExtras),
      lods: cluster.lods.map((lod) => [lod.offset, lod.count, lod.stream]),
    })),
  }
  if (materialBucket) extra.materialBucket = materialBucket
  return extra
}

export function lod0OnlyClusterLodExtras(extras) {
  const meta = extras && extras[CLUSTER_LOD_EXTRA_KEY]
  if (!meta || !Array.isArray(meta.clusters)) throw new TypeError('lod0OnlyClusterLodExtras: extras carry no EP_cluster_lod clusters')
  const clusters = meta.clusters.map((cluster, clusterIndex) => {
    const first = Array.isArray(cluster.lods) ? cluster.lods[0] : null
    const stream = Array.isArray(first) ? first[2] || 0 : first?.stream || 0
    if (!first || stream !== 0) throw new RangeError(`lod0OnlyClusterLodExtras: cluster ${clusterIndex} LOD0 is not on primitive.indices (stream ${stream})`)
    return { ...cluster, lods: [first] }
  })
  return {
    ...extras,
    [CLUSTER_LOD_EXTRA_KEY]: { ...meta, lodCount: 1, coarseIndexAccessor: -1, coarseIndexCount: 0, clusters },
  }
}

export class ClusterLodRecordError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ClusterLodRecordError'
    this.code = 'cluster-lod-malformed'
  }
}

export function parseClusterLod(extras) {
  const meta = extras && extras[CLUSTER_LOD_EXTRA_KEY]
  if (meta == null) return null
  if (!Array.isArray(meta.clusters)) throw new ClusterLodRecordError('parseClusterLod: EP_cluster_lod carries no clusters array')
  if (!meta.clusters.length) return null
  if (!meta.clusters.every(isValidRawCluster)) throw new ClusterLodRecordError('parseClusterLod: EP_cluster_lod holds a malformed cluster record')
  const clusters = meta.clusters.map((cluster) => ({
    aabb: cluster.aabb,
    sphere: cluster.sphere.length === SPHERE_WITH_CENTER_LENGTH ? cluster.sphere : sphereFromAabb(cluster.aabb),
    lods: cluster.lods.map(lodEntryFromRaw),
  }))
  return {
    version: meta.version || 1,
    lodCount: meta.lodCount || (clusters[0] && clusters[0].lods.length) || 1,
    coarseIndexAccessor: meta.coarseIndexAccessor != null ? meta.coarseIndexAccessor : -1,
    coarseIndexCount: meta.coarseIndexCount || 0,
    materialBucket: typeof meta.materialBucket === 'string' && meta.materialBucket ? meta.materialBucket : null,
    clusters,
  }
}
