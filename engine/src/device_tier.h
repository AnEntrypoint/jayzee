#ifndef ENGINE_DEVICE_TIER_H
#define ENGINE_DEVICE_TIER_H

#include <cstdint>

namespace engine::device {

constexpr std::uint32_t kTierCount = 3;
constexpr std::uint32_t kVertexStrideBytes = 32;
constexpr std::uint32_t kIndexBytes = 4;

struct Limits {
  std::uint32_t maxTextureDimension2D;
  std::uint32_t maxTextureArrayLayers;
  std::uint64_t maxBufferSize;
  std::uint32_t texelBytes;
  std::uint64_t deviceMemoryBytes;
};

struct Plan {
  std::uint32_t tier;
  std::uint32_t textureSide;
  std::uint32_t textureLayers;
  std::uint32_t texelBytes;
  std::uint32_t modelSlots;
  std::uint32_t verticesPerModel;
  std::uint32_t indicesPerModel;
  std::uint32_t vertexStrideBytes;
  std::uint32_t uploadBytesPerFrame;
  std::uint64_t vramBudgetBytes;
  std::uint64_t vramBytes;
};

bool plan(const Limits& limits, Plan& out);
bool planTier(std::uint32_t tier, std::uint32_t texelBytes, Plan& out);
std::uint64_t vramBytesOf(const Plan& planned);

}

#endif
