#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

#include "arena.h"
#include "harness.h"
#include "materials.h"
#include "textures.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr std::uint32_t kMaterialCapacity = 4;
constexpr std::uint32_t kTextureCapacity = 2;
constexpr std::uint32_t kRetireCycles = kLastGeneration;
constexpr std::uint32_t kChurnCycles = 10000;
constexpr std::size_t kRegionScratchBytes = 512;
constexpr double kTextureSide = 4.0;
constexpr double kNeverIssuedHandle = 3.0;
constexpr float kValidRed = 0.25f;
constexpr float kValidGreen = 0.5f;
constexpr float kValidBlue = 0.75f;
constexpr float kValidAlpha = 1.0f;
constexpr float kValidRoughness = 0.5f;
constexpr float kOutOfRangeColour = 1.5f;
constexpr float kNegativeChannel = -0.1f;
constexpr float kNegativeEmissive = -0.5f;
constexpr std::uint32_t kAlignment = 8;
constexpr std::uint32_t kTextureFormat = textures::kFormatRgba8Unorm;
constexpr std::uint32_t kSrgbFormat = textures::kFormatRgba8Srgb;
constexpr std::uint32_t kUnknownFormat = 9;
constexpr std::uint32_t kHeldMaterials = kMaterialCapacity - 1;
constexpr std::uint32_t kHeldTextures = kTextureCapacity - 1;

materials::Values validValues(double albedo) {
  return materials::Values{kValidRed, kValidGreen, kValidBlue, kValidAlpha, kValidRoughness, 0.0f, 0.0f, 0.0f, 0.0f, albedo};
}

bool refusedWith(double result, Status expected) {
  return result == static_cast<double>(expected);
}

void retireMaterialSlot() {
  bool cyclesOk = true;
  std::uint32_t stillLive = 0;
  double last = 0.0;
  for (std::uint32_t cycle = 0; cycle < kRetireCycles; ++cycle) {
    const double handle = materials::add(validValues(0.0));
    if (handle < 0.0) {
      cyclesOk = false;
      break;
    }
    last = handle;
    if (materials::remove(handle) != kOk) cyclesOk = false;
    if (materials::isLive(handle)) stillLive += 1;
  }
  check(cyclesOk, "phase 8: 65534 material add and remove cycles on one slot all succeed");
  check(stillLive == 0, "phase 8: no issued material handle is live after its release");
  check(static_cast<std::uint64_t>(last) / handles::kSpan == kLastGeneration,
        "phase 8: the last material handle carries generation 65534");
  check(materials::liveCount() == 0, "phase 8: the material pool is empty after the retirement cycles");
  check(materials::remove(last) == kBadId, "phase 8: a release of the last material handle is refused");

  double held[kMaterialCapacity];
  std::uint32_t acquired = 0;
  for (std::uint32_t i = 0; i < kMaterialCapacity; ++i) {
    const double handle = materials::add(validValues(0.0));
    if (handle >= 0.0) held[acquired++] = handle;
  }
  check(acquired == kHeldMaterials, "phase 8: a retired material slot is never acquired again");
  check(refusedWith(materials::add(validValues(0.0)), kFull), "phase 8: a full material pool refuses with kFull");
  for (std::uint32_t i = 0; i < acquired; ++i) {
    check(materials::remove(held[i]) == kOk, "phase 8: a held material removes");
  }
  observe("phase 8: material liveCount after releasing the held slots", static_cast<double>(materials::liveCount()));
}

