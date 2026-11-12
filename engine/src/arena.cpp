#include "arena.h"

#include <cstdint>

#if defined(__EMSCRIPTEN__)
#include <unistd.h>
#endif

namespace engine::arena {

namespace {

constexpr std::size_t kAlignment = 64;

#if defined(__EMSCRIPTEN__)
std::uint8_t* reserve() {
  void* raw = sbrk(static_cast<std::intptr_t>(kBytes + kAlignment));
  if (raw == reinterpret_cast<void*>(-1)) return nullptr;
  return reinterpret_cast<std::uint8_t*>((reinterpret_cast<std::uintptr_t>(raw) + kAlignment - 1) & ~(static_cast<std::uintptr_t>(kAlignment) - 1));
}

std::uint8_t* const storage = reserve();
#else
alignas(kAlignment) std::uint8_t storage[kBytes];
#endif
std::size_t offset = 0;
std::uint64_t carveCount = 0;
bool sealedFlag = false;

}

void* carve(std::size_t bytes, std::size_t alignment) {
  if (sealedFlag || storage == nullptr) return nullptr;
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
