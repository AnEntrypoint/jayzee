#include <emscripten/threading.h>

#include <cerrno>
#include <cmath>
#include <cstdint>

extern "C" {
int _emscripten_thread_supports_atomics_wait(void);
void _emscripten_yield(double now);
}

namespace {

constexpr double kSpinsPerMillisecond = 20000.0;
constexpr std::uint64_t kUnboundedSpins = ~std::uint64_t{0};

std::uint64_t spinBudget(double maxWaitMilliseconds) {
  if (!(maxWaitMilliseconds >= 0.0)) return kUnboundedSpins;
  if (maxWaitMilliseconds == INFINITY) return kUnboundedSpins;
  const double spins = maxWaitMilliseconds * kSpinsPerMillisecond;
  if (spins >= 18446744073709551615.0) return kUnboundedSpins;
  return static_cast<std::uint64_t>(spins);
}

int spinWait(volatile void* addr, std::uint32_t val, double maxWaitMilliseconds) {
  const std::uint64_t budget = spinBudget(maxWaitMilliseconds);
  for (std::uint64_t spin = 0; spin < budget; ++spin) {
    _emscripten_yield(0);
    if (__atomic_load_n(reinterpret_cast<const std::uint32_t*>(addr), __ATOMIC_SEQ_CST) != val) return -EWOULDBLOCK;
  }
  return -ETIMEDOUT;
}

}

extern "C" int emscripten_futex_wait(volatile void* addr, std::uint32_t val, double maxWaitMilliseconds) {
  if ((reinterpret_cast<std::intptr_t>(addr) & 3) != 0) return -EINVAL;
  _emscripten_yield(0);
  if (!_emscripten_thread_supports_atomics_wait()) return spinWait(addr, val, maxWaitMilliseconds);
  std::int64_t maxWaitNs = -1;
  if (maxWaitMilliseconds != INFINITY && maxWaitMilliseconds >= 0.0) {
    maxWaitNs = static_cast<std::int64_t>(maxWaitMilliseconds * 1000.0 * 1000.0);
  }
  const int ret = __builtin_wasm_memory_atomic_wait32(reinterpret_cast<int*>(addr), static_cast<int>(val), maxWaitNs);
  if (ret == 1) return -EWOULDBLOCK;
  if (ret == 2) return -ETIMEDOUT;
  return 0;
}
