#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
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

constexpr std::uint32_t kCostVertices = 4;
constexpr std::uint32_t kCostBatches = 5;
constexpr std::uint32_t kCostFramesPerBatch = 20;
constexpr float kFarX = 1.0e6f;
constexpr float kFarCut = 1.0e5f;
constexpr float kSlotCut = 201.5f;
constexpr double kShiftedOrigin[3] = {100.0, 0.0, 0.0};
constexpr double kCostOrigin[3] = {0.0, 0.0, 0.0};

std::uint32_t gCostIndices[models::kMaxClustersPerSlot * models::kClusterIndices];
models::Range gCostRuns[models::kMaxClustersPerSlot];
models::Range gReferenceRuns[models::kMaxClustersPerSlot];

struct Tally {
  std::uint64_t runs;
  std::uint64_t kept;
  std::uint32_t slots;
};

std::uint32_t referenceRuns(std::uint32_t slot, const float planes[6][4], const double frameOrigin[3], models::Range* out, std::uint32_t& kept) {
  kept = 0;
  const models::Cluster* clusters = models::slotClusters(slot);
  const std::uint32_t count = models::slotClusterCount(slot);
  const models::Range base = models::slotRange(slot);
  float offset[3];
  models::modelOffset(slot, offset);
  std::uint32_t runs = 0;
  bool open = false;
  for (std::uint32_t c = 0; c < count; ++c) {
    bool outside = false;
    for (int p = 0; p < 6 && !outside; ++p) {
      double distance = static_cast<double>(planes[p][3]);
      for (int k = 0; k < 3; ++k) {
        const double centre = static_cast<double>(clusters[c].centre[k]) * static_cast<double>(models::kModelScale) + static_cast<double>(offset[k]) - frameOrigin[k];
        distance += static_cast<double>(planes[p][k]) * centre;
      }
      outside = distance < -static_cast<double>(clusters[c].radius) * static_cast<double>(models::kModelScale);
    }
    if (outside) {
      open = false;
      continue;
    }
    kept += 1;
    if (open) {
      out[runs - 1].indexCount += clusters[c].indexCount;
    } else {
      out[runs] = models::Range{base.firstVertex, base.vertexCount, base.firstIndex + clusters[c].firstIndex, clusters[c].indexCount};
      runs += 1;
      open = true;
    }
  }
  return runs;
}

std::uint32_t mismatches(const float planes[6][4], const double frameOrigin[3], Tally& tally) {
  std::uint32_t wrong = 0;
  tally = Tally{0, 0, 0};
  for (std::uint32_t slot = 0; slot < models::slotCount(); ++slot) {
    std::uint32_t kept = 0;
    std::uint32_t expectedKept = 0;
    const std::uint32_t runs = models::visibleRuns(slot, planes, gCostRuns, &kept, frameOrigin);
    const std::uint32_t expected = referenceRuns(slot, planes, frameOrigin, gReferenceRuns, expectedKept);
    tally.runs += runs;
    tally.kept += kept;
    tally.slots += runs > 0 ? 1 : 0;
    if (runs != expected || kept != expectedKept) {
      wrong += 1;
      continue;
    }
    for (std::uint32_t r = 0; r < runs; ++r) {
      if (gCostRuns[r].firstVertex != gReferenceRuns[r].firstVertex || gCostRuns[r].vertexCount != gReferenceRuns[r].vertexCount ||
          gCostRuns[r].firstIndex != gReferenceRuns[r].firstIndex || gCostRuns[r].indexCount != gReferenceRuns[r].indexCount) {
        wrong += 1;
        break;
      }
    }
  }
  return wrong;
}

double nanosecondsPerFrame(const float planes[6][4], std::uint64_t& sink) {
  double best = 0.0;
  for (std::uint32_t batch = 0; batch < kCostBatches; ++batch) {
    const auto start = std::chrono::steady_clock::now();
    for (std::uint32_t frame = 0; frame < kCostFramesPerBatch; ++frame) {
      for (std::uint32_t slot = 0; slot < models::slotCount(); ++slot) {
        std::uint32_t kept = 0;
        sink += models::visibleRuns(slot, planes, gCostRuns, &kept, kCostOrigin) + kept;
      }
    }
    const double elapsed = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - start).count() / kCostFramesPerBatch;
    if (batch == 0 || elapsed < best) best = elapsed;
  }
  return best;
}

