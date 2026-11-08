#ifndef ENGINE_VEGETATION_H
#define ENGINE_VEGETATION_H

#include <cstdint>

#include "surface_shape.h"

namespace engine::vegetation {

constexpr int kCellsPerSide = 32;
constexpr int kCells = kCellsPerSide * kCellsPerSide;
constexpr int kInstancesPerCell = 32;
constexpr std::uint32_t kClassTrunk = 0;
constexpr std::uint32_t kClassRock = 1;
constexpr std::uint32_t kClassPass = 2;
constexpr float kMaxScale = 2.0f;
constexpr float kMaxReach = 2.0f;
constexpr float kBoundHeight = 100.0f;

struct Instance {
  float x;
  float y;
  float z;
  float yaw;
  float scale;
  std::uint32_t cls;
};

struct Cell {
  std::uint32_t count;
  Instance instances[kInstancesPerCell];
};

struct Field {
  float origin = 0.0f;
  float cellSize = 0.0f;
  bool configured = false;
  std::uint64_t placed = 0;
  Cell cells[kCells];
};

Field& state();
bool configure(Field& field, float origin, float cellSize);
int place(Field& field, float x, float y, float z, float yaw, float scale, std::uint32_t cls);
void clear(Field& field);
void registerCollisions();

class VegetationShape final : public SurfaceShape {
 public:
  VegetationShape();

  JPH::AABox GetLocalBounds() const override;
};

}

#endif
