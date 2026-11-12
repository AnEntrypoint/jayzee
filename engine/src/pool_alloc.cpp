#include <Jolt/Jolt.h>

#include <Jolt/Core/Memory.h>

#include <cstring>

#include "arena.h"
#include "pool_alloc.h"

namespace engine::pool {

namespace {

constexpr std::uint32_t kLargeClass = 0;
constexpr std::size_t kBlockAlignment = 16;
constexpr std::size_t kPointerBytes = sizeof(void*);

void* freeHeads[kClasses];
void* largeHead = nullptr;
std::uint64_t failureCount = 0;

std::uint32_t& classField(char* raw) {
  return *reinterpret_cast<std::uint32_t*>(raw);
}

std::uint64_t& capacityField(char* raw) {
  return *reinterpret_cast<std::uint64_t*>(raw + 8);
}

void*& linkField(char* raw) {
  return *reinterpret_cast<void**>(raw + kBlockHeaderBytes);
}

std::uint32_t classOf(std::size_t total) {
  for (std::uint32_t c = kMinClass; c <= kMaxClass; ++c) {
    if ((std::size_t(1) << c) >= total) return c;
  }
  return kLargeClass;
}

char* carveBlock(std::size_t capacity) {
  void* raw = arena::carve(capacity, kBlockAlignment);
  if (raw == nullptr) failureCount += 1;
  return static_cast<char*>(raw);
}

char* popFree(std::uint32_t index) {
  char* raw = static_cast<char*>(freeHeads[index]);
  if (raw != nullptr) freeHeads[index] = linkField(raw);
  return raw;
}

char* takeLarge(std::size_t total) {
  void** link = &largeHead;
  while (*link != nullptr) {
    char* raw = static_cast<char*>(*link);
    if (capacityField(raw) >= total) {
      *link = linkField(raw);
      return raw;
    }
    link = &linkField(raw);
  }
  return nullptr;
}

void* joltAllocate(std::size_t size) {
  return allocate(size);
}

void* joltReallocate(void* block, std::size_t oldSize, std::size_t newSize) {
  if (block == nullptr) return allocate(newSize);
  void* next = allocate(newSize);
  if (next == nullptr) return nullptr;
  std::memcpy(next, block, oldSize < newSize ? oldSize : newSize);
  release(block);
  return next;
}

void joltFree(void* block) {
  release(block);
}

void* joltAlignedAllocate(std::size_t size, std::size_t alignment) {
  return allocateAligned(size, alignment);
}

void joltAlignedFree(void* block) {
  releaseAligned(block);
}

}

bool prime(const std::uint32_t (&counts)[kClasses]) {
  for (std::uint32_t i = 0; i < kClasses; ++i) {
    const std::uint32_t c = kMinClass + i;
    for (std::uint32_t k = 0; k < counts[i]; ++k) {
      char* raw = carveBlock(std::size_t(1) << c);
      if (raw == nullptr) return false;
      classField(raw) = c;
      capacityField(raw) = std::size_t(1) << c;
      linkField(raw) = freeHeads[i];
      freeHeads[i] = raw;
    }
  }
  return true;
}

bool refill(const std::uint32_t (&counts)[kClasses]) {
  for (std::uint32_t i = 0; i < kClasses; ++i) {
    std::uint32_t held = 0;
    for (void* block = freeHeads[i]; block != nullptr && held < counts[i]; block = linkField(static_cast<char*>(block))) held += 1;
    const std::uint32_t c = kMinClass + i;
    for (; held < counts[i]; ++held) {
      char* raw = carveBlock(std::size_t(1) << c);
      if (raw == nullptr) return false;
      classField(raw) = c;
      capacityField(raw) = std::size_t(1) << c;
      linkField(raw) = freeHeads[i];
      freeHeads[i] = raw;
    }
  }
  return true;
}

void installJoltHooks() {
  JPH::Allocate = joltAllocate;
  JPH::Reallocate = joltReallocate;
  JPH::Free = joltFree;
  JPH::AlignedAllocate = joltAlignedAllocate;
  JPH::AlignedFree = joltAlignedFree;
}

void* allocate(std::size_t bytes) {
  const std::size_t total = bytes + kBlockHeaderBytes;
  const std::uint32_t c = classOf(total);
  char* raw = nullptr;
  std::size_t capacity = total;
  if (c == kLargeClass) {
    raw = takeLarge(total);
    if (raw != nullptr) capacity = capacityField(raw);
  } else {
    capacity = std::size_t(1) << c;
    raw = popFree(c - kMinClass);
  }
  if (raw == nullptr) {
    raw = carveBlock(capacity);
    if (raw == nullptr) return nullptr;
  }
  classField(raw) = c;
  capacityField(raw) = capacity;
  return raw + kBlockHeaderBytes;
}

void* allocateAligned(std::size_t bytes, std::size_t alignment) {
  if (alignment == 0 || (alignment & (alignment - 1)) != 0) return nullptr;
  char* user = static_cast<char*>(allocate(bytes + alignment + kPointerBytes));
  if (user == nullptr) return nullptr;
  const std::uintptr_t start = reinterpret_cast<std::uintptr_t>(user) + kPointerBytes;
  const std::uintptr_t aligned = (start + alignment - 1) & ~(static_cast<std::uintptr_t>(alignment) - 1);
  reinterpret_cast<void**>(aligned)[-1] = user;
  return reinterpret_cast<void*>(aligned);
}

void release(void* block) {
  if (block == nullptr) return;
  char* raw = static_cast<char*>(block) - kBlockHeaderBytes;
  const std::uint32_t c = classField(raw);
  if (c == kLargeClass) {
    linkField(raw) = largeHead;
    largeHead = raw;
    return;
  }
  const std::uint32_t index = c - kMinClass;
  linkField(raw) = freeHeads[index];
  freeHeads[index] = raw;
}

void releaseAligned(void* block) {
  if (block == nullptr) return;
  release(reinterpret_cast<void**>(block)[-1]);
}

std::uint64_t failures() {
  return failureCount;
}

}
