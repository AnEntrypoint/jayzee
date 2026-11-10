#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>

#include "device_tier.h"
#include "harness.h"
#include "model_pool.h"
#include "textures.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr std::uint64_t kMiB = 1024ull * 1024ull;
constexpr std::uint64_t kGiB = 1024ull * kMiB;

device::Limits limits(std::uint32_t side, std::uint32_t layers, std::uint64_t maxBuffer, std::uint32_t texel, std::uint64_t memory) {
  return device::Limits{side, layers, maxBuffer, texel, memory};
}

alignas(16) std::uint8_t gStorage[96 * 1024];

const models::Layout kLayout{4, 512, 768, 32};

constexpr std::uint32_t kClusterVertices = 512;
constexpr std::uint32_t kClusterSlotIndices = 768;
constexpr std::uint32_t kVertexStride = 32;

void unitPlanes(float planes[6][4]) {
  for (int p = 0; p < 6; ++p) {
    for (int c = 0; c < 4; ++c) planes[p][c] = 0.0f;
    planes[p][3] = 1.0f;
  }
}

constexpr std::uint32_t kChurnCycles = 10000;

bool refusedWith(double value, Status status) {
  return value == static_cast<double>(status);
}

}

void modelsAndTiers() {
  device::Plan planned{};

  check(device::plan(limits(8192, 256, 256 * kMiB, 1, 0), planned) && planned.tier == 2,
        "device plan picks tier 2 for compressed textures on a large device");
  check(planned.vramBytes == 905969664ull, "tier 2 compressed accounted bytes equal the hand-computed 905969664");
  check(planned.vramBudgetBytes == 1024 * kMiB && planned.uploadBytesPerFrame == 2u * 1024u * 1024u,
        "tier 2 carries its budget and its per-frame upload allowance");

  check(device::plan(limits(8192, 256, 256 * kMiB, 4, 0), planned) && planned.tier == 0,
        "device plan picks tier 0 for RGBA8 textures, since no larger tier fits the budget");
  check(planned.vramBytes == 112547157ull, "tier 0 RGBA8 accounted bytes equal the hand-computed 112547157");

  check(device::plan(limits(1024, 256, 256 * kMiB, 1, 0), planned) && planned.tier == 1,
        "a device capped at 1024 texture side gets tier 1");
  check(planned.vramBytes == 363506346ull, "tier 1 compressed accounted bytes equal the hand-computed 363506346");

  check(device::plan(limits(8192, 256, 64 * kMiB, 1, 0), planned) && planned.tier == 0,
        "a 64 MiB buffer limit leaves only tier 0's pools");
  check(device::plan(limits(8192, 256, 1024, 1, 0), planned) == false, "a device with no tier that fits is refused");
  check(device::plan(limits(8192, 256, 256 * kMiB, 2, 0), planned) == false, "a texel size other than 1 or 4 is refused");
  check(device::plan(limits(8192, 256, 256 * kMiB, 1, kGiB), planned) && planned.tier == 0,
        "a 1 GiB device caps the budget at a quarter and drops to tier 0");
  check(planned.vramBudgetBytes == 256 * kMiB, "the device cap sets the budget to a quarter of device memory");

  check(device::vramBytesOf(device::Plan{0, 512, 64, 1, 128, 4096, 12288, 32, 0, 0, 0}) == 45438293ull,
        "vramBytesOf for tier 0 at one byte per texel equals 45438293");

  check(device::planTier(2, 1, planned) && planned.vramBytes == 905969664ull, "planTier fills the accounted bytes without the fit test");
  check(!device::planTier(2, 2, planned), "planTier refuses a texel size other than 1 or 4");
  check(device::planTier(0, 1, planned) && planned.uploadBytesPerFrame == 512u * 1024u, "tier 0 carries a 512 KiB upload budget per frame");
  check(device::planTier(2, 1, planned) && planned.uploadBytesPerFrame == 2u * 1024u * 1024u, "tier 2 carries a 2 MiB upload budget per frame");
  const models::Layout tierTwo{planned.modelSlots, planned.verticesPerModel, planned.indicesPerModel, planned.vertexStrideBytes, planned.uploadBytesPerFrame};
  check(models::bytesFor(tierTwo) >= 369098752ull, "the tier 2 pool holds its 369098752 vertex and index bytes");
  check(models::bytesFor(tierTwo) < 512ull * kMiB, "the tier 2 pool fits the 512 MiB build's arena");
  check(models::validLayout(kLayout), "a four-slot layout with 32-byte vertices is valid");
  check(!models::validLayout({0, 8, 12, 32}), "a layout with no slots is refused");
  check(!models::validLayout({handles::kMaxSlots + 1, 8, 12, 32}), "a layout above the slot maximum is refused");
  check(!models::validLayout({4, 8, 12, 6}), "a vertex stride that is not a multiple of four is refused");
  check(!models::validLayout({65535, 65536, 12, 256}), "a vertex pool above the 32-bit range is refused");
  check(!models::validLayout({4, 8, 12, 8}), "a vertex stride below 12 bytes is refused, since a position is three floats");
  check(models::validLayout({4, 512, 98304, 32}), "a slot of 256 clusters of 384 indices is valid");
  check(!models::validLayout({4, 512, 98305, 32}), "a slot needing more than 256 clusters is refused");

  check(refusedWith(models::acquire(1, 1), kNotConfigured), "acquire before bind reports not configured");
  check(models::bind(nullptr, sizeof gStorage, kLayout) == kRange, "bind refuses a null base");
  check(models::bind(gStorage + 8, sizeof gStorage - 8, kLayout) == kRange, "bind refuses a base that is not 16-byte aligned");
  check(models::bind(gStorage, models::bytesFor(kLayout) - 1, kLayout) == kRange, "bind refuses a buffer one byte short");
  check(models::bind(gStorage, sizeof gStorage, {4, 8, 12, 6}) == kRange, "bind refuses a bad layout");
  check(models::bind(gStorage, sizeof gStorage, kLayout) == kOk, "bind accepts an aligned buffer of the layout size");
  check(models::bind(gStorage, sizeof gStorage, kLayout) == kRange, "a second bind is refused");
  observe("model pool bytes for the witness layout", static_cast<double>(models::bytesFor(kLayout)));

  double first = models::acquire(8, 12);
  double second = models::acquire(4, 6);
  double third = models::acquire(1, 1);
  double fourth = models::acquire(8, 12);
  check(first > 0.0 && second > 0.0 && third > 0.0 && fourth > 0.0, "four slots acquire with positive handles");
  check(refusedWith(models::acquire(1, 1), kFull), "a fifth acquire on four slots reports full");
  check(refusedWith(models::acquire(513, 1), kRange), "acquire refuses more vertices than a slot holds");
  check(refusedWith(models::acquire(1, 769), kRange), "acquire refuses more indices than a slot holds");
  check(models::liveCount() == 4, "four live slots after four acquires");

  alignas(16) std::uint8_t vertices[8 * 32];
  alignas(16) std::uint8_t indices[12 * 4];
  for (std::size_t i = 0; i < sizeof vertices; ++i) vertices[i] = static_cast<std::uint8_t>(i + 1);
  for (std::size_t i = 0; i < sizeof indices; ++i) indices[i] = static_cast<std::uint8_t>(0x80 + i);
  check(models::upload(first, vertices, 8, indices, 12) == kOk, "upload with the acquired counts succeeds");
  check(models::slotDirty(0) && !models::uploaded(first), "an upload marks its slot dirty until the GPU copy clears it");
  models::clearDirty(0);
  check(models::slotReady(0) && models::uploaded(first), "clearing the dirty flag makes the slot ready to draw");
  check(models::dirtyCount() == 0, "no slot is dirty after its upload is cleared");
  check(models::upload(first, vertices, 7, indices, 12) == kRange, "upload with a vertex count other than acquired is refused");
  check(models::upload(first, vertices, 8, indices, 11) == kRange, "upload with an index count other than acquired is refused");
  check(models::upload(first, nullptr, 8, indices, 12) == kRange, "upload with a null vertex pointer is refused");

  models::Range range{};
  check(models::ranges(first, range) == kOk, "ranges reads a live slot");
  check(range.firstVertex == 0 && range.vertexCount == 8 && range.firstIndex == 0 && range.indexCount == 12,
        "the first slot's ranges are vertices 0 to 8 and indices 0 to 12");
  check(models::ranges(second, range) == kOk && range.firstVertex == 512 && range.firstIndex == 768,
        "the second slot starts after the first slot's pool share");

  const std::size_t vertexBase = 80;
  check(std::memcmp(gStorage + vertexBase, vertices, sizeof vertices) == 0,
        "upload copies the vertex bytes into the slot's pool share");

  check(models::release(second) == kOk, "release frees a live slot");
  check(models::isLive(second) == false, "a released handle is no longer live");
  check(models::release(second) == kBadId, "a second release of the same handle is refused");
  check(models::ranges(second, range) == kBadId, "ranges on a released handle is refused");
  check(models::upload(second, vertices, 4, indices, 6) == kBadId, "upload on a released handle is refused");
  check(models::liveCount() == 3, "three live slots after one release");

  double reused = models::acquire(4, 6);
  check(reused > 0.0 && reused != second, "the freed slot is reacquired under a new generation handle");
  check(models::isLive(reused) && !models::isLive(second), "the new handle is live and the old handle is stale");
  check(models::liveCount() == 4, "four live slots after reacquiring the freed slot");

  check(models::release(first) == kOk && models::release(third) == kOk && models::release(fourth) == kOk &&
            models::release(reused) == kOk,
        "all four slots release");
  check(models::liveCount() == 0, "no live slots after every release");

  std::uint32_t churnFailures = 0;
  for (std::uint32_t cycle = 0; cycle < kChurnCycles; ++cycle) {
    const double handle = models::acquire(8, 12);
    if (handle <= 0.0 || models::upload(handle, vertices, 8, indices, 12) != kOk || models::release(handle) != kOk) {
      churnFailures += 1;
    }
  }
  check(churnFailures == 0, "10000 acquire, upload and release cycles all succeed");
  check(models::liveCount() == 0, "the churn leaves no live slot");
  check(models::bytesFor(kLayout) == 78096, "the pool's byte size is unchanged by the churn");
  observe("model churn cycles", kChurnCycles);

  alignas(16) std::uint8_t clusterVertices[kClusterVertices * kVertexStride] = {};
  alignas(16) std::uint32_t clusterIndices[kClusterSlotIndices];
  for (std::uint32_t v = 0; v < kClusterVertices; ++v) {
    const float position[3] = {static_cast<float>(v), 0.0f, 0.0f};
    std::memcpy(clusterVertices + v * kVertexStride, position, sizeof position);
  }
  for (std::uint32_t i = 0; i < kClusterSlotIndices; ++i) clusterIndices[i] = i < 384 ? i % 256 : 256 + (i - 384) % 256;

  const double geometry = models::acquire(kClusterVertices, kClusterSlotIndices);
  const double outOfRange = models::acquire(4, 3);
  check(geometry > 0.0 && outOfRange > 0.0, "two slots acquire for the cluster witness");
  models::Range geometryRange{};
  models::Range strayRange{};
  check(models::ranges(geometry, geometryRange) == kOk && models::ranges(outOfRange, strayRange) == kOk,
        "both cluster witness slots report their ranges");
  const std::uint32_t slot = geometryRange.firstVertex / kClusterVertices;
  const std::uint32_t strayPlace = strayRange.firstVertex / kClusterVertices;
  check(models::upload(geometry, clusterVertices, kClusterVertices, clusterIndices, kClusterSlotIndices) == kOk,
        "upload of a two-cluster slot succeeds");
  check(models::slotClusterCount(slot) == 2, "a 768-index slot holds two 384-index clusters");

  const models::Cluster* clusters = models::slotClusters(slot);
  check(clusters[0].firstIndex == 0 && clusters[0].indexCount == 384 && clusters[1].firstIndex == 384 && clusters[1].indexCount == 384,
        "cluster index runs are 0 to 384 and 384 to 768");
  check(std::fabs(clusters[0].centre[0] - 127.5f) < 1e-3f && std::fabs(clusters[1].centre[0] - 383.5f) < 1e-3f,
        "each cluster's sphere centre is the middle of its vertex run");

  std::uint32_t outsideSphere = 0;
  for (std::uint32_t c = 0; c < 2; ++c) {
    for (std::uint32_t i = c * 384; i < (c + 1) * 384; ++i) {
      float p[3];
      std::memcpy(p, clusterVertices + clusterIndices[i] * kVertexStride, sizeof p);
      const float dx = p[0] - clusters[c].centre[0];
      const float dy = p[1] - clusters[c].centre[1];
      const float dz = p[2] - clusters[c].centre[2];
      if (std::sqrt(dx * dx + dy * dy + dz * dz) > clusters[c].radius) outsideSphere += 1;
    }
  }
  check(outsideSphere == 0, "every vertex of every cluster lies inside its bounding sphere");

  float offset[3];
  models::modelOffset(3, offset);
  check(offset[0] == 4.0f && offset[1] == 0.0f && offset[2] == -20.0f, "slot 3 is placed at x 4, y 0, z -20, as the shader places it");

  float everything[6][4];
  unitPlanes(everything);
  models::Range runs[models::kMaxClustersPerSlot];
  check(models::visibleRuns(slot, everything, runs) == 1 && runs[0].indexCount == 768 && runs[0].firstIndex == geometryRange.firstIndex &&
            runs[0].firstVertex == geometryRange.firstVertex,
        "with every plane passing, the two adjacent clusters merge into one run of 768 indices");

  float leftOnly[6][4];
  unitPlanes(leftOnly);
  leftOnly[0][0] = -1.0f;
  leftOnly[0][3] = 400.0f;
  const std::uint32_t kept = models::visibleRuns(slot, leftOnly, runs);
  check(kept == 1 && runs[0].indexCount == 384 && runs[0].firstIndex == geometryRange.firstIndex,
        "a plane that cuts off the right cluster leaves the left cluster as one run of 384 indices");
  float placed[3];
  models::modelOffset(slot, placed);
  std::uint32_t leakedVertices = 0;
  for (std::uint32_t i = 384; i < 768; ++i) {
    const float worldX = 2.0f * static_cast<float>(clusterIndices[i]) + placed[0];
    if (-worldX + 400.0f >= 0.0f) leakedVertices += 1;
  }
  check(leakedVertices == 0, "every vertex of the culled right cluster is outside the plane that culled it");

  float nothing[6][4];
  unitPlanes(nothing);
  nothing[0][0] = 1.0f;
  nothing[0][3] = -10000.0f;
  check(models::visibleRuns(slot, nothing, runs) == 0, "a plane every cluster fails culls the whole slot");
  check(models::visibleRuns(models::slotCount() + 3, everything, runs) == 0, "a slot index past the layout has no runs");

  check(models::slotClusterCount(strayPlace) == 1, "an out-of-range index slot still holds one cluster");
  const std::uint32_t stray[3] = {0, 1, 9};
  check(models::upload(outOfRange, clusterVertices, 4, stray, 3) == kOk, "upload with an index past the vertex count is accepted");
  check(models::visibleRuns(strayPlace, nothing, runs) == 1 && runs[0].indexCount == 3,
        "a cluster whose indices leave the slot's vertices is never culled");

  check(models::release(geometry) == kOk && models::release(outOfRange) == kOk, "the cluster witness slots release");
  check(models::liveCount() == 0, "no live slot after the cluster witness");
}

}
