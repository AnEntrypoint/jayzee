#include "budget.h"

#include "arena.h"
#include "bridge.h"
#include "codec.h"
#include "page_cache.h"
#include "pool_alloc.h"
#include "vegetation.h"
#include "world.h"

namespace engine::budget {

namespace {

constexpr std::uint32_t kMinPlayers = 1;
constexpr std::uint32_t kMaxPlayers = 1024;
constexpr std::uint32_t kMinWorkers = 1;
constexpr std::uint32_t kMaxWorkers = 8;

struct Tier {
  std::uint32_t maxPlayers;
  std::uint32_t baseBodies;
  std::uint32_t bodiesPerPlayer;
};

constexpr Tier kTiers[] = {
    {16, 512, 32},
    {256, 1024, 16},
    {kMaxPlayers, 2048, 8},
};

constexpr std::uint32_t kStatics = 64;
constexpr std::uint32_t kTrunks = 1024;
constexpr std::uint32_t kPageSlots = 64;
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
constexpr std::uint64_t kTempBytes = 16ull * 1024ull * 1024ull;

constexpr std::uint64_t kJoltBodyBytes = 1024;
constexpr std::uint64_t kJoltStaticBytes = 512;
constexpr std::uint64_t kJoltContactBytes = 384;
constexpr std::uint64_t kJoltPairBytes = 128;
constexpr std::uint64_t kJoltFixedBytes = 512ull * 1024ull;
constexpr std::uint64_t kMaterialBytes = 64;
constexpr std::uint64_t kTextureBytes = 32;
constexpr std::uint64_t kLightBytes = 32;
constexpr std::uint64_t kWorkerScratchBytes = 64ull * 1024ull;
constexpr std::uint64_t kSlackBytes = 1024ull * 1024ull;

constexpr std::uint64_t kBodyRowBytes = 2 * sizeof(std::uint32_t) + sizeof(std::uint16_t) + sizeof(std::uint8_t) + 6 * sizeof(double) +
                                        sizeof(Transform) + sizeof(std::uint32_t) + kBatchFloats * sizeof(float) + sizeof(std::uint32_t);

std::uint32_t bodiesFor(std::uint32_t players) {
  for (const Tier& tier : kTiers) {
    if (players <= tier.maxPlayers) return tier.baseBodies + tier.bodiesPerPlayer * players;
  }
  return 0;
}

std::uint64_t totalBytes(const Capacity& c) {
  const std::uint64_t bodies = c.bodies;
  const std::uint64_t players = c.players;
  const std::uint64_t visible = c.visiblePerClient;
  const std::uint64_t entityBytes = codec::kEntityBytes;
  const std::uint64_t fixedBodies = static_cast<std::uint64_t>(c.statics) + c.trunks + kFixedJoltBodies;
  const std::uint64_t vegetationCells = static_cast<std::uint64_t>(c.cellsPerSide) * c.cellsPerSide;
  const std::uint64_t interestCells = static_cast<std::uint64_t>(c.interestCellsPerSide) * c.interestCellsPerSide;

  std::uint64_t total = 0;
  total += bodies * kBodyRowBytes;
  total += bodies * kJoltBodyBytes;
  total += fixedBodies * kJoltStaticBytes;
  total += static_cast<std::uint64_t>(joltContactCapacity(c)) * kJoltContactBytes;
  total += static_cast<std::uint64_t>(joltPairCapacity(c)) * kJoltPairBytes;
  total += c.tempBytes;
  total += kJoltFixedBytes;
  total += pool::primedBytes();
  total += static_cast<std::uint64_t>(c.pageSlots) * (planet::kPageSamples * sizeof(float) + sizeof(std::int64_t) + sizeof(std::uint8_t));
  total += vegetationCells * (sizeof(std::uint32_t) + static_cast<std::uint64_t>(c.instancesPerCell) * sizeof(vegetation::Instance));
  total += static_cast<std::uint64_t>(c.materials) * kMaterialBytes;
  total += static_cast<std::uint64_t>(c.textures) * kTextureBytes;
  total += static_cast<std::uint64_t>(c.lights) * kLightBytes;
  total += players * c.inputDepth * sizeof(bridge::InputSlot);
  total += static_cast<std::uint64_t>(c.eventSlots) * sizeof(bridge::EventSlot);
  total += interestCells * (sizeof(std::uint32_t) + visible * sizeof(std::uint32_t));
  total += players * visible * entityBytes;
  total += players * c.baselineDepth * visible * entityBytes;
  total += codec::kScratchBytes + codec::kScratchValues * sizeof(double) + 4 * sizeof(std::int32_t);
  total += static_cast<std::uint64_t>(c.workers) * kWorkerScratchBytes;
  total += kSlackBytes;
  return total;
}

}

bool plan(std::uint64_t budgetBytes, std::uint32_t players, std::uint32_t workers, Capacity& out) {
  if (players < kMinPlayers || players > kMaxPlayers) return false;
  if (workers < kMinWorkers || workers > kMaxWorkers) return false;
  Capacity next{};
  next.players = players;
  next.bodies = bodiesFor(players);
  next.statics = kStatics;
  next.trunks = kTrunks;
  next.pageSlots = kPageSlots;
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
  next.tempBytes = kTempBytes;
  next.arenaBytes = totalBytes(next);
  out = next;
  return next.arenaBytes <= budgetBytes && next.arenaBytes <= arena::kBytes;
}

}
