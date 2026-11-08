#ifndef ENGINE_TEST_HARNESS_H
#define ENGINE_TEST_HARNESS_H

#include <cstdint>
#include <cstdio>

#include "arena.h"
#include "budget.h"

namespace engine::test {

constexpr std::uint32_t kWitnessPlayers = 1;
constexpr std::uint32_t kWitnessWorkers = 1;
constexpr std::uint32_t kWitnessAlignment = 8;

inline budget::Capacity& witnessCapacity() {
  static budget::Capacity capacity{};
  return capacity;
}

inline int& failureCount() {
  static int count = 0;
  return count;
}

inline void check(bool ok, const char* label) {
  if (!ok) failureCount() += 1;
  std::printf("%s %s\n", ok ? "PASS" : "FAIL", label);
}

inline void observe(const char* label, double value) {
  std::printf("INFO %s %.12g\n", label, value);
}

inline void observeHex(const char* label, std::uint64_t value) {
  std::printf("INFO %s 0x%016llx\n", label, static_cast<unsigned long long>(value));
}

inline void observeText(const char* label, const char* text) {
  std::printf("INFO %s %s\n", label, text);
}

inline int finish() {
  const int failures = failureCount();
  if (failures == 0) {
    std::printf("RESULT: PASS\n");
  } else {
    std::printf("RESULT: FAIL %d\n", failures);
  }
  return failures == 0 ? 0 : 1;
}

}

#endif
