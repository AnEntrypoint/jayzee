#include "materials.h"

#include <cmath>
#include <cstring>

namespace engine::materials {

namespace {

handles::Table gTable{};
Slot* gSlots = nullptr;
bool gBound = false;

bool unit(float value) {
  return value >= 0.0f && value <= 1.0f;
}

bool nonNegativeFinite(float value) {
  return std::isfinite(value) && value >= 0.0f;
}

Status validate(const Values& values) {
  if (!unit(values.r) || !unit(values.g) || !unit(values.b) || !unit(values.a)) return kRange;
  if (!unit(values.roughness) || !unit(values.metallic)) return kRange;
  if (!nonNegativeFinite(values.emissiveR) || !nonNegativeFinite(values.emissiveG) || !nonNegativeFinite(values.emissiveB)) return kRange;
  std::uint32_t albedo = 0;
  if (!handles::wholeHandle(values.albedo, albedo)) return kRange;
  if (albedo != 0 && !textures::isLive(values.albedo)) return kBadId;
  return kOk;
}

Slot make(const Values& values) {
  std::uint32_t albedo = 0;
  handles::wholeHandle(values.albedo, albedo);
  return Slot{values.r, values.g, values.b, values.a, values.roughness, values.metallic, values.emissiveR, values.emissiveG, values.emissiveB, albedo};
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

std::uint32_t viewOffset() {
  return gBound ? static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(gSlots)) : 0u;
}

std::uint32_t liveCount() {
  return handles::liveCount(gTable);
}

double add(const Values& values) {
  if (!gBound) return kNotConfigured;
  const Status status = validate(values);
  if (status != kOk) return status;
  std::uint32_t slot = 0;
  if (!handles::acquire(gTable, slot)) return kFull;
  gSlots[slot] = make(values);
  return handles::handleOf(gTable, slot);
}

Status set(double handle, const Values& values) {
  if (!gBound) return kNotConfigured;
  const Status status = validate(values);
  if (status != kOk) return status;
  std::uint32_t h = 0;
  std::uint32_t slot = 0;
  if (!handles::wholeHandle(handle, h) || !handles::resolve(gTable, h, slot)) return kBadId;
  gSlots[slot] = make(values);
  return kOk;
}

Status remove(double handle) {
  if (!gBound) return kNotConfigured;
  std::uint32_t h = 0;
  std::uint32_t slot = 0;
  if (!handles::wholeHandle(handle, h) || !handles::resolve(gTable, h, slot)) return kBadId;
  gSlots[slot] = Slot{};
  handles::release(gTable, slot);
  return kOk;
}

bool isLive(double handle) {
  std::uint32_t h = 0;
  std::uint32_t slot = 0;
  return gBound && handles::wholeHandle(handle, h) && handles::resolve(gTable, h, slot);
}

int slot(double handle) {
  std::uint32_t h = 0;
  std::uint32_t index = 0;
  if (!gBound || !handles::wholeHandle(handle, h) || !handles::resolve(gTable, h, index)) return -1;
  return static_cast<int>(index);
}

}
