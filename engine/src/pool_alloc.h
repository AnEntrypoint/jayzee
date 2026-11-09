#ifndef ENGINE_POOL_ALLOC_H
#define ENGINE_POOL_ALLOC_H

#include <cstddef>
#include <cstdint>

namespace engine::pool {

constexpr std::uint32_t kMinClass = 5;
constexpr std::uint32_t kMaxClass = 16;
constexpr std::uint32_t kClasses = kMaxClass - kMinClass + 1;
constexpr std::size_t kBlockHeaderBytes = 16;

constexpr std::uint32_t kPrimeCounts[kClasses] = {64, 64, 64, 64, 64, 16, 16, 16, 4, 4, 4, 4};
constexpr std::uint32_t kLargestIndex = kClasses - 1;
constexpr std::uint64_t kLargestClassBytes = std::uint64_t(1) << kMaxClass;

constexpr std::uint64_t primedBytes() {
  std::uint64_t total = 0;
  for (std::uint32_t i = 0; i < kClasses; ++i) {
    total += static_cast<std::uint64_t>(kPrimeCounts[i]) << (kMinClass + i);
  }
  return total;
}

bool prime(const std::uint32_t (&counts)[kClasses]);
void installJoltHooks();
void* allocate(std::size_t bytes);
void* allocateAligned(std::size_t bytes, std::size_t alignment);
void release(void* block);
void releaseAligned(void* block);
std::uint64_t failures();

}

#endif
