#ifndef ENGINE_WORLD_H
#define ENGINE_WORLD_H

#include <cstdint>

namespace engine {

constexpr std::uint32_t kMaxBodies = 4096;
constexpr std::uint32_t kMaxStatics = 64;
constexpr std::uint32_t kMaxIterations = 32;

enum Status : int {
  kOk = 0,
  kFull = -1,
  kRange = -2,
  kNotConfigured = -3,
  kBadId = -4,
  kTooManyStatics = -5,
  kZeroThickness = -6,
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

class World {
 public:
  World() = default;
  ~World();
  World(const World&) = delete;
  World& operator=(const World&) = delete;

  static Status initialize();

  Status configure(const Config& config);
  Status addBox(const float* box);
  int spawn(const float* position, const float* velocity);
  Status setPosition(std::uint32_t id, const float* position);
  Status setVelocity(std::uint32_t id, const float* velocity);
  void step(std::uint32_t steps);
  void setTick(std::uint64_t tick);

  std::uint32_t count() const { return count_; }
  std::uint64_t tick() const { return tick_; }
  const double* positions() const { return positions_; }
  const double* velocities() const { return velocities_; }

 private:
  struct Runtime;

  void sync(std::uint32_t index);

  Runtime* runtime_ = nullptr;
  std::uint32_t capacity_ = 0;
  std::uint32_t statics_ = 0;
  std::uint32_t count_ = 0;
  std::uint32_t tickRate_ = 1;
  float drag_ = 0.0f;
  float restitution_ = 0.0f;
  std::uint64_t tick_ = 0;
  std::uint32_t bodyIds_[kMaxBodies];
  alignas(8) double positions_[kMaxBodies * 3];
  alignas(8) double velocities_[kMaxBodies * 3];
};

World& world();

}

#endif
