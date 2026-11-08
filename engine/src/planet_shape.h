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

  Planet& terrain() const { return terrain_; }

 private:
  Planet& terrain_;
  float bound_;
};

void registerCollisions();

}

#endif
