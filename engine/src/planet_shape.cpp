#include "planet_shape.h"

#include <algorithm>
#include <cmath>

#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/ShapeCast.h>
#include <Jolt/Physics/Collision/TransformedShape.h>
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
  const PhysicsOrigin& o = physicsOrigin();
  const double x = localSurfacePosition.GetX() + o.x;
  const double y = localSurfacePosition.GetY() + o.y;
  const double z = localSurfacePosition.GetZ() + o.z;
  if (!(x * x + y * y + z * z > 0.0)) return JPH::Vec3::sAxisY();
  PageCursor cursor;
  const SurfaceSample sample = sampleSurface(terrain_, x, y, z, cursor);
  return JPH::Vec3(static_cast<float>(sample.normal[0]), static_cast<float>(sample.normal[1]), static_cast<float>(sample.normal[2]));
}

double rayStepMetres(const Planet& terrain) {
  constexpr double kQuarterTurn = 3.14159265358979323846 / 4.0;
  return 0.5 * terrain.cellSize * kQuarterTurn / (kPageSide - 1);
}

namespace {

bool rayFraction(Planet& terrain, JPH::Vec3Arg origin, JPH::Vec3Arg direction, float limit, float& fraction) {
  const PhysicsOrigin& o = physicsOrigin();
  const double px = origin.GetX() + o.x;
  const double py = origin.GetY() + o.y;
  const double pz = origin.GetZ() + o.z;
  const double dx = direction.GetX();
  const double dy = direction.GetY();
  const double dz = direction.GetZ();
  const double length = std::sqrt(dx * dx + dy * dy + dz * dz);
  const double end = std::min(1.0, static_cast<double>(limit));
  if (!(length > 0.0) || !(end >= 0.0)) return false;
  PageCursor cursor;
  double centreDistance = 0.0;
  double outward = 0.0;
  auto gapAt = [&](double t) {
    const double x = px + dx * t;
    const double y = py + dy * t;
    const double z = pz + dz * t;
    centreDistance = std::sqrt(x * x + y * y + z * z);
    outward = x * dx + y * dy + z * dz;
    if (!(centreDistance > 0.0)) return -terrain.radius;
    return centreDistance - (terrain.radius + sampleSurface(terrain, x, y, z, cursor).height);
  };
  if (gapAt(0.0) <= 0.0) {
    fraction = 0.0f;
    return true;
  }
  const double shell = terrain.radius + terrain.maxHeight;
  const double stride = std::max(rayStepMetres(terrain), length * end / kRaySteps);
  double low = 0.0;
  while (low < end) {
    if (centreDistance > shell && outward >= 0.0) return false;
    const double advance = std::max(stride, centreDistance - shell);
    const double high = std::min(end, low + advance / length);
    if (gapAt(high) <= 0.0) {
      double clear = low;
      double blocked = high;
      for (int i = 0; i < kRayBisections; ++i) {
        const double mid = 0.5 * (clear + blocked);
        if (gapAt(mid) <= 0.0) {
          blocked = mid;
        } else {
          clear = mid;
        }
      }
      fraction = static_cast<float>(blocked);
      return true;
    }
    low = high;
  }
  return false;
}

struct RoundContact {
  JPH::Vec3 surface;
  JPH::Vec3 axis;
  float depth;
};

constexpr int kRingSamples = 8;
constexpr int kMaxRoundContacts = kRingSamples + 1;
constexpr double kOnSurfaceMetres = 5.0e-3;
constexpr double kSamePlaneCosine = 1.0 - 1.0e-6;
constexpr double kSamePlaneMetres = 1.0e-4;
constexpr double kRingReachRadii = 3.0;
constexpr double kDiagonal = 0.70710678118654752440;
constexpr double kRing[kRingSamples][2] = {{1.0, 0.0},  {kDiagonal, kDiagonal},   {0.0, 1.0},  {-kDiagonal, kDiagonal},
                                           {-1.0, 0.0}, {-kDiagonal, -kDiagonal}, {0.0, -1.0}, {kDiagonal, -kDiagonal}};

struct PlaneRecord {
  double normal[3];
  double distance;
};

bool onSurface(Planet& terrain, const double* point, PageCursor& cursor) {
  const double distance = std::sqrt(point[0] * point[0] + point[1] * point[1] + point[2] * point[2]);
  if (!(distance > 0.0)) return false;
  const double gap = distance - (terrain.radius + sampleSurface(terrain, point[0], point[1], point[2], cursor).height);
  return std::abs(gap) <= kOnSurfaceMetres;
}

JPH::Vec3 narrow(const double* v) {
  return JPH::Vec3(static_cast<float>(v[0]), static_cast<float>(v[1]), static_cast<float>(v[2]));
}

int roundContacts(Planet& terrain, JPH::Vec3Arg center, float radius, float maxSeparation, RoundContact* out, PageCursor& cursor) {
  const PhysicsOrigin& o = physicsOrigin();
  const double origin[3] = {o.x, o.y, o.z};
  const double c[3] = {center.GetX() + o.x, center.GetY() + o.y, center.GetZ() + o.z};
  const double distance = std::sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
  if (!(distance > 0.0)) return 0;
  const double up[3] = {c[0] / distance, c[1] / distance, c[2] / distance};
  const SurfaceSample under = sampleSurface(terrain, c[0], c[1], c[2], cursor);
  const double reach = terrain.radius + under.height;
  const double gap = distance - reach;
  PlaneRecord planes[kMaxRoundContacts];
  int count = 0;

  bool onPlane = false;
  if (!under.flat) {
    const double planeDistance = gap * (under.normal[0] * up[0] + under.normal[1] * up[1] + under.normal[2] * up[2]);
    double foot[3];
    for (int k = 0; k < 3; ++k) foot[k] = c[k] - under.normal[k] * planeDistance;
    if (onSurface(terrain, foot, cursor)) {
      onPlane = true;
      const double penetration = radius - planeDistance;
      if (penetration >= -maxSeparation) {
        double local[3];
        for (int k = 0; k < 3; ++k) {
          local[k] = foot[k] - origin[k];
          planes[count].normal[k] = under.normal[k];
        }
        planes[count].distance = planeDistance;
        out[count] = RoundContact{narrow(local), narrow(under.normal), static_cast<float>(penetration)};
        count += 1;
      }
    }
  }
  if (!onPlane) {
    const double penetration = reach + radius - distance;
    if (penetration >= -maxSeparation) {
      double local[3];
      for (int k = 0; k < 3; ++k) {
        local[k] = up[k] * reach - origin[k];
        planes[count].normal[k] = up[k];
      }
      planes[count].distance = gap;
      out[count] = RoundContact{narrow(local), narrow(up), static_cast<float>(penetration)};
      count += 1;
    }
  }

  if (!(gap < kRingReachRadii * radius)) return count;
  const int thin = std::abs(up[0]) <= std::abs(up[1]) ? (std::abs(up[0]) <= std::abs(up[2]) ? 0 : 2) : (std::abs(up[1]) <= std::abs(up[2]) ? 1 : 2);
  double axis[3] = {0.0, 0.0, 0.0};
  axis[thin] = 1.0;
  double first[3] = {up[1] * axis[2] - up[2] * axis[1], up[2] * axis[0] - up[0] * axis[2], up[0] * axis[1] - up[1] * axis[0]};
  const double firstLength = std::sqrt(first[0] * first[0] + first[1] * first[1] + first[2] * first[2]);
  for (int k = 0; k < 3; ++k) first[k] /= firstLength;
  const double second[3] = {up[1] * first[2] - up[2] * first[1], up[2] * first[0] - up[0] * first[2], up[0] * first[1] - up[1] * first[0]};

  for (int sample = 0; sample < kRingSamples; ++sample) {
    double q[3];
    for (int k = 0; k < 3; ++k) q[k] = c[k] + radius * (kRing[sample][0] * first[k] + kRing[sample][1] * second[k]);
    const SurfaceSample side = sampleSurface(terrain, q[0], q[1], q[2], cursor);
    if (side.flat && under.flat && side.height == under.height) continue;
    const double qDistance = std::sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2]);
    const double qReach = terrain.radius + side.height;
    double planeDistance = 0.0;
    for (int k = 0; k < 3; ++k) planeDistance += (c[k] - q[k] / qDistance * qReach) * side.normal[k];
    const double penetration = radius - planeDistance;
    if (penetration < -maxSeparation) continue;
    bool known = false;
    for (int p = 0; p < count; ++p) {
      const double cosine = planes[p].normal[0] * side.normal[0] + planes[p].normal[1] * side.normal[1] + planes[p].normal[2] * side.normal[2];
      if (cosine > kSamePlaneCosine && std::abs(planes[p].distance - planeDistance) < kSamePlaneMetres) known = true;
    }
    if (known) continue;
    double foot[3];
    for (int k = 0; k < 3; ++k) foot[k] = c[k] - side.normal[k] * planeDistance;
    if (!onSurface(terrain, foot, cursor)) continue;
    double local[3];
    for (int k = 0; k < 3; ++k) {
      local[k] = foot[k] - origin[k];
      planes[count].normal[k] = side.normal[k];
    }
    planes[count].distance = planeDistance;
    out[count] = RoundContact{narrow(local), narrow(side.normal), static_cast<float>(penetration)};
    count += 1;
  }
  return count;
}

