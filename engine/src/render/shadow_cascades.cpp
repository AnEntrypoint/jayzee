#include "shadow_cascades.h"

#include <cmath>
#include <cstring>

namespace engine::render::shadows {

namespace {

constexpr Budget kTierBudget[kTiers] = {{2, 1024}, {3, 1024}, {4, 2048}};
constexpr float kPoleLimit = 0.99f;
constexpr float kRadiusSteps = 8.0f;

State current{0, 0, 0, 0, 0.0f, {0.0f, -1.0f, 0.0f}, {}};

bool invert(const float* m, float* out) {
  double inv[16];
  inv[0] = static_cast<double>(m[5]) * m[10] * m[15] - static_cast<double>(m[5]) * m[11] * m[14] - static_cast<double>(m[9]) * m[6] * m[15] +
           static_cast<double>(m[9]) * m[7] * m[14] + static_cast<double>(m[13]) * m[6] * m[11] - static_cast<double>(m[13]) * m[7] * m[10];
  inv[4] = -static_cast<double>(m[4]) * m[10] * m[15] + static_cast<double>(m[4]) * m[11] * m[14] + static_cast<double>(m[8]) * m[6] * m[15] -
           static_cast<double>(m[8]) * m[7] * m[14] - static_cast<double>(m[12]) * m[6] * m[11] + static_cast<double>(m[12]) * m[7] * m[10];
  inv[8] = static_cast<double>(m[4]) * m[9] * m[15] - static_cast<double>(m[4]) * m[11] * m[13] - static_cast<double>(m[8]) * m[5] * m[15] +
           static_cast<double>(m[8]) * m[7] * m[13] + static_cast<double>(m[12]) * m[5] * m[11] - static_cast<double>(m[12]) * m[7] * m[9];
  inv[12] = -static_cast<double>(m[4]) * m[9] * m[14] + static_cast<double>(m[4]) * m[10] * m[13] + static_cast<double>(m[8]) * m[5] * m[14] -
            static_cast<double>(m[8]) * m[6] * m[13] - static_cast<double>(m[12]) * m[5] * m[10] + static_cast<double>(m[12]) * m[6] * m[9];
  inv[1] = -static_cast<double>(m[1]) * m[10] * m[15] + static_cast<double>(m[1]) * m[11] * m[14] + static_cast<double>(m[9]) * m[2] * m[15] -
           static_cast<double>(m[9]) * m[3] * m[14] - static_cast<double>(m[13]) * m[2] * m[11] + static_cast<double>(m[13]) * m[3] * m[10];
  inv[5] = static_cast<double>(m[0]) * m[10] * m[15] - static_cast<double>(m[0]) * m[11] * m[14] - static_cast<double>(m[8]) * m[2] * m[15] +
           static_cast<double>(m[8]) * m[3] * m[14] + static_cast<double>(m[12]) * m[2] * m[11] - static_cast<double>(m[12]) * m[3] * m[10];
  inv[9] = -static_cast<double>(m[0]) * m[9] * m[15] + static_cast<double>(m[0]) * m[11] * m[13] + static_cast<double>(m[8]) * m[1] * m[15] -
           static_cast<double>(m[8]) * m[3] * m[13] - static_cast<double>(m[12]) * m[1] * m[11] + static_cast<double>(m[12]) * m[3] * m[9];
  inv[13] = static_cast<double>(m[0]) * m[9] * m[14] - static_cast<double>(m[0]) * m[10] * m[13] - static_cast<double>(m[8]) * m[1] * m[14] +
            static_cast<double>(m[8]) * m[2] * m[13] + static_cast<double>(m[12]) * m[1] * m[10] - static_cast<double>(m[12]) * m[2] * m[9];
  inv[2] = static_cast<double>(m[1]) * m[6] * m[15] - static_cast<double>(m[1]) * m[7] * m[14] - static_cast<double>(m[5]) * m[2] * m[15] +
           static_cast<double>(m[5]) * m[3] * m[14] + static_cast<double>(m[13]) * m[2] * m[7] - static_cast<double>(m[13]) * m[3] * m[6];
  inv[6] = -static_cast<double>(m[0]) * m[6] * m[15] + static_cast<double>(m[0]) * m[7] * m[14] + static_cast<double>(m[4]) * m[2] * m[15] -
           static_cast<double>(m[4]) * m[3] * m[14] - static_cast<double>(m[12]) * m[2] * m[7] + static_cast<double>(m[12]) * m[3] * m[6];
  inv[10] = static_cast<double>(m[0]) * m[5] * m[15] - static_cast<double>(m[0]) * m[7] * m[13] - static_cast<double>(m[4]) * m[1] * m[15] +
            static_cast<double>(m[4]) * m[3] * m[13] + static_cast<double>(m[12]) * m[1] * m[7] - static_cast<double>(m[12]) * m[3] * m[5];
  inv[14] = -static_cast<double>(m[0]) * m[5] * m[14] + static_cast<double>(m[0]) * m[6] * m[13] + static_cast<double>(m[4]) * m[1] * m[14] -
            static_cast<double>(m[4]) * m[2] * m[13] - static_cast<double>(m[12]) * m[1] * m[6] + static_cast<double>(m[12]) * m[2] * m[5];
  inv[3] = -static_cast<double>(m[1]) * m[6] * m[11] + static_cast<double>(m[1]) * m[7] * m[10] + static_cast<double>(m[5]) * m[2] * m[11] -
           static_cast<double>(m[5]) * m[3] * m[10] - static_cast<double>(m[9]) * m[2] * m[7] + static_cast<double>(m[9]) * m[3] * m[6];
  inv[7] = static_cast<double>(m[0]) * m[6] * m[11] - static_cast<double>(m[0]) * m[7] * m[10] - static_cast<double>(m[4]) * m[2] * m[11] +
           static_cast<double>(m[4]) * m[3] * m[10] + static_cast<double>(m[8]) * m[2] * m[7] - static_cast<double>(m[8]) * m[3] * m[6];
  inv[11] = -static_cast<double>(m[0]) * m[5] * m[11] + static_cast<double>(m[0]) * m[7] * m[9] + static_cast<double>(m[4]) * m[1] * m[11] -
            static_cast<double>(m[4]) * m[3] * m[9] - static_cast<double>(m[8]) * m[1] * m[7] + static_cast<double>(m[8]) * m[3] * m[5];
  inv[15] = static_cast<double>(m[0]) * m[5] * m[10] - static_cast<double>(m[0]) * m[6] * m[9] - static_cast<double>(m[4]) * m[1] * m[10] +
            static_cast<double>(m[4]) * m[2] * m[9] + static_cast<double>(m[8]) * m[1] * m[6] - static_cast<double>(m[8]) * m[2] * m[5];
  const double det = static_cast<double>(m[0]) * inv[0] + static_cast<double>(m[1]) * inv[4] + static_cast<double>(m[2]) * inv[8] + static_cast<double>(m[3]) * inv[12];
  if (!(std::fabs(det) > 0.0) || !std::isfinite(det)) return false;
  for (int i = 0; i < 16; ++i) out[i] = static_cast<float>(inv[i] / det);
  return true;
}

bool unproject(const float* inverse, float x, float y, float z, float out[3]) {
  const float w = inverse[3] * x + inverse[7] * y + inverse[11] * z + inverse[15];
  if (!(std::fabs(w) > 0.0f)) return false;
  out[0] = (inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12]) / w;
  out[1] = (inverse[1] * x + inverse[5] * y + inverse[9] * z + inverse[13]) / w;
  out[2] = (inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14]) / w;
  return std::isfinite(out[0]) && std::isfinite(out[1]) && std::isfinite(out[2]);
}

