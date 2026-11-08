#ifndef ENGINE_SNAPSHOT_DELTA_H
#define ENGINE_SNAPSHOT_DELTA_H

#include <cstddef>
#include <cstdint>

#include "codec.h"

namespace engine::snapshot {

constexpr std::size_t kHeaderBytes = 16;
constexpr std::size_t kIndexBytes = 4;
constexpr std::size_t kRecordBytes = kIndexBytes + codec::kEntityBytes;
constexpr std::size_t kRemovedBytes = kIndexBytes;

constexpr std::size_t segmentBytesFor(std::uint32_t visible) {
  return kHeaderBytes + static_cast<std::size_t>(visible) * (kRecordBytes + kRemovedBytes);
}

struct Ring {
  std::uint32_t visible;
  std::uint32_t depth;
  std::uint32_t* ticks;
  std::uint32_t* counts;
  std::uint32_t* indices;
  std::uint8_t* records;
  std::uint8_t* segments;
};

struct Slot {
  std::uint32_t* tick;
  std::uint32_t* count;
  std::uint32_t* indices;
  std::uint8_t* records;
};

Slot slotOf(const Ring& ring, std::uint32_t client, std::uint32_t slot);
std::uint8_t* segmentOf(const Ring& ring, std::uint32_t client);
std::int32_t findSlot(const Ring& ring, std::uint32_t client, std::uint32_t filled, std::uint32_t tick);
bool encodeRecord(const double* positions, const double* velocities, std::uint32_t body, std::uint8_t* out);
std::int32_t encodeDelta(const Ring& ring, std::uint32_t client, std::uint32_t current, std::uint32_t baseline);

}

#endif
