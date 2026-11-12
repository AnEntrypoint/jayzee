#include "vegetation.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <new>

#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>

#include "physics_origin.h"
#include "sphere_contact.h"
#include "world.h"

namespace engine::vegetation {

namespace {

constexpr float kTrunkRadius = 0.4f;
constexpr float kTrunkHalfHeight = 3.0f;
constexpr float kRockHalf = 0.6f;
constexpr std::size_t kAlign = 16;

Field* bound = nullptr;
std::atomic<std::uint32_t> touchesArmed{0};
std::atomic<std::uint32_t> touchCount{0};
std::uint32_t touchesDropped = 0;
Touch touches[kMaxTouches];

void recordTouch(std::uint32_t instance, JPH::Vec3Arg anchor) {
  const std::uint32_t at = touchCount.fetch_add(1, std::memory_order_relaxed);
  if (at >= kMaxTouches) return;
  touches[at] = Touch{instance, anchor.GetX(), anchor.GetY(), anchor.GetZ()};
}

bool touchBefore(const Touch& a, const Touch& b) {
  if (a.instance != b.instance) return a.instance < b.instance;
  if (a.y != b.y) return a.y < b.y;
  if (a.x != b.x) return a.x < b.x;
  return a.z < b.z;
}

std::size_t alignUp(std::size_t value) {
  return (value + kAlign - 1) / kAlign * kAlign;
}

int cellCoordinate(double value, double origin, float cellSize, std::uint32_t cellsPerSide) {
  const double last = static_cast<double>(cellsPerSide) - 1.0;
  const double t = std::floor((value - origin) / cellSize);
  if (!(t >= 0.0)) return 0;
  if (t > last) return static_cast<int>(cellsPerSide) - 1;
  return static_cast<int>(t);
}

bool instanceContact(const Instance& inst, JPH::Vec3Arg center, float radius, float maxSeparation, JPH::Vec3& surface,
                     JPH::Vec3& axis, float& depth, JPH::Vec3& anchor) {
  float reach = 0.0f;
  JPH::Vec3 closest;
  if (inst.cls == kClassTrunk) {
    const float length = 2.0f * kTrunkHalfHeight * inst.scale;
    const float t = std::clamp((center.GetY() - inst.y) / length, 0.0f, 1.0f);
    closest = JPH::Vec3(inst.x, inst.y + t * length, inst.z);
    reach = kTrunkRadius * inst.scale;
  } else if (inst.cls == kClassRock) {
    const float h = kRockHalf * inst.scale;
    const float c = std::cos(inst.yaw);
    const float s = std::sin(inst.yaw);
    const float dx = center.GetX() - inst.x;
    const float dz = center.GetZ() - inst.z;
    const float lx = std::clamp(c * dx - s * dz, -h, h);
    const float ly = std::clamp(center.GetY() - (inst.y + h), -h, h);
    const float lz = std::clamp(s * dx + c * dz, -h, h);
    closest = JPH::Vec3(inst.x + c * lx + s * lz, inst.y + h + ly, inst.z - s * lx + c * lz);
  } else {
    return false;
  }
  const JPH::Vec3 delta = center - closest;
  const float distance = delta.Length();
  axis = distance > 0.0f ? delta / distance : JPH::Vec3::sAxisY();
  depth = radius + reach - distance;
  if (depth < -maxSeparation) return false;
  surface = closest + axis * reach;
  anchor = inst.cls == kClassRock ? JPH::Vec3(inst.x, inst.y + kRockHalf * inst.scale, inst.z) : closest;
  return true;
}

void collideField(const Field& field, JPH::Mat44Arg fieldToWorld, JPH::Vec3Arg center, float radius, float maxSeparation,
                  JPH::SubShapeID fieldSub, JPH::SubShapeID sphereSub, bool fieldFirst, JPH::CollideShapeCollector& ioCollector) {
  if (!field.configured) return;
  const PhysicsOrigin& o = physicsOrigin();
  const double reach = static_cast<double>(radius) + kMaxReach;
  const double cx = static_cast<double>(center.GetX()) + o.x;
  const double cz = static_cast<double>(center.GetZ()) + o.z;
  const int x0 = cellCoordinate(cx - reach, field.origin, field.cellSize, field.cellsPerSide);
  const int x1 = cellCoordinate(cx + reach, field.origin, field.cellSize, field.cellsPerSide);
  const int z0 = cellCoordinate(cz - reach, field.origin, field.cellSize, field.cellsPerSide);
  const int z1 = cellCoordinate(cz + reach, field.origin, field.cellSize, field.cellsPerSide);
  for (int iz = z0; iz <= z1; ++iz) {
    for (int ix = x0; ix <= x1; ++ix) {
      const std::size_t index = static_cast<std::size_t>(iz) * field.cellsPerSide + static_cast<std::size_t>(ix);
      const Instance* row = field.instances + index * field.instancesPerCell;
      const std::uint32_t count = field.counts[index];
      for (std::uint32_t k = 0; k < count; ++k) {
        if (ioCollector.ShouldEarlyOut()) return;
        JPH::Vec3 surface;
        JPH::Vec3 axis;
        JPH::Vec3 anchor;
        float depth = 0.0f;
        if (!instanceContact(row[k], center, radius, maxSeparation, surface, axis, depth, anchor)) continue;
        if (touchesArmed.load(std::memory_order_relaxed) != 0) {
          recordTouch(static_cast<std::uint32_t>(index * field.instancesPerCell + k), anchor);
        }
        reportSphereContact(fieldToWorld, surface, axis, depth, fieldSub, sphereSub, fieldFirst, ioCollector);
      }
    }
  }
}

void collideFieldSphere(const JPH::Shape* inShape1, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                        JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                        const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                        const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                        const JPH::ShapeFilter&) {
  const Field& field = static_cast<const VegetationShape*>(inShape1)->field();
  const float radius = static_cast<const JPH::SphereShape*>(inShape2)->GetRadius();
  const JPH::Vec3 center = inCenterOfMassTransform1.Inversed() * inCenterOfMassTransform2.GetTranslation();
  collideField(field, inCenterOfMassTransform1, center, radius, inCollideShapeSettings.mMaxSeparationDistance,
               inSubShapeIDCreator1.GetID(), inSubShapeIDCreator2.GetID(), true, ioCollector);
}

void collideSphereField(const JPH::Shape* inShape1, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                        JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                        const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                        const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                        const JPH::ShapeFilter&) {
  const Field& field = static_cast<const VegetationShape*>(inShape2)->field();
  const float radius = static_cast<const JPH::SphereShape*>(inShape1)->GetRadius();
  const JPH::Vec3 center = inCenterOfMassTransform2.Inversed() * inCenterOfMassTransform1.GetTranslation();
  collideField(field, inCenterOfMassTransform2, center, radius, inCollideShapeSettings.mMaxSeparationDistance,
               inSubShapeIDCreator2.GetID(), inSubShapeIDCreator1.GetID(), false, ioCollector);
}

}

std::size_t bytesFor(std::uint32_t cellsPerSide, std::uint32_t instancesPerCell) {
  if (cellsPerSide == 0 || instancesPerCell == 0) return 0;
  const std::uint64_t cells = static_cast<std::uint64_t>(cellsPerSide) * cellsPerSide;
  const std::uint64_t instances = cells * instancesPerCell;
  if (cells > kMaxInstances || instances > kMaxInstances) return 0;
  const std::size_t countsAt = alignUp(sizeof(Field));
  const std::size_t instancesAt = alignUp(countsAt + static_cast<std::size_t>(cells) * sizeof(std::uint32_t));
  return alignUp(instancesAt + static_cast<std::size_t>(instances) * sizeof(Instance));
}

Field* bind(void* base, std::uint32_t cellsPerSide, std::uint32_t instancesPerCell) {
  if (bound != nullptr) return nullptr;
  const std::size_t total = bytesFor(cellsPerSide, instancesPerCell);
  if (base == nullptr || total == 0) return nullptr;
  std::memset(base, 0, total);
  std::uint8_t* raw = static_cast<std::uint8_t*>(base);
  Field* field = new (base) Field();
  const std::size_t countsAt = alignUp(sizeof(Field));
  const std::size_t cells = static_cast<std::size_t>(cellsPerSide) * cellsPerSide;
  field->counts = reinterpret_cast<std::uint32_t*>(raw + countsAt);
  field->instances = reinterpret_cast<Instance*>(raw + alignUp(countsAt + cells * sizeof(std::uint32_t)));
  field->cellsPerSide = cellsPerSide;
  field->instancesPerCell = instancesPerCell;
  bound = field;
  return field;
}

Field& state() {
  return *bound;
}

bool configure(Field& field, double origin, float cellSize) {
  if (!std::isfinite(origin) || !std::isfinite(cellSize) || !(cellSize > 0.0f)) return false;
  clear(field);
  field.origin = origin;
  field.cellSize = cellSize;
  field.configured = true;
  return true;
}

int place(Field& field, float x, float y, float z, float yaw, float scale, std::uint32_t cls) {
  if (!field.configured) return kNotConfigured;
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z) || !std::isfinite(yaw)) return kRange;
  if (!(scale > 0.0f && scale <= kMaxScale) || cls > kClassPass) return kRange;
  const double side = static_cast<double>(field.cellsPerSide);
  const double tx = std::floor((static_cast<double>(x) - field.origin) / field.cellSize);
  const double tz = std::floor((static_cast<double>(z) - field.origin) / field.cellSize);
  if (!(tx >= 0.0 && tx < side && tz >= 0.0 && tz < side)) return kRange;
  const std::size_t index = static_cast<std::size_t>(tz) * field.cellsPerSide + static_cast<std::size_t>(tx);
  std::uint32_t& count = field.counts[index];
  if (count == field.instancesPerCell) return kFull;
  field.instances[index * field.instancesPerCell + count] = Instance{x, y, z, yaw, scale, cls};
  count += 1;
  field.placed += 1;
  return kOk;
}

