#include <cmath>
#include <cstdint>
#include <cstring>

#include "arena.h"
#include "harness.h"
#include "render/shadow_cascades.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

namespace shadows = engine::render::shadows;

constexpr float kNear = 0.5f;
constexpr float kFar = 400.0f;
constexpr float kDistance = 120.0f;
constexpr float kFovY = 1.0471976f;
constexpr float kAspect = 16.0f / 9.0f;
constexpr std::uint32_t kCascades = 3;
constexpr std::uint32_t kResolution = 1024;
constexpr float kClipSlack = 1.0e-3f;
constexpr float kTexelSlack = 2.0e-2f;
constexpr std::uint32_t kMoves = 200;

void multiply(const float* a, const float* b, float* out) {
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      float sum = 0.0f;
      for (int k = 0; k < 4; ++k) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
}

void cameraAt(float x, float y, float z, float yaw, float* viewProj) {
  const float f = 1.0f / std::tan(kFovY / 2.0f);
  const float nf = 1.0f / (kNear - kFar);
  const float proj[16] = {f / kAspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (kFar + kNear) * nf, -1, 0, 0, 2 * kFar * kNear * nf, 0};
  const float c = std::cos(yaw);
  const float s = std::sin(yaw);
  const float view[16] = {c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, -(c * x + s * z), -y, -(-s * x + c * z), 1};
  multiply(proj, view, viewProj);
}

void project(const float* m, const float* p, float out[3]) {
  for (int r = 0; r < 3; ++r) out[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
}

std::uint32_t cornersOutside(const float* viewProj) {
  const shadows::State& state = shadows::state();
  float inverseSpan = 0.0f;
  float whole[8][3];
  shadows::sliceCorners(viewProj, 0.0f, 1.0f, whole);
  float axis[3];
  for (int k = 0; k < 3; ++k) {
    axis[k] = 0.0f;
    for (int c = 0; c < 4; ++c) axis[k] += (whole[c + 4][k] - whole[c][k]) * 0.25f;
  }
  inverseSpan = 1.0f / std::sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
  std::uint32_t outside = 0;
  for (std::uint32_t i = 0; i < state.cascades; ++i) {
    const shadows::Cascade& cascade = state.cascade[i];
    float corners[8][3];
    shadows::sliceCorners(viewProj, (cascade.splitNear - state.cascade[0].splitNear) * inverseSpan, (cascade.splitFar - state.cascade[0].splitNear) * inverseSpan, corners);
    for (int c = 0; c < 8; ++c) {
      float clip[3];
      project(cascade.viewProj, corners[c], clip);
      for (int k = 0; k < 3; ++k) {
        if (!(std::fabs(clip[k]) <= 1.0f + kClipSlack)) outside += 1;
      }
    }
  }
  return outside;
}

}

