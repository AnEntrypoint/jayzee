#include <emscripten/threading.h>

#include <cerrno>
#include <cmath>
#include <cstdint>
#include <ctime>

extern "C" {
int _emscripten_thread_supports_atomics_wait(void);
void _emscripten_yield(double now);
}

namespace {

constexpr int kWaitKinds = 5;
constexpr int kMainSpinWait = 0;
constexpr int kSpinTimeout = 1;
constexpr int kWorkerWait = 2;
constexpr int kTimedSlice = 3;
constexpr int kYield = 4;
std::uint32_t waitCounts[kWaitKinds] = {0u, 0u, 0u, 0u, 0u};

void countWait(int kind) {
  __atomic_fetch_add(&waitCounts[kind], 1u, __ATOMIC_RELAXED);
}

constexpr double kSpinsPerMillisecond = 20000.0;
constexpr std::uint64_t kUnboundedSpins = ~std::uint64_t{0};
constexpr double kSliceMilliseconds = 1.0;
constexpr std::uint32_t kTimedSlices = 1000;

std::uint64_t spinBudget(double maxWaitMilliseconds) {
  if (!(maxWaitMilliseconds >= 0.0)) return kUnboundedSpins;
  if (maxWaitMilliseconds == INFINITY) return kUnboundedSpins;
  const double spins = maxWaitMilliseconds * kSpinsPerMillisecond;
  if (spins >= 18446744073709551615.0) return kUnboundedSpins;
  return static_cast<std::uint64_t>(spins);
}

int spinWait(volatile void* addr, std::uint32_t val, double maxWaitMilliseconds) {
  countWait(kMainSpinWait);
  const std::uint64_t budget = spinBudget(maxWaitMilliseconds);
  for (std::uint64_t spin = 0; spin < budget; ++spin) {
    _emscripten_yield(0);
    if (__atomic_load_n(static_cast<volatile std::uint32_t*>(addr), __ATOMIC_SEQ_CST) != val) return -EWOULDBLOCK;
  }
  countWait(kSpinTimeout);
  return -ETIMEDOUT;
}

int mapWaitResult(int r) {
  if (r != EINTR && r != ETIMEDOUT && r != ECANCELED) return 0;
  return r;
}

int timedWait(volatile int* addr, int val, const struct timespec* at) {
  if (at != nullptr && at->tv_nsec >= 1000000000L) return EINVAL;
  if (at == nullptr) return mapWaitResult(-emscripten_futex_wait(addr, static_cast<std::uint32_t>(val), INFINITY));
  int r = ETIMEDOUT;
  for (std::uint32_t slice = 0; slice < kTimedSlices && r == ETIMEDOUT; ++slice) {
    countWait(kTimedSlice);
    r = -emscripten_futex_wait(addr, static_cast<std::uint32_t>(val), kSliceMilliseconds);
  }
  return mapWaitResult(r);
}

}

extern "C" int emscripten_futex_wait(volatile void* addr, std::uint32_t val, double maxWaitMilliseconds) {
  if ((reinterpret_cast<std::uintptr_t>(addr) & 3) != 0) return -EINVAL;
  _emscripten_yield(0);
  if (emscripten_is_main_runtime_thread() || !_emscripten_thread_supports_atomics_wait()) return spinWait(addr, val, maxWaitMilliseconds);
  std::int64_t maxWaitNs = -1;
  if (maxWaitMilliseconds != INFINITY && maxWaitMilliseconds >= 0.0) {
    maxWaitNs = static_cast<std::int64_t>(maxWaitMilliseconds * 1000.0 * 1000.0);
  }
  countWait(kWorkerWait);
  const int ret = __builtin_wasm_memory_atomic_wait32((int*)addr, static_cast<int>(val), maxWaitNs);
  if (ret == 1) return -EWOULDBLOCK;
  if (ret == 2) return -ETIMEDOUT;
  return 0;
}

extern "C" int __timedwait_cp(volatile int* addr, int val, clockid_t clk, const struct timespec* at, int priv) {
  (void)clk;
  (void)priv;
  return timedWait(addr, val, at);
}

extern "C" int __timedwait(volatile int* addr, int val, clockid_t clk, const struct timespec* at, int priv) {
  (void)clk;
  (void)priv;
  return timedWait(addr, val, at);
}

extern "C" std::uint32_t engine_futex_wait_count(int kind) {
  return kind >= 0 && kind < kWaitKinds ? __atomic_load_n(&waitCounts[kind], __ATOMIC_RELAXED) : 0u;
}

extern "C" int sched_yield() {
  countWait(kYield);
  _emscripten_yield(0);
  return 0;
}
