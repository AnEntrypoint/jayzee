#ifndef ENGINE_MODEL_POOL_H
#define ENGINE_MODEL_POOL_H

#include <cstddef>
#include <cstdint>

#include "world.h"

namespace engine::models {

constexpr std::size_t kAlignment = 16;
constexpr std::uint32_t kIndexBytes = 4;

struct Layout {
  std::uint32_t slots;
  std::uint32_t verticesPerSlot;
  std::uint32_t indicesPerSlot;
  std::uint32_t vertexStrideBytes;
};

struct Range {
  std::uint32_t firstVertex;
  std::uint32_t vertexCount;
  std::uint32_t firstIndex;
  std::uint32_t indexCount;
};

bool validLayout(const Layout& layout);
std::size_t bytesFor(const Layout& layout);
Status bind(void* base, std::size_t bytes, const Layout& layout);
bool bound();
const Layout& layout();
std::uint32_t liveCount();
double acquire(std::uint32_t vertices, std::uint32_t indices);
Status upload(double handle, const void* vertices, std::uint32_t vertexCount, const void* indices, std::uint32_t indexCount);
Status ranges(double handle, Range& out);
Status release(double handle);
bool isLive(double handle);

}

#endif
