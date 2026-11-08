#ifndef ENGINE_SURFACE_SHAPE_H
#define ENGINE_SURFACE_SHAPE_H

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Collision/PhysicsMaterial.h>
#include <Jolt/Physics/Collision/Shape/Shape.h>

namespace engine {

class SurfaceShape : public JPH::Shape {
 public:
  SurfaceShape(JPH::EShapeType type, JPH::EShapeSubType subType) : JPH::Shape(type, subType) {}

  JPH::uint GetSubShapeIDBitsRecursive() const override { return 0; }
  float GetInnerRadius() const override { return 0.0f; }
  JPH::MassProperties GetMassProperties() const override { return JPH::MassProperties(); }

  const JPH::PhysicsMaterial* GetMaterial(const JPH::SubShapeID&) const override {
    return JPH::PhysicsMaterial::sDefault.GetPtr();
  }

  JPH::Vec3 GetSurfaceNormal(const JPH::SubShapeID&, JPH::Vec3Arg) const override { return JPH::Vec3::sAxisY(); }

  void GetSubmergedVolume(JPH::Mat44Arg, JPH::Vec3Arg, const JPH::Plane&, float& outTotalVolume, float& outSubmergedVolume,
                          JPH::Vec3& outCenterOfBuoyancy
#ifdef JPH_DEBUG_RENDERER
                          , JPH::RVec3Arg
#endif
                          ) const override {
    outTotalVolume = 0.0f;
    outSubmergedVolume = 0.0f;
    outCenterOfBuoyancy = JPH::Vec3::sZero();
  }

#ifdef JPH_DEBUG_RENDERER
  void Draw(JPH::DebugRenderer*, JPH::RMat44Arg, JPH::Vec3Arg, JPH::ColorArg, bool, bool) const override {}
#endif

  bool CastRay(const JPH::RayCast&, const JPH::SubShapeIDCreator&, JPH::RayCastResult&) const override { return false; }

  void CastRay(const JPH::RayCast&, const JPH::RayCastSettings&, const JPH::SubShapeIDCreator&, JPH::CastRayCollector&,
               const JPH::ShapeFilter& = {}) const override {}

  void CollidePoint(JPH::Vec3Arg, const JPH::SubShapeIDCreator&, JPH::CollidePointCollector&,
                    const JPH::ShapeFilter& = {}) const override {}

  void CollideSoftBodyVertices(JPH::Mat44Arg, JPH::Vec3Arg, const JPH::CollideSoftBodyVertexIterator&, JPH::uint, int) const override {}

  void GetTrianglesStart(JPH::Shape::GetTrianglesContext&, const JPH::AABox&, JPH::Vec3Arg, JPH::QuatArg, JPH::Vec3Arg) const override {}

  int GetTrianglesNext(JPH::Shape::GetTrianglesContext&, int, JPH::Float3*, const JPH::PhysicsMaterial**) const override { return 0; }

  JPH::Shape::Stats GetStats() const override { return JPH::Shape::Stats(sizeof(*this), 0); }

  float GetVolume() const override { return 0.0f; }

  bool MustBeStatic() const override { return true; }
};

}

#endif