void clear(Field& field) {
  const std::size_t cells = static_cast<std::size_t>(field.cellsPerSide) * field.cellsPerSide;
  for (std::size_t index = 0; index < cells; ++index) field.counts[index] = 0;
  field.placed = 0;
  touchCount.store(0, std::memory_order_relaxed);
}

bool isBound() {
  return bound != nullptr;
}

void armTouches(bool on) {
  touchesArmed.store(on ? 1u : 0u, std::memory_order_relaxed);
}

std::uint32_t drainTouches(const Touch*& rows) {
  const std::uint32_t recorded = touchCount.exchange(0, std::memory_order_relaxed);
  const std::uint32_t held = std::min(recorded, kMaxTouches);
  touchesDropped += recorded - held;
  for (std::uint32_t i = 1; i < held; ++i) {
    const Touch moving = touches[i];
    std::uint32_t at = i;
    while (at > 0 && touchBefore(moving, touches[at - 1])) {
      touches[at] = touches[at - 1];
      at -= 1;
    }
    touches[at] = moving;
  }
  std::uint32_t unique = 0;
  for (std::uint32_t i = 0; i < held; ++i) {
    if (unique > 0 && touches[unique - 1].instance == touches[i].instance) continue;
    touches[unique] = touches[i];
    unique += 1;
  }
  rows = touches;
  return unique;
}