JPH::Vec3 lowestCenter(JPH::Mat44Arg roundToPlanet, float halfHeight) {
  if (!(halfHeight > 0.0f)) return roundToPlanet.GetTranslation();
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::Vec3 a = roundToPlanet * JPH::Vec3(0.0f, -halfHeight, 0.0f);
  const JPH::Vec3 b = roundToPlanet * JPH::Vec3(0.0f, halfHeight, 0.0f);
  const double ex = static_cast<double>(b.GetX()) - a.GetX();
  const double ey = static_cast<double>(b.GetY()) - a.GetY();
  const double ez = static_cast<double>(b.GetZ()) - a.GetZ();
  const double lengthSq = ex * ex + ey * ey + ez * ez;
  const double dx = -o.x - a.GetX();
  const double dy = -o.y - a.GetY();
  const double dz = -o.z - a.GetZ();
  const double along = lengthSq > 0.0 ? std::min(1.0, std::max(0.0, (dx * ex + dy * ey + dz * ez) / lengthSq)) : 0.0;
  return a + JPH::Vec3(static_cast<float>(ex), static_cast<float>(ey), static_cast<float>(ez)) * static_cast<float>(along);
}

void reportRoundContact(JPH::Mat44Arg fieldToWorld, const RoundContact& contact, JPH::SubShapeID fieldSub, JPH::SubShapeID roundSub,
                        bool fieldFirst, JPH::CollideShapeCollector& ioCollector) {
  const JPH::Vec3 onField = fieldToWorld * contact.surface;
  const JPH::Vec3 axis = fieldToWorld.Multiply3x3(contact.axis);
  const JPH::Vec3 onRound = onField - axis * contact.depth;
  const JPH::BodyID body = JPH::TransformedShape::sGetBodyID(ioCollector.GetContext());
  if (fieldFirst) {
    ioCollector.AddHit(JPH::CollideShapeResult(onField, onRound, axis, contact.depth, fieldSub, roundSub, body));
  } else {
    ioCollector.AddHit(JPH::CollideShapeResult(onRound, onField, -axis, contact.depth, roundSub, fieldSub, body));
  }
}

