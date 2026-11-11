#include <cstdint>

#include <emscripten/emscripten.h>

#include "planet_frame.h"
#include "pose_handoff.h"
#include "world.h"

namespace {

double frameScratch[4] = {};

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
  engine::planet::state().pages.applyPending();
  return engine::world().follow(frameScratch[0], frameScratch[1], frameScratch[2]);
}

EMSCRIPTEN_KEEPALIVE void engine_planet_height_scratch() {
  frameScratch[3] = engine_planet_height(frameScratch[0], frameScratch[1], frameScratch[2]);
}

}
