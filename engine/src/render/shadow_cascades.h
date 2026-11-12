#ifndef ENGINE_RENDER_SHADOW_CASCADES_H
#define ENGINE_RENDER_SHADOW_CASCADES_H

#include <cstdint>

namespace engine::render::shadows {

constexpr std::uint32_t kMaxCascades = 4;
constexpr std::uint32_t kMinResolution = 256;
constexpr std::uint32_t kMaxResolution = 4096;
constexpr std::uint32_t kDepthTexelBytes = 4;
constexpr std::uint32_t kTiers = 3;
constexpr float kSplitBlend = 0.5f;
constexpr float kCasterReach = 2.0f;

struct Cascade {
  float viewProj[16];
  float centre[3];
  float radius;
  float splitNear;
  float splitFar;
  float texel;
  float pad;
};

static_assert(sizeof(Cascade) == 96);

struct State {
  std::uint32_t cascades;
  std::uint32_t resolution;
  std::uint32_t mapBytes;
  std::uint32_t fits;
  float distance;
  float sun[3];
  Cascade cascade[kMaxCascades];
};

static_assert(sizeof(State) == 32 + kMaxCascades * 96);

struct Budget {
  std::uint32_t cascades;
  std::uint32_t resolution;
};

Budget budgetFor(std::uint32_t deviceTier);
std::uint32_t mapBytesOf(std::uint32_t cascades, std::uint32_t resolution);
const State& state();
bool enabled();
bool configure(std::uint32_t cascades, std::uint32_t resolution, float distance);
bool setSun(float x, float y, float z);
void reset();
void splitDistances(float nearDistance, float farDistance, std::uint32_t cascades, float blend, float* out);
bool sliceCorners(const float* viewProj, float nearFraction, float farFraction, float corners[8][3]);
bool fit(const float* viewProj);

}

#endif
