#ifndef ENGINE_TEST_OCCLUSION_REFERENCE_H
#define ENGINE_TEST_OCCLUSION_REFERENCE_H

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace engine::witness::occlusion {

constexpr std::uint32_t kMaxSide = 64;
constexpr std::uint32_t kMaxLevels = 7;

struct Pyramid {
  std::uint32_t width;
  std::uint32_t height;
  std::uint32_t levels;
  float texel[kMaxLevels][kMaxSide * kMaxSide];
};

struct Footprint {
  float ax;
  float ay;
  float bx;
  float by;
  float zmin;
};

inline std::uint32_t powerOfTwoAtLeast(std::uint32_t value) {
  std::uint32_t size = 1;
  while (size < value) size <<= 1;
  return size;
}

inline std::uint32_t levelsFor(std::uint32_t width, std::uint32_t height) {
  std::uint32_t side = width > height ? width : height;
  std::uint32_t levels = 1;
  while (side > 1) {
    side >>= 1;
    levels += 1;
  }
  return levels;
}

inline std::uint32_t levelExtent(std::uint32_t base, std::uint32_t level) {
  return std::max(base >> level, 1u);
}

inline void build(Pyramid& pyramid, const float* depth, std::uint32_t surfaceWidth, std::uint32_t surfaceHeight) {
  pyramid.width = powerOfTwoAtLeast(surfaceWidth);
  pyramid.height = powerOfTwoAtLeast(surfaceHeight);
  pyramid.levels = levelsFor(pyramid.width, pyramid.height);
  for (std::uint32_t y = 0; y < pyramid.height; ++y) {
    for (std::uint32_t x = 0; x < pyramid.width; ++x) {
      const bool inside = x < surfaceWidth && y < surfaceHeight;
      pyramid.texel[0][y * kMaxSide + x] = inside ? depth[y * surfaceWidth + x] : 1.0f;
    }
  }
  for (std::uint32_t level = 1; level < pyramid.levels; ++level) {
    const std::uint32_t previousWidth = levelExtent(pyramid.width, level - 1);
    const std::uint32_t previousHeight = levelExtent(pyramid.height, level - 1);
    const std::uint32_t width = levelExtent(pyramid.width, level);
    const std::uint32_t height = levelExtent(pyramid.height, level);
    for (std::uint32_t y = 0; y < height; ++y) {
      for (std::uint32_t x = 0; x < width; ++x) {
        float farthest = 0.0f;
        for (std::uint32_t dy = 0; dy < 2; ++dy) {
          for (std::uint32_t dx = 0; dx < 2; ++dx) {
            const std::uint32_t sx = std::min(2 * x + dx, previousWidth - 1);
            const std::uint32_t sy = std::min(2 * y + dy, previousHeight - 1);
            farthest = std::max(farthest, pyramid.texel[level - 1][sy * kMaxSide + sx]);
          }
        }
        pyramid.texel[level][y * kMaxSide + x] = farthest;
      }
    }
  }
}

inline bool footprint(const float viewProj[16], const float centre[3], float radius, std::uint32_t surfaceWidth, std::uint32_t surfaceHeight, Footprint& out) {
  float lowX = 1e30f;
  float lowY = 1e30f;
  float highX = -1e30f;
  float highY = -1e30f;
  float zmin = 1e30f;
  for (std::uint32_t corner = 0; corner < 8; ++corner) {
    const float point[4] = {
        centre[0] + ((corner & 1u) ? radius : -radius),
        centre[1] + ((corner & 2u) ? radius : -radius),
        centre[2] + ((corner & 4u) ? radius : -radius),
        1.0f,
    };
    float clip[4];
    for (std::uint32_t row = 0; row < 4; ++row) {
      clip[row] = viewProj[row] * point[0] + viewProj[4 + row] * point[1] + viewProj[8 + row] * point[2] + viewProj[12 + row] * point[3];
    }
    if (clip[3] <= 1e-6f) return false;
    const float ndcX = clip[0] / clip[3];
    const float ndcY = clip[1] / clip[3];
    lowX = std::min(lowX, ndcX);
    lowY = std::min(lowY, ndcY);
    highX = std::max(highX, ndcX);
    highY = std::max(highY, ndcY);
    zmin = std::min(zmin, (clip[2] + clip[3]) * 0.5f / clip[3]);
  }
  const float w = static_cast<float>(surfaceWidth);
  const float h = static_cast<float>(surfaceHeight);
  out.ax = std::clamp((lowX * 0.5f + 0.5f) * w, 0.0f, w - 1.0f);
  out.ay = std::clamp((0.5f - highY * 0.5f) * h, 0.0f, h - 1.0f);
  out.bx = std::clamp((highX * 0.5f + 0.5f) * w, 0.0f, w - 1.0f);
  out.by = std::clamp((0.5f - lowY * 0.5f) * h, 0.0f, h - 1.0f);
  out.zmin = zmin;
  return true;
}

inline bool occluded(const Pyramid& pyramid, const float viewProj[16], const float centre[3], float radius, std::uint32_t surfaceWidth, std::uint32_t surfaceHeight) {
  Footprint f{};
  if (!footprint(viewProj, centre, radius, surfaceWidth, surfaceHeight, f)) return false;
  const float span = std::max(f.bx - f.ax, f.by - f.ay);
  std::uint32_t level = static_cast<std::uint32_t>(std::ceil(std::log2(std::max(span, 1.0f))));
  if (level >= pyramid.levels) level = pyramid.levels - 1;
  const float scale = static_cast<float>(1u << level);
  const std::uint32_t mostX = levelExtent(pyramid.width, level) - 1;
  const std::uint32_t mostY = levelExtent(pyramid.height, level) - 1;
  const std::uint32_t x0 = std::min(static_cast<std::uint32_t>(std::floor(f.ax / scale)), mostX);
  const std::uint32_t y0 = std::min(static_cast<std::uint32_t>(std::floor(f.ay / scale)), mostY);
  const std::uint32_t x1 = std::min(static_cast<std::uint32_t>(std::floor(f.bx / scale)), mostX);
  const std::uint32_t y1 = std::min(static_cast<std::uint32_t>(std::floor(f.by / scale)), mostY);
  const float* texels = pyramid.texel[level];
  const float farthest = std::max(std::max(texels[y0 * kMaxSide + x0], texels[y0 * kMaxSide + x1]),
                                  std::max(texels[y1 * kMaxSide + x0], texels[y1 * kMaxSide + x1]));
  return f.zmin > farthest + 1e-5f;
}

inline bool everyPixelBehind(const Footprint& f, const float* depth, std::uint32_t surfaceWidth) {
  const std::uint32_t x0 = static_cast<std::uint32_t>(std::floor(f.ax));
  const std::uint32_t x1 = static_cast<std::uint32_t>(std::floor(f.bx));
  const std::uint32_t y0 = static_cast<std::uint32_t>(std::floor(f.ay));
  const std::uint32_t y1 = static_cast<std::uint32_t>(std::floor(f.by));
  for (std::uint32_t y = y0; y <= y1; ++y) {
    for (std::uint32_t x = x0; x <= x1; ++x) {
      if (!(depth[y * surfaceWidth + x] + 1e-5f < f.zmin)) return false;
    }
  }
  return true;
}

}

#endif
