#ifndef ENGINE_POSE_HANDOFF_H
#define ENGINE_POSE_HANDOFF_H

#include <cstdint>

#include "world.h"

namespace engine::pose {

struct Header {
  double originX;
  double originY;
  double originZ;
  std::uint64_t tick;
  std::uint32_t bodies;
  std::uint32_t reserved;
};

static_assert(sizeof(Header) == 40);

constexpr std::uint32_t kHeaderBytes = sizeof(Header);

std::uint32_t bytesFor(std::uint32_t bodies);
std::uint8_t* reserve();
std::int32_t exportPoses(std::uint8_t* dst, std::uint32_t capacity);
int importPoses(const std::uint8_t* src, std::uint32_t bytes);

}

#endif
