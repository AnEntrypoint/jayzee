#include "vegetation.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <new>

#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>

#include "sphere_contact.h"
#include "world.h"

namespace engine::vegetation {

namespace {

constexpr float kTrunkRadius = 0.4f;
constexpr float kTrunkHalfHeight = 3.0f;
constexpr float kRockHalf = 0.6f;
constexpr std::size_t kAlign = 16;

Field* bound = nullptr;

std::size_t alignUp(std::size_t value) {
  return (value + kAlign - 1) / kAlign * kAlign;
}

int cellCoordinate(float value, float origin, float cellSize, std::uint32_t cellsPerSide) {
  const float last = static_cast<float>(cellsPerSide) - 1.0f;
  const float t = std::floor((value - origin) / cellSize);
  if (!(t >= 0.0f)) return 0;
  if (t > last) return static_cast<int>(cellsPerSide) - 1;
  return static_cast<int>(t);
}

bool instanceContact(const Instance& inst, JPH::Vec3Arg center, float radius, float maxSeparation, JPH::Vec3& surface,
                     JPH::Vec3& axis, float& depth) {
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
  return true;
}

void collideField(const Field& field, JPH::Mat44Arg fieldToWorld, JPH::Vec3Arg center, float radius, float maxSeparation,
                  JPH::SubShapeID fieldSub, JPH::SubShapeID sphereSub, bool fieldFirst, JPH::CollideShapeCollector& ioCollector) {
  if (!field.configured) return;
  const float reach = radius + kMaxReach;
  const int x0 = cellCoordinate(center.GetX() - reach, field.origin, field.cellSize, field.cellsPerSide);
  const int x1 = cellCoordinate(center.GetX() + reach, field.origin, field.cellSize, field.cellsPerSide);
  const int z0 = cellCoordinate(center.GetZ() - reach, field.origin, field.cellSize, field.cellsPerSide);
  const int z1 = cellCoordinate(center.GetZ() + reach, field.origin, field.cellSize, field.cellsPerSide);
  for (int iz = z0; iz <= z1; ++iz) {
    for (int ix = x0; ix <= x1; ++ix) {
      const std::size_t index = static_cast<std::size_t>(iz) * field.cellsPerSide + static_cast<std::size_t>(ix);
      const Instance* row = field.instances + index * field.instancesPerCell;
      const std::uint32_t count = field.counts[index];
      for (std::uint32_t k = 0; k < count; ++k) {
        if (ioCollector.ShouldEarlyOut()) return;
        JPH::Vec3 surface;
        JPH::Vec3 axis;
        float depth = 0.0f;
        if (!instanceContact(row[k], center, radius, maxSeparation, surface, axis, depth)) continue;
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

bool configure(Field& field, float origin, float cellSize) {
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
  const float side = static_cast<float>(field.cellsPerSide);
  const float tx = std::floor((x - field.origin) / field.cellSize);
  const float tz = std::floor((z - field.origin) / field.cellSize);
  if (!(tx >= 0.0f && tx < side && tz >= 0.0f && tz < side)) return kRange;
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
