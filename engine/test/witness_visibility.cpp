#include <algorithm>
#include <cstdint>

#include "harness.h"
#include "occlusion_reference.h"
#include "render/render_frame.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;
namespace occ = occlusion;
namespace rnd = engine::render;

constexpr std::uint32_t kSurfaceWidth = 37;
constexpr std::uint32_t kSurfaceHeight = 23;
constexpr std::uint32_t kPixels = kSurfaceWidth * kSurfaceHeight;
constexpr std::uint32_t kSpheres = 4000;
constexpr std::uint32_t kLargestCluster = 131071;

struct Lcg {
  std::uint32_t state;
  float next() {
    state = state * 1664525u + 1013904223u;
    return static_cast<float>(state >> 8) / 16777216.0f;
  }
};

struct Counts {
  std::uint32_t occluded;
  std::uint32_t visible;
  std::uint32_t violations;
};

float gDepth[kPixels];
occ::Pyramid gPyramid;

void perspective(float viewProj[16]) {
  const float near = 0.1f;
  const float far = 100.0f;
  const float focal = 1.7320508f;
  const float aspect = static_cast<float>(kSurfaceWidth) / static_cast<float>(kSurfaceHeight);
  for (std::uint32_t i = 0; i < 16; ++i) viewProj[i] = 0.0f;
  viewProj[0] = focal / aspect;
  viewProj[5] = focal;
  viewProj[10] = (far + near) / (near - far);
  viewProj[11] = -1.0f;
  viewProj[14] = 2.0f * far * near / (near - far);
}

void fillDepth(float* depth, Lcg& rng) {
  for (std::uint32_t i = 0; i < kPixels; ++i) {
    depth[i] = rng.next() < 0.5f ? 0.2f + 0.3f * rng.next() : 1.0f;
  }
}

Counts sweep(const float viewProj[16], const float* depth, Lcg& rng) {
  Counts counts{0, 0, 0};
  for (std::uint32_t s = 0; s < kSpheres; ++s) {
    const float centre[3] = {-3.0f + 6.0f * rng.next(), -2.0f + 4.0f * rng.next(), -2.0f - 28.0f * rng.next()};
    const float radius = 0.2f + 1.8f * rng.next();
    if (occ::occluded(gPyramid, viewProj, centre, radius, kSurfaceWidth, kSurfaceHeight)) {
      counts.occluded += 1;
      occ::Footprint footprint{};
      occ::footprint(viewProj, centre, radius, kSurfaceWidth, kSurfaceHeight, footprint);
      if (!occ::everyPixelBehind(footprint, depth, kSurfaceWidth)) counts.violations += 1;
    } else {
      counts.visible += 1;
    }
  }
  return counts;
}

std::uint32_t pyramidMismatches() {
  std::uint32_t mismatches = 0;
  for (std::uint32_t level = 1; level < gPyramid.levels; ++level) {
    const std::uint32_t width = occ::levelExtent(gPyramid.width, level);
    const std::uint32_t height = occ::levelExtent(gPyramid.height, level);
    const std::uint32_t span = 1u << level;
    for (std::uint32_t y = 0; y < height; ++y) {
      for (std::uint32_t x = 0; x < width; ++x) {
        float brute = 0.0f;
        for (std::uint32_t py = y * span; py < std::min((y + 1) * span, gPyramid.height); ++py) {
          for (std::uint32_t px = x * span; px < std::min((x + 1) * span, gPyramid.width); ++px) {
            brute = std::max(brute, gPyramid.texel[0][py * occ::kMaxSide + px]);
          }
        }
        if (brute != gPyramid.texel[level][y * occ::kMaxSide + x]) mismatches += 1;
      }
    }
  }
  return mismatches;
}

}

void visibilityAndOcclusion() {
  check(rnd::visibilityId(0, 0) == 1u, "the first triangle of cluster 0 has visibility id 1");
  check(rnd::visibilityId(0, 127) == 128u, "the last triangle of cluster 0 has visibility id 128");
  check(rnd::visibilityId(1, 0) == 129u, "cluster 1 starts right after cluster 0's 128 ids");

  bool roundTrip = true;
  const std::uint32_t clusters[5] = {0u, 1u, 255u, 4095u, kLargestCluster};
  const std::uint32_t triangles[4] = {0u, 1u, 64u, 127u};
  for (std::uint32_t cluster : clusters) {
    for (std::uint32_t triangle : triangles) {
      const std::uint32_t id = rnd::visibilityId(cluster, triangle);
      if (id == rnd::kNoVisibility || rnd::visibilityCluster(id) != cluster || rnd::visibilityTriangle(id) != triangle) roundTrip = false;
    }
  }
  check(roundTrip, "visibility ids round-trip their cluster and triangle, including the largest cluster index");
  check(rnd::visibilityId(kLargestCluster, 127) == 16777216u, "the largest visibility id is 2^24 and fits the u32 target");
  check(rnd::kTriangleMask == 127u && rnd::kTriangleBits == 7u, "a cluster of 128 triangles uses seven id bits");
  check(rnd::modelSettings().path == rnd::kModelPathVisibility && rnd::modelSettings().occlusion == 1u,
        "the model path defaults to visibility with occlusion on");

  Lcg rng{2026u};
  fillDepth(gDepth, rng);
  occ::build(gPyramid, gDepth, kSurfaceWidth, kSurfaceHeight);
  check(gPyramid.width == 64u && gPyramid.height == 32u && gPyramid.levels == 7u,
        "a 37 by 23 surface pads to a 64 by 32 pyramid of seven levels");
  check(pyramidMismatches() == 0u, "every pyramid texel equals the maximum of the pixels it covers");

  float viewProj[16];
  perspective(viewProj);
  const Counts random = sweep(viewProj, gDepth, rng);
  observe("occluded spheres of 4000 random", random.occluded);
  observe("visible spheres of 4000 random", random.visible);
  check(random.occluded > 0u && random.visible > 0u, "the random sweep sees both occluded and visible spheres");
  check(random.violations == 0u, "no sphere the pyramid calls occluded has a pixel in front of it");

  for (std::uint32_t i = 0; i < kPixels; ++i) gDepth[i] = 1.0f;
  occ::build(gPyramid, gDepth, kSurfaceWidth, kSurfaceHeight);
  Lcg blankRng{7u};
  const Counts blank = sweep(viewProj, gDepth, blankRng);
  check(blank.occluded == 0u, "with no occluder in the depth buffer no sphere is occluded");

  for (std::uint32_t i = 0; i < kPixels; ++i) gDepth[i] = 0.2f;
  occ::build(gPyramid, gDepth, kSurfaceWidth, kSurfaceHeight);
  const float centre[3] = {0.0f, 0.0f, -10.0f};
  occ::Footprint footprint{};
  const bool inFront = occ::footprint(viewProj, centre, 0.5f, kSurfaceWidth, kSurfaceHeight, footprint);
  check(inFront && occ::occluded(gPyramid, viewProj, centre, 0.5f, kSurfaceWidth, kSurfaceHeight),
        "a sphere behind a full wall of depth 0.2 is occluded");
  const float behind[3] = {0.0f, 0.0f, 5.0f};
  check(!occ::occluded(gPyramid, viewProj, behind, 0.5f, kSurfaceWidth, kSurfaceHeight),
        "a sphere behind the camera is never occluded");
}

}