void report(std::uint32_t tier, const char* scene, const float planes[6][4], std::uint64_t& sink) {
  const double frame = nanosecondsPerFrame(planes, sink);
  std::printf("INFO visibleRuns tier %u, %s: %.4f microseconds per call, %.2f microseconds per frame over %u slots\n", tier, scene,
              frame / 1000.0 / static_cast<double>(models::slotCount()), frame / 1000.0, models::slotCount());
}

void tierCost(std::uint32_t tier) {
  device::Plan planned{};
  if (!device::planTier(tier, 1, planned)) {
    check(false, "visibleRuns cost: the tier plans");
    return;
  }
  const models::Layout layout{planned.modelSlots, planned.verticesPerModel, planned.indicesPerModel, planned.vertexStrideBytes, planned.uploadBytesPerFrame};
  const std::size_t bytes = (models::bytesFor(layout) + models::kAlignment - 1) & ~(models::kAlignment - 1);
  void* storage = std::aligned_alloc(models::kAlignment, bytes);
  if (storage == nullptr || models::bind(storage, bytes, layout) != kOk) {
    check(false, "visibleRuns cost: the tier pool binds");
    return;
  }
  const std::uint32_t clusters = layout.indicesPerSlot / models::kClusterIndices;
  alignas(16) std::uint8_t vertices[kCostVertices * 256] = {};
  const float xs[kCostVertices] = {0.0f, 1.0f, kFarX, kFarX + 1.0f};
  for (std::uint32_t v = 0; v < kCostVertices; ++v) {
    const float position[3] = {xs[v], 0.0f, 0.0f};
    std::memcpy(vertices + v * layout.vertexStrideBytes, position, sizeof position);
  }
  for (std::uint32_t i = 0; i < layout.indicesPerSlot; ++i) gCostIndices[i] = ((i / models::kClusterIndices) % 2) * 2 + (i % 2);
  std::uint32_t refused = 0;
  for (std::uint32_t slot = 0; slot < layout.slots; ++slot) {
    const double handle = models::acquire(kCostVertices, layout.indicesPerSlot);
    if (handle <= 0.0 || models::upload(handle, vertices, kCostVertices, gCostIndices, layout.indicesPerSlot) != kOk) refused += 1;
    if (models::slotClusterCount(slot) != clusters) refused += 1;
  }
  std::printf("INFO visibleRuns tier %u layout: %u slots of %u clusters, %u sphere tests per frame at most\n", tier, layout.slots, clusters, layout.slots * clusters);
  char label[160];
  std::snprintf(label, sizeof label, "visibleRuns tier %u: every slot fills with %u clusters", tier, clusters);
  check(refused == 0 && clusters * models::kClusterIndices == layout.indicesPerSlot && clusters % 2 == 0, label);

  float everything[6][4];
  unitPlanes(everything);
  float alternate[6][4];
  unitPlanes(alternate);
  alternate[0][0] = -1.0f;
  alternate[0][3] = kFarCut;
  float nothing[6][4];
  unitPlanes(nothing);
  nothing[0][0] = 1.0f;
  nothing[0][3] = -1.0e9f;
  float someSlots[6][4];
  unitPlanes(someSlots);
  someSlots[0][0] = -1.0f;
  someSlots[0][3] = kSlotCut;

  Tally tally{};
  std::uint32_t wrong = mismatches(everything, kCostOrigin, tally);
  std::uint32_t shape = 0;
  for (std::uint32_t slot = 0; slot < layout.slots; ++slot) {
    if (models::visibleRuns(slot, everything, gCostRuns, nullptr, kCostOrigin) != 1 || gCostRuns[0].firstIndex != slot * layout.indicesPerSlot ||
        gCostRuns[0].indexCount != layout.indicesPerSlot) {
      shape += 1;
    }
  }
  std::snprintf(label, sizeof label, "visibleRuns tier %u: with every plane passing each slot is one run of all its indices and keeps every cluster", tier);
  check(wrong == 0 && shape == 0 && tally.runs == layout.slots && tally.kept == static_cast<std::uint64_t>(layout.slots) * clusters, label);

  wrong = mismatches(alternate, kCostOrigin, tally);
  shape = 0;
  for (std::uint32_t slot = 0; slot < layout.slots; ++slot) {
    const std::uint32_t runs = models::visibleRuns(slot, alternate, gCostRuns, nullptr, kCostOrigin);
    if (runs != clusters / 2) shape += 1;
    for (std::uint32_t r = 0; r < runs; ++r) {
      if (gCostRuns[r].indexCount != models::kClusterIndices || gCostRuns[r].firstIndex != slot * layout.indicesPerSlot + 2 * r * models::kClusterIndices) shape += 1;
    }
  }
  std::snprintf(label, sizeof label, "visibleRuns tier %u: with every second cluster culled each slot is %u separate runs of 384 indices", tier, clusters / 2);
  check(wrong == 0 && shape == 0 && tally.runs == static_cast<std::uint64_t>(layout.slots) * (clusters / 2) && tally.kept == tally.runs, label);

  wrong = mismatches(nothing, kCostOrigin, tally);
  std::snprintf(label, sizeof label, "visibleRuns tier %u: a plane every cluster fails gives no run in any slot", tier);
  check(wrong == 0 && tally.runs == 0 && tally.kept == 0, label);

  wrong = mismatches(someSlots, kCostOrigin, tally);
  std::snprintf(label, sizeof label, "visibleRuns tier %u: a plane across the slot row keeps the first 53 slots and culls the rest, as the double reference does", tier);
  check(wrong == 0 && tally.slots == 53 && tally.kept == 53ull * (clusters / 2), label);
  wrong = mismatches(someSlots, kShiftedOrigin, tally);
  std::snprintf(label, sizeof label, "visibleRuns tier %u: a frame origin 100 m along x keeps 25 more slots, as the double reference does", tier);
  check(wrong == 0 && tally.slots == 78, label);

  std::uint64_t sink = 0;
  report(tier, "every cluster visible", everything, sink);
  report(tier, "every second cluster culled", alternate, sink);
  report(tier, "every cluster culled", nothing, sink);
  std::snprintf(label, sizeof label, "visibleRuns tier %u: the timed calls returned runs", tier);
  check(sink > 0, label);
}

