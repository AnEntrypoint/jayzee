#include <cstdint>
#include <cstdlib>

#include <emscripten/emscripten.h>

#include "bridge.h"
#include "world.h"

namespace {

#if defined(ENGINE_LEAK_ON_TICK)
volatile std::uintptr_t retained = 0;

void leakBlock() {
  unsigned char* block = static_cast<unsigned char*>(std::malloc(65536));
  block[0] = static_cast<unsigned char>(engine::world().tick());
  retained = reinterpret_cast<std::uintptr_t>(block);
}
#endif

alignas(8) float stageRows[engine::kMaxBodies * engine::kBatchFloats];
std::uint32_t stageHandles[engine::kMaxBodies];

}

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_init() {
  return engine::World::initialize();
}

EMSCRIPTEN_KEEPALIVE int engine_world_configure(std::uint32_t capacity, std::uint32_t tickRate, float gravity, float drag,
                                                float radius, float restitution, std::uint32_t iterations) {
  const engine::Config config{capacity, tickRate, gravity, drag, radius, restitution, iterations};
  return engine::world().configure(config);
}

EMSCRIPTEN_KEEPALIVE int engine_world_add_box(float minX, float minY, float minZ, float maxX, float maxY, float maxZ) {
  const float box[6] = {minX, minY, minZ, maxX, maxY, maxZ};
  return engine::world().addBox(box);
}

EMSCRIPTEN_KEEPALIVE int engine_spawn(float px, float py, float pz, float vx, float vy, float vz) {
  const float position[3] = {px, py, pz};
  const float velocity[3] = {vx, vy, vz};
  return engine::world().spawn(position, velocity);
}

EMSCRIPTEN_KEEPALIVE float* engine_stage() {
  return stageRows;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t* engine_stage_handles() {
  return stageHandles;
}

EMSCRIPTEN_KEEPALIVE int engine_spawn_batch(std::uint32_t count) {
  return engine::world().spawnBatch(stageRows, count, stageHandles);
}

EMSCRIPTEN_KEEPALIVE int engine_despawn(std::uint32_t handle) {
  return engine::world().despawn(handle);
}

EMSCRIPTEN_KEEPALIVE int engine_set_position(std::uint32_t handle, float x, float y, float z) {
  const float position[3] = {x, y, z};
  return engine::world().setPosition(handle, position);
}

EMSCRIPTEN_KEEPALIVE int engine_set_velocity(std::uint32_t handle, float x, float y, float z) {
  const float velocity[3] = {x, y, z};
  return engine::world().setVelocity(handle, velocity);
}

EMSCRIPTEN_KEEPALIVE void engine_set_tick(std::uint64_t tick) {
  engine::world().setTick(tick);
}

EMSCRIPTEN_KEEPALIVE void engine_tick(int steps) {
  if (steps <= 0) return;
#if defined(ENGINE_LEAK_ON_TICK)
  for (int i = 0; i < steps; ++i) {
    engine::bridge::tickBatch(1);
    leakBlock();
  }
#else
  engine::bridge::tickBatch(static_cast<std::uint32_t>(steps));
#endif
}

EMSCRIPTEN_KEEPALIVE void engine_mark_warmup() {
  engine::markWarmup();
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_allocations_since_warmup() {
  return engine::allocationsSinceWarmup();
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_allocations_total() {
  return engine::allocationsTotal();
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_ticks() {
  return engine::world().tick();
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_memory_bytes() {
  return static_cast<std::uint64_t>(__builtin_wasm_memory_size(0)) * 65536ull;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_body_count() {
  return engine::world().count();
}

EMSCRIPTEN_KEEPALIVE const double* engine_positions() {
  return engine::world().positions();
}

EMSCRIPTEN_KEEPALIVE const double* engine_velocities() {
  return engine::world().velocities();
}

EMSCRIPTEN_KEEPALIVE const engine::Transform* engine_transforms() {
  return engine::world().transforms();
}

EMSCRIPTEN_KEEPALIVE std::uint32_t* engine_control() {
  return engine::bridge::controlWords();
}

EMSCRIPTEN_KEEPALIVE engine::bridge::InputSlot* engine_inputs() {
  return engine::bridge::inputSlots();
}

EMSCRIPTEN_KEEPALIVE engine::bridge::EventSlot* engine_events() {
  return engine::bridge::eventSlots();
}

}
