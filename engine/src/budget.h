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
#define ENGINE_TOP_TIER_BODIES 40960
#endif

constexpr std::uint32_t kTopTierBodies = ENGINE_TOP_TIER_BODIES;
constexpr std::uint32_t kCompactTopTierBodies = 12288;
constexpr std::uint32_t kBaseTopTierBodies = 10240;
constexpr std::uint64_t kRenderBytesPerBody = 136;
constexpr std::uint64_t kRenderFixedBytes = 2ull * 1024ull * 1024ull - kBaseTopTierBodies * kRenderBytesPerBody;
constexpr std::uint64_t kTopTierArenaBytes = 768ull * 1024ull * 1024ull;
constexpr std::uint32_t kRenderBodySlots = arena::kBytes >= kTopTierArenaBytes ? kTopTierBodies : kCompactTopTierBodies;
constexpr std::uint64_t kRenderBytes = kRenderFixedBytes + kRenderBodySlots * kRenderBytesPerBody;

static_assert(kTopTierBodies >= kCompactTopTierBodies && (kTopTierBodies - 2048) % kMaxPlayers == 0);
static_assert(kTopTierBodies <= 131072);
constexpr std::uint64_t kHostReserveBytes = 16ull * 1024ull * 1024ull;

bool plan(std::uint64_t budgetBytes, std::uint32_t players, std::uint32_t workers, Capacity& out);
bool workersFit(std::uint32_t workers);
const Capacity& chosen();
void poolCounts(const Capacity& c, std::uint32_t (&out)[pool::kClasses]);

}

#endif
