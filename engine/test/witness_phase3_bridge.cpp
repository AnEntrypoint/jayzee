#include <cmath>
#include <cstddef>
#include <cstdint>

#include "arena.h"
#include "bridge.h"
#include "harness.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr std::uint32_t kCapacity = 64;
constexpr std::uint32_t kTickRate = 60;
constexpr std::uint32_t kBatchSteps = 60;
constexpr std::uint32_t kBatches = 1000;
constexpr std::uint32_t kWarmupBatches = 10;
constexpr std::uint32_t kWarmupBodies = 8;
constexpr float kInputVelocity = 6.0f;
constexpr double kInputTolerance = 0.05;
constexpr std::uint32_t kUnknownBody = 1000;
constexpr std::size_t kCursorProbeBytes = 8;
constexpr std::size_t kCursorProbeAlignment = 8;
constexpr std::uint32_t kInputSeq = 1;
constexpr std::uint32_t kRejectedSeq = 2;

std::uint32_t engineTickCalls = 0;

Config batchConfig() {
  return Config{kCapacity, kTickRate, 0.0f, 0.0f, 0.5f, 0.0f, 10};
}

void tick(std::uint32_t steps) {
  engineTickCalls += 1;
  bridge::tickBatch(steps);
}

void pushInput(std::uint32_t seq, std::uint32_t body, float vx, float vy, float vz) {
  std::uint32_t* control = bridge::controlWords();
  bridge::InputSlot& slot = bridge::inputSlots()[control[bridge::kInputHead] % bridge::inputSlotCount()];
  slot = bridge::InputSlot{seq, body, vx, vy, vz};
  control[bridge::kInputHead] += 1;
}

void drainEvents() {
  std::uint32_t* control = bridge::controlWords();
  control[bridge::kEventTail] = control[bridge::kEventHead];
}

void batchCallRule() {
  std::uint32_t* control = bridge::controlWords();
  check(world().configure(batchConfig()) == kOk, "phase 3: the bridge world configures");
  const std::uint32_t epoch0 = control[bridge::kEpoch];
  const std::uint64_t tick0 = world().tick();
  const std::uint32_t calls0 = engineTickCalls;
  for (std::uint32_t b = 0; b < kBatches; ++b) {
    tick(kBatchSteps);
  }
  check(engineTickCalls - calls0 == kBatches, "phase 3: one engine_tick call per batch, counted over 1000 batches");
  check(control[bridge::kEpoch] - epoch0 == kBatches, "phase 3: the epoch advances once per batch");
  check(world().tick() - tick0 == static_cast<std::uint64_t>(kBatches) * kBatchSteps,
        "phase 3: each batch advances the tick by its step count");
}

void inputAtBatchStart() {
  std::uint32_t* control = bridge::controlWords();
  check(world().configure(batchConfig()) == kOk, "phase 3: the input world configures");
  const double position[3] = {0.0f, 2.0f, 0.0f};
  const double velocity[3] = {0.0f, 0.0f, 0.0f};
  const std::int64_t handle = world().spawn(position, velocity);
  check(handle == 0, "phase 3: the input target is handle 0");
  drainEvents();
  const std::uint32_t head0 = control[bridge::kEventHead];
  pushInput(kInputSeq, 0, kInputVelocity, 0.0f, 0.0f);
  tick(kBatchSteps);
  const double expected = static_cast<double>(kInputVelocity) * kBatchSteps / kTickRate;
  const double x = world().positions()[0];
  observe("phase 3: body x after one batch with a 6 m/s input", x);
  check(std::fabs(x - expected) <= kInputTolerance, "phase 3: an input applies at batch start, so the whole batch moves at its speed");
  const std::uint32_t head1 = control[bridge::kEventHead];
  check(head1 - head0 == 2, "phase 3: an applied input produces two events in its batch");
  check(bridge::eventSlots()[head0 % bridge::eventSlotCount()].kind == bridge::kEventInputApplied,
        "phase 3: the first event of the batch is INPUT_APPLIED");
  check(bridge::eventSlots()[(head0 + 1) % bridge::eventSlotCount()].kind == bridge::kEventTicked,
        "phase 3: the second event of the batch is TICKED");
}

void rejectedInput() {
  std::uint32_t* control = bridge::controlWords();
  drainEvents();
  const std::uint32_t head0 = control[bridge::kEventHead];
  pushInput(kRejectedSeq, kUnknownBody, 1.0f, 0.0f, 0.0f);
  tick(1);
  const bridge::EventSlot& event = bridge::eventSlots()[head0 % bridge::eventSlotCount()];
  check(event.kind == bridge::kEventInputRejected && event.a == kUnknownBody,
        "phase 3: an input naming a body that does not exist is rejected with an event");
}

