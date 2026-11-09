#include "phase_timer.h"
#include <cstdint>
#include <cstdlib>

#include <emscripten/emscripten.h>

#include "arena.h"
#include "bridge.h"
#include "budget.h"
#include "codec.h"
#include "interest.h"
#include "materials.h"
#include "textures.h"
#include "planet_frame.h"
#include "pool_alloc.h"
#include "vegetation.h"
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

constexpr std::uint32_t kLayoutMagic = 0x31474e45u;
constexpr std::uint32_t kLayoutVersion = 1;
constexpr double kMaxBudgetBytes = 4294967296.0;

enum LayoutWord : std::uint32_t {
  kWordMagic,
  kWordVersion,
  kWordPlayers,
  kWordBodies,
  kWordWorkers,
  kWordArenaBytes,
  kWordUsedBytes,
  kWordInputSlots,
  kWordEventSlots,
  kWordRegionCount,
  kWordRegions,
};

constexpr std::uint32_t kRegionWord0 = kWordRegions;

enum Region : std::uint32_t {
  kRegionControl,
  kRegionInputs,
  kRegionEvents,
  kRegionTransforms,
  kRegionPositions,
  kRegionVelocities,
  kRegionStageRows,
  kRegionStageHandles,
  kRegionPlanetScratch,
  kRegionCodecBytes,
  kRegionCodecValues,
  kRegionCodecCounts,
  kRegionCount,
};

constexpr std::uint32_t kLayoutWords = kRegionWord0 + kRegionCount;

std::uint32_t layoutWords[kLayoutWords];
engine::budget::Capacity capacity{};
float* stageRows = nullptr;
std::uint32_t* stageHandles = nullptr;
std::int32_t planetScratch[4];
engine::codec::Scratch* codecScratch = nullptr;

template <typename T>
T* carveArray(std::size_t count) {
  return static_cast<T*>(engine::arena::carve(sizeof(T) * count, alignof(T)));
}

std::uint32_t addressOf(const void* pointer) {
  return static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(pointer));
}

void fillLayout() {
  layoutWords[kWordMagic] = kLayoutMagic;
  layoutWords[kWordVersion] = kLayoutVersion;
  layoutWords[kWordPlayers] = capacity.players;
  layoutWords[kWordBodies] = capacity.bodies;
  layoutWords[kWordWorkers] = capacity.workers;
  layoutWords[kWordArenaBytes] = static_cast<std::uint32_t>(capacity.arenaBytes);
  layoutWords[kWordInputSlots] = engine::bridge::inputSlotCount();
  layoutWords[kWordEventSlots] = engine::bridge::eventSlotCount();
  layoutWords[kWordRegionCount] = kRegionCount;
  layoutWords[kRegionWord0 + kRegionControl] = addressOf(engine::bridge::controlWords());
  layoutWords[kRegionWord0 + kRegionInputs] = addressOf(engine::bridge::inputSlots());
  layoutWords[kRegionWord0 + kRegionEvents] = addressOf(engine::bridge::eventSlots());
  layoutWords[kRegionWord0 + kRegionTransforms] = addressOf(engine::world().transforms());
  layoutWords[kRegionWord0 + kRegionPositions] = addressOf(engine::world().positions());
  layoutWords[kRegionWord0 + kRegionVelocities] = addressOf(engine::world().velocities());
  layoutWords[kRegionWord0 + kRegionStageRows] = addressOf(stageRows);
  layoutWords[kRegionWord0 + kRegionStageHandles] = addressOf(stageHandles);
  layoutWords[kRegionWord0 + kRegionPlanetScratch] = addressOf(planetScratch);
  layoutWords[kRegionWord0 + kRegionCodecBytes] = addressOf(codecScratch->bytes);
  layoutWords[kRegionWord0 + kRegionCodecValues] = addressOf(codecScratch->values);
  layoutWords[kRegionWord0 + kRegionCodecCounts] = addressOf(codecScratch->counts);
}

