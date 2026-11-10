#include "model_pool.h"

#include <cmath>
#include <cstring>
#include <limits>

#include "textures.h"

namespace engine::models {

namespace {

struct Meta {
  std::uint32_t vertices;
  std::uint32_t indices;
  std::uint32_t dirty;
};

constexpr std::uint64_t kMaxPoolBytes = 0x7fffffffull;
constexpr std::uint32_t kMinStrideBytes = 12;
constexpr float kBoundSlack = 1.0e-5f;
constexpr float kUnbounded = std::numeric_limits<float>::infinity();

handles::Table gTable{};
Meta* gMeta = nullptr;
std::uint8_t* gVertices = nullptr;
std::uint8_t* gIndices = nullptr;
Cluster* gClusters = nullptr;
Layout gLayout{};
bool gBound = false;

std::uint32_t clustersFor(std::uint32_t indices) {
  return (indices + kClusterIndices - 1) / kClusterIndices;
}

std::uint32_t slotClusterStride() {
  return clustersFor(gLayout.indicesPerSlot);
}

std::uint32_t indexAt(const std::uint8_t* base, std::uint32_t i) {
  std::uint32_t value = 0;
  std::memcpy(&value, base + static_cast<std::size_t>(i) * kIndexBytes, sizeof value);
  return value;
}

bool outsideFrustum(const float planes[6][4], const float* centre, float radius) {
  for (int p = 0; p < 6; ++p) {
    const float distance = planes[p][0] * centre[0] + planes[p][1] * centre[1] + planes[p][2] * centre[2] + planes[p][3];
    if (distance < -radius) return true;
  }
  return false;
}

void buildClusters(std::uint32_t slot) {
  const Meta meta = gMeta[slot];
  const std::uint32_t stride = slotClusterStride();
  Cluster* out = gClusters + static_cast<std::size_t>(slot) * stride;
  const std::uint8_t* indices = gIndices + static_cast<std::size_t>(slot) * gLayout.indicesPerSlot * kIndexBytes;
  const std::uint8_t* vertices = gVertices + static_cast<std::size_t>(slot) * gLayout.verticesPerSlot * gLayout.vertexStrideBytes;

  bool trusted = true;
  for (std::uint32_t i = 0; i < meta.indices && trusted; ++i) trusted = indexAt(indices, i) < meta.vertices;

  for (std::uint32_t c = 0; c < stride; ++c) {
    const std::uint32_t first = c * kClusterIndices;
    const std::uint32_t last = first + kClusterIndices < meta.indices ? first + kClusterIndices : meta.indices;
    Cluster& cluster = out[c];
    cluster = Cluster{{0.0f, 0.0f, 0.0f}, kUnbounded, first, last > first ? last - first : 0};
    if (!trusted || cluster.indexCount == 0) continue;

    float low[3] = {kUnbounded, kUnbounded, kUnbounded};
    float high[3] = {-kUnbounded, -kUnbounded, -kUnbounded};
    bool finite = true;
    for (std::uint32_t i = first; i < last; ++i) {
      float p[3];
      std::memcpy(p, vertices + static_cast<std::size_t>(indexAt(indices, i)) * gLayout.vertexStrideBytes, sizeof p);
      for (int k = 0; k < 3; ++k) {
        if (!std::isfinite(p[k])) finite = false;
        if (p[k] < low[k]) low[k] = p[k];
        if (p[k] > high[k]) high[k] = p[k];
      }
    }
    if (!finite) continue;

    for (int k = 0; k < 3; ++k) cluster.centre[k] = 0.5f * (low[k] + high[k]);
    float farthest = 0.0f;
    for (std::uint32_t i = first; i < last; ++i) {
      float p[3];
      std::memcpy(p, vertices + static_cast<std::size_t>(indexAt(indices, i)) * gLayout.vertexStrideBytes, sizeof p);
      const float dx = p[0] - cluster.centre[0];
      const float dy = p[1] - cluster.centre[1];
      const float dz = p[2] - cluster.centre[2];
      const float distance = dx * dx + dy * dy + dz * dz;
      if (distance > farthest) farthest = distance;
    }
    cluster.radius = std::sqrt(farthest) * (1.0f + kBoundSlack);
  }
}

std::size_t alignUp(std::size_t value) {
  return (value + kAlignment - 1) & ~(kAlignment - 1);
}

std::size_t metaBytes(std::uint32_t slots) {
  return alignUp(static_cast<std::size_t>(slots) * sizeof(Meta));
}

std::size_t tableBytes(std::uint32_t slots) {
  return alignUp(handles::bytesFor(slots));
}

std::size_t vertexBytes(const Layout& layout) {
  return alignUp(static_cast<std::size_t>(layout.slots) * layout.verticesPerSlot * layout.vertexStrideBytes);
}

std::size_t indexBytes(const Layout& layout) {
  return alignUp(static_cast<std::size_t>(layout.slots) * layout.indicesPerSlot * kIndexBytes);
}

std::size_t clusterBytes(const Layout& layout) {
  return alignUp(static_cast<std::size_t>(layout.slots) * clustersFor(layout.indicesPerSlot) * sizeof(Cluster));
}

bool resolveSlot(double handle, std::uint32_t& slot) {
  std::uint32_t whole = 0;
  return gBound && handles::wholeHandle(handle, whole) && handles::resolve(gTable, whole, slot);
}

bool held(std::uint32_t slot) {
  return gBound && slot < gLayout.slots && gMeta[slot].vertices != 0;
}

}

bool validLayout(const Layout& layout) {
  if (layout.slots < 1 || layout.slots > handles::kMaxSlots) return false;
  if (layout.verticesPerSlot < 1 || layout.indicesPerSlot < 1) return false;
  if (layout.vertexStrideBytes < kMinStrideBytes || layout.vertexStrideBytes > 256 || layout.vertexStrideBytes % 4 != 0) return false;
  if (layout.indicesPerSlot > kMaxClustersPerSlot * kClusterIndices) return false;
  const std::uint64_t vertexPool = static_cast<std::uint64_t>(layout.slots) * layout.verticesPerSlot * layout.vertexStrideBytes;
  const std::uint64_t indexPool = static_cast<std::uint64_t>(layout.slots) * layout.indicesPerSlot * kIndexBytes;
  return vertexPool <= kMaxPoolBytes && indexPool <= kMaxPoolBytes;
}

std::size_t bytesFor(const Layout& layout) {
  return metaBytes(layout.slots) + tableBytes(layout.slots) + vertexBytes(layout) + indexBytes(layout) + clusterBytes(layout);
}

Status bind(void* base, std::size_t bytes, const Layout& layout) {
  if (gBound) return kRange;
  if (!validLayout(layout)) return kRange;
  if (base == nullptr || (reinterpret_cast<std::uintptr_t>(base) & (kAlignment - 1)) != 0) return kRange;
  if (bytes < bytesFor(layout)) return kRange;
  std::uint8_t* cursor = static_cast<std::uint8_t*>(base);
  gMeta = reinterpret_cast<Meta*>(cursor);
  std::memset(gMeta, 0, metaBytes(layout.slots));
  cursor += metaBytes(layout.slots);
  if (!handles::bindTable(gTable, cursor, layout.slots)) return kRange;
  cursor += tableBytes(layout.slots);
  gVertices = cursor;
  cursor += vertexBytes(layout);
  gIndices = cursor;
  cursor += indexBytes(layout);
  gClusters = reinterpret_cast<Cluster*>(cursor);
  std::memset(gClusters, 0, clusterBytes(layout));
  gLayout = layout;
  gBound = true;
  return kOk;
}

bool bound() {
  return gBound;
}

const Layout& layout() {
  return gLayout;
}

std::uint32_t liveCount() {
  return gBound ? handles::liveCount(gTable) : 0;
}

double acquire(std::uint32_t vertices, std::uint32_t indices) {
  if (!gBound) return kNotConfigured;
  if (vertices < 1 || vertices > gLayout.verticesPerSlot) return kRange;
  if (indices < 1 || indices > gLayout.indicesPerSlot) return kRange;
  std::uint32_t slot = 0;
  if (!handles::acquire(gTable, slot)) return kFull;
  gMeta[slot] = Meta{vertices, indices, 0};
  return handles::handleOf(gTable, slot);
}

Status upload(double handle, const void* vertices, std::uint32_t vertexCount, const void* indices, std::uint32_t indexCount) {
  std::uint32_t slot = 0;
  if (!resolveSlot(handle, slot)) return kBadId;
  if (vertices == nullptr || indices == nullptr) return kRange;
  if (vertexCount != gMeta[slot].vertices || indexCount != gMeta[slot].indices) return kRange;
  if (indexCount % 3 != 0) return kRange;
  std::memcpy(gVertices + static_cast<std::size_t>(slot) * gLayout.verticesPerSlot * gLayout.vertexStrideBytes, vertices,
              static_cast<std::size_t>(vertexCount) * gLayout.vertexStrideBytes);
  std::memcpy(gIndices + static_cast<std::size_t>(slot) * gLayout.indicesPerSlot * kIndexBytes, indices,
              static_cast<std::size_t>(indexCount) * kIndexBytes);
  buildClusters(slot);
  gMeta[slot].dirty = 1;
  return kOk;
}

Status mutableSlot(double handle, std::uint8_t*& vertices, std::uint8_t*& indices) {
  std::uint32_t slot = 0;
  if (!resolveSlot(handle, slot)) return kBadId;
  vertices = gVertices + static_cast<std::size_t>(slot) * gLayout.verticesPerSlot * gLayout.vertexStrideBytes;
  indices = gIndices + static_cast<std::size_t>(slot) * gLayout.indicesPerSlot * kIndexBytes;
  return kOk;
}

Status markDirty(double handle) {
  std::uint32_t slot = 0;
  if (!resolveSlot(handle, slot)) return kBadId;
  if (gMeta[slot].indices % 3 != 0) return kRange;
  buildClusters(slot);
  gMeta[slot].dirty = 1;
  return kOk;
}

Status ranges(double handle, Range& out) {
  std::uint32_t slot = 0;
  if (!resolveSlot(handle, slot)) return kBadId;
  out.firstVertex = slot * gLayout.verticesPerSlot;
  out.vertexCount = gMeta[slot].vertices;
  out.firstIndex = slot * gLayout.indicesPerSlot;
  out.indexCount = gMeta[slot].indices;
  return kOk;
}

Status release(double handle) {
  std::uint32_t whole = 0;
  std::uint32_t slot = 0;
  if (!gBound || !handles::wholeHandle(handle, whole) || !handles::resolve(gTable, whole, slot)) return kBadId;
  gMeta[slot] = Meta{0, 0, 0};
  handles::release(gTable, slot);
  return kOk;
}

bool isLive(double handle) {
  std::uint32_t slot = 0;
  return resolveSlot(handle, slot);
}

bool uploaded(double handle) {
  std::uint32_t slot = 0;
  return resolveSlot(handle, slot) && gMeta[slot].dirty == 0;
}

std::uint32_t slotCount() {
  return gBound ? gLayout.slots : 0;
}

bool slotDirty(std::uint32_t slot) {
  return held(slot) && gMeta[slot].dirty != 0;
}

bool slotReady(std::uint32_t slot) {
  return held(slot) && gMeta[slot].dirty == 0;
}

void clearDirty(std::uint32_t slot) {
  if (held(slot)) gMeta[slot].dirty = 0;
}

std::uint32_t dirtyCount() {
  std::uint32_t count = 0;
  for (std::uint32_t slot = 0; slot < slotCount(); ++slot) {
    if (slotDirty(slot)) count += 1;
  }
  return count;
}

Range slotRange(std::uint32_t slot) {
  Range out{0, 0, 0, 0};
  if (!held(slot)) return out;
  out.firstVertex = slot * gLayout.verticesPerSlot;
  out.vertexCount = gMeta[slot].vertices;
  out.firstIndex = slot * gLayout.indicesPerSlot;
  out.indexCount = gMeta[slot].indices;
  return out;
}

std::uint32_t slotClusterCount(std::uint32_t slot) {
  return held(slot) ? clustersFor(gMeta[slot].indices) : 0;
}

std::uint32_t clusterStride() {
  return gBound ? slotClusterStride() : 0;
}

std::uint64_t clusterSlotBytes() {
  return static_cast<std::uint64_t>(clusterStride()) * sizeof(Cluster);
}

std::uint64_t clusterPoolBytes() {
  return static_cast<std::uint64_t>(slotCount()) * clusterSlotBytes();
}

const Cluster* clusterTable() {
  return gClusters;
}

const Cluster* slotClusters(std::uint32_t slot) {
  return gClusters + static_cast<std::size_t>(slot) * slotClusterStride();
}

void modelOffset(std::uint32_t slot, float out[3]) {
  out[0] = static_cast<float>(slot) * 4.0f - 8.0f;
  out[1] = 0.0f;
  out[2] = -20.0f;
}

std::uint32_t visibleRuns(std::uint32_t slot, const float planes[6][4], Range* out) {
  if (!held(slot)) return 0;
  const std::uint32_t count = slotClusterCount(slot);
  const Cluster* clusters = slotClusters(slot);
  const Range base = slotRange(slot);
  float offset[3];
  modelOffset(slot, offset);
  std::uint32_t runs = 0;
  for (std::uint32_t c = 0; c < count; ++c) {
    const Cluster& cluster = clusters[c];
    const float centre[3] = {cluster.centre[0] * kModelScale + offset[0], cluster.centre[1] * kModelScale + offset[1],
                             cluster.centre[2] * kModelScale + offset[2]};
    if (outsideFrustum(planes, centre, cluster.radius * kModelScale)) continue;
    const std::uint32_t first = base.firstIndex + cluster.firstIndex;
    if (runs > 0 && out[runs - 1].firstIndex + out[runs - 1].indexCount == first) {
      out[runs - 1].indexCount += cluster.indexCount;
    } else {
      out[runs] = Range{base.firstVertex, base.vertexCount, first, cluster.indexCount};
      runs += 1;
    }
  }
  return runs;
}

const std::uint8_t* slotVertices(std::uint32_t slot) {
  return gVertices + static_cast<std::size_t>(slot) * slotVertexBytes();
}

const std::uint8_t* slotIndices(std::uint32_t slot) {
  return gIndices + static_cast<std::size_t>(slot) * slotIndexBytes();
}

std::uint64_t slotVertexBytes() {
  return gBound ? static_cast<std::uint64_t>(gLayout.verticesPerSlot) * gLayout.vertexStrideBytes : 0;
}

std::uint64_t slotIndexBytes() {
  return gBound ? static_cast<std::uint64_t>(gLayout.indicesPerSlot) * kIndexBytes : 0;
}

std::uint64_t vertexPoolBytes() {
  return static_cast<std::uint64_t>(slotCount()) * slotVertexBytes();
}

std::uint64_t indexPoolBytes() {
  return static_cast<std::uint64_t>(slotCount()) * slotIndexBytes();
}

}
