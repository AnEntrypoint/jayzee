#include "textures.h"

#include <cmath>
#include <cstring>

namespace engine::handles {

bool bindTable(Table& table, void* metadata, std::uint32_t capacity) {
  if (metadata == nullptr || capacity < 1 || capacity > kMaxSlots) return false;
  if ((reinterpret_cast<std::uintptr_t>(metadata) & 7u) != 0) return false;
  table.freeStack = static_cast<std::uint32_t*>(metadata);
  table.generation = reinterpret_cast<std::uint16_t*>(table.freeStack + capacity);
  table.live = reinterpret_cast<std::uint8_t*>(table.generation + capacity);
  table.capacity = capacity;
  table.freeCount = capacity;
  table.retired = 0;
  for (std::uint32_t i = 0; i < capacity; ++i) {
    table.generation[i] = 1;
    table.live[i] = 0;
    table.freeStack[i] = capacity - 1 - i;
  }
  return true;
}

bool acquire(Table& table, std::uint32_t& slot) {
  if (table.freeCount == 0) return false;
  table.freeCount -= 1;
  slot = table.freeStack[table.freeCount];
  table.live[slot] = 1;
  return true;
}

void release(Table& table, std::uint32_t slot) {
  table.live[slot] = 0;
  if (table.generation[slot] == kLastGeneration) {
    table.generation[slot] = kRetiredGeneration;
    table.retired += 1;
    return;
  }
  table.generation[slot] = static_cast<std::uint16_t>(table.generation[slot] + 1);
  table.freeStack[table.freeCount] = slot;
  table.freeCount += 1;
}

double handleOf(const Table& table, std::uint32_t slot) {
  return static_cast<double>(table.generation[slot]) * static_cast<double>(kSpan) + static_cast<double>(slot);
}

bool wholeHandle(double value, std::uint32_t& out) {
  if (!(value >= 0.0 && value <= 4294967295.0)) return false;
  if (value != std::floor(value)) return false;
  out = static_cast<std::uint32_t>(value);
  return true;
}

bool resolve(const Table& table, std::uint32_t handle, std::uint32_t& slot) {
  const std::uint32_t candidate = handle % kSpan;
  const std::uint32_t generation = handle / kSpan;
  if (candidate >= table.capacity) return false;
  if (table.live[candidate] != 1) return false;
  if (table.generation[candidate] != generation) return false;
  slot = candidate;
  return true;
}

std::uint32_t liveCount(const Table& table) {
  return table.capacity - table.freeCount - table.retired;
}

}

namespace engine::textures {

namespace {

handles::Table gTable{};
Slot* gSlots = nullptr;
bool gBound = false;

bool wholeIn(double value, double low, double high, std::uint32_t& out) {
  if (!(value >= low && value <= high)) return false;
  if (value != std::floor(value)) return false;
  out = static_cast<std::uint32_t>(value);
  return true;
}

bool knownFormat(std::uint32_t format) {
  return format == kFormatRgba8Unorm || format == kFormatRgba8Srgb;
}

}

Status bind(void* base, std::uint32_t capacity) {
  if (gBound) return kRange;
  if (base == nullptr || (reinterpret_cast<std::uintptr_t>(base) & 7u) != 0) return kRange;
  if (capacity < 1 || capacity > handles::kMaxSlots) return kRange;
  gSlots = static_cast<Slot*>(base);
  std::memset(gSlots, 0, static_cast<std::size_t>(capacity) * sizeof(Slot));
  void* metadata = static_cast<std::uint8_t*>(base) + static_cast<std::size_t>(capacity) * sizeof(Slot);
  if (!handles::bindTable(gTable, metadata, capacity)) return kRange;
  gBound = true;
  return kOk;
}

bool bound() {
  return gBound;
}

std::uint32_t capacity() {
  return gTable.capacity;
}

std::uint32_t liveCount() {
  return handles::liveCount(gTable);
}

double add(double width, double height, double format) {
  if (!gBound) return kNotConfigured;
  std::uint32_t w = 0;
  std::uint32_t h = 0;
  std::uint32_t f = 0;
  if (!wholeIn(width, 1.0, static_cast<double>(kMaxDimension), w)) return kRange;
  if (!wholeIn(height, 1.0, static_cast<double>(kMaxDimension), h)) return kRange;
  if (!wholeIn(format, 0.0, 4294967295.0, f) || !knownFormat(f)) return kRange;
  std::uint32_t slot = 0;
  if (!handles::acquire(gTable, slot)) return kFull;
  gSlots[slot] = Slot{slot, w, h, f};
  return handles::handleOf(gTable, slot);
}

Status remove(double handle) {
  if (!gBound) return kNotConfigured;
  std::uint32_t h = 0;
  std::uint32_t slot = 0;
  if (!handles::wholeHandle(handle, h) || !handles::resolve(gTable, h, slot)) return kBadId;
  gSlots[slot] = Slot{0, 0, 0, 0};
  handles::release(gTable, slot);
  return kOk;
}

bool isLive(double handle) {
  std::uint32_t h = 0;
  std::uint32_t slot = 0;
  return gBound && handles::wholeHandle(handle, h) && handles::resolve(gTable, h, slot);
}

int layer(double handle) {
  std::uint32_t h = 0;
  std::uint32_t slot = 0;
  if (!gBound || !handles::wholeHandle(handle, h) || !handles::resolve(gTable, h, slot)) return -1;
  return static_cast<int>(gSlots[slot].layer);
}

}