void lightBasis(const float* sun, float right[3], float up[3]) {
  const float helper[3] = {std::fabs(sun[1]) > kPoleLimit ? 1.0f : 0.0f, std::fabs(sun[1]) > kPoleLimit ? 0.0f : 1.0f, 0.0f};
  right[0] = helper[1] * sun[2] - helper[2] * sun[1];
  right[1] = helper[2] * sun[0] - helper[0] * sun[2];
  right[2] = helper[0] * sun[1] - helper[1] * sun[0];
  const float length = std::sqrt(right[0] * right[0] + right[1] * right[1] + right[2] * right[2]);
  for (int k = 0; k < 3; ++k) right[k] /= length;
  up[0] = sun[1] * right[2] - sun[2] * right[1];
  up[1] = sun[2] * right[0] - sun[0] * right[2];
  up[2] = sun[0] * right[1] - sun[1] * right[0];
}

float dot3(const float* a, const float* b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

void fitCascade(const float corners[8][3], Cascade& out) {
  float centre[3] = {0.0f, 0.0f, 0.0f};
  for (int c = 0; c < 8; ++c) {
    for (int k = 0; k < 3; ++k) centre[k] += corners[c][k] * 0.125f;
  }
  float farthest = 0.0f;
  for (int c = 0; c < 8; ++c) {
    const float d[3] = {corners[c][0] - centre[0], corners[c][1] - centre[1], corners[c][2] - centre[2]};
    const float squared = dot3(d, d);
    if (squared > farthest) farthest = squared;
  }
  const float texelsAcross = static_cast<float>(current.resolution);
  float radius = std::sqrt(farthest);
  const float step = std::exp2(std::ceil(std::log2(radius > 1.0e-6f ? radius : 1.0e-6f) * kRadiusSteps) / kRadiusSteps);
  radius = step * texelsAcross / (texelsAcross - 2.0f);
  const float texel = 2.0f * radius / texelsAcross;
  float right[3];
  float up[3];
  lightBasis(current.sun, right, up);
  const float alongRight = std::floor(dot3(centre, right) / texel) * texel;
  const float alongUp = std::floor(dot3(centre, up) / texel) * texel;
  const float alongSun = dot3(centre, current.sun);
  const float depth = radius * (1.0f + kCasterReach);
  const float reach = radius * kCasterReach;
  float* m = out.viewProj;
  for (int k = 0; k < 3; ++k) {
    m[k * 4] = right[k] / radius;
    m[k * 4 + 1] = up[k] / radius;
    m[k * 4 + 2] = current.sun[k] * 2.0f / (depth + radius);
    m[k * 4 + 3] = 0.0f;
  }
  m[12] = -alongRight / radius;
  m[13] = -alongUp / radius;
  m[14] = -(alongSun - radius - reach) * 2.0f / (depth + radius) - 1.0f;
  m[15] = 1.0f;
  for (int k = 0; k < 3; ++k) out.centre[k] = right[k] * alongRight + up[k] * alongUp + current.sun[k] * alongSun;
  out.radius = radius;
  out.texel = texel;
  out.pad = 0.0f;
}

}

