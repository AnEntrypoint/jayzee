#include "bridge.h"

#include "arena.h"
#include "planet_frame.h"
#include "world.h"

namespace engine::bridge {

namespace {

alignas(8) std::uint32_t control[kControlWords];
InputSlot* inputs = nullptr;
EventSlot* events = nullptr;
std::uint32_t inputCount = 0;
std::uint32_t eventCount = 0;

void pushEvent(EventKind kind, std::uint32_t a, std::uint32_t b) {
  const std::uint32_t head = control[kEventHead];
  if (head - control[kEventTail] >= eventCount) {
    control[kEventDropped] += 1;
    return;
  }
  events[head % eventCount] = EventSlot{kind, a, b, 0};
  control[kEventHead] = head + 1;
}

void drainInputs() {
  World& w = world();
  while (control[kInputTail] != control[kInputHead]) {
    const InputSlot& slot = inputs[control[kInputTail] % inputCount];
    const float velocity[3] = {slot.vx, slot.vy, slot.vz};
    const bool applied = w.setVelocity(slot.body, velocity) == kOk;
    pushEvent(applied ? kEventInputApplied : kEventInputRejected, slot.body, slot.seq);
    control[kInputTail] += 1;
  }
}

}

Status bind(const budget::Capacity& capacity) {
  if (inputs != nullptr) return kAlreadyInitialized;
  const std::size_t slots = static_cast<std::size_t>(capacity.players) * capacity.inputDepth;
  inputs = static_cast<InputSlot*>(arena::carve(sizeof(InputSlot) * slots, alignof(InputSlot)));
  events = static_cast<EventSlot*>(arena::carve(sizeof(EventSlot) * capacity.eventSlots, alignof(EventSlot)));
  if (inputs == nullptr || events == nullptr) return kFull;
  inputCount = static_cast<std::uint32_t>(slots);
  eventCount = capacity.eventSlots;
  return kOk;
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

std::uint32_t inputSlotCount() {
  return inputCount;
}

std::uint32_t eventSlotCount() {
  return eventCount;
}

void tickBatch(std::uint32_t steps) {
  if (inputs == nullptr) return;
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
