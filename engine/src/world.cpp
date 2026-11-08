#include <Jolt/Jolt.h>

#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>

#include "world.h"

namespace engine {

namespace {

constexpr JPH::ObjectLayer kLayerNonMoving = 0;
constexpr JPH::ObjectLayer kLayerMoving = 1;
constexpr JPH::uint kTempBytes = 4 * 1024 * 1024;
constexpr JPH::uint kMaxBodyPairs = 16384;
constexpr JPH::uint kMaxContactConstraints = 10240;
constexpr float kGroundHalfExtent = 4096.0f;
constexpr float kConvexRadius = 0.05f;

bool joltReady = false;

void silentTrace(const char*, ...) {}

class BroadPhaseLayers final : public JPH::BroadPhaseLayerInterface {
 public:
  BroadPhaseLayers() {
    map_[kLayerNonMoving] = JPH::BroadPhaseLayer(0);
    map_[kLayerMoving] = JPH::BroadPhaseLayer(1);
  }

  JPH::uint GetNumBroadPhaseLayers() const override { return 2; }

  JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer layer) const override { return map_[layer]; }

 private:
  JPH::BroadPhaseLayer map_[2];
};

class ObjectVsBroadPhase final : public JPH::ObjectVsBroadPhaseLayerFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer layer, JPH::BroadPhaseLayer broad) const override {
    if (layer == kLayerNonMoving) return broad == JPH::BroadPhaseLayer(1);
    return true;
  }
};

class ObjectPairs final : public JPH::ObjectLayerPairFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer a, JPH::ObjectLayer b) const override {
    if (a == kLayerNonMoving) return b == kLayerMoving;
    return true;
  }
};

}

struct World::Runtime {
  BroadPhaseLayers broadPhase;
  ObjectVsBroadPhase objectVsBroadPhase;
  ObjectPairs objectPairs;
  JPH::TempAllocatorImpl temp{kTempBytes};
  JPH::JobSystemSingleThreaded jobs{JPH::cMaxPhysicsJobs};
  JPH::PhysicsSystem physics;
  JPH::ShapeRefC sphere;
};

World::~World() {
  delete runtime_;
}

Status World::initialize() {
  if (joltReady) return kOk;
  JPH::RegisterDefaultAllocator();
  JPH::Trace = silentTrace;
  JPH::Factory::sInstance = new JPH::Factory();
  JPH::RegisterTypes();
  joltReady = true;
  return kOk;
}

Status World::configure(const Config& config) {
  if (config.capacity == 0 || config.capacity > kMaxBodies) return kRange;
  if (config.tickRate == 0) return kRange;
  if (config.iterations == 0 || config.iterations > kMaxIterations) return kRange;
  if (!(config.radius > 0.0f)) return kRange;
  if (!joltReady) return kNotConfigured;

  delete runtime_;
  runtime_ = new Runtime();
  capacity_ = config.capacity;
  statics_ = 0;
  count_ = 0;
  tick_ = 0;
  tickRate_ = config.tickRate;
  drag_ = config.drag;
  restitution_ = config.restitution;

  runtime_->physics.Init(kMaxBodies + kMaxStatics + 1, 0, kMaxBodyPairs, kMaxContactConstraints,
                         runtime_->broadPhase, runtime_->objectVsBroadPhase, runtime_->objectPairs);
  runtime_->physics.SetGravity(JPH::Vec3(0.0f, config.gravity, 0.0f));
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mNumVelocitySteps = config.iterations;
  runtime_->physics.SetPhysicsSettings(settings);

  runtime_->sphere = new JPH::SphereShape(config.radius);
  JPH::ShapeRefC ground = new JPH::BoxShape(JPH::Vec3(kGroundHalfExtent, 1.0f, kGroundHalfExtent), kConvexRadius);
  JPH::BodyCreationSettings groundSettings(ground.GetPtr(), JPH::RVec3(0.0f, -1.0f, 0.0f), JPH::Quat::sIdentity(),
                                           JPH::EMotionType::Static, kLayerNonMoving);
  runtime_->physics.GetBodyInterface().CreateAndAddBody(groundSettings, JPH::EActivation::DontActivate);
  return kOk;
}

