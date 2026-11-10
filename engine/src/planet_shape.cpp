#include "planet_shape.h"

#include <cmath>

#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>

#include "physics_origin.h"
#include "sphere_contact.h"

namespace engine::planet {

namespace {

bool sphereContact(Planet& terrain, JPH::Vec3Arg center, float radius, float maxSeparation, JPH::Vec3& surface, JPH::Vec3& axis,
                   float& depth) {
  const PhysicsOrigin& o = physicsOrigin();
  const double x = center.GetX() + o.x;
  const double y = center.GetY() + o.y;
  const double z = center.GetZ() + o.z;
  const double distance = std::sqrt(x * x + y * y + z * z);
  if (!(distance > 0.0)) return false;
  const double reach = terrain.radius + heightAt(terrain, x, y, z);
  const double penetration = reach + radius - distance;
  if (penetration < -maxSeparation) return false;
  const double ax = x / distance;
  const double ay = y / distance;
  const double az = z / distance;
  axis = JPH::Vec3(static_cast<float>(ax), static_cast<float>(ay), static_cast<float>(az));
  surface = JPH::Vec3(static_cast<float>(ax * reach - o.x), static_cast<float>(ay * reach - o.y), static_cast<float>(az * reach - o.z));
  depth = static_cast<float>(penetration);
  return true;
}

void collidePlanetSphere(const JPH::Shape* inShape1, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                         JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                         const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                         const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                         const JPH::ShapeFilter&) {
  if (ioCollector.ShouldEarlyOut()) return;
  Planet& terrain = static_cast<const PlanetShape*>(inShape1)->terrain();
  const float radius = static_cast<const JPH::SphereShape*>(inShape2)->GetRadius();
  const JPH::Vec3 center = inCenterOfMassTransform1.Inversed() * inCenterOfMassTransform2.GetTranslation();
  JPH::Vec3 surface;
  JPH::Vec3 axis;
  float depth = 0.0f;
  if (!sphereContact(terrain, center, radius, inCollideShapeSettings.mMaxSeparationDistance, surface, axis, depth)) return;
  reportSphereContact(inCenterOfMassTransform1, surface, axis, depth, inSubShapeIDCreator1.GetID(), inSubShapeIDCreator2.GetID(),
                      true, ioCollector);
}

void collideSpherePlanet(const JPH::Shape* inShape1, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                         JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                         const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                         const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                         const JPH::ShapeFilter&) {
  if (ioCollector.ShouldEarlyOut()) return;
  Planet& terrain = static_cast<const PlanetShape*>(inShape2)->terrain();
  const float radius = static_cast<const JPH::SphereShape*>(inShape1)->GetRadius();
  const JPH::Vec3 center = inCenterOfMassTransform2.Inversed() * inCenterOfMassTransform1.GetTranslation();
  JPH::Vec3 surface;
  JPH::Vec3 axis;
  float depth = 0.0f;
  if (!sphereContact(terrain, center, radius, inCollideShapeSettings.mMaxSeparationDistance, surface, axis, depth)) return;
  reportSphereContact(inCenterOfMassTransform2, surface, axis, depth, inSubShapeIDCreator2.GetID(), inSubShapeIDCreator1.GetID(),
                      false, ioCollector);
}

}

PlanetShape::PlanetShape(Planet& terrain, float boundRadius)
    : SurfaceShape(JPH::EShapeType::User1, JPH::EShapeSubType::User1), terrain_(terrain), bound_(boundRadius) {}

JPH::AABox PlanetShape::GetLocalBounds() const {
  return JPH::AABox(JPH::Vec3::sReplicate(-bound_), JPH::Vec3::sReplicate(bound_));
}

JPH::Vec3 PlanetShape::GetSurfaceNormal(const JPH::SubShapeID&, JPH::Vec3Arg localSurfacePosition) const {
  const float length = localSurfacePosition.Length();
  return length > 0.0f ? localSurfacePosition / length : JPH::Vec3::sAxisY();
}

void registerCollisions() {
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::User1, JPH::EShapeSubType::Sphere, collidePlanetSphere);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::Sphere, JPH::EShapeSubType::User1, collideSpherePlanet);
}

}
