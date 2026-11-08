#ifndef ENGINE_SPHERE_CONTACT_H
#define ENGINE_SPHERE_CONTACT_H

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Collision/CollideShape.h>
#include <Jolt/Physics/Collision/Shape/Shape.h>

namespace engine {

inline void reportSphereContact(JPH::Mat44Arg fieldToWorld, JPH::Vec3Arg surfaceLocal, JPH::Vec3Arg axisLocal, float depth,
                                JPH::SubShapeID fieldSub, JPH::SubShapeID sphereSub, bool fieldFirst,
                                JPH::CollideShapeCollector& ioCollector) {
  const JPH::Vec3 onField = fieldToWorld * surfaceLocal;
  const JPH::Vec3 axis = fieldToWorld.Multiply3x3(axisLocal);
  const JPH::Vec3 onSphere = onField - axis * depth;
  if (fieldFirst) {
    ioCollector.AddHit(JPH::CollideShapeResult(onField, onSphere, axis, depth, fieldSub, sphereSub, JPH::BodyID()));
  } else {
    ioCollector.AddHit(JPH::CollideShapeResult(onSphere, onField, -axis, depth, sphereSub, fieldSub, JPH::BodyID()));
  }
}

}

#endif
