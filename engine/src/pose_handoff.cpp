#include "pose_handoff.h"

#include <cstring>

#include "arena.h"
#include "physics_origin.h"

namespace engine::pose {

namespace {

std::uint8_t* reserved = nullptr;

}

std::uint32_t bytesFor(std::uint32_t bodies) {
  return kHeaderBytes + bodies * static_cast<std::uint32_t>(sizeof(Transform));
}

std::uint8_t* reserve() {
  if (reserved == nullptr) {
    World& world = engine::world();
    if (world.transforms() == nullptr) return nullptr;
    reserved = static_cast<std::uint8_t*>(arena::carve(bytesFor(world.bodyCapacity()), alignof(Header)));
  }
  return reserved;
}

std::int32_t exportPoses(std::uint8_t* dst, std::uint32_t capacity) {
  World& world = engine::world();
  const Transform* rows = world.transforms();
  if (rows == nullptr || dst == nullptr) return -1;
  const std::uint32_t bodies = world.bodyCapacity();
  const std::uint32_t needed = bytesFor(bodies);
  if (capacity < needed) return -1;
  const PhysicsOrigin& origin = physicsOrigin();
  Header header{origin.x, origin.y, origin.z, world.tick(), bodies, 0};
  std::memcpy(dst, &header, kHeaderBytes);
  std::memcpy(dst + kHeaderBytes, rows, bodies * sizeof(Transform));
  return static_cast<std::int32_t>(needed);
}

int importPoses(const std::uint8_t* src, std::uint32_t bytes) {
  if (src == nullptr || bytes < kHeaderBytes) return kRange;
  Header header{};
  std::memcpy(&header, src, kHeaderBytes);
  if (header.bodies != engine::world().bodyCapacity() || bytes < bytesFor(header.bodies)) return kRange;
  PhysicsOrigin& origin = physicsOrigin();
  origin.x = header.originX;
  origin.y = header.originY;
  origin.z = header.originZ;
  return engine::world().applyPoses(reinterpret_cast<const Transform*>(src + kHeaderBytes), header.bodies);
}

}