void retireTextureSlot() {
  bool cyclesOk = true;
  std::uint32_t stillLive = 0;
  double last = 0.0;
  for (std::uint32_t cycle = 0; cycle < kRetireCycles; ++cycle) {
    const double handle = textures::add(kTextureSide, kTextureSide, kTextureFormat);
    if (handle < 0.0) {
      cyclesOk = false;
      break;
    }
    last = handle;
    if (textures::remove(handle) != kOk) cyclesOk = false;
    if (textures::isLive(handle)) stillLive += 1;
  }
  check(cyclesOk, "phase 8: 65534 texture add and remove cycles on one slot all succeed");
  check(stillLive == 0, "phase 8: no issued texture handle is live after its release");
  check(static_cast<std::uint64_t>(last) / handles::kSpan == kLastGeneration,
        "phase 8: the last texture handle carries generation 65534");
  check(textures::liveCount() == 0, "phase 8: the texture pool is empty after the retirement cycles");
  check(textures::remove(last) == kBadId, "phase 8: a release of the last texture handle is refused");

  double held[kTextureCapacity];
  std::uint32_t acquired = 0;
  for (std::uint32_t i = 0; i < kTextureCapacity; ++i) {
    const double handle = textures::add(kTextureSide, kTextureSide, kTextureFormat);
    if (handle >= 0.0) held[acquired++] = handle;
  }
  check(acquired == kHeldTextures, "phase 8: a retired texture slot is never acquired again");
  check(refusedWith(textures::add(kTextureSide, kTextureSide, kTextureFormat), kFull), "phase 8: a full texture pool refuses with kFull");
  for (std::uint32_t i = 0; i < acquired; ++i) {
    check(textures::remove(held[i]) == kOk, "phase 8: a held texture removes");
  }
}

void materialRefusals(void* base) {
  static std::uint8_t before[kRegionScratchBytes];
  static std::uint8_t after[kRegionScratchBytes];
  const std::size_t bytes = materials::bytesFor(kMaterialCapacity);
  std::memcpy(before, base, bytes);
  const std::uint32_t live0 = materials::liveCount();
  const std::uint32_t view0 = materials::viewOffset();

  materials::Values colour = validValues(0.0);
  colour.r = kOutOfRangeColour;
  check(refusedWith(materials::add(colour), kRange), "phase 8: a colour above 1 is refused with kRange");

  materials::Values negative = validValues(0.0);
  negative.g = kNegativeChannel;
  check(refusedWith(materials::add(negative), kRange), "phase 8: a colour below 0 is refused with kRange");

  materials::Values notANumber = validValues(0.0);
  notANumber.a = std::numeric_limits<float>::quiet_NaN();
  check(refusedWith(materials::add(notANumber), kRange), "phase 8: a NaN alpha is refused with kRange");

  materials::Values emissive = validValues(0.0);
  emissive.emissiveR = kNegativeEmissive;
  check(refusedWith(materials::add(emissive), kRange), "phase 8: an emissive below zero is refused with kRange");

  check(refusedWith(materials::add(validValues(kNeverIssuedHandle)), kBadId),
        "phase 8: an albedo that was never issued is refused with kBadId");

  std::memcpy(after, base, bytes);
  check(std::memcmp(before, after, bytes) == 0 && materials::liveCount() == live0 && materials::viewOffset() == view0,
        "phase 8: refused materials leave the table unchanged");
}

void textureRefusals() {
  const std::uint32_t live0 = textures::liveCount();
  check(refusedWith(textures::add(0.0, kTextureSide, kTextureFormat), kRange), "phase 8: a zero-width texture is refused with kRange");
  check(refusedWith(textures::add(kTextureSide, kTextureSide, kUnknownFormat), kRange),
        "phase 8: an unknown texture format is refused with kRange");
  check(refusedWith(textures::add(4.5, kTextureSide, kTextureFormat), kRange), "phase 8: a fractional width is refused with kRange");
  check(textures::liveCount() == live0, "phase 8: refused textures leave the texture pool unchanged");
}

