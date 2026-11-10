#include "device_tier.h"

namespace engine::device {

namespace {

constexpr std::uint64_t kMiB = 1024ull * 1024ull;
constexpr std::uint64_t kMemoryShareDivisor = 4;

struct Tier {
  std::uint32_t textureSide;
  std::uint32_t textureLayers;
  std::uint32_t modelSlots;
  std::uint32_t verticesPerModel;
  std::uint32_t indicesPerModel;
  std::uint32_t uploadBytesPerFrame;
  std::uint64_t vramBudgetBytes;
};

constexpr Tier kTiers[kTierCount] = {
    {512, 64, 128, 4096, 12288, 512u * 1024u, 256 * kMiB},
    {1024, 128, 256, 16384, 49152, 1024u * 1024u, 512 * kMiB},
    {2048, 96, 256, 32768, 98304, 2048u * 1024u, 1024 * kMiB},
};

std::uint64_t textureBytes(std::uint32_t side, std::uint32_t layers, std::uint32_t texelBytes) {
  const std::uint64_t base = static_cast<std::uint64_t>(layers) * side * side * texelBytes;
  return base + base / 3;
}

std::uint64_t vertexBytes(std::uint32_t slots, std::uint32_t vertices) {
  return static_cast<std::uint64_t>(slots) * vertices * kVertexStrideBytes;
}

std::uint64_t indexBytes(std::uint32_t slots, std::uint32_t indices) {
  return static_cast<std::uint64_t>(slots) * indices * kIndexBytes;
}

std::uint64_t budgetFor(const Tier& tier, const Limits& limits) {
  if (limits.deviceMemoryBytes == 0) return tier.vramBudgetBytes;
  const std::uint64_t share = limits.deviceMemoryBytes / kMemoryShareDivisor;
  return share < tier.vramBudgetBytes ? share : tier.vramBudgetBytes;
}

bool fits(const Tier& tier, const Limits& limits) {
  if (tier.textureSide > limits.maxTextureDimension2D) return false;
  if (tier.textureLayers > limits.maxTextureArrayLayers) return false;
  if (vertexBytes(tier.modelSlots, tier.verticesPerModel) > limits.maxBufferSize) return false;
  if (indexBytes(tier.modelSlots, tier.indicesPerModel) > limits.maxBufferSize) return false;
  const std::uint64_t total = textureBytes(tier.textureSide, tier.textureLayers, limits.texelBytes) +
                              vertexBytes(tier.modelSlots, tier.verticesPerModel) +
                              indexBytes(tier.modelSlots, tier.indicesPerModel);
  return total <= budgetFor(tier, limits);
}

}

std::uint64_t vramBytesOf(const Plan& planned) {
  return textureBytes(planned.textureSide, planned.textureLayers, planned.texelBytes) +
         vertexBytes(planned.modelSlots, planned.verticesPerModel) +
         indexBytes(planned.modelSlots, planned.indicesPerModel);
}

bool plan(const Limits& limits, Plan& out) {
  if (limits.texelBytes != 1 && limits.texelBytes != 4) return false;
  for (std::uint32_t i = kTierCount; i > 0; --i) {
    const Tier& tier = kTiers[i - 1];
    if (!fits(tier, limits)) continue;
    out.tier = i - 1;
    out.textureSide = tier.textureSide;
    out.textureLayers = tier.textureLayers;
    out.texelBytes = limits.texelBytes;
    out.modelSlots = tier.modelSlots;
    out.verticesPerModel = tier.verticesPerModel;
    out.indicesPerModel = tier.indicesPerModel;
    out.vertexStrideBytes = kVertexStrideBytes;
    out.uploadBytesPerFrame = tier.uploadBytesPerFrame;
    out.vramBudgetBytes = budgetFor(tier, limits);
    out.vramBytes = vramBytesOf(out);
    return true;
  }
  return false;
}

}