void shadowCascades() {
  const shadows::State& state = shadows::state();
  float viewProj[16];
  cameraAt(3.0f, 12.0f, 7.0f, 0.4f, viewProj);
  check(!shadows::enabled() && state.cascades == 0 && state.mapBytes == 0 && !shadows::fit(viewProj) && state.fits == 0,
        "shadows: off by default, with no cascade, no map bytes and no fit");
  check(shadows::budgetFor(0).cascades == 2 && shadows::budgetFor(0).resolution == 1024 && shadows::budgetFor(1).cascades == 3 && shadows::budgetFor(2).cascades == 4 &&
            shadows::budgetFor(2).resolution == 2048 && shadows::budgetFor(9).cascades == 4,
        "shadows: the device tier fixes the cascade count and the map size, 2 of 1024 up to 4 of 2048");
  check(shadows::mapBytesOf(2, 1024) == 8u * 1024u * 1024u && shadows::mapBytesOf(4, 2048) == 64u * 1024u * 1024u,
        "shadows: the map bytes are cascades times the square of the size times four, 8 MiB at tier 0 and 64 MiB at tier 2");
  check(!shadows::configure(5, 1024, kDistance) && !shadows::configure(2, 1000, kDistance) && !shadows::configure(2, 128, kDistance) && !shadows::configure(2, 8192, kDistance) &&
            !shadows::configure(2, 1024, 0.0f) && !shadows::enabled(),
        "shadows: more than 4 cascades, a size that is not a power of two from 256 to 4096, and a distance that is not positive are refused");
  check(!shadows::setSun(0.0f, 0.0f, 0.0f) && shadows::setSun(1.0f, -2.0f, 0.5f) && std::fabs(state.sun[0] * state.sun[0] + state.sun[1] * state.sun[1] + state.sun[2] * state.sun[2] - 1.0f) < 1.0e-5f,
        "shadows: a zero sun direction is refused and an accepted one is stored at unit length");

  float splits[shadows::kMaxCascades + 1];
  shadows::splitDistances(1.0f, 256.0f, 4, 1.0f, splits);
  check(splits[0] == 1.0f && std::fabs(splits[1] - 4.0f) < 1.0e-3f && std::fabs(splits[2] - 16.0f) < 1.0e-3f && std::fabs(splits[3] - 64.0f) < 1.0e-2f && splits[4] == 256.0f,
        "shadows: a split blend of one gives logarithmic splits, 1, 4, 16, 64, 256");
  shadows::splitDistances(1.0f, 256.0f, 4, 0.0f, splits);
  check(std::fabs(splits[1] - 64.75f) < 1.0e-3f && std::fabs(splits[2] - 128.5f) < 1.0e-3f && splits[4] == 256.0f, "shadows: a split blend of zero gives uniform splits");

  const std::uint64_t carves = engine::arena::carves();
  check(shadows::configure(kCascades, kResolution, kDistance) && shadows::enabled() && state.mapBytes == 12u * 1024u * 1024u,
        "shadows: three cascades of 1024 over 120 m are accepted, a fixed 12 MiB of depth");
  check(shadows::fit(viewProj) && state.fits == 1, "shadows: the cascades fit a camera frustum");
  bool ordered = std::fabs(state.cascade[0].splitNear - kNear) < 1.0e-2f && std::fabs(state.cascade[kCascades - 1].splitFar - (kNear + kDistance)) < 0.5f;
  for (std::uint32_t i = 0; i + 1 < kCascades; ++i) ordered = ordered && state.cascade[i].splitFar == state.cascade[i + 1].splitNear && state.cascade[i].radius < state.cascade[i + 1].radius;
  observe("shadows: first cascade far split in metres", state.cascade[0].splitFar);
  observe("shadows: first cascade texel in metres", state.cascade[0].texel);
  observe("shadows: last cascade texel in metres", state.cascade[kCascades - 1].texel);
  check(ordered, "shadows: the splits run from the near plane to the shadow distance without a gap, and each cascade is wider than the one before");
  check(cornersOutside(viewProj) == 0, "shadows: every corner of every frustum slice lies inside its cascade's clip volume");

  const float probe[3] = {20.0f, 0.0f, -30.0f};
  float before[shadows::kMaxCascades][3];
  float radius[shadows::kMaxCascades];
  for (std::uint32_t i = 0; i < kCascades; ++i) {
    project(state.cascade[i].viewProj, probe, before[i]);
    radius[i] = state.cascade[i].radius;
  }
  float worstFraction = 0.0f;
  std::uint32_t radiusChanges = 0;
  std::uint32_t outside = 0;
  for (std::uint32_t move = 1; move <= kMoves; ++move) {
    const float t = static_cast<float>(move);
    cameraAt(3.0f + 0.013f * t, 12.0f + 0.007f * t, 7.0f - 0.011f * t, 0.4f + 0.003f * t, viewProj);
    shadows::fit(viewProj);
    outside += cornersOutside(viewProj);
    for (std::uint32_t i = 0; i < kCascades; ++i) {
      if (state.cascade[i].radius != radius[i]) radiusChanges += 1;
      float now[3];
      project(state.cascade[i].viewProj, probe, now);
      for (int k = 0; k < 2; ++k) {
        const float texels = (now[k] - before[i][k]) * 0.5f * kResolution;
        const float fraction = std::fabs(texels - std::round(texels));
        if (fraction > worstFraction) worstFraction = fraction;
      }
    }
  }
  observe("shadows: largest sub-texel shift of a fixed point over 200 camera moves and turns, in texels", worstFraction);
  check(radiusChanges == 0, "shadows: moving and turning the camera does not change the size of any cascade");
  check(worstFraction <= kTexelSlack, "shadows: a fixed point moves in the shadow map by whole texels only, so the shadow edge does not swim");
  check(outside == 0, "shadows: the slices stay inside their cascades over the 200 moves");
  check(engine::arena::carves() == carves, "shadows: configuring and fitting carve nothing from the arena");

  check(shadows::configure(0, 0, 0.0f) && !shadows::enabled() && state.mapBytes == 0, "shadows: a cascade count of zero turns shadows off again");
  shadows::setSun(0.0f, -1.0f, 0.0f);
}

}
