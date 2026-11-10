#include <cstdint>
#include <cstring>

#include <emscripten/emscripten.h>

#include "arena.h"
#include "device_tier.h"
#include "model_pool.h"

namespace {

std::uint32_t mix(std::uint32_t seed, std::uint32_t index) {
  std::uint32_t h = seed * 2654435761u + index * 40503u + 1u;
  h ^= h >> 15;
  h *= 2246822519u;
  h ^= h >> 13;
  return h;
}

float unit(std::uint32_t h) {
  return static_cast<float>(h & 0xffffu) / 32768.0f - 1.0f;
}

void fillModel(std::uint8_t* vertices, std::uint8_t* indices, std::uint32_t vertexCount, std::uint32_t indexCount, std::uint32_t seed) {
  const std::uint32_t stride = engine::models::layout().vertexStrideBytes;
  for (std::uint32_t v = 0; v < vertexCount; ++v) {
    const float position[3] = {unit(mix(seed, 3 * v)), unit(mix(seed, 3 * v + 1)), unit(mix(seed, 3 * v + 2))};
    std::uint8_t* out = vertices + static_cast<std::size_t>(v) * stride;
    std::memset(out, 0, stride);
    std::memcpy(out, position, sizeof position);
  }
  for (std::uint32_t i = 0; i < indexCount; ++i) {
    const std::uint32_t index = i % vertexCount;
    std::memcpy(indices + static_cast<std::size_t>(i) * engine::models::kIndexBytes, &index, sizeof index);
  }
}

}

extern "C" {

EMSCRIPTEN_KEEPALIVE double engine_models_acquire(std::uint32_t vertices, std::uint32_t indices) {
  return engine::models::acquire(vertices, indices);
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_models_cluster_stride() {
  return engine::models::clusterStride();
}

EMSCRIPTEN_KEEPALIVE double engine_models_cluster_bytes() {
  return static_cast<double>(engine::models::clusterPoolBytes());
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_models_clusters_ptr() {
  return static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(engine::models::clusterTable()));
}

EMSCRIPTEN_KEEPALIVE double engine_models_load(std::uint32_t vertices, std::uint32_t indices, std::uint32_t seed) {
  const double handle = engine::models::acquire(vertices, indices);
  if (handle <= 0.0) return handle;
  std::uint8_t* vertexOut = nullptr;
  std::uint8_t* indexOut = nullptr;
  if (engine::models::mutableSlot(handle, vertexOut, indexOut) != engine::kOk) return engine::kBadId;
  fillModel(vertexOut, indexOut, vertices, indices, seed);
  engine::models::markDirty(handle);
  return handle;
}

EMSCRIPTEN_KEEPALIVE int engine_models_bind_plan(std::uint32_t maxTextureDimension, std::uint32_t maxTextureLayers, double maxBufferBytes, std::uint32_t texelBytes, double deviceMemoryBytes) {
  if (engine::models::bound()) return -4;
  engine::device::Limits limits{maxTextureDimension, maxTextureLayers, static_cast<std::uint64_t>(maxBufferBytes), texelBytes, static_cast<std::uint64_t>(deviceMemoryBytes)};
  engine::device::Plan planned{};
  if (!engine::device::plan(limits, planned)) return -1;
  for (std::uint32_t tier = planned.tier + 1; tier-- > 0;) {
    engine::device::Plan candidate{};
    if (!engine::device::planTier(tier, texelBytes, candidate)) return -3;
    const engine::models::Layout layout{candidate.modelSlots, candidate.verticesPerModel, candidate.indicesPerModel, candidate.vertexStrideBytes, candidate.uploadBytesPerFrame};
    const std::size_t bytes = engine::models::bytesFor(layout);
    void* base = engine::arena::carve(bytes, engine::models::kAlignment);
    if (base == nullptr) continue;
    if (engine::models::bind(base, bytes, layout) != engine::kOk) return -3;
    return static_cast<int>(tier);
  }
  return -2;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_models_vertex_ptr(double handle) {
  std::uint8_t* vertices = nullptr;
  std::uint8_t* indices = nullptr;
  if (engine::models::mutableSlot(handle, vertices, indices) != engine::kOk) return 0;
  return static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(vertices));
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_models_index_ptr(double handle) {
  std::uint8_t* vertices = nullptr;
  std::uint8_t* indices = nullptr;
  if (engine::models::mutableSlot(handle, vertices, indices) != engine::kOk) return 0;
  return static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(indices));
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_models_vertex_count(double handle) {
  engine::models::Range range{};
  if (engine::models::ranges(handle, range) != engine::kOk) return 0;
  return range.vertexCount;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_models_index_count(double handle) {
  engine::models::Range range{};
  if (engine::models::ranges(handle, range) != engine::kOk) return 0;
  return range.indexCount;
}

EMSCRIPTEN_KEEPALIVE int engine_models_mark_dirty(double handle) {
  return static_cast<int>(engine::models::markDirty(handle));
}

EMSCRIPTEN_KEEPALIVE int engine_models_unload(double handle) {
  return engine::models::release(handle);
}

EMSCRIPTEN_KEEPALIVE int engine_models_live() {
  return static_cast<int>(engine::models::liveCount());
}

EMSCRIPTEN_KEEPALIVE int engine_models_bound() {
  return engine::models::bound() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE double engine_models_pool_bytes() {
  return engine::models::bound() ? static_cast<double>(engine::models::bytesFor(engine::models::layout())) : 0.0;
}

EMSCRIPTEN_KEEPALIVE int engine_models_dirty() {
  return static_cast<int>(engine::models::dirtyCount());
}

EMSCRIPTEN_KEEPALIVE int engine_models_uploaded(double handle) {
  return engine::models::uploaded(handle) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int engine_device_plan_tier(std::uint32_t maxTextureDimension, std::uint32_t maxTextureLayers, double maxBufferBytes, std::uint32_t texelBytes, double deviceMemoryBytes) {
  engine::device::Limits limits{maxTextureDimension, maxTextureLayers, static_cast<std::uint64_t>(maxBufferBytes), texelBytes, static_cast<std::uint64_t>(deviceMemoryBytes)};
  engine::device::Plan planned{};
  if (!engine::device::plan(limits, planned)) return -1;
  return static_cast<int>(planned.tier);
}

EMSCRIPTEN_KEEPALIVE double engine_device_tier_vram(std::uint32_t tier, std::uint32_t texelBytes) {
  engine::device::Plan planned{};
  if (!engine::device::planTier(tier, texelBytes, planned)) return -1.0;
  return static_cast<double>(planned.vramBytes);
}

EMSCRIPTEN_KEEPALIVE double engine_device_tier_budget(std::uint32_t tier) {
  engine::device::Plan planned{};
  if (!engine::device::planTier(tier, 1, planned)) return -1.0;
  return static_cast<double>(planned.vramBudgetBytes);
}

}