void collidePlanetCapsule(const JPH::Shape* inShape1, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                          JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                          const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                          const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                          const JPH::ShapeFilter&) {
  if (ioCollector.ShouldEarlyOut()) return;
  Planet& terrain = static_cast<const PlanetShape*>(inShape1)->terrain();
  const auto* capsule = static_cast<const JPH::CapsuleShape*>(inShape2);
  const JPH::Mat44 capsuleToPlanet = inCenterOfMassTransform1.Inversed() * inCenterOfMassTransform2;
  RoundContact contacts[kMaxRoundContacts];
  PageCursor cursor;
  const int count = roundContacts(terrain, lowestCenter(capsuleToPlanet, capsule->GetHalfHeightOfCylinder()), capsule->GetRadius(),
                                  inCollideShapeSettings.mMaxSeparationDistance, contacts, cursor);
  for (int i = 0; i < count; ++i) {
    reportRoundContact(inCenterOfMassTransform1, contacts[i], inSubShapeIDCreator1.GetID(), inSubShapeIDCreator2.GetID(), true, ioCollector);
  }
}

void collideCapsulePlanet(const JPH::Shape* inShape1, const JPH::Shape* inShape2, JPH::Vec3Arg, JPH::Vec3Arg,
                          JPH::Mat44Arg inCenterOfMassTransform1, JPH::Mat44Arg inCenterOfMassTransform2,
                          const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                          const JPH::CollideShapeSettings& inCollideShapeSettings, JPH::CollideShapeCollector& ioCollector,
                          const JPH::ShapeFilter&) {
  if (ioCollector.ShouldEarlyOut()) return;
  Planet& terrain = static_cast<const PlanetShape*>(inShape2)->terrain();
  const auto* capsule = static_cast<const JPH::CapsuleShape*>(inShape1);
  const JPH::Mat44 capsuleToPlanet = inCenterOfMassTransform2.Inversed() * inCenterOfMassTransform1;
  RoundContact contacts[kMaxRoundContacts];
  PageCursor cursor;
  const int count = roundContacts(terrain, lowestCenter(capsuleToPlanet, capsule->GetHalfHeightOfCylinder()), capsule->GetRadius(),
                                  inCollideShapeSettings.mMaxSeparationDistance, contacts, cursor);
  for (int i = 0; i < count; ++i) {
    reportRoundContact(inCenterOfMassTransform2, contacts[i], inSubShapeIDCreator2.GetID(), inSubShapeIDCreator1.GetID(), false, ioCollector);
  }
}

