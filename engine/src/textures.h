#ifndef ENGINE_TEXTURES_H
#define ENGINE_TEXTURES_H

#include <cstddef>
#include <cstdint>

#include "world.h"

namespace engine::handles {

constexpr std::uint32_t kSpan = 65536;
constexpr std::uint32_t kMaxSlots = 65535;

constexpr std::size_t bytesFor(std::uint32_t capacity) {
  const std::size_t meta = static_cast<std::size_t>(capacity) * (sizeof(std::uint16_t) + sizeof(std::uint8_t) + sizeof(std::uint32_t));
  return (meta + 7) & ~static_cast<std::size_t>(7);
}

struct Table {
  std::uint16_t* generation;
  std::uint8_t* live;
  std::uint32_t* freeStack;
  std::uint32_t capacity;
  std::uint32_t freeCount;
  std::uint32_t retired;
};

bool bindTable(Table& table, void* metadata, std::uint32_t capacity);
bool acquire(Table& table, std::uint32_t& slot);
void release(Table& table, std::uint32_t slot);
double handleOf(const Table& table, std::uint32_t slot);
bool wholeHandle(double value, std::uint32_t& out);
bool resolve(const Table& table, std::uint32_t handle, std::uint32_t& slot);
std::uint32_t liveCount(const Table& table);

}

namespace engine::textures {

constexpr std::uint32_t kMaxDimension = 16384;
constexpr std::uint32_t kFormatRgba8Unorm = 1;
constexpr std::uint32_t kFormatRgba8Srgb = 2;

struct Slot {
  std::uint32_t layer;
  std::uint32_t width;
  std::uint32_t height;
  std::uint32_t format;
};

constexpr std::size_t bytesFor(std::uint32_t capacity) {
  return static_cast<std::size_t>(capacity) * sizeof(Slot) + handles::bytesFor(capacity);
}

Status bind(void* base, std::uint32_t capacity);
bool bound();
std::uint32_t capacity();
std::uint32_t liveCount();
double add(double width, double height, double format);
Status remove(double handle);
bool isLive(double handle);
int layer(double handle);

}

#endif
