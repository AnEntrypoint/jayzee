#include "arena.h"
#include "bridge.h"
#include "budget.h"
#include "harness.h"
#include "planet_frame.h"
#include "pool_alloc.h"
#include "vegetation.h"
#include "world.h"

namespace engine::witness {

void phase2World();
void phase3Bridge();
void phase4Pools();
void phase5Planet();
void phase6Vegetation();
void phase7Codecs();
void phase8Resources();

}

int main() {
  using engine::test::check;
  using engine::test::kWitnessAlignment;
  using engine::test::kWitnessPlayers;
  using engine::test::kWitnessWorkers;
  using engine::test::witnessCapacity;

  check(engine::budget::plan(engine::arena::kBytes, kWitnessPlayers, kWitnessWorkers, witnessCapacity()),
        "the witness budget plans a capacity inside the arena");
  const engine::budget::Capacity& capacity = witnessCapacity();
  check(engine::pool::prime(engine::pool::kPrimeCounts), "the pool primes its block classes before Jolt starts");
  check(engine::World::initialize() == engine::kOk, "jolt initializes with the engine allocators and types");
  check(engine::world().bind(capacity) == engine::kOk, "the world singleton binds its arrays from the arena");
  check(engine::bridge::bind(capacity) == engine::kOk, "the bridge binds its input and event rings from the arena");
  check(engine::planet::bind(engine::arena::carve(engine::planet::bytesFor(capacity.pageSlots), kWitnessAlignment), capacity.pageSlots) !=
            nullptr,
        "the planet page cache binds from the arena");
  check(engine::vegetation::bind(engine::arena::carve(engine::vegetation::bytesFor(capacity.cellsPerSide, capacity.instancesPerCell),
                                                      kWitnessAlignment),
                                 capacity.cellsPerSide, capacity.instancesPerCell) != nullptr,
        "the vegetation field binds from the arena");

  engine::witness::phase2World();
  engine::witness::phase3Bridge();
  engine::witness::phase4Pools();
  engine::witness::phase5Planet();
  engine::witness::phase6Vegetation();
  engine::witness::phase7Codecs();
  engine::witness::phase8Resources();

  check(engine::pool::failures() == 0, "no pool allocation failed during the run");
  return engine::test::finish();
}