void castRoundPlanet(const JPH::ShapeCast& inShapeCast, float halfHeight, float radius, const JPH::Shape* inShape,
                     JPH::Mat44Arg inCenterOfMassTransform2, const JPH::SubShapeIDCreator& inSubShapeIDCreator1,
                     const JPH::SubShapeIDCreator& inSubShapeIDCreator2, JPH::CastShapeCollector& ioCollector) {
  if (ioCollector.ShouldEarlyOut()) return;
  Planet& terrain = static_cast<const PlanetShape*>(inShape)->terrain();
  const JPH::Mat44 start = inShapeCast.mCenterOfMassStart;
  const JPH::Vec3 direction = inShapeCast.mDirection;
  const float length = direction.Length();
  const float end = std::min(1.0f, ioCollector.GetEarlyOutFraction());
  if (!(end >= 0.0f)) return;
  PageCursor cursor;
  RoundContact contacts[kMaxRoundContacts];
  RoundContact touch{};

  auto touchAt = [&](float fraction) {
    const JPH::Mat44 moved = JPH::Mat44::sTranslation(direction * fraction) * start;
    const int count = roundContacts(terrain, lowestCenter(moved, halfHeight), radius, 0.0f, contacts, cursor);
    int deepest = -1;
    for (int i = 0; i < count; ++i) {
      if (deepest < 0 || contacts[i].depth > contacts[deepest].depth) deepest = i;
    }
    if (deepest < 0) return false;
    touch = contacts[deepest];
    return true;
  };

  const int samples = std::clamp(static_cast<int>(std::ceil(length * end / (0.5f * radius))), 1, kCastSamples);
  float clear = 0.0f;
  float blocked = -1.0f;
  for (int i = 0; i <= samples; ++i) {
    const float fraction = end * static_cast<float>(i) / static_cast<float>(samples);
    if (touchAt(fraction)) {
      blocked = fraction;
      break;
    }
    clear = fraction;
  }
  if (blocked < 0.0f) return;
  for (int i = 0; i < kCastBisections && (blocked - clear) * length > kCastResolutionMetres; ++i) {
    const float mid = 0.5f * (clear + blocked);
    if (touchAt(mid)) {
      blocked = mid;
    } else {
      clear = mid;
    }
  }
  if (!touchAt(blocked)) return;

  const JPH::Vec3 onField = inCenterOfMassTransform2 * touch.surface;
  const JPH::Vec3 normal = inCenterOfMassTransform2.Multiply3x3(touch.axis);
  const JPH::Vec3 onRound = onField - normal * touch.depth;
  ioCollector.AddHit(JPH::ShapeCastResult(blocked, onRound, onField, -normal, false, inSubShapeIDCreator1.GetID(),
                                          inSubShapeIDCreator2.GetID(), JPH::TransformedShape::sGetBodyID(ioCollector.GetContext())));
}

