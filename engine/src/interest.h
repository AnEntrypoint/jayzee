#ifndef ENGINE_INTEREST_H
#define ENGINE_INTEREST_H

#include <cstddef>
#include <cstdint>

#include "budget.h"
#include "codec.h"
#include "snapshot_delta.h"
#include "world.h"

namespace engine::interest {

constexpr std::size_t kClientBytes = 20;

struct Offsets {
  std::size_t clients;
  std::size_t ticks;
  std::size_t counts;
  std::size_t indices;
  std::size_t records;
  std::size_t segments;
  std::size_t cellStarts;
  std::size_t cellCursor;
  std::size_t bodyCells;
  std::size_t bodyOrder;
  std::size_t total;
};

constexpr std::size_t align8(std::size_t value) {
  return (value + 7) & ~static_cast<std::size_t>(7);
}

constexpr Offsets layout(const budget::Capacity& capacity) {
  const std::size_t players = capacity.players;
  const std::size_t depth = capacity.baselineDepth;
  const std::size_t visible = capacity.visiblePerClient;
  const std::size_t cells = static_cast<std::size_t>(capacity.interestCellsPerSide) * capacity.interestCellsPerSide;
  const std::size_t bodies = capacity.bodies;
  const std::size_t slots = players * depth;
  Offsets o{};
  std::size_t at = 0;
  o.clients = at;
  at = align8(at + players * kClientBytes);
  o.ticks = at;
  at = align8(at + slots * sizeof(std::uint32_t));
  o.counts = at;
  at = align8(at + slots * sizeof(std::uint32_t));
  o.indices = at;
  at = align8(at + slots * visible * sizeof(std::uint32_t));
  o.records = at;
  at = align8(at + slots * visible * codec::kEntityBytes);
  o.segments = at;
  at = align8(at + players * snapshot::segmentBytesFor(capacity.visiblePerClient));
  o.cellStarts = at;
  at = align8(at + (cells + 1) * sizeof(std::uint32_t));
  o.cellCursor = at;
  at = align8(at + cells * sizeof(std::uint32_t));
  o.bodyCells = at;
  at = align8(at + bodies * sizeof(std::uint32_t));
  o.bodyOrder = at;
  at = align8(at + bodies * sizeof(std::uint32_t));
  o.total = at;
  return o;
}

constexpr std::size_t bytesFor(const budget::Capacity& capacity) {
  return layout(capacity).total;
}

bool bind(void* base, const budget::Capacity& capacity);
Status configure(std::uint32_t players, double cellSize, double originX, double originZ, std::uint32_t cellsPerSide, std::uint32_t radiusCells);
Status setClient(std::uint32_t slot, double x, double z, bool active);
Status update(std::uint32_t tick, const double* positions, const double* velocities, std::uint32_t count);
std::int32_t visibleCount(std::uint32_t slot);
std::uint32_t truncated();
std::uint32_t outside();
std::int32_t encode(std::uint32_t slot, std::uint32_t baselineTick);
const std::uint8_t* segment(std::uint32_t slot);
std::size_t segmentBytes();

}

#endif
