#include <cstdint>

#include <emscripten/emscripten.h>

#include "materials.h"
#include "textures.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE double engine_material_add(float r, float g, float b, float a, float roughness, float metallic, float emissiveR,
                                                float emissiveG, float emissiveB, double albedo) {
  return engine::materials::add(engine::materials::Values{r, g, b, a, roughness, metallic, emissiveR, emissiveG, emissiveB, albedo});
}

EMSCRIPTEN_KEEPALIVE int engine_material_set(double handle, float r, float g, float b, float a, float roughness, float metallic,
                                             float emissiveR, float emissiveG, float emissiveB, double albedo) {
  return engine::materials::set(handle, engine::materials::Values{r, g, b, a, roughness, metallic, emissiveR, emissiveG, emissiveB, albedo});
}

EMSCRIPTEN_KEEPALIVE int engine_material_remove(double handle) {
  return engine::materials::remove(handle);
}

EMSCRIPTEN_KEEPALIVE int engine_material_is_live(double handle) {
  return engine::materials::isLive(handle) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int engine_material_slot(double handle) {
  return engine::materials::slot(handle);
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_material_view_offset() {
  return engine::materials::viewOffset();
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_material_count() {
  return engine::materials::bound() ? engine::materials::capacity() : 0u;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_material_live_count() {
  return engine::materials::bound() ? engine::materials::liveCount() : 0u;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_material_stride_bytes() {
  return static_cast<std::uint32_t>(engine::materials::kStrideBytes);
}

EMSCRIPTEN_KEEPALIVE double engine_texture_add(double width, double height, double format) {
  return engine::textures::add(width, height, format);
}

EMSCRIPTEN_KEEPALIVE int engine_texture_remove(double handle) {
  return engine::textures::remove(handle);
}

EMSCRIPTEN_KEEPALIVE int engine_texture_is_live(double handle) {
  return engine::textures::isLive(handle) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int engine_texture_layer(double handle) {
  return engine::textures::layer(handle);
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_texture_count() {
  return engine::textures::bound() ? engine::textures::capacity() : 0u;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_texture_live_count() {
  return engine::textures::bound() ? engine::textures::liveCount() : 0u;
}

}
