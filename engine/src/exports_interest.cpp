#include <cstdint>

#include <emscripten/emscripten.h>

#include "interest.h"
#include "world.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_interest_configure(std::uint32_t players, double cellSize, double originX, double originZ,
                                                   std::uint32_t cellsPerSide, std::uint32_t radiusCells) {
  return engine::interest::configure(players, cellSize, originX, originZ, cellsPerSide, radiusCells);
}

EMSCRIPTEN_KEEPALIVE int engine_interest_set_client(std::uint32_t slot, double x, double z, int active) {
  return engine::interest::setClient(slot, x, z, active != 0);
}

EMSCRIPTEN_KEEPALIVE int engine_interest_update(std::uint32_t tick) {
  const engine::World& w = engine::world();
  return engine::interest::update(tick, w.positions(), w.velocities(), w.slotExtent());
}

EMSCRIPTEN_KEEPALIVE int engine_interest_visible_count(std::uint32_t slot) {
  return engine::interest::visibleCount(slot);
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_interest_truncated() {
  return engine::interest::truncated();
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_interest_outside() {
  return engine::interest::outside();
}

EMSCRIPTEN_KEEPALIVE int engine_snapshot_encode(std::uint32_t slot, std::uint32_t baselineTick) {
  return engine::interest::encode(slot, baselineTick);
}

EMSCRIPTEN_KEEPALIVE std::int32_t engine_snapshot_offset(std::uint32_t slot) {
  const std::uint8_t* at = engine::interest::segment(slot);
  if (at == nullptr) return engine::kBadId;
  return static_cast<std::int32_t>(reinterpret_cast<std::uintptr_t>(at));
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_snapshot_capacity_bytes() {
  return static_cast<std::uint32_t>(engine::interest::segmentBytes());
}

}
