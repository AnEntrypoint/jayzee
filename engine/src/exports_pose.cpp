#include <cstdint>

#include <emscripten/emscripten.h>

#include "planet_frame.h"
#include "pose_handoff.h"
#include "tick_profile.h"
#include "world.h"

namespace {

constexpr int kScratchSpot = 0;
constexpr int kScratchHeight = 3;
constexpr int kScratchViewTarget = 4;
constexpr int kScratchViewCos = 7;
constexpr int kScratchViewRange = 8;
double frameScratch[9] = {};

}

extern "C" {

double engine_planet_height(double x, double y, double z);

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_pose_bytes() {
  return engine::pose::bytesFor(engine::world().bodyCapacity());
}

EMSCRIPTEN_KEEPALIVE std::uint8_t* engine_pose_reserve() {
  return engine::pose::reserve();
}

EMSCRIPTEN_KEEPALIVE std::int32_t engine_pose_export(std::uint8_t* dst, std::uint32_t capacity) {
  ENGINE_PROFILE_SCOPE("engine pose export");
  return engine::pose::exportPoses(dst, capacity);
}

EMSCRIPTEN_KEEPALIVE int engine_pose_import(const std::uint8_t* src, std::uint32_t bytes) {
  return engine::pose::importPoses(src, bytes);
}

EMSCRIPTEN_KEEPALIVE int engine_follow(double x, double y, double z) {
  return engine::world().follow(x, y, z);
}

EMSCRIPTEN_KEEPALIVE double* engine_frame_scratch() {
  return frameScratch;
}

EMSCRIPTEN_KEEPALIVE int engine_follow_scratch() {
  ENGINE_PROFILE_SCOPE("engine follow");
  engine::planet::state().pages.applyPending();
  return engine::world().follow(frameScratch[0], frameScratch[1], frameScratch[2]);
}

EMSCRIPTEN_KEEPALIVE void engine_planet_height_scratch() {
  frameScratch[kScratchHeight] = engine_planet_height(frameScratch[0], frameScratch[1], frameScratch[2]);
}

EMSCRIPTEN_KEEPALIVE int engine_release_view_scratch() {
  const double* eye = frameScratch + kScratchSpot;
  const double* target = frameScratch + kScratchViewTarget;
  const double direction[3] = {target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]};
  return engine::world().setReleaseView(eye, direction, frameScratch[kScratchViewCos], frameScratch[kScratchViewRange]);
}

}
