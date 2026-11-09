#ifndef ENGINE_WORLD_H
#define ENGINE_WORLD_H

#include <cstdint>

#include "budget.h"

namespace JPH {
class BodyInterface;
class PhysicsSystem;
}

namespace engine {

constexpr std::uint32_t kMaxIterations = 32;
constexpr std::uint32_t kSlotMask = 0xffffu;
constexpr std::uint32_t kBatchFloats = 6;
constexpr std::uint32_t kNoBody = 0xffffffffu;
constexpr std::uint16_t kLastGeneration = 0xfffeu;
constexpr std::uint16_t kRetiredGeneration = 0xffffu;
constexpr std::uint32_t kFixedJoltBodies = 3;

constexpr std::uint32_t joltBodyCapacity(const budget::Capacity& c) {
  return c.bodies + c.statics + c.trunks + kFixedJoltBodies;
}

constexpr std::uint32_t kQuadNodesPerPage = 256;

constexpr std::uint32_t joltQuadNodePages(const budget::Capacity& c) {
  const std::uint32_t leaves = (joltBodyCapacity(c) + 1) / 2;
  const std::uint32_t nodes = 2 * (leaves + (leaves + 2) / 3);
  return (nodes + kQuadNodesPerPage - 1) / kQuadNodesPerPage;
}

constexpr std::uint32_t joltPairCapacity(const budget::Capacity& c) {
  return c.bodies * 4;
}

constexpr std::uint32_t joltContactCapacity(const budget::Capacity& c) {
  return c.bodies * 5 / 2;
}

enum Status : int {
  kOk = 0,
  kFull = -1,
  kRange = -2,
  kNotConfigured = -3,
  kBadId = -4,
  kTooManyStatics = -5,
  kZeroThickness = -6,
  kAlreadyInitialized = -7,
};

struct Config {
  std::uint32_t capacity;
  std::uint32_t tickRate;
  float gravity;
  float drag;
  float radius;
  float restitution;
  std::uint32_t iterations;
};

struct Transform {
  float x;
  float y;
  float z;
  float qx;
  float qy;
  float qz;
  float qw;
};

static_assert(sizeof(Transform) == 28);

std::uint64_t allocationsTotal();
void markWarmup();
std::uint64_t allocationsSinceWarmup();

class World {
 public:
  World() = default;
  ~World();
  World(const World&) = delete;
  World& operator=(const World&) = delete;

  static Status initialize();

  Status bind(const budget::Capacity& capacity);
  Status configure(const Config& config);
  Status addBox(const float* box);
  Status configurePlanet(double radius, double cellSize, double gravity, double maxHeight);
  Status attachVegetation();
  Status addTrunk(const float* trunk);
  std::int64_t spawn(const float* position, const float* velocity);
  int spawnBatch(const float* rows, std::uint32_t count, std::uint32_t* handles);
  Status despawn(std::uint32_t handle);
  Status setPosition(std::uint32_t handle, const float* position);
  Status setVelocity(std::uint32_t handle, const float* velocity);
  void step(std::uint32_t steps);
  void setTick(std::uint64_t tick);
  void applyRadialGravity(JPH::PhysicsSystem& system, float dt);

  std::uint32_t count() const { return live_; }
  std::uint32_t slotExtent() const { return fresh_; }
  std::uint32_t retiredSlots() const { return retired_; }
  std::uint32_t physicsBodies() const;
  std::uint32_t activeBodies() const;
  std::uint64_t tick() const { return tick_; }
  std::uint32_t bodyCapacity() const { return limits_.bodies; }
  const double* positions() const { return positions_; }
  const double* velocities() const { return velocities_; }
  const Transform* transforms() const { return transforms_; }

 private:
  struct Runtime;

  int resolve(std::uint32_t handle) const;
  int allocateSlot();
  void sync(std::uint32_t slot);
  void removeBody(std::uint32_t index);
  void releaseRuntime();

  Runtime* runtime_ = nullptr;
  budget::Capacity limits_{};
  std::uint32_t capacity_ = 0;
  std::uint32_t statics_ = 0;
  std::uint32_t live_ = 0;
  std::uint32_t retired_ = 0;
  std::uint32_t fresh_ = 0;
  std::uint32_t freeCount_ = 0;
  std::uint32_t tickRate_ = 1;
  float drag_ = 0.0f;
  float restitution_ = 0.0f;
  float planetGravity_ = 0.0f;
  std::uint32_t groundBody_ = kNoBody;
  std::uint32_t planetBody_ = kNoBody;
  std::uint32_t vegetationBody_ = kNoBody;
  std::uint32_t trunkBodies_ = 0;
  std::uint64_t tick_ = 0;
  std::uint32_t* bodyIds_ = nullptr;
  std::uint32_t* batch_ = nullptr;
  std::uint32_t* freeSlots_ = nullptr;
  std::uint16_t* generations_ = nullptr;
  std::uint8_t* alive_ = nullptr;
  double* positions_ = nullptr;
  double* velocities_ = nullptr;
  Transform* transforms_ = nullptr;
};

World& world();

}

#endif
