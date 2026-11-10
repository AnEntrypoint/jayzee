#ifndef ENGINE_MODEL_POOL_H
#define ENGINE_MODEL_POOL_H

#include <cstddef>
#include <cstdint>

#include "world.h"

namespace engine::models {

constexpr std::size_t kAlignment = 16;
constexpr std::uint32_t kIndexBytes = 4;
constexpr std::uint32_t kClusterIndices = 384;
constexpr std::uint32_t kMaxClustersPerSlot = 256;
constexpr float kModelScale = 2.0f;

struct Cluster {
  float centre[3];
  float radius;
  std::uint32_t firstIndex;
  std::uint32_t indexCount;
};

static_assert(sizeof(Cluster) == 24);
static_assert(offsetof(Cluster, centre) == 0);
static_assert(offsetof(Cluster, radius) == 12);
static_assert(offsetof(Cluster, firstIndex) == 16);
static_assert(offsetof(Cluster, indexCount) == 20);

struct Layout {
  std::uint32_t slots;
  std::uint32_t verticesPerSlot;
  std::uint32_t indicesPerSlot;
  std::uint32_t vertexStrideBytes;
  std::uint32_t uploadBytesPerFrame = 0;
};

struct Range {
  std::uint32_t firstVertex;
  std::uint32_t vertexCount;
  std::uint32_t firstIndex;
  std::uint32_t indexCount;
};

bool validLayout(const Layout& layout);
std::size_t bytesFor(const Layout& layout);
Status bind(void* base, std::size_t bytes, const Layout& layout);
bool bound();
const Layout& layout();
std::uint32_t liveCount();
double acquire(std::uint32_t vertices, std::uint32_t indices);
Status upload(double handle, const void* vertices, std::uint32_t vertexCount, const void* indices, std::uint32_t indexCount);
Status mutableSlot(double handle, std::uint8_t*& vertices, std::uint8_t*& indices);
Status markDirty(double handle);
Status ranges(double handle, Range& out);
Status release(double handle);
bool isLive(double handle);
bool uploaded(double handle);
std::int32_t slotOf(double handle);
std::uint32_t slotCount();
bool slotDirty(std::uint32_t slot);
bool slotReady(std::uint32_t slot);
void clearDirty(std::uint32_t slot);
std::uint32_t dirtyCount();
Range slotRange(std::uint32_t slot);
std::uint32_t slotClusterCount(std::uint32_t slot);
const Cluster* slotClusters(std::uint32_t slot);
std::uint32_t clusterStride();
std::uint64_t clusterSlotBytes();
std::uint64_t clusterPoolBytes();
const Cluster* clusterTable();
void modelOffset(std::uint32_t slot, float out[3]);
std::uint32_t visibleRuns(std::uint32_t slot, const float planes[6][4], Range* out, std::uint32_t* clusters, const double frameOrigin[3]);
const std::uint8_t* slotVertices(std::uint32_t slot);
const std::uint8_t* slotIndices(std::uint32_t slot);
std::uint64_t slotVertexBytes();
std::uint64_t slotIndexBytes();
std::uint64_t vertexPoolBytes();
std::uint64_t indexPoolBytes();

}

#endif
