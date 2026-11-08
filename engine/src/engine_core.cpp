#include <cstdint>
#include <cstdlib>
#include <emscripten/emscripten.h>

namespace {

std::uint64_t tick_count = 0;
volatile std::uintptr_t retained = 0;

void run_step() {
  ++tick_count;
#ifdef ENGINE_LEAK_ON_TICK
  char* block = static_cast<char*>(std::malloc(65536));
  block[0] = static_cast<char>(tick_count);
  retained = reinterpret_cast<std::uintptr_t>(block);
#endif
}

}

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_init() {
  tick_count = 0;
  return 0;
}

EMSCRIPTEN_KEEPALIVE void engine_tick(int steps) {
  for (int i = 0; i < steps; ++i) run_step();
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_ticks() {
  return tick_count;
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_memory_bytes() {
  return static_cast<std::uint64_t>(__builtin_wasm_memory_size(0)) * 65536ull;
}

}