void oneTickedEventPerBatch() {
  std::uint32_t* control = bridge::controlWords();
  check(world().configure(batchConfig()) == kOk, "phase 3: the event world configures");
  drainEvents();
  const std::uint32_t droppedBefore = control[bridge::kEventDropped];
  std::uint32_t wrongCounts = 0;
  for (std::uint32_t b = 0; b < kBatches; ++b) {
    const std::uint32_t head0 = control[bridge::kEventHead];
    tick(kBatchSteps);
    const std::uint32_t head1 = control[bridge::kEventHead];
    std::uint32_t ticked = 0;
    for (std::uint32_t i = head0; i != head1; ++i) {
      if (bridge::eventSlots()[i % bridge::eventSlotCount()].kind == bridge::kEventTicked) ticked += 1;
    }
    if (ticked != 1) wrongCounts += 1;
    drainEvents();
  }
  check(wrongCounts == 0, "phase 3: exactly one TICKED event per batch, over 1000 batches");
  check(control[bridge::kEventDropped] == droppedBefore, "phase 3: no event is dropped when the host drains each batch");
}

void regionLayout() {
  const World& w = world();
  const std::uintptr_t transformsBegin = reinterpret_cast<std::uintptr_t>(w.transforms());
  const std::uintptr_t transformsEnd = transformsBegin + static_cast<std::uintptr_t>(w.bodyCapacity()) * sizeof(Transform);
  const std::uintptr_t positionsBegin = reinterpret_cast<std::uintptr_t>(w.positions());
  const std::uintptr_t positionsEnd = positionsBegin + static_cast<std::uintptr_t>(w.bodyCapacity()) * 3 * sizeof(double);
  const std::uintptr_t cursor = reinterpret_cast<std::uintptr_t>(arena::carve(kCursorProbeBytes, kCursorProbeAlignment));
  check(transformsBegin != 0 && transformsEnd <= cursor, "phase 3: the transform region lies below the arena cursor");
  check(transformsBegin % 4 == 0, "phase 3: the transform region is 4-byte aligned");
  check(transformsEnd <= positionsBegin || positionsEnd <= transformsBegin,
        "phase 3: the transform region does not overlap the position region");
  check(reinterpret_cast<std::uintptr_t>(bridge::controlWords()) % 4 == 0 &&
            reinterpret_cast<std::uintptr_t>(bridge::inputSlots()) % 4 == 0 &&
            reinterpret_cast<std::uintptr_t>(bridge::eventSlots()) % 4 == 0,
        "phase 3: the control, input and event regions are 4-byte aligned");
  check(sizeof(bridge::InputSlot) == 20 && sizeof(bridge::EventSlot) == 16, "phase 3: input slots are 20 bytes and event slots 16 bytes");
  check(bridge::inputSlotCount() == engine::test::witnessCapacity().players * engine::test::witnessCapacity().inputDepth,
        "phase 3: the input ring holds players times input depth slots");
  check(bridge::eventSlotCount() == engine::test::witnessCapacity().eventSlots, "phase 3: the event ring holds the budgeted slot count");
}

void noAllocationAfterWarmup() {
  check(world().configure(batchConfig()) == kOk, "phase 3: the allocation world configures");
  const double velocity[3] = {0.0f, 0.0f, 0.0f};
  for (std::uint32_t i = 0; i < kWarmupBodies; ++i) {
    const double position[3] = {static_cast<float>(i) * 1.5f, 2.0f, 0.0f};
    world().spawn(position, velocity);
  }
  for (std::uint32_t b = 0; b < kWarmupBatches; ++b) {
    tick(kBatchSteps);
  }
  markWarmup();
  const std::uint64_t carves0 = arena::carves();
  for (std::uint32_t b = 0; b < kBatches; ++b) {
    tick(kBatchSteps);
  }
  check(arena::carves() == carves0, "phase 3: no arena carve happens across 1000 batches after warm-up");
  check(allocationsSinceWarmup() == 0, "phase 3: no allocation happens across 1000 batches after warm-up");
}

}

void phase3Bridge() {
  batchCallRule();
  inputAtBatchStart();
  rejectedInput();
  oneTickedEventPerBatch();
  regionLayout();
  noAllocationAfterWarmup();
}

}
