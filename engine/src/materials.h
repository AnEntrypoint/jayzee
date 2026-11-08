#ifndef ENGINE_MATERIALS_H
#define ENGINE_MATERIALS_H

#include <cstddef>
#include <cstdint>

#include "textures.h"
#include "world.h"

namespace engine::materials {

struct Slot {
  float r;
  float g;
  float b;
  float a;
  float roughness;
  float metallic;
  float emissiveR;
  float emissiveG;
  float emissiveB;
  std::uint32_t albedo;
};

struct Values {
  float r;
  float g;
  float b;
  float a;
  float roughness;
  float metallic;
  float emissiveR;
  float emissiveG;
  float emissiveB;
  double albedo;
};

constexpr std::size_t kStrideBytes = sizeof(Slot);
constexpr std::uint32_t kStrideWords = 10;
constexpr std::uint32_t kAlbedoWord = 9;

static_assert(sizeof(Slot) == 40, "a material slot is 10 words");

constexpr std::size_t bytesFor(std::uint32_t capacity) {
  return static_cast<std::size_t>(capacity) * sizeof(Slot) + handles::bytesFor(capacity);
}

Status bind(void* base, std::uint32_t capacity);
bool bound();
std::uint32_t capacity();
std::uint32_t viewOffset();
std::uint32_t liveCount();
double add(const Values& values);
Status set(double handle, const Values& values);
Status remove(double handle);
bool isLive(double handle);
int slot(double handle);

}

#endif
