#include "bridge.h"

#include "planet_frame.h"
#include "world.h"

namespace engine::bridge {

namespace {

alignas(8) std::uint32_t control[kControlWords];
InputSlot inputs[kInputSlots];
EventSlot events[kEventSlots];

void pushEvent(EventKind kind, std::uint32_t a, std::uint32_t b) {
  const std::uint32_t head = control[kEventHead];
  if (head - control[kEventTail] >= kEventSlots) {
    control[kEventDropped] += 1;
    return;
  }
  events[head % kEventSlots] = EventSlot{kind, a, b, 0};
  control[kEventHead] = head + 1;
}

void drainInputs() {
  World& w = world();
  while (control[kInputTail] != control[kInputHead]) {
    const InputSlot& slot = inputs[control[kInputTail] % kInputSlots];
    const float velocity[3] = {slot.vx, slot.vy, slot.vz};
    const bool applied = w.setVelocity(slot.body, velocity) == kOk;
    pushEvent(applied ? kEventInputApplied : kEventInputRejected, slot.body, slot.seq);
    control[kInputTail] += 1;
  }
}

}

std::uint32_t* controlWords() {
  return control;
}

InputSlot* inputSlots() {
  return inputs;
}

EventSlot* eventSlots() {
  return events;
}

void tickBatch(std::uint32_t steps) {
  control[kEpoch] += 1;
  planet::state().pages.applyPending();
  drainInputs();
  World& w = world();
  w.step(steps);
  control[kBodyCount] = w.count();
  control[kTickLow] = static_cast<std::uint32_t>(w.tick());
  control[kTickHigh] = static_cast<std::uint32_t>(w.tick() >> 32);
  pushEvent(kEventTicked, steps, control[kTickLow]);
}

}
