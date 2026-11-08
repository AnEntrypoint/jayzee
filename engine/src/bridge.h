#ifndef ENGINE_BRIDGE_H
#define ENGINE_BRIDGE_H

#include <cstdint>

namespace engine::bridge {

constexpr std::uint32_t kInputSlots = 256;
constexpr std::uint32_t kEventSlots = 256;
constexpr std::uint32_t kControlWords = 16;

enum ControlWord : std::uint32_t {
  kInputHead = 0,
  kInputTail = 1,
  kEpoch = 2,
  kEventHead = 3,
  kEventTail = 4,
  kEventDropped = 5,
  kBodyCount = 6,
  kTickLow = 7,
  kTickHigh = 8,
};

enum EventKind : std::uint32_t {
  kEventInputApplied = 1,
  kEventInputRejected = 2,
  kEventTicked = 3,
};

struct InputSlot {
  std::uint32_t seq;
  std::uint32_t body;
  float vx;
  float vy;
  float vz;
};

struct EventSlot {
  std::uint32_t kind;
  std::uint32_t a;
  std::uint32_t b;
  std::uint32_t c;
};

static_assert(sizeof(InputSlot) == 20);
static_assert(sizeof(EventSlot) == 16);

std::uint32_t* controlWords();
InputSlot* inputSlots();
EventSlot* eventSlots();
void tickBatch(std::uint32_t steps);

}

#endif
