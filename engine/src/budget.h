#ifndef ENGINE_BUDGET_H
#define ENGINE_BUDGET_H

#include <cstdint>

#include "arena.h"
#include "pool_alloc.h"

namespace engine::budget {

struct Capacity {
  std::uint32_t players;
  std::uint32_t bodies;
  std::uint32_t statics;
  std::uint32_t trunks;
  std::uint32_t pageSlots;
  std::uint32_t cellsPerSide;
  std::uint32_t instancesPerCell;
  std::uint32_t materials;
  std::uint32_t textures;
  std::uint32_t lights;
  std::uint32_t inputDepth;
  std::uint32_t eventSlots;
  std::uint32_t visiblePerClient;
  std::uint32_t baselineDepth;
  std::uint32_t interestCellsPerSide;
  std::uint32_t workers;
  std::uint64_t tempBytes;
  std::uint32_t modelTier;
  std::uint64_t modelBytes;
  std::uint64_t hostBytes;
  std::uint64_t arenaBytes;
};

constexpr std::uint32_t kMaxPlayers = 1024;
#if !defined(ENGINE_TOP_TIER_BODIES)
#define ENGINE_TOP_TIER_BODIES 131072
#endif

constexpr std::uint32_t kTopTierBodies = ENGINE_TOP_TIER_BODIES;
constexpr std::uint32_t kCompactTopTierBodies = 12288;
constexpr std::uint64_t kRenderBytesPerBody = 168;
constexpr std::uint64_t kRenderFixedBytes = 1024ull * 1024ull;

static_assert(kTopTierBodies >= kCompactTopTierBodies && (kTopTierBodies - 2048) % kMaxPlayers == 0);
static_assert(kTopTierBodies <= 131072);
constexpr std::uint64_t kHostReserveBytes = 16ull * 1024ull * 1024ull;

enum Term : std::uint32_t {
  kTermBodyRows,
  kTermJoltBodies,
  kTermJoltStatics,
  kTermContacts,
  kTermBodyPairs,
  kTermTemp,
  kTermJoltFixed,
  kTermPoolPrimed,
  kTermQuadNodes,
  kTermPages,
  kTermVegetation,
  kTermMaterials,
  kTermRender,
  kTermModels,
  kTermHost,
  kTermBridge,
  kTermInterest,
  kTermCodec,
  kTermWorkers,
  kTermSlack,
  kTermCount,
};

std::uint64_t termBytes(const Capacity& c, std::uint32_t term);
bool plan(std::uint64_t budgetBytes, std::uint32_t players, std::uint32_t workers, Capacity& out);
bool workersFit(std::uint32_t workers);
const Capacity& chosen();
void poolCounts(const Capacity& c, std::uint32_t (&out)[pool::kClasses]);

}

#endif