int initialize(std::uint32_t players, std::uint32_t workers, double budgetBytes) {
  if (!(budgetBytes >= 0.0) || budgetBytes > kMaxBudgetBytes) return engine::kRange;
  if (engine::arena::sealed() || engine::arena::used() != 0) return engine::kAlreadyInitialized;
  if (!engine::budget::plan(static_cast<std::uint64_t>(budgetBytes), players, workers, capacity)) return engine::kRange;
  std::uint32_t primeCounts[engine::pool::kClasses];
  engine::budget::poolCounts(capacity, primeCounts);
  if (!engine::pool::prime(primeCounts)) return engine::kFull;
  const engine::Status joltStatus = engine::World::initialize();
  if (joltStatus != engine::kOk) return joltStatus;
  if (engine::world().bind(capacity) != engine::kOk) return engine::kFull;
  if (engine::bridge::bind(capacity) != engine::kOk) return engine::kFull;
  if (engine::planet::bind(engine::arena::carve(engine::planet::bytesFor(capacity.pageSlots), 16), capacity.pageSlots) == nullptr) {
    return engine::kFull;
  }
  if (engine::vegetation::bind(engine::arena::carve(engine::vegetation::bytesFor(capacity.cellsPerSide, capacity.instancesPerCell), 16),
                               capacity.cellsPerSide, capacity.instancesPerCell) == nullptr) {
    return engine::kFull;
  }
  codecScratch = engine::codec::Scratch::bind(engine::arena::carve(engine::codec::Scratch::bytesFor(), 16));
  if (codecScratch == nullptr) return engine::kFull;
  if (engine::materials::bind(engine::arena::carve(engine::materials::bytesFor(capacity.materials), 8), capacity.materials) != engine::kOk) {
    return engine::kFull;
  }
  if (engine::textures::bind(engine::arena::carve(engine::textures::bytesFor(capacity.textures), 8), capacity.textures) != engine::kOk) {
    return engine::kFull;
  }
  if (!engine::interest::bind(engine::arena::carve(engine::interest::bytesFor(capacity), 8), capacity)) return engine::kFull;
  stageRows = carveArray<float>(static_cast<std::size_t>(capacity.bodies) * engine::kBatchFloats);
  stageHandles = carveArray<std::uint32_t>(capacity.bodies);
  if (stageRows == nullptr || stageHandles == nullptr) return engine::kFull;
  fillLayout();
  return engine::kOk;
}

}

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_init(std::uint32_t players, std::uint32_t workers, double budgetBytes) {
  return initialize(players, workers, budgetBytes);
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_arena_used() {
  return static_cast<std::uint64_t>(engine::arena::used());
}

EMSCRIPTEN_KEEPALIVE void engine_arena_seal() {
  engine::arena::seal();
}

EMSCRIPTEN_KEEPALIVE std::uint32_t* engine_layout() {
  layoutWords[kWordUsedBytes] = static_cast<std::uint32_t>(engine::arena::used());
  return layoutWords;
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_allocation_failures() {
  return engine::pool::failures();
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

EMSCRIPTEN_KEEPALIVE int engine_world_add_trunk(float x, float y, float z, float radius, float halfHeight) {
  const float trunk[5] = {x, y, z, radius, halfHeight};
  return engine::world().addTrunk(trunk);
}

EMSCRIPTEN_KEEPALIVE double engine_spawn(float px, float py, float pz, float vx, float vy, float vz) {
  const float position[3] = {px, py, pz};
  const float velocity[3] = {vx, vy, vz};
  return static_cast<double>(engine::world().spawn(position, velocity));
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

#if defined(ENGINE_PHASE_TIMERS)
EMSCRIPTEN_KEEPALIVE double engine_phase_total_ms(int id) {
  return engine::phase::total(static_cast<engine::phase::Id>(id));
}

EMSCRIPTEN_KEEPALIVE int engine_phase_count() {
  return static_cast<int>(engine::phase::kCount);
}
#endif

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_ticks() {
  return engine::world().tick();
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_memory_bytes() {
  return static_cast<std::uint64_t>(__builtin_wasm_memory_size(0)) * 65536ull;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_body_count() {
  return engine::world().count();
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_retired_slots() {
  return engine::world().retiredSlots();
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_physics_bodies() {
  return engine::world().physicsBodies();
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

EMSCRIPTEN_KEEPALIVE int engine_planet_configure(double radius, double cellSize, double gravity, double maxHeight) {
  return engine::world().configurePlanet(radius, cellSize, gravity, maxHeight);
}

EMSCRIPTEN_KEEPALIVE int engine_planet_locate(double x, double y, double z) {
  const engine::planet::Planet& terrain = engine::planet::state();
  if (!terrain.configured) return engine::kNotConfigured;
  const engine::planet::Cell cell = engine::planet::worldToCell(x, y, z, terrain.radius, terrain.cellSize);
  planetScratch[0] = cell.face;
  planetScratch[1] = cell.cx;
  planetScratch[2] = cell.cy;
  planetScratch[3] = engine::kOk;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE int engine_planet_resolve(int face, int cx, int cy) {
  const engine::planet::Planet& terrain = engine::planet::state();
  if (!terrain.configured) return engine::kNotConfigured;
  const engine::planet::Cell cell = engine::planet::resolveCell(face, cx, cy, terrain.cellsPerFace);
  planetScratch[0] = cell.face;
  planetScratch[1] = cell.cx;
  planetScratch[2] = cell.cy;
  planetScratch[3] = engine::kOk;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE std::int64_t engine_planet_key(int face, int cx, int cy) {
  const engine::planet::Planet& terrain = engine::planet::state();
  if (!terrain.configured) {
    planetScratch[3] = engine::kNotConfigured;
    return 0;
  }
  std::int64_t key = 0;
  if (!engine::planet::packCellKey(face, cx, cy, terrain.cellsPerFace, key)) {
    planetScratch[3] = engine::kRange;
    return 0;
  }
  planetScratch[3] = engine::kOk;
  return key;
}

EMSCRIPTEN_KEEPALIVE std::int32_t* engine_planet_scratch() {
  return planetScratch;
}

EMSCRIPTEN_KEEPALIVE double engine_planet_height(double x, double y, double z) {
  engine::planet::Planet& terrain = engine::planet::state();
  if (!terrain.configured) return 0.0;
  return engine::planet::heightAt(terrain, x, y, z);
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_planet_gap_queries() {
  return engine::planet::state().gapQueries;
}

EMSCRIPTEN_KEEPALIVE int engine_planet_resident() {
  return engine::planet::state().pages.residentCount();
}

EMSCRIPTEN_KEEPALIVE int engine_page_stage(std::int64_t key) {
  return engine::planet::state().pages.stage(key);
}

EMSCRIPTEN_KEEPALIVE float* engine_page_samples(int slot) {
  return engine::planet::state().pages.samples(slot);
}

EMSCRIPTEN_KEEPALIVE int engine_page_commit(int slot) {
  return engine::planet::state().pages.commit(slot) ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_page_release(std::int64_t key) {
  return engine::planet::state().pages.releaseKey(key) ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_page_lookup(std::int64_t key) {
  return engine::planet::state().pages.lookup(key);
}

EMSCRIPTEN_KEEPALIVE int engine_veg_configure(double origin, double cellSize) {
  const bool ok = engine::vegetation::configure(engine::vegetation::state(), static_cast<float>(origin), static_cast<float>(cellSize));
  return ok ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_veg_place(float x, float y, float z, float yaw, float scale, std::uint32_t cls) {
  return engine::vegetation::place(engine::vegetation::state(), x, y, z, yaw, scale, cls);
}

EMSCRIPTEN_KEEPALIVE int engine_veg_attach() {
  return engine::world().attachVegetation();
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_veg_placed() {
  return engine::vegetation::state().placed;
}

EMSCRIPTEN_KEEPALIVE std::uint8_t* engine_codec_bytes() {
  return codecScratch->bytes;
}

EMSCRIPTEN_KEEPALIVE double* engine_codec_values() {
  return codecScratch->values;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_encode_entity() {
  const bool ok = engine::codec::encodeEntity(codecScratch->values, codecScratch->values + 3, codecScratch->values[6], codecScratch->values + 7, codecScratch->values[10], codecScratch->bytes);
  return ok ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_decode_entity(int length) {
  if (length < 0) return engine::kRange;
  const bool ok = engine::codec::decodeEntity(codecScratch->bytes, static_cast<std::size_t>(length), codecScratch->values, codecScratch->values + 3, codecScratch->values[6],
                                              codecScratch->values + 7, codecScratch->values[10]);
  return ok ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_encode_player() {
  const bool ok = engine::codec::encodePlayer(codecScratch->values, codecScratch->values + 3, codecScratch->values[6], codecScratch->bytes);
  return ok ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_decode_player(int length) {
  if (length < 0) return engine::kRange;
  const bool ok = engine::codec::decodePlayer(codecScratch->bytes, static_cast<std::size_t>(length), codecScratch->values, codecScratch->values + 3, codecScratch->values[6]);
  return ok ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_encode_quat() {
  return engine::codec::encodeSmallestThree(codecScratch->values, codecScratch->values[4]) ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_decode_quat() {
  return engine::codec::decodeSmallestThree(codecScratch->values[0], codecScratch->values + 1) ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_encode_inputs(int count) {
  const int length = engine::codec::encodeInputs(codecScratch->values, count, codecScratch->bytes);
  return length < 0 ? engine::kRange : length;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_encode_packet(int buttons, int axes, double chartEpoch, int count) {
  const engine::codec::PacketSchema schema{buttons, axes};
  return engine::codec::encodePacket(schema, codecScratch->values, count, chartEpoch, codecScratch->bytes, codecScratch->counts);
}

EMSCRIPTEN_KEEPALIVE int engine_codec_decode_packet(int buttons, int axes, int length, int dropping, std::uint32_t dropAtOrBelow) {
  const engine::codec::PacketSchema schema{buttons, axes};
  const std::size_t size = length < 0 ? 0 : static_cast<std::size_t>(length);
  return engine::codec::decodePacket(schema, codecScratch->bytes, size, dropping != 0, dropAtOrBelow, codecScratch->values, codecScratch->packetEpoch);
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_codec_packet_epoch() {
  return codecScratch->packetEpoch;
}

EMSCRIPTEN_KEEPALIVE std::int32_t* engine_codec_counts() {
  return codecScratch->counts;
}

EMSCRIPTEN_KEEPALIVE int engine_codec_decode_inputs(int length) {
  if (length < 0) return engine::kRange;
  const int count = engine::codec::decodeInputs(codecScratch->bytes, static_cast<std::size_t>(length), codecScratch->values);
  return count < 0 ? engine::kRange : count;
}

}
