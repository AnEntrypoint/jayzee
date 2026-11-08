#include "vegetation.h"

#include <algorithm>
#include <cmath>

#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>

#include "sphere_contact.h"
#include "world.h"

namespace engine::vegetation {

namespace {

constexpr float kTrunkRadius = 0.4f;
constexpr float kTrunkHalfHeight = 3.0f;
constexpr float kRockHalf = 0.6f;

int cellCoordinate(float value, float origin, float cellSize) {
  const float t = std::floor((value - origin) / cellSize);
  if (!(t >= 0.0f)) return 0;
  if (t > static_cast<float>(kCellsPerSide - 1)) return kCellsPerSide - 1;
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

void collideField(JPH::Mat44Arg fieldToWorld, JPH::Vec3Arg center, float radius, float maxSeparation, JPH::SubShapeID fieldSub,
                  JPH::SubShapeID sphereSub, bool fieldFirst, JPH::CollideShapeCollector& ioCollector) {
  const Field& field = state();
  if (!field.configured) return;
  const float reach = radius + kMaxReach;
  const int x0 = cellCoordinate(center.GetX() - reach, field.origin, field.cellSize);
  const int x1 = cellCoordinate(center.GetX() + reach, field.origin, field.cellSize);
  const int z0 = cellCoordinate(center.GetZ() - reach, field.origin, field.cellSize);
  const int z1 = cellCoordinate(center.GetZ() + reach, field.origin, field.cellSize);
  for (int iz = z0; iz <= z1; ++iz) {
    for (int ix = x0; ix <= x1; ++ix) {
      const Cell& cell = field.cells[iz * kCellsPerSide + ix];
      for (std::uint32_t k = 0; k < cell.count; ++k) {
        if (ioCollector.ShouldEarlyOut()) return;
        JPH::Vec3 surface;
        JPH::Vec3 axis;
        float depth = 0.0f;
        if (!instanceContact(cell.instances[k], center, radius, maxSeparation, surface, axis, depth)) continue;
        reportSphereContact(fieldToWorld, surface, axis, depth, fieldSub, sphereSub, fieldFirst, ioCollector);
      }
    }
  }
}

void collideFieldSphere(const JPH::Shape*, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                        JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                        const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                        const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                        const JPH::ShapeFilter&) {
  const float radius = static_cast<const JPH::SphereShape*>(inShape2)->GetRadius();
  const JPH::Vec3 center = inCenterOfMassTransform1.Inversed() * inCenterOfMassTransform2.GetTranslation();
  collideField(inCenterOfMassTransform1, center, radius, inCollideShapeSettings.mMaxSeparationDistance,
               inSubShapeIDCreator1.GetID(), inSubShapeIDCreator2.GetID(), true, ioCollector);
}

void collideSphereField(const JPH::Shape* inShape1, const JPH::Shape*, JPH::Vec3Arg, JPH::Vec3Arg,
                        JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                        const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                        const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                        const JPH::ShapeFilter&) {
  const float radius = static_cast<const JPH::SphereShape*>(inShape1)->GetRadius();
  const JPH::Vec3 center = inCenterOfMassTransform2.Inversed() * inCenterOfMassTransform1.GetTranslation();
  collideField(inCenterOfMassTransform2, center, radius, inCollideShapeSettings.mMaxSeparationDistance,
               inSubShapeIDCreator2.GetID(), inSubShapeIDCreator1.GetID(), false, ioCollector);
}

}

Field& state() {
  static Field instance;
  return instance;
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
  const float tx = std::floor((x - field.origin) / field.cellSize);
  const float tz = std::floor((z - field.origin) / field.cellSize);
  if (!(tx >= 0.0f && tx < static_cast<float>(kCellsPerSide) && tz >= 0.0f && tz < static_cast<float>(kCellsPerSide))) {
    return kRange;
  }
  Cell& cell = field.cells[static_cast<int>(tz) * kCellsPerSide + static_cast<int>(tx)];
  if (cell.count == kInstancesPerCell) return kFull;
  cell.instances[cell.count] = Instance{x, y, z, yaw, scale, cls};
  cell.count += 1;
  field.placed += 1;
  return kOk;
}

void clear(Field& field) {
  for (int index = 0; index < kCells; ++index) field.cells[index].count = 0;
  field.placed = 0;
}

void registerCollisions() {
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::User2, JPH::EShapeSubType::Sphere, collideFieldSphere);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::Sphere, JPH::EShapeSubType::User2, collideSphereField);
}

VegetationShape::VegetationShape() : SurfaceShape(JPH::EShapeType::User2, JPH::EShapeSubType::User2) {}

JPH::AABox VegetationShape::GetLocalBounds() const {
  const Field& field = state();
  const float extent = field.cellSize * static_cast<float>(kCellsPerSide);
  return JPH::AABox(JPH::Vec3(field.origin, -kBoundHeight, field.origin),
                    JPH::Vec3(field.origin + extent, kBoundHeight, field.origin + extent));
}

}
