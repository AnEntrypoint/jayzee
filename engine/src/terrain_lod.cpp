#include "terrain_lod.h"

#include <cmath>

namespace engine::terrain {

namespace {

LodState current{};

}

const LodState& state() {
  return current;
}

void reset() {
  current = LodState{};
}

bool enabled() {
  return current.pageBudget != kNoPageBudget;
}

std::uint32_t windowFor(std::uint32_t pageBudget) {
  std::uint32_t side = 0;
  while ((side + 1) * (side + 1) <= pageBudget) side += 1;
  return side;
}

float ratioOf(double altitude, double fullDetailAltitude) {
  if (!(altitude > fullDetailAltitude)) return 0.0f;
  return static_cast<float>(std::log2(altitude / fullDetailAltitude));
}

std::uint32_t levelAfter(std::uint32_t previous, float ratio, std::uint32_t levels) {
  if (levels == 0) return 0;
  const int last = static_cast<int>(levels) - 1;
  int level = static_cast<int>(previous) > last ? last : static_cast<int>(previous);
  const int up = static_cast<int>(std::floor(ratio - kLevelHysteresis));
  if (up > level) {
    level = up;
  } else {
    const int down = static_cast<int>(std::floor(ratio + kLevelHysteresis));
    if (down < level) level = down;
  }
  if (level < 0) level = 0;
  if (level > last) level = last;
  return static_cast<std::uint32_t>(level);
}

float morphOf(std::uint32_t level, float ratio, std::uint32_t levels) {
  if (levels == 0 || level + 1 >= levels) return 0.0f;
  const float start = static_cast<float>(level + 1) - kLevelHysteresis - kMorphBand;
  const float blend = (ratio - start) / kMorphBand;
  if (!(blend > 0.0f)) return 0.0f;
  return blend < 1.0f ? blend : 1.0f;
}

bool configure(std::uint32_t pageBudget, std::uint32_t levels, double fullDetailAltitude) {
  if (pageBudget == kNoPageBudget) {
    reset();
    return true;
  }
  if (levels < 1 || levels > kMaxLevels) return false;
  if (!(fullDetailAltitude > 0.0) || !std::isfinite(fullDetailAltitude)) return false;
  current = LodState{};
  current.pageBudget = pageBudget;
  current.levels = levels;
  current.window = windowFor(pageBudget);
  current.spanCells = 1;
  current.fullDetailAltitude = fullDetailAltitude;
  return true;
}

const LodState& select(double altitude) {
  if (!enabled()) return current;
  if (!(altitude >= 0.0)) altitude = 0.0;
  const float ratio = ratioOf(altitude, current.fullDetailAltitude);
  const std::uint32_t level = levelAfter(current.level, ratio, current.levels);
  if (level != current.level) current.switches += 1;
  current.level = level;
  current.spanCells = 1u << level;
  current.ratio = ratio;
  current.morph = morphOf(level, ratio, current.levels);
  current.altitude = altitude;
  return current;
}

}