Budget budgetFor(std::uint32_t deviceTier) {
  return kTierBudget[deviceTier < kTiers ? deviceTier : kTiers - 1];
}

std::uint32_t mapBytesOf(std::uint32_t cascades, std::uint32_t resolution) {
  return cascades * resolution * resolution * kDepthTexelBytes;
}

const State& state() {
  return current;
}

bool enabled() {
  return current.cascades != 0;
}

void reset() {
  const float sun[3] = {current.sun[0], current.sun[1], current.sun[2]};
  current = State{};
  for (int k = 0; k < 3; ++k) current.sun[k] = sun[k];
}

bool configure(std::uint32_t cascades, std::uint32_t resolution, float distance) {
  if (cascades == 0) {
    reset();
    return true;
  }
  if (cascades > kMaxCascades) return false;
  if (resolution < kMinResolution || resolution > kMaxResolution || (resolution & (resolution - 1)) != 0) return false;
  if (!(distance > 0.0f) || !std::isfinite(distance)) return false;
  reset();
  current.cascades = cascades;
  current.resolution = resolution;
  current.mapBytes = mapBytesOf(cascades, resolution);
  current.distance = distance;
  return true;
}

bool setSun(float x, float y, float z) {
  const float length = std::sqrt(x * x + y * y + z * z);
  if (!(length > 0.0f) || !std::isfinite(length)) return false;
  current.sun[0] = x / length;
  current.sun[1] = y / length;
  current.sun[2] = z / length;
  return true;
}