void tierCostInChild(std::uint32_t tier) {
  std::fflush(stdout);
  const int before = engine::test::failureCount();
  const pid_t child = fork();
  if (child == 0) {
    tierCost(tier);
    std::fflush(stdout);
    _exit(engine::test::failureCount() == before ? 0 : 1);
  }
  int status = -1;
  const bool waited = child > 0 && waitpid(child, &status, 0) == child;
  char label[160];
  std::snprintf(label, sizeof label, "visibleRuns tier %u: the run in its own process, with the pool bound at the tier layout, ends with no failure", tier);
  check(waited && WIFEXITED(status) && WEXITSTATUS(status) == 0, label);
}

}

constexpr double kOrigin[3] = {0.0, 0.0, 0.0};

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

  for (std::uint32_t tier = 0; tier < 3; ++tier) tierCostInChild(tier);

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
  check(models::visibleRuns(slot, everything, runs, nullptr, kOrigin) == 1 && runs[0].indexCount == 768 && runs[0].firstIndex == geometryRange.firstIndex &&
            runs[0].firstVertex == geometryRange.firstVertex,
        "with every plane passing, the two adjacent clusters merge into one run of 768 indices");

  float leftOnly[6][4];
  unitPlanes(leftOnly);
  leftOnly[0][0] = -1.0f;
  leftOnly[0][3] = 400.0f;
  const std::uint32_t kept = models::visibleRuns(slot, leftOnly, runs, nullptr, kOrigin);
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
  check(models::visibleRuns(slot, nothing, runs, nullptr, kOrigin) == 0, "a plane every cluster fails culls the whole slot");
  check(models::visibleRuns(models::slotCount() + 3, everything, runs, nullptr, kOrigin) == 0, "a slot index past the layout has no runs");

  check(models::slotClusterCount(strayPlace) == 1, "an out-of-range index slot still holds one cluster");
  const std::uint32_t stray[3] = {0, 1, 9};
  check(models::upload(outOfRange, clusterVertices, 4, stray, 3) == kOk, "upload with an index past the vertex count is accepted");
  check(models::visibleRuns(strayPlace, nothing, runs, nullptr, kOrigin) == 1 && runs[0].indexCount == 3,
        "a cluster whose indices leave the slot's vertices is never culled");

  check(models::release(geometry) == kOk && models::release(outOfRange) == kOk, "the cluster witness slots release");
  check(models::liveCount() == 0, "no live slot after the cluster witness");
}

}
