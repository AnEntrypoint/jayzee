#ifndef ENGINE_BUDGET_H
#define ENGINE_BUDGET_H

#include <cstdint>

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
  std::uint64_t arenaBytes;
};

bool plan(std::uint64_t budgetBytes, std::uint32_t players, std::uint32_t workers, Capacity& out);

}

#endif
