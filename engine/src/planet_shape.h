#ifndef ENGINE_PLANET_SHAPE_H
#define ENGINE_PLANET_SHAPE_H

#include "planet_frame.h"
#include "surface_shape.h"

namespace engine::planet {

class PlanetShape final : public SurfaceShape {
 public:
  PlanetShape(Planet& terrain, float boundRadius);

  JPH::AABox GetLocalBounds() const override;
  JPH::Vec3 GetSurfaceNormal(const JPH::SubShapeID&, JPH::Vec3Arg localSurfacePosition) const override;
  bool CastRay(const JPH::RayCast& ray, const JPH::SubShapeIDCreator& subShapeIDCreator, JPH::RayCastResult& ioHit) const override;
  void CastRay(const JPH::RayCast& ray, const JPH::RayCastSettings& settings, const JPH::SubShapeIDCreator& subShapeIDCreator,
               JPH::CastRayCollector& ioCollector, const JPH::ShapeFilter& shapeFilter = {}) const override;

  Planet& terrain() const { return terrain_; }

 private:
  Planet& terrain_;
  float bound_;
};

constexpr int kRaySteps = 8192;
constexpr int kRayBisections = 24;
constexpr int kCastSamples = 32;
constexpr int kCastBisections = 24;
constexpr float kCastResolutionMetres = 1.0e-5f;

double rayStepMetres(const Planet& terrain);
void registerCollisions();

}

#endif
