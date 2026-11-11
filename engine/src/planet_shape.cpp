#include "planet_shape.h"

#include <algorithm>
#include <cmath>

#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/ShapeCast.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
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

bool capsuleContact(Planet& terrain, JPH::Mat44Arg capsuleToPlanet, float halfHeight, float radius, float maxSeparation,
                    JPH::Vec3& surface, JPH::Vec3& axis, float& depth) {
  const JPH::Vec3 a = capsuleToPlanet * JPH::Vec3(0.0f, -halfHeight, 0.0f);
  const JPH::Vec3 b = capsuleToPlanet * JPH::Vec3(0.0f, halfHeight, 0.0f);
  const JPH::Vec3 ab = b - a;
  const float lengthSq = ab.LengthSq();
  const float along = lengthSq > 0.0f ? std::min(1.0f, std::max(0.0f, -a.Dot(ab) / lengthSq)) : 0.0f;
  return sphereContact(terrain, a + ab * along, radius, maxSeparation, surface, axis, depth);
}

void collidePlanetCapsule(const JPH::Shape* inShape1, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                          JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                          const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                          const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                          const JPH::ShapeFilter&) {
  if (ioCollector.ShouldEarlyOut()) return;
  Planet& terrain = static_cast<const PlanetShape*>(inShape1)->terrain();
  const auto* capsule = static_cast<const JPH::CapsuleShape*>(inShape2);
  JPH::Vec3 surface;
  JPH::Vec3 axis;
  float depth = 0.0f;
  const JPH::Mat44 capsuleToPlanet = inCenterOfMassTransform1.Inversed() * inCenterOfMassTransform2;
  if (!capsuleContact(terrain, capsuleToPlanet, capsule->GetHalfHeightOfCylinder(), capsule->GetRadius(),
                      inCollideShapeSettings.mMaxSeparationDistance, surface, axis, depth)) {
    return;
  }
  reportSphereContact(inCenterOfMassTransform1, surface, axis, depth, inSubShapeIDCreator1.GetID(), inSubShapeIDCreator2.GetID(),
                      true, ioCollector);
}

void collideCapsulePlanet(const JPH::Shape* inShape1, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                          JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                          const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                          const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                          const JPH::ShapeFilter&) {
  if (ioCollector.ShouldEarlyOut()) return;
  Planet& terrain = static_cast<const PlanetShape*>(inShape2)->terrain();
  const auto* capsule = static_cast<const JPH::CapsuleShape*>(inShape1);
  JPH::Vec3 surface;
  JPH::Vec3 axis;
  float depth = 0.0f;
  const JPH::Mat44 capsuleToPlanet = inCenterOfMassTransform2.Inversed() * inCenterOfMassTransform1;
  if (!capsuleContact(terrain, capsuleToPlanet, capsule->GetHalfHeightOfCylinder(), capsule->GetRadius(),
                      inCollideShapeSettings.mMaxSeparationDistance, surface, axis, depth)) {
    return;
  }
  reportSphereContact(inCenterOfMassTransform2, surface, axis, depth, inSubShapeIDCreator2.GetID(), inSubShapeIDCreator1.GetID(),
                      false, ioCollector);
}

void castCapsulePlanet(const JPH::ShapeCast& inShapeCast, const JPH::ShapeCastSettings&, const JPH::Shape* inShape, JPH::Vec3Arg,
                       const JPH::ShapeFilter&, JPH::Mat44Arg inCenterOfMassTransform2,
                       const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                       JPH::CastShapeCollector& ioCollector) {
  if (ioCollector.ShouldEarlyOut()) return;
  Planet& terrain = static_cast<const PlanetShape*>(inShape)->terrain();
  const auto* capsule = static_cast<const JPH::CapsuleShape*>(inShapeCast.mShape);
  const float halfHeight = capsule->GetHalfHeightOfCylinder();
  const float radius = capsule->GetRadius();
  const JPH::Mat44 planetFromWorld = inCenterOfMassTransform2.Inversed();
  const JPH::Mat44 start = planetFromWorld * inShapeCast.mCenterOfMassStart;
  const JPH::Vec3 direction = planetFromWorld.Multiply3x3(inShapeCast.mDirection);

  auto contactAt = [&](float fraction, JPH::Vec3& surface, JPH::Vec3& axis, float& depth) {
    const JPH::Mat44 moved = JPH::Mat44::sTranslation(direction * fraction) * start;
    return capsuleContact(terrain, moved, halfHeight, radius, 0.0f, surface, axis, depth);
  };

  constexpr int kSamples = 32;
  constexpr int kBisections = 24;
  JPH::Vec3 surface;
  JPH::Vec3 axis;
  float depth = 0.0f;
  float previous = 0.0f;
  float hit = -1.0f;
  for (int i = 0; i <= kSamples; ++i) {
    const float fraction = static_cast<float>(i) / kSamples;
    if (contactAt(fraction, surface, axis, depth)) {
      hit = fraction;
      break;
    }
    previous = fraction;
  }
  if (hit < 0.0f) return;
  float low = previous;
  float high = hit;
  for (int i = 0; i < kBisections; ++i) {
    const float mid = 0.5f * (low + high);
    if (contactAt(mid, surface, axis, depth)) {
      high = mid;
    } else {
      low = mid;
    }
  }
  if (!contactAt(high, surface, axis, depth)) return;

  const JPH::Vec3 onField = inCenterOfMassTransform2 * surface;
  const JPH::Vec3 normal = inCenterOfMassTransform2.Multiply3x3(axis);
  const JPH::Vec3 onCapsule = onField - normal * depth;
  ioCollector.AddHit(JPH::ShapeCastResult(high, onCapsule, onField, normal * depth, false, inSubShapeIDCreator1.GetID(),
                                          inSubShapeIDCreator2.GetID(), JPH::BodyID()));
}

void registerCollisions() {
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::User1, JPH::EShapeSubType::Sphere, collidePlanetSphere);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::Sphere, JPH::EShapeSubType::User1, collideSpherePlanet);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::User1, JPH::EShapeSubType::Capsule, collidePlanetCapsule);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::Capsule, JPH::EShapeSubType::User1, collideCapsulePlanet);
  JPH::CollisionDispatch::sRegisterCastShape(JPH::EShapeSubType::Capsule, JPH::EShapeSubType::User1, castCapsulePlanet);
}

}
