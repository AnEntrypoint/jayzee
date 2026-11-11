#include <cstdint>
#include <memory>

#include "harness.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr std::uint32_t kRetireCapacity = 2;
constexpr std::uint32_t kRetireCycles = kLastGeneration + 1u;
constexpr std::uint32_t kChurnCapacity = 64;
constexpr std::uint32_t kChurnBatchSize = 16;
constexpr std::uint32_t kChurnBatches = 625;
constexpr std::uint32_t kChurnBodies = kChurnBatchSize * kChurnBatches;
constexpr std::uint32_t kWarmupBatches = 8;
constexpr std::uint32_t kStepEvery = 64;
constexpr std::uint32_t kTickRate = 60;
constexpr std::uint32_t kIterations = 10;
constexpr float kGravity = -9.81f;
constexpr float kDrag = 0.0f;
constexpr float kRadius = 0.5f;
constexpr float kRestitution = 0.0f;
constexpr float kDropHeight = 5.0f;
constexpr float kSpacing = 1.0f;

std::uint32_t retireHandles[kRetireCycles];
std::uint32_t churnHandles[kChurnBodies];

std::unique_ptr<World> makeWorld(std::uint32_t capacity, Status& status) {
  std::unique_ptr<World> w = std::make_unique<World>();
  w->bind(engine::test::witnessCapacity());
  status = w->configure(Config{capacity, kTickRate, kGravity, kDrag, kRadius, kRestitution, kIterations});
  return w;
}

void fillRows(double* rows, std::uint32_t count) {
  for (std::uint32_t i = 0; i < count; ++i) {
    double* row = rows + i * kBatchWords;
    row[0] = static_cast<float>(i) * kSpacing;
    row[1] = kDropHeight;
    row[2] = 0.0f;
    row[3] = 0.0f;
    row[4] = 0.0f;
    row[5] = 0.0f;
  }
}

bool allRefused(World& w, const std::uint32_t* handles, std::uint32_t count) {
  bool refused = true;
  for (std::uint32_t i = 0; i < count; ++i) {
    if (w.despawn(handles[i]) != kBadId) refused = false;
  }
  return refused;
}

void staleGenerationRefused() {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(kRetireCapacity, status);
  check(status == kOk, "phase 4: a capacity-2 pool configures");
  const double position[3] = {0.0f, kDropHeight, 0.0f};
  const double velocity[3] = {0.0f, 0.0f, 0.0f};
  const std::uint32_t handle = static_cast<std::uint32_t>(w->spawn(position, velocity));
  check(w->despawn(handle ^ (1u << 16)) == kBadId, "phase 4: a handle with the wrong generation is refused");
  check(w->despawn(handle) == kOk, "phase 4: the live handle still despawns");
}

void retirement() {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(kRetireCapacity, status);
  const double position[3] = {0.0f, kDropHeight, 0.0f};
  const double velocity[3] = {0.0f, 0.0f, 0.0f};
  bool everyCycleOk = true;
  bool immediateRefused = true;
  std::uint32_t retiredBeforeLast = 0xffffffffu;
  for (std::uint32_t cycle = 0; cycle < kRetireCycles; ++cycle) {
    const std::int64_t spawned = w->spawn(position, velocity);
    if (spawned < 0) {
      everyCycleOk = false;
      break;
    }
    const std::uint32_t handle = static_cast<std::uint32_t>(spawned);
    retireHandles[cycle] = handle;
    if (w->despawn(handle) != kOk) everyCycleOk = false;
    if (w->despawn(handle) != kBadId) immediateRefused = false;
    if (cycle + 1 == kRetireCycles - 1) retiredBeforeLast = w->retiredSlots();
  }
  check(everyCycleOk, "phase 4: 65535 spawn and despawn cycles on one slot all succeed");
  check(immediateRefused, "phase 4: a despawned handle is refused by a second despawn");
  check(retiredBeforeLast == 0, "phase 4: no slot retires before its generation 65534 despawn");
  check(w->retiredSlots() == 1, "phase 4: the slot retires on its generation 65534 despawn");
  check((retireHandles[kRetireCycles - 1] >> 16) == kLastGeneration, "phase 4: the last issued handle carries generation 65534");
  check(allRefused(*w, retireHandles, kRetireCycles), "phase 4: every issued handle is refused after its slot was reused");
  const std::int64_t next = w->spawn(position, velocity);
  check(next >= 0 && (static_cast<std::uint32_t>(next) & kSlotMask) == 1, "phase 4: the next spawn lands in slot 1");
  check(w->spawn(position, velocity) < 0, "phase 4: with the retired slot out of use, a further spawn is refused");
  observe("phase 4: retired slots after 65535 cycles of one slot", static_cast<double>(w->retiredSlots()));
}

void churn() {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(kChurnCapacity, status);
  check(status == kOk, "phase 4: a 64-body pool configures");
  double rows[kChurnBatchSize * kBatchWords];
  fillRows(rows, kChurnBatchSize);
  std::uint32_t handles[kChurnBatchSize];

  for (std::uint32_t b = 0; b < kWarmupBatches; ++b) {
    w->spawnBatch(rows, kChurnBatchSize, handles);
    w->step(1);
    for (std::uint32_t i = 0; i < kChurnBatchSize; ++i) w->despawn(handles[i]);
  }

  markWarmup();
  bool batchesOk = true;
  for (std::uint32_t b = 0; b < kChurnBatches; ++b) {
    if (w->spawnBatch(rows, kChurnBatchSize, handles) != static_cast<int>(kChurnBatchSize)) batchesOk = false;
    for (std::uint32_t i = 0; i < kChurnBatchSize; ++i) churnHandles[b * kChurnBatchSize + i] = handles[i];
    if (b % kStepEvery == 0) w->step(1);
    for (std::uint32_t i = 0; i < kChurnBatchSize; ++i) {
      if (w->despawn(handles[i]) != kOk) batchesOk = false;
    }
  }
  check(batchesOk, "phase 4: 10000 spawns and despawns in batches of 16 all succeed");
  observe("phase 4: allocations since warm-up over 10000 body cycles", static_cast<double>(allocationsSinceWarmup()));
  check(allocationsSinceWarmup() == 0, "phase 4: zero allocations after warm-up over 10000 spawn and despawn cycles");
  check(w->count() == 0, "phase 4: no body remains after the churn");
  check(w->retiredSlots() == 0, "phase 4: no slot retires during the churn");
  check(allRefused(*w, churnHandles, kChurnBodies), "phase 4: every churned handle is refused after its slot was reused");
}

}

void phase4Pools() {
  staleGenerationRefused();
  retirement();
  churn();
}

}
