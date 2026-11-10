#include "model_pool.h"

#include <cstring>

#include "textures.h"

namespace engine::models {

namespace {

struct Meta {
  std::uint32_t vertices;
  std::uint32_t indices;
};

constexpr std::uint64_t kMaxPoolBytes = 0x7fffffffull;

handles::Table gTable{};
Meta* gMeta = nullptr;
std::uint8_t* gVertices = nullptr;
std::uint8_t* gIndices = nullptr;
Layout gLayout{};
bool gBound = false;

std::size_t alignUp(std::size_t value) {
  return (value + kAlignment - 1) & ~(kAlignment - 1);
}

std::size_t metaBytes(std::uint32_t slots) {
  return alignUp(static_cast<std::size_t>(slots) * sizeof(Meta));
}

std::size_t tableBytes(std::uint32_t slots) {
  return alignUp(handles::bytesFor(slots));
}

std::size_t vertexBytes(const Layout& layout) {
  return alignUp(static_cast<std::size_t>(layout.slots) * layout.verticesPerSlot * layout.vertexStrideBytes);
}

std::size_t indexBytes(const Layout& layout) {
  return alignUp(static_cast<std::size_t>(layout.slots) * layout.indicesPerSlot * kIndexBytes);
}

bool resolveSlot(double handle, std::uint32_t& slot) {
  std::uint32_t whole = 0;
  return gBound && handles::wholeHandle(handle, whole) && handles::resolve(gTable, whole, slot);
}

}

bool validLayout(const Layout& layout) {
  if (layout.slots < 1 || layout.slots > handles::kMaxSlots) return false;
  if (layout.verticesPerSlot < 1 || layout.indicesPerSlot < 1) return false;
  if (layout.vertexStrideBytes < 4 || layout.vertexStrideBytes > 256 || layout.vertexStrideBytes % 4 != 0) return false;
  const std::uint64_t vertexPool = static_cast<std::uint64_t>(layout.slots) * layout.verticesPerSlot * layout.vertexStrideBytes;
  const std::uint64_t indexPool = static_cast<std::uint64_t>(layout.slots) * layout.indicesPerSlot * kIndexBytes;
  return vertexPool <= kMaxPoolBytes && indexPool <= kMaxPoolBytes;
}

std::size_t bytesFor(const Layout& layout) {
  return metaBytes(layout.slots) + tableBytes(layout.slots) + vertexBytes(layout) + indexBytes(layout);
}

Status bind(void* base, std::size_t bytes, const Layout& layout) {
  if (gBound) return kRange;
  if (!validLayout(layout)) return kRange;
  if (base == nullptr || (reinterpret_cast<std::uintptr_t>(base) & (kAlignment - 1)) != 0) return kRange;
  if (bytes < bytesFor(layout)) return kRange;
  std::uint8_t* cursor = static_cast<std::uint8_t*>(base);
  gMeta = reinterpret_cast<Meta*>(cursor);
  std::memset(gMeta, 0, metaBytes(layout.slots));
  cursor += metaBytes(layout.slots);
  if (!handles::bindTable(gTable, cursor, layout.slots)) return kRange;
  cursor += tableBytes(layout.slots);
  gVertices = cursor;
  cursor += vertexBytes(layout);
  gIndices = cursor;
  gLayout = layout;
  gBound = true;
  return kOk;
}

bool bound() {
  return gBound;
}

const Layout& layout() {
  return gLayout;
}

std::uint32_t liveCount() {
  return gBound ? handles::liveCount(gTable) : 0;
}

double acquire(std::uint32_t vertices, std::uint32_t indices) {
  if (!gBound) return kNotConfigured;
  if (vertices < 1 || vertices > gLayout.verticesPerSlot) return kRange;
  if (indices < 1 || indices > gLayout.indicesPerSlot) return kRange;
  std::uint32_t slot = 0;
  if (!handles::acquire(gTable, slot)) return kFull;
  gMeta[slot] = Meta{vertices, indices};
  return handles::handleOf(gTable, slot);
}

Status upload(double handle, const void* vertices, std::uint32_t vertexCount, const void* indices, std::uint32_t indexCount) {
  std::uint32_t slot = 0;
  if (!resolveSlot(handle, slot)) return kBadId;
  if (vertices == nullptr || indices == nullptr) return kRange;
  if (vertexCount != gMeta[slot].vertices || indexCount != gMeta[slot].indices) return kRange;
  const std::size_t vertexOffset = static_cast<std::size_t>(slot) * gLayout.verticesPerSlot * gLayout.vertexStrideBytes;
  const std::size_t indexOffset = static_cast<std::size_t>(slot) * gLayout.indicesPerSlot * kIndexBytes;
  std::memcpy(gVertices + vertexOffset, vertices, static_cast<std::size_t>(vertexCount) * gLayout.vertexStrideBytes);
  std::memcpy(gIndices + indexOffset, indices, static_cast<std::size_t>(indexCount) * kIndexBytes);
  return kOk;
}

Status ranges(double handle, Range& out) {
  std::uint32_t slot = 0;
  if (!resolveSlot(handle, slot)) return kBadId;
  out.firstVertex = slot * gLayout.verticesPerSlot;
  out.vertexCount = gMeta[slot].vertices;
  out.firstIndex = slot * gLayout.indicesPerSlot;
  out.indexCount = gMeta[slot].indices;
  return kOk;
}

Status release(double handle) {
  std::uint32_t whole = 0;
  std::uint32_t slot = 0;
  if (!gBound || !handles::wholeHandle(handle, whole) || !handles::resolve(gTable, whole, slot)) return kBadId;
  gMeta[slot] = Meta{0, 0};
  handles::release(gTable, slot);
  return kOk;
}

bool isLive(double handle) {
  std::uint32_t slot = 0;
  return resolveSlot(handle, slot);
}

}