void liveAlbedo(void* materialBase) {
  const double texture = textures::add(kTextureSide, kTextureSide, kSrgbFormat);
  check(texture >= 0.0, "phase 8: a texture is added for an albedo");
  check(textures::layer(texture) >= 0, "phase 8: the texture has a layer");
  const double material = materials::add(validValues(texture));
  check(material >= 0.0, "phase 8: a material with a live albedo is accepted");
  const materials::Slot* slots = reinterpret_cast<const materials::Slot*>(materialBase);
  const int index = materials::slot(material);
  check(index >= 0 && slots[index].albedo == static_cast<std::uint32_t>(texture), "phase 8: the albedo is stored in the material slot");
  check(slots[index].r == kValidRed && slots[index].roughness == kValidRoughness, "phase 8: the colour is stored in the slot");
  check(materials::remove(material) == kOk && textures::remove(texture) == kOk, "phase 8: the live albedo pair removes");
}

void deadAlbedo(void* materialBase) {
  static std::uint8_t before[kRegionScratchBytes];
  static std::uint8_t after[kRegionScratchBytes];
  const std::size_t bytes = materials::bytesFor(kMaterialCapacity);
  const double texture = textures::add(kTextureSide, kTextureSide, kTextureFormat);
  check(textures::remove(texture) == kOk, "phase 8: a texture is removed to leave a dead albedo");
  std::memcpy(before, materialBase, bytes);
  const std::uint32_t live0 = materials::liveCount();
  check(refusedWith(materials::add(validValues(texture)), kBadId), "phase 8: a material with a removed albedo is refused with kBadId");
  std::memcpy(after, materialBase, bytes);
  check(std::memcmp(before, after, bytes) == 0 && materials::liveCount() == live0,
        "phase 8: a material refused for a dead albedo leaves the table unchanged");
}

void materialChurn() {
  const std::size_t used0 = arena::used();
  const std::uint32_t view0 = materials::viewOffset();
  bool cyclesOk = true;
  for (std::uint32_t cycle = 0; cycle < kChurnCycles; ++cycle) {
    const double handle = materials::add(validValues(0.0));
    if (handle < 0.0) {
      cyclesOk = false;
      continue;
    }
    if (materials::remove(handle) != kOk) cyclesOk = false;
  }
  check(cyclesOk, "phase 8: 10000 material add and remove cycles all succeed");
  check(arena::used() == used0, "phase 8: the arena used bytes are unchanged over 10000 material cycles");
  check(materials::viewOffset() == view0, "phase 8: the material view offset is unchanged over 10000 cycles");
  check(materials::liveCount() == 0, "phase 8: no material is live after the churn");
}

void textureChurn() {
  const std::size_t used0 = arena::used();
  bool cyclesOk = true;
  for (std::uint32_t cycle = 0; cycle < kChurnCycles; ++cycle) {
    const double handle = textures::add(kTextureSide, kTextureSide, kTextureFormat);
    if (handle < 0.0) {
      cyclesOk = false;
      continue;
    }
    if (textures::remove(handle) != kOk) cyclesOk = false;
  }
  check(cyclesOk, "phase 8: 10000 texture add and remove cycles all succeed");
  check(arena::used() == used0, "phase 8: the arena used bytes are unchanged over 10000 texture cycles");
  check(textures::liveCount() == 0, "phase 8: no texture is live after the churn");
}

}

void phase8Resources() {
  void* materialBase = arena::carve(materials::bytesFor(kMaterialCapacity), kAlignment);
  void* textureBase = arena::carve(textures::bytesFor(kTextureCapacity), kAlignment);
  check(materialBase != nullptr && textureBase != nullptr, "phase 8: the material and texture regions are carved from the arena");
  check(textures::bind(textureBase, kTextureCapacity) == kOk, "phase 8: the texture pool binds once");
  check(materials::bind(materialBase, kMaterialCapacity) == kOk, "phase 8: the material pool binds once");
  check(materials::kStrideBytes == 40, "phase 8: a material slot is 40 bytes");
  retireMaterialSlot();
  retireTextureSlot();
  materialRefusals(materialBase);
  textureRefusals();
  liveAlbedo(materialBase);
  deadAlbedo(materialBase);
  materialChurn();
  textureChurn();
}

}
