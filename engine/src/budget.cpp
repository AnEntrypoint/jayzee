#include "budget.h"

#include <algorithm>

#include "arena.h"
#include "bridge.h"
#include "codec.h"
#include "page_cache.h"
#include "pool_alloc.h"
#include "vegetation.h"
#include "device_tier.h"
#include "model_pool.h"
#include "world.h"

namespace engine::budget {

namespace {

constexpr std::uint32_t kMinPlayers = 1;
constexpr std::uint32_t kMinWorkers = 1;
constexpr std::uint32_t kMaxWorkers = 8;

struct Tier {
  std::uint32_t maxPlayers;
  std::uint32_t baseBodies;
  std::uint32_t bodiesPerPlayer;
};

constexpr std::uint32_t kTopBase = 2048;
constexpr std::uint32_t kTopBodiesPerPlayer = (kTopTierBodies - kTopBase) / kMaxPlayers;
constexpr std::uint32_t kCompactBodiesPerPlayer = (kCompactTopTierBodies - kTopBase) / kMaxPlayers;

constexpr Tier kTiers[] = {
    {16, 512, 32},
    {256, 1024, 16},
    {kMaxPlayers, kTopBase, kTopBodiesPerPlayer},
};

constexpr std::uint32_t kStatics = 64;
constexpr std::uint32_t kTrunks = 1024;
constexpr std::uint64_t kPageBudgetDivisor = 8;
constexpr std::uint32_t kCellsPerSide = 32;
constexpr std::uint32_t kInstancesPerCell = 32;
constexpr std::uint32_t kMaterials = 1024;
constexpr std::uint32_t kTextures = 512;
constexpr std::uint32_t kLights = 256;
constexpr std::uint32_t kInputDepth = 8;
constexpr std::uint32_t kEventSlots = 256;
constexpr std::uint32_t kVisiblePerClient = 128;
constexpr std::uint32_t kBaselineDepth = 8;
constexpr std::uint32_t kInterestCellsPerSide = 32;
constexpr std::uint64_t kTempBytes = 8ull * 1024ull * 1024ull;
constexpr std::uint64_t kTempBytesPerBody = 64;
constexpr std::uint64_t kTempBytesPerContact = 896;

constexpr std::uint64_t kJoltBodyBytes = 576;
constexpr std::uint64_t kJoltStaticBytes = 512;
constexpr std::uint64_t kJoltContactBytes = 384;
constexpr std::uint64_t kJoltPairBytes = 128;
constexpr std::uint64_t kJoltFixedBytes = 512ull * 1024ull;
constexpr std::uint64_t kMaterialBytes = 64;
constexpr std::uint64_t kTextureBytes = 32;
constexpr std::uint64_t kLightBytes = 32;
constexpr std::uint64_t kWorkerScratchBytes = 64ull * 1024ull;
constexpr std::uint64_t kSlackBytes = 1024ull * 1024ull;
#if defined(ENGINE_THREADS)
constexpr std::uint64_t kJoltThreadHeapBytes = 526648;
constexpr std::uint64_t kHeapReserveBytes = 2633240;
#endif

constexpr std::uint64_t kBodyRowBytes = 2 * sizeof(std::uint32_t) + sizeof(std::uint16_t) + sizeof(std::uint8_t) + 6 * sizeof(double) +
                                        sizeof(Transform) + sizeof(std::uint32_t) + kBatchWords * sizeof(double) + sizeof(std::uint32_t) + sizeof(std::uint8_t) + sizeof(float) + sizeof(std::uint32_t) + sizeof(float);

constexpr bool scalesBodies(std::uint32_t players) {
  return players > kTiers[1].maxPlayers;
}

constexpr std::uint32_t bodiesFor(std::uint32_t players, std::uint32_t perPlayer) {
  if (scalesBodies(players)) return kTopBase + perPlayer * players;
  for (const Tier& tier : kTiers) {
    if (players <= tier.maxPlayers) return tier.baseBodies + tier.bodiesPerPlayer * players;
  }
  return 0;
}

static_assert(bodiesFor(kMaxPlayers, kTopBodiesPerPlayer) == kTopTierBodies);
static_assert(bodiesFor(kMaxPlayers, kCompactBodiesPerPlayer) == kCompactTopTierBodies);

}

std::uint64_t termBytes(const Capacity& c, std::uint32_t term) {
  const std::uint64_t bodies = c.bodies;
  const std::uint64_t players = c.players;
  const std::uint64_t visible = c.visiblePerClient;
  const std::uint64_t entityBytes = codec::kEntityBytes;
  const std::uint64_t fixedBodies = static_cast<std::uint64_t>(c.statics) + c.trunks + kFixedJoltBodies;
  const std::uint64_t vegetationCells = static_cast<std::uint64_t>(c.cellsPerSide) * c.cellsPerSide;
  const std::uint64_t interestCells = static_cast<std::uint64_t>(c.interestCellsPerSide) * c.interestCellsPerSide;
  switch (term) {
    case kTermBodyRows: return bodies * kBodyRowBytes;
    case kTermJoltBodies: return bodies * kJoltBodyBytes;
    case kTermJoltStatics: return fixedBodies * kJoltStaticBytes;
    case kTermContacts: return static_cast<std::uint64_t>(joltContactCapacity(c)) * kJoltContactBytes;
    case kTermBodyPairs: return static_cast<std::uint64_t>(joltPairCapacity(c)) * kJoltPairBytes;
    case kTermTemp: return c.tempBytes;
    case kTermJoltFixed: return kJoltFixedBytes;
    case kTermPoolPrimed: return pool::primedBytes();
    case kTermQuadNodes: return static_cast<std::uint64_t>(joltQuadNodePages(c)) * pool::kLargestClassBytes;
    case kTermPages: return static_cast<std::uint64_t>(c.pageSlots) * (planet::kPageSamples * sizeof(float) + sizeof(std::int64_t) + sizeof(std::uint8_t));
    case kTermVegetation: return vegetationCells * (sizeof(std::uint32_t) + static_cast<std::uint64_t>(c.instancesPerCell) * sizeof(vegetation::Instance));
    case kTermMaterials: return static_cast<std::uint64_t>(c.materials) * kMaterialBytes + static_cast<std::uint64_t>(c.textures) * kTextureBytes + static_cast<std::uint64_t>(c.lights) * kLightBytes;
    case kTermRender: return kRenderFixedBytes + bodies * kRenderBytesPerBody;
    case kTermModels: return c.modelBytes;
    case kTermHost: return c.hostBytes;
    case kTermBridge: return players * c.inputDepth * sizeof(bridge::InputSlot) + static_cast<std::uint64_t>(c.eventSlots) * sizeof(bridge::EventSlot);
    case kTermInterest: return interestCells * (sizeof(std::uint32_t) + visible * sizeof(std::uint32_t)) + players * visible * entityBytes + players * c.baselineDepth * visible * entityBytes;
    case kTermCodec: return codec::kScratchBytes + codec::kScratchValues * sizeof(double) + 4 * sizeof(std::int32_t);
    case kTermWorkers: return static_cast<std::uint64_t>(c.workers) * kWorkerScratchBytes;
    case kTermSlack: return kSlackBytes;
    default: return 0;
  }
}

namespace {

std::uint64_t totalBytes(const Capacity& c) {
  std::uint64_t total = 0;
  for (std::uint32_t term = 0; term < kTermCount; ++term) total += termBytes(c, term);
  return total;
}

}

std::uint32_t pageSlotsFor(std::uint64_t budgetBytes) {
  const std::uint64_t affordable = budgetBytes / kPageBudgetDivisor / planet::kPageArenaBytes;
  return static_cast<std::uint32_t>(std::clamp<std::uint64_t>(affordable, planet::kMinPageSlots, planet::kMaxRenderedPages));
}

std::uint64_t modelBytesOf(std::uint32_t tier) {
  device::Plan planned{};
  if (!device::planTier(tier, 1, planned)) return 0;
  const models::Layout layout{planned.modelSlots, planned.verticesPerModel, planned.indicesPerModel, planned.vertexStrideBytes, planned.uploadBytesPerFrame};
  return models::bytesFor(layout);
}

bool fitsTier(std::uint64_t budgetBytes, std::uint32_t players, std::uint32_t workers, Capacity& out) {
  Capacity next{};
  next.players = players;
  next.statics = kStatics;
  next.trunks = kTrunks;
  next.pageSlots = pageSlotsFor(budgetBytes);
  next.cellsPerSide = kCellsPerSide;
  next.instancesPerCell = kInstancesPerCell;
  next.materials = kMaterials;
  next.textures = kTextures;
  next.lights = kLights;
  next.inputDepth = kInputDepth;
  next.eventSlots = kEventSlots;
  next.visiblePerClient = kVisiblePerClient;
  next.baselineDepth = kBaselineDepth;
  next.interestCellsPerSide = kInterestCellsPerSide;
  next.workers = workers;
  next.hostBytes = players == kMaxPlayers ? kHostReserveBytes : 0;
  const std::uint32_t mostPerPlayer = scalesBodies(players) ? kTopBodiesPerPlayer : 0;
  const std::uint32_t leastPerPlayer = scalesBodies(players) ? kCompactBodiesPerPlayer : 0;
  bool fits = false;
  for (std::uint32_t tier = device::kTierCount; tier-- > 0 && !fits;) {
    next.modelTier = tier;
    next.modelBytes = modelBytesOf(tier);
    for (std::uint32_t perPlayer = mostPerPlayer + 1; perPlayer-- > leastPerPlayer;) {
      next.bodies = bodiesFor(players, perPlayer);
      next.tempBytes = kTempBytes + static_cast<std::uint64_t>(next.bodies) * kTempBytesPerBody + static_cast<std::uint64_t>(joltContactCapacity(next)) * kTempBytesPerContact;
      next.arenaBytes = totalBytes(next);
      if (next.arenaBytes <= budgetBytes && next.arenaBytes <= arena::kBytes) {
        fits = true;
        break;
      }
    }
  }
  out = next;
  return fits;
}

void poolCounts(const Capacity& c, std::uint32_t (&out)[pool::kClasses]) {
  for (std::uint32_t i = 0; i < pool::kClasses; ++i) out[i] = pool::kPrimeCounts[i];
  out[pool::kLargestIndex] += joltQuadNodePages(c);
}

constexpr std::uint32_t kFallbackTiers[] = {1024, 256, 64};

Capacity chosenCapacity{};

bool plan(std::uint64_t budgetBytes, std::uint32_t players, std::uint32_t workers, Capacity& out) {
  if (players < kMinPlayers || players > kMaxPlayers) return false;
  if (workers < kMinWorkers || workers > kMaxWorkers) return false;
  if (!workersFit(workers)) return false;
  if (fitsTier(budgetBytes, players, workers, out)) {
    chosenCapacity = out;
    return true;
  }
  for (const std::uint32_t tier : kFallbackTiers) {
    if (tier < players && fitsTier(budgetBytes, tier, workers, out)) {
      chosenCapacity = out;
      return true;
    }
  }
  return false;
}

bool workersFit(std::uint32_t workers) {
#if defined(ENGINE_THREADS)
  return workers <= 1 || static_cast<std::uint64_t>(workers - 1) * kJoltThreadHeapBytes <= kHeapReserveBytes;
#else
  return true;
#endif
}

const Capacity& chosen() {
  return chosenCapacity;
}

}
