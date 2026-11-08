#include "snapshot_delta.h"

#include <algorithm>
#include <cstring>

namespace engine::snapshot {

namespace {

constexpr double kUnitScale[3] = {1.0, 1.0, 1.0};

void putU32(std::uint8_t* at, std::uint32_t value) {
  at[0] = static_cast<std::uint8_t>(value);
  at[1] = static_cast<std::uint8_t>(value >> 8);
  at[2] = static_cast<std::uint8_t>(value >> 16);
  at[3] = static_cast<std::uint8_t>(value >> 24);
}

std::size_t slotNumber(const Ring& ring, std::uint32_t client, std::uint32_t slot) {
  return static_cast<std::size_t>(client) * ring.depth + slot;
}

}

Slot slotOf(const Ring& ring, std::uint32_t client, std::uint32_t slot) {
  const std::size_t n = slotNumber(ring, client, slot);
  const std::size_t visible = ring.visible;
  return Slot{ring.ticks + n, ring.counts + n, ring.indices + n * visible, ring.records + n * visible * codec::kEntityBytes};
}

std::uint8_t* segmentOf(const Ring& ring, std::uint32_t client) {
  return ring.segments + static_cast<std::size_t>(client) * segmentBytesFor(ring.visible);
}

std::int32_t findSlot(const Ring& ring, std::uint32_t client, std::uint32_t filled, std::uint32_t tick) {
  for (std::uint32_t slot = 0; slot < filled; ++slot) {
    if (*slotOf(ring, client, slot).tick == tick) return static_cast<std::int32_t>(slot);
  }
  return -1;
}

bool encodeRecord(const double* positions, const double* velocities, std::uint32_t body, std::uint8_t* out) {
  return codec::encodeEntity(positions + 3 * static_cast<std::size_t>(body), velocities + 3 * static_cast<std::size_t>(body), 0.0, kUnitScale,
                             0.0, out);
}

std::int32_t encodeDelta(const Ring& ring, std::uint32_t client, std::uint32_t current, std::uint32_t baseline) {
  const Slot now = slotOf(ring, client, current);
  const Slot base = slotOf(ring, client, baseline);
  std::uint8_t* out = segmentOf(ring, client);
  const std::size_t visible = ring.visible;

  std::uint32_t records = 0;
  for (std::uint32_t j = 0; j < *now.count; ++j) {
    const std::uint32_t body = now.indices[j];
    const std::uint32_t* found = std::lower_bound(base.indices, base.indices + *base.count, body);
    const std::uint32_t at = static_cast<std::uint32_t>(found - base.indices);
    const bool unchanged = at < *base.count && *found == body &&
                           std::memcmp(now.records + static_cast<std::size_t>(j) * codec::kEntityBytes,
                                       base.records + static_cast<std::size_t>(at) * codec::kEntityBytes, codec::kEntityBytes) == 0;
    if (unchanged) continue;
    std::uint8_t* row = out + kHeaderBytes + static_cast<std::size_t>(records) * kRecordBytes;
    putU32(row, body);
    std::memcpy(row + kIndexBytes, now.records + static_cast<std::size_t>(j) * codec::kEntityBytes, codec::kEntityBytes);
    records += 1;
  }

  std::uint32_t removed = 0;
  std::uint8_t* removedAt = out + kHeaderBytes + visible * kRecordBytes;
  for (std::uint32_t j = 0; j < *base.count; ++j) {
    const std::uint32_t body = base.indices[j];
    const std::uint32_t* found = std::lower_bound(now.indices, now.indices + *now.count, body);
    if (found != now.indices + *now.count && *found == body) continue;
    putU32(removedAt + static_cast<std::size_t>(removed) * kRemovedBytes, body);
    removed += 1;
  }

  putU32(out, *now.tick);
  putU32(out + 4, *base.tick);
  putU32(out + 8, records);
  putU32(out + 12, removed);
  return static_cast<std::int32_t>(kHeaderBytes + static_cast<std::size_t>(records) * kRecordBytes +
                                   static_cast<std::size_t>(removed) * kRemovedBytes);
}

}