Status World::addBox(const float* box) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (statics_ == kMaxStatics) return kTooManyStatics;
  const float halfX = (box[3] - box[0]) * 0.5f;
  const float halfY = (box[4] - box[1]) * 0.5f;
  const float halfZ = (box[5] - box[2]) * 0.5f;
  if (!(halfX > 0.0f && halfY > 0.0f && halfZ > 0.0f)) return kZeroThickness;
  const float radius = std::min(kConvexRadius, std::min(halfX, std::min(halfY, halfZ)));
  JPH::ShapeRefC shape = new JPH::BoxShape(JPH::Vec3(halfX, halfY, halfZ), radius);
  const JPH::RVec3 center((box[0] + box[3]) * 0.5f, (box[1] + box[4]) * 0.5f, (box[2] + box[5]) * 0.5f);
  JPH::BodyCreationSettings settings(shape.GetPtr(), center, JPH::Quat::sIdentity(), JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  statics_ += 1;
  return kOk;
}

int World::spawn(const float* position, const float* velocity) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (count_ == capacity_) return kFull;
  JPH::BodyCreationSettings settings(runtime_->sphere.GetPtr(), JPH::RVec3(position[0], position[1], position[2]),
                                     JPH::Quat::sIdentity(), JPH::EMotionType::Dynamic, kLayerMoving);
  settings.mRestitution = restitution_;
  settings.mLinearDamping = drag_;
  settings.mAllowSleeping = false;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id = bodies.CreateAndAddBody(settings, JPH::EActivation::Activate);
  if (id.IsInvalid()) return kFull;
  bodies.SetLinearVelocity(id, JPH::Vec3(velocity[0], velocity[1], velocity[2]));
  const std::uint32_t index = count_;
  bodyIds_[index] = id.GetIndexAndSequenceNumber();
  count_ += 1;
  sync(index);
  return static_cast<int>(index);
}

Status World::setPosition(std::uint32_t id, const float* position) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (id >= count_) return kBadId;
  runtime_->physics.GetBodyInterface().SetPosition(JPH::BodyID(bodyIds_[id]),
                                                   JPH::RVec3(position[0], position[1], position[2]), JPH::EActivation::Activate);
  sync(id);
  return kOk;
}

Status World::setVelocity(std::uint32_t id, const float* velocity) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (id >= count_) return kBadId;
  runtime_->physics.GetBodyInterface().SetLinearVelocity(JPH::BodyID(bodyIds_[id]),
                                                         JPH::Vec3(velocity[0], velocity[1], velocity[2]));
  sync(id);
  return kOk;
}

void World::step(std::uint32_t steps) {
  const float dt = 1.0f / static_cast<float>(tickRate_);
  for (std::uint32_t s = 0; s < steps; ++s) {
    if (runtime_ != nullptr) {
      runtime_->physics.Update(dt, 1, &runtime_->temp, &runtime_->jobs);
      for (std::uint32_t i = 0; i < count_; ++i) sync(i);
    }
    tick_ += 1;
  }
}

void World::setTick(std::uint64_t tick) {
  tick_ = tick;
}

void World::sync(std::uint32_t index) {
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[index]);
  const JPH::RVec3 p = bodies.GetCenterOfMassPosition(id);
  const JPH::Vec3 v = bodies.GetLinearVelocity(id);
  double* position = positions_ + index * 3;
  double* velocity = velocities_ + index * 3;
  position[0] = p.GetX();
  position[1] = p.GetY();
  position[2] = p.GetZ();
  velocity[0] = v.GetX();
  velocity[1] = v.GetY();
  velocity[2] = v.GetZ();
  const JPH::Quat q = bodies.GetRotation(id);
  Transform& transform = transforms_[index];
  transform.x = p.GetX();
  transform.y = p.GetY();
  transform.z = p.GetZ();
  transform.qx = q.GetX();
  transform.qy = q.GetY();
  transform.qz = q.GetZ();
  transform.qw = q.GetW();
}

World& world() {
  static World instance;
  return instance;
}

}
