#include "arena.h"

#include <cstdint>

namespace engine::arena {

namespace {

alignas(64) std::uint8_t storage[kBytes];
std::size_t offset = 0;
std::uint64_t carveCount = 0;
bool sealedFlag = false;

}

void* carve(std::size_t bytes, std::size_t alignment) {
  if (sealedFlag) return nullptr;
  if (alignment == 0 || (alignment & (alignment - 1)) != 0) return nullptr;
  const std::uintptr_t base = reinterpret_cast<std::uintptr_t>(storage);
  const std::uintptr_t cursor = base + offset;
  const std::uintptr_t start = (cursor + alignment - 1) & ~(static_cast<std::uintptr_t>(alignment) - 1);
  const std::size_t end = static_cast<std::size_t>(start - base) + bytes;
  if (end < offset || end > kBytes) return nullptr;
  offset = end;
  carveCount += 1;
  return reinterpret_cast<void*>(start);
}

std::size_t used() {
  return offset;
}

std::uint64_t carves() {
  return carveCount;
}

void seal() {
  sealedFlag = true;
}

bool sealed() {
  return sealedFlag;
}

}