std::uint32_t droppedTouches() {
  return touchesDropped;
}

namespace {

Instance* instanceAt(Field& field, std::uint32_t instance) {
  const std::size_t cells = static_cast<std::size_t>(field.cellsPerSide) * field.cellsPerSide;
  const std::size_t cell = instance / field.instancesPerCell;
  const std::uint32_t k = instance % field.instancesPerCell;
  if (cell >= cells || k >= field.counts[cell]) return nullptr;
  return field.instances + instance;
}

}

bool promote(Field& field, std::uint32_t instance) {
  Instance* inst = instanceAt(field, instance);
  if (inst == nullptr || inst->cls >= kClassPass) return false;
  inst->cls |= kPromotedBit;
  return true;
}

bool restore(Field& field, std::uint32_t instance) {
  Instance* inst = instanceAt(field, instance);
  if (inst == nullptr || (inst->cls & kPromotedBit) == 0) return false;
  inst->cls &= ~kPromotedBit;
  return true;
}

void registerCollisions() {
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::User2, JPH::EShapeSubType::Sphere, collideFieldSphere);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::Sphere, JPH::EShapeSubType::User2, collideSphereField);
}

VegetationShape::VegetationShape() : VegetationShape(state()) {}

VegetationShape::VegetationShape(Field& field)
    : SurfaceShape(JPH::EShapeType::User2, JPH::EShapeSubType::User2), field_(field) {}

JPH::AABox VegetationShape::GetLocalBounds() const {
  const float extent = field_.cellSize * static_cast<float>(field_.cellsPerSide);
  return JPH::AABox(JPH::Vec3(field_.origin, -kBoundHeight, field_.origin),
                    JPH::Vec3(field_.origin + extent, kBoundHeight, field_.origin + extent));
}

}
