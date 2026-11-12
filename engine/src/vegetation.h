#ifndef ENGINE_VEGETATION_H
#define ENGINE_VEGETATION_H

#include <cstddef>
#include <cstdint>

#include "surface_shape.h"

namespace engine::vegetation {

constexpr std::uint32_t kMaxInstances = 1u << 22;
constexpr std::uint32_t kClassTrunk = 0;
constexpr std::uint32_t kClassRock = 1;
constexpr std::uint32_t kClassPass = 2;
constexpr float kMaxScale = 2.0f;
constexpr float kMaxReach = 2.0f;
constexpr float kBoundHeight = 100.0f;
constexpr std::uint32_t kPromotedBit = 0x80000000u;
constexpr std::uint32_t kMaxTouches = 256;

struct Instance {
  float x;
  float y;
  float z;
  float yaw;
  float scale;
  std::uint32_t cls;
};

struct Touch {
  std::uint32_t instance;
  float x;
  float y;
  float z;
};

static_assert(sizeof(Touch) == 16);

struct Field {
  double origin = 0.0;
  float cellSize = 0.0f;
  bool configured = false;
  std::uint64_t placed = 0;
  std::uint32_t cellsPerSide = 0;
  std::uint32_t instancesPerCell = 0;
  std::uint32_t* counts = nullptr;
  Instance* instances = nullptr;
};

std::size_t bytesFor(std::uint32_t cellsPerSide, std::uint32_t instancesPerCell);
Field* bind(void* base, std::uint32_t cellsPerSide, std::uint32_t instancesPerCell);
Field& state();
bool configure(Field& field, double origin, float cellSize);
int place(Field& field, float x, float y, float z, float yaw, float scale, std::uint32_t cls);
void clear(Field& field);
bool isBound();
void armTouches(bool on);
std::uint32_t drainTouches(const Touch*& rows);
std::uint32_t droppedTouches();
bool promote(Field& field, std::uint32_t instance);
bool restore(Field& field, std::uint32_t instance);
const Instance* instanceRow(const Field& field, std::uint32_t instance);
bool anchorOf(const Field& field, std::uint32_t instance, float out[3]);
void registerCollisions();

class VegetationShape final : public SurfaceShape {
 public:
  VegetationShape();
  explicit VegetationShape(Field& field);

  JPH::AABox GetLocalBounds() const override;

  const Field& field() const { return field_; }

 private:
  Field& field_;
};

}

#endif
