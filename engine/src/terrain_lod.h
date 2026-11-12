#ifndef ENGINE_TERRAIN_LOD_H
#define ENGINE_TERRAIN_LOD_H

#include <cstdint>

namespace engine::terrain {

constexpr std::uint32_t kMaxLevels = 16;
constexpr std::uint32_t kNoPageBudget = 0;
constexpr float kLevelHysteresis = 0.25f;
constexpr float kMorphBand = 0.5f;
constexpr std::uint32_t kQuadrantMask = 3u;
constexpr std::uint32_t kLevelShift = 8;
constexpr std::uint16_t kNoParent = 0xffffu;

static_assert(kMorphBand <= 1.0f - 2.0f * kLevelHysteresis);

struct LodState {
  std::uint32_t pageBudget;
  std::uint32_t levels;
  std::uint32_t level;
  std::uint32_t window;
  std::uint32_t spanCells;
  std::uint32_t switches;
  float morph;
  float ratio;
  double fullDetailAltitude;
  double altitude;
};

static_assert(sizeof(LodState) == 48);

struct PageLod {
  std::uint8_t level;
  std::uint8_t quadrant;
  std::uint16_t parentSlot;
};

static_assert(sizeof(PageLod) == 4);

const LodState& state();
bool configure(std::uint32_t pageBudget, std::uint32_t levels, double fullDetailAltitude);
void reset();
bool enabled();
const LodState& select(double altitude);
float ratioOf(double altitude, double fullDetailAltitude);
std::uint32_t levelAfter(std::uint32_t previous, float ratio, std::uint32_t levels);
float morphOf(std::uint32_t level, float ratio, std::uint32_t levels);
std::uint32_t windowFor(std::uint32_t pageBudget);

}

#endif