void splitDistances(float nearDistance, float farDistance, std::uint32_t cascades, float blend, float* out) {
  out[0] = nearDistance;
  for (std::uint32_t i = 1; i <= cascades; ++i) {
    const float along = static_cast<float>(i) / static_cast<float>(cascades);
    const float logarithmic = nearDistance * std::pow(farDistance / nearDistance, along);
    const float uniform = nearDistance + (farDistance - nearDistance) * along;
    out[i] = i == cascades ? farDistance : blend * logarithmic + (1.0f - blend) * uniform;
  }
}

bool sliceCorners(const float* viewProj, float nearFraction, float farFraction, float corners[8][3]) {
  float inverse[16];
  if (!invert(viewProj, inverse)) return false;
  for (int c = 0; c < 4; ++c) {
    const float x = (c & 1) != 0 ? 1.0f : -1.0f;
    const float y = (c & 2) != 0 ? 1.0f : -1.0f;
    float nearPoint[3];
    float farPoint[3];
    if (!unproject(inverse, x, y, -1.0f, nearPoint) || !unproject(inverse, x, y, 1.0f, farPoint)) return false;
    for (int k = 0; k < 3; ++k) {
      corners[c][k] = nearPoint[k] + (farPoint[k] - nearPoint[k]) * nearFraction;
      corners[c + 4][k] = nearPoint[k] + (farPoint[k] - nearPoint[k]) * farFraction;
    }
  }
  return true;
}

bool fit(const float* viewProj) {
  if (!enabled()) return false;
  float whole[8][3];
  if (!sliceCorners(viewProj, 0.0f, 1.0f, whole)) return false;
  float inverse[16];
  invert(viewProj, inverse);
  float eyeNear[3];
  float eyeFar[3];
  if (!unproject(inverse, 0.0f, 0.0f, -1.0f, eyeNear) || !unproject(inverse, 0.0f, 0.0f, 1.0f, eyeFar)) return false;
  const float axis[3] = {eyeFar[0] - eyeNear[0], eyeFar[1] - eyeNear[1], eyeFar[2] - eyeNear[2]};
  const float span = std::sqrt(dot3(axis, axis));
  if (!(span > 0.0f)) return false;
  const float side[3] = {whole[0][0] - eyeNear[0], whole[0][1] - eyeNear[1], whole[0][2] - eyeNear[2]};
  const float nearHalf = std::sqrt(dot3(side, side));
  const float farSide[3] = {whole[4][0] - eyeFar[0], whole[4][1] - eyeFar[1], whole[4][2] - eyeFar[2]};
  const float farHalf = std::sqrt(dot3(farSide, farSide));
  const float nearDistance = farHalf > nearHalf ? span * nearHalf / (farHalf - nearHalf) : span;
  const float farDistance = nearDistance + (current.distance < span ? current.distance : span);
  float splits[kMaxCascades + 1];
  splitDistances(nearDistance, farDistance, current.cascades, kSplitBlend, splits);
  for (std::uint32_t i = 0; i < current.cascades; ++i) {
    float corners[8][3];
    if (!sliceCorners(viewProj, (splits[i] - nearDistance) / span, (splits[i + 1] - nearDistance) / span, corners)) return false;
    Cascade& cascade = current.cascade[i];
    fitCascade(corners, cascade);
    cascade.splitNear = splits[i];
    cascade.splitFar = splits[i + 1];
  }
  current.fits += 1;
  return true;
}

}