void castCapsulePlanet(const JPH::ShapeCast& inShapeCast, const JPH::ShapeCastSettings&, const JPH::Shape* inShape, JPH::Vec3Arg,
                       const JPH::ShapeFilter&, JPH::Mat44Arg inCenterOfMassTransform2,
                       const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                       JPH::CastShapeCollector& ioCollector) {
  const auto* capsule = static_cast<const JPH::CapsuleShape*>(inShapeCast.mShape);
  castRoundPlanet(inShapeCast, capsule->GetHalfHeightOfCylinder(), capsule->GetRadius(), inShape, inCenterOfMassTransform2,
                  inSubShapeIDCreator1, inSubShapeIDCreator2, ioCollector);
}

void castSpherePlanet(const JPH::ShapeCast& inShapeCast, const JPH::ShapeCastSettings&, const JPH::Shape* inShape, JPH::Vec3Arg,
                      const JPH::ShapeFilter&, JPH::Mat44Arg inCenterOfMassTransform2,
                      const JPH::SubShapeIDCreator& inSubShapeIDCreator1, const JPH::SubShapeIDCreator& inSubShapeIDCreator2,
                      JPH::CastShapeCollector& ioCollector) {
  const auto* sphere = static_cast<const JPH::SphereShape*>(inShapeCast.mShape);
  castRoundPlanet(inShapeCast, 0.0f, sphere->GetRadius(), inShape, inCenterOfMassTransform2, inSubShapeIDCreator1, inSubShapeIDCreator2,
                  ioCollector);
}

}

bool PlanetShape::CastRay(const JPH::RayCast& ray, const JPH::SubShapeIDCreator& subShapeIDCreator, JPH::RayCastResult& ioHit) const {
  float fraction = 0.0f;
  if (!rayFraction(terrain_, ray.mOrigin, ray.mDirection, ioHit.mFraction, fraction)) return false;
  if (!(fraction < ioHit.mFraction)) return false;
  ioHit.mFraction = fraction;
  ioHit.mSubShapeID2 = subShapeIDCreator.GetID();
  return true;
}

void PlanetShape::CastRay(const JPH::RayCast& ray, const JPH::RayCastSettings&, const JPH::SubShapeIDCreator& subShapeIDCreator,
                          JPH::CastRayCollector& ioCollector, const JPH::ShapeFilter& shapeFilter) const {
  if (!shapeFilter.ShouldCollide(this, subShapeIDCreator.GetID())) return;
  float fraction = 0.0f;
  if (!rayFraction(terrain_, ray.mOrigin, ray.mDirection, ioCollector.GetEarlyOutFraction(), fraction)) return;
  if (!(fraction < ioCollector.GetEarlyOutFraction())) return;
  JPH::RayCastResult hit;
  hit.mBodyID = JPH::TransformedShape::sGetBodyID(ioCollector.GetContext());
  hit.mFraction = fraction;
  hit.mSubShapeID2 = subShapeIDCreator.GetID();
  ioCollector.AddHit(hit);
}

void registerCollisions() {
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::User1, JPH::EShapeSubType::Sphere, collidePlanetSphere);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::Sphere, JPH::EShapeSubType::User1, collideSpherePlanet);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::User1, JPH::EShapeSubType::Capsule, collidePlanetCapsule);
  JPH::CollisionDispatch::sRegisterCollideShape(JPH::EShapeSubType::Capsule, JPH::EShapeSubType::User1, collideCapsulePlanet);
  JPH::CollisionDispatch::sRegisterCastShape(JPH::EShapeSubType::Capsule, JPH::EShapeSubType::User1, castCapsulePlanet);
  JPH::CollisionDispatch::sRegisterCastShape(JPH::EShapeSubType::Sphere, JPH::EShapeSubType::User1, castSpherePlanet);
}

}
