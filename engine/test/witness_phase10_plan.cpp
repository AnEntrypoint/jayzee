#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

#include "harness.h"
#include "render/render_frame.h"

namespace engine::witness {

namespace {

namespace rnd = engine::render;

constexpr std::uint64_t kExpectedChecksum = 0x3fb5a6de438de68eull;
constexpr std::uint32_t kExpectedVisible[rnd::kPropClasses] = {2489, 2489, 2487, 2483};

rnd::FramePlan plan;
rnd::Camera camera;
Transform transforms[rnd::kBodySlots];
std::uint8_t classes[rnd::kBodySlots];
rnd::MaterialSlot materials[1];
std::uint8_t albedoReady[rnd::kAlbedoLayers];
std::uint8_t albedoPixels[rnd::kAlbedoLayers * rnd::kAlbedoBytes];
planet::PageCache pages;

std::int32_t noAlbedoLayer(double) {
  return -1;
}

void normalise(float* v) {
  const float l = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  const float s = l > 0.0f ? 1.0f / l : 1.0f;
  v[0] *= s;
  v[1] *= s;
  v[2] *= s;
}

void lookAt(const float* eye, float* out) {
  float z[3] = {eye[0], eye[1], eye[2]};
  normalise(z);
  float x[3] = {z[2], 0.0f, -z[0]};
  normalise(x);
  const float y[3] = {z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]};
  const float tx = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  const float ty = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  const float tz = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  const float view[16] = {x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, tx, ty, tz, 1};
  std::memcpy(out, view, sizeof view);
}

void perspective(float fovY, float aspect, float zNear, float zFar, float* out) {
  const float f = 1.0f / std::tan(fovY / 2.0f);
  const float nf = 1.0f / (zNear - zFar);
  const float proj[16] = {f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (zFar + zNear) * nf, -1, 0, 0, 2 * zFar * zNear * nf, 0};
  std::memcpy(out, proj, sizeof proj);
}

void multiply(const float* p, const float* v, float* out) {
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      float sum = 0.0f;
      for (int k = 0; k < 4; ++k) sum += p[k * 4 + r] * v[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
}

void buildScene(std::uint32_t frame) {
  for (std::uint32_t i = 0; i < rnd::kBodySlots; ++i) {
    transforms[i] = Transform{static_cast<float>(i % 100) * 0.6f - 30.0f, 1.0f + static_cast<float>(i % 5), static_cast<float>(i / 100) * 0.6f - 30.0f, 0.0f, 0.0f, 0.0f, 1.0f};
    classes[i] = static_cast<std::uint8_t>(i % rnd::kPropClasses);
  }
  const float angle = static_cast<float>(frame) * 0.01f;
  const float eye[3] = {std::sin(angle) * 60.0f, 25.0f, std::cos(angle) * 60.0f};
  float view[16];
  float proj[16];
  lookAt(eye, view);
  perspective(1.0471975512f, 1.0f, 0.1f, 500.0f, proj);
  multiply(proj, view, camera.viewProj);
  camera.eye[0] = eye[0];
  camera.eye[1] = eye[1];
  camera.eye[2] = eye[2];
  camera.eye[3] = 1.0f;
}

}

void phase10Plan() {
  using engine::test::check;
  using engine::test::observe;
  using engine::test::observeHex;

  buildScene(599);
  for (std::uint32_t layer = 0; layer < rnd::kAlbedoLayers; ++layer) albedoReady[layer] = 0;
  std::memset(albedoPixels, 0, sizeof albedoPixels);
  std::memset(materials, 0, sizeof materials);

  rnd::SceneView scene{};
  scene.transforms = transforms;
  scene.bodyCount = rnd::kBodySlots;
  scene.bodyClass = classes;
  scene.pages = &pages;
  scene.materials = materials;
  scene.materialCount = 1;
  scene.albedoReady = albedoReady;
  scene.albedoPixels = albedoPixels;
  scene.albedoLayerOf = noAlbedoLayer;

  rnd::resetPlan(plan);
  rnd::planFrame(scene, camera, plan);

  observeHex("phase 10 plan checksum", plan.checksum);
  for (std::uint32_t c = 0; c < rnd::kPropClasses; ++c) observe("phase 10 visible class", static_cast<double>(plan.propCount[c]));
  check(plan.checksum == kExpectedChecksum, "phase 10: the frame checksum is the value recorded before the plan layout change");
  bool counts = true;
  for (std::uint32_t c = 0; c < rnd::kPropClasses; ++c) counts = counts && plan.propCount[c] == kExpectedVisible[c];
  check(counts, "phase 10: the visible count per class matches the recorded values");
}

}
