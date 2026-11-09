#include "phase_timer.h"
#include <Jolt/Jolt.h>

#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#if defined(ENGINE_THREADS)
#include <Jolt/Core/JobSystemThreadPool.h>
#endif
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsStepListener.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>
#include <new>

#include "arena.h"
#include "planet_frame.h"
#include "planet_shape.h"
#include "pool_alloc.h"
#include "vegetation.h"
#include "world.h"

namespace engine {

namespace {

constexpr JPH::ObjectLayer kLayerNonMoving = 0;
constexpr JPH::ObjectLayer kLayerMoving = 1;
constexpr float kGroundHalfExtent = 4096.0f;
constexpr float kConvexRadius = 0.05f;

bool joltReady = false;
std::uint64_t warmupBase = 0;

void silentTrace(const char*, ...) {}

static_assert(sizeof(JPH::BodyID) == sizeof(std::uint32_t));

JPH::BodyID* asBodyIds(std::uint32_t* raw) {
  return reinterpret_cast<JPH::BodyID*>(raw);
}

template <typename T>
T* carveArray(std::size_t count) {
  return static_cast<T*>(arena::carve(sizeof(T) * count, alignof(T)));
}

class BroadPhaseLayers final : public JPH::BroadPhaseLayerInterface {
 public:
  BroadPhaseLayers() {
    map_[kLayerNonMoving] = JPH::BroadPhaseLayer(0);
    map_[kLayerMoving] = JPH::BroadPhaseLayer(1);
  }

  JPH::uint GetNumBroadPhaseLayers() const override { return 2; }

  JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer layer) const override { return map_[layer]; }

#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
  const char* GetBroadPhaseLayerName(JPH::BroadPhaseLayer layer) const override {
    return layer == JPH::BroadPhaseLayer(0) ? "non-moving" : "moving";
  }
#endif

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

class RadialGravity final : public JPH::PhysicsStepListener {
 public:
  explicit RadialGravity(World& owner) : owner_(owner) {}

  void OnStep(const JPH::PhysicsStepListenerContext& context) override {
    owner_.applyRadialGravity(context.mPhysicsSystem->GetBodyInterfaceNoLock(), context.mDeltaTime);
  }

 private:
  World& owner_;
};

}

struct World::Runtime {
  Runtime(World& owner, std::uint64_t tempBytes, std::uint32_t workers)
      : temp(static_cast<std::size_t>(tempBytes)),
#if defined(ENGINE_THREADS)
        jobs(JPH::cMaxPhysicsJobs, JPH::cMaxPhysicsBarriers, static_cast<int>(workers) - 1),
#else
        jobs(JPH::cMaxPhysicsJobs),
#endif
        gravity(owner) {}

  BroadPhaseLayers broadPhase;
  ObjectVsBroadPhase objectVsBroadPhase;
  ObjectPairs objectPairs;
  JPH::TempAllocatorImpl temp;
#if defined(ENGINE_THREADS)
  JPH::JobSystemThreadPool jobs;
#else
  JPH::JobSystemSingleThreaded jobs;
#endif
  JPH::PhysicsSystem physics;
  JPH::ShapeRefC sphere;
  JPH::ShapeRefC planetShape;
  JPH::ShapeRefC vegetationShape;
  RadialGravity gravity;
};

std::uint64_t allocationsTotal() {
  return arena::carves();
}

void markWarmup() {
  warmupBase = arena::carves();
}

std::uint64_t allocationsSinceWarmup() {
  return arena::carves() - warmupBase;
}

World::~World() {
  releaseRuntime();
}

void World::releaseRuntime() {
  if (runtime_ == nullptr) return;
  runtime_->~Runtime();
  pool::releaseAligned(runtime_);
  runtime_ = nullptr;
}

Status World::initialize() {
  if (joltReady) return kOk;
  JPH::RegisterDefaultAllocator();
  pool::installJoltHooks();
  JPH::Trace = silentTrace;
  JPH::Factory::sInstance = new JPH::Factory();
  JPH::RegisterTypes();
  planet::registerCollisions();
  vegetation::registerCollisions();
  joltReady = true;
  return kOk;
}

Status World::bind(const budget::Capacity& capacity) {
  if (bodyIds_ != nullptr) return kAlreadyInitialized;
  const std::size_t n = capacity.bodies;
  bodyIds_ = carveArray<std::uint32_t>(n);
  batch_ = carveArray<std::uint32_t>(n);
  freeSlots_ = carveArray<std::uint32_t>(n);
  generations_ = carveArray<std::uint16_t>(n);
  alive_ = carveArray<std::uint8_t>(n);
  positions_ = carveArray<double>(n * 3);
  velocities_ = carveArray<double>(n * 3);
  transforms_ = carveArray<Transform>(n);
  if (bodyIds_ == nullptr || batch_ == nullptr || freeSlots_ == nullptr || generations_ == nullptr || alive_ == nullptr ||
      positions_ == nullptr || velocities_ == nullptr || transforms_ == nullptr) {
    return kFull;
  }
  limits_ = capacity;
  return kOk;
}

Status World::configure(const Config& config) {
  if (config.capacity == 0 || config.capacity > limits_.bodies) return kRange;
  if (config.tickRate == 0) return kRange;
  if (config.iterations == 0 || config.iterations > kMaxIterations) return kRange;
  if (!(config.radius > 0.0f)) return kRange;
  if (!joltReady) return kNotConfigured;
  if (bodyIds_ == nullptr) return kNotConfigured;

  releaseRuntime();
  void* raw = pool::allocateAligned(sizeof(Runtime), alignof(Runtime));
  if (raw == nullptr) return kFull;
  runtime_ = new (raw) Runtime(*this, limits_.tempBytes, limits_.workers);
  runtime_->jobs.CreateJob("warm", JPH::Color::sGreen, [] {}, 0);
  capacity_ = config.capacity;
  statics_ = 0;
  live_ = 0;
  retired_ = 0;
  fresh_ = 0;
  freeCount_ = 0;
  tick_ = 0;
  tickRate_ = config.tickRate;
  drag_ = config.drag;
  restitution_ = config.restitution;
  planetGravity_ = 0.0f;
  groundBody_ = kNoBody;
  planetBody_ = kNoBody;
  vegetationBody_ = kNoBody;
  trunkBodies_ = 0;
  std::fill(generations_, generations_ + limits_.bodies, static_cast<std::uint16_t>(0));
  std::fill(alive_, alive_ + limits_.bodies, static_cast<std::uint8_t>(0));

  runtime_->physics.Init(joltBodyCapacity(limits_), 0, joltPairCapacity(limits_), joltContactCapacity(limits_), runtime_->broadPhase,
                         runtime_->objectVsBroadPhase, runtime_->objectPairs);
  runtime_->physics.SetGravity(JPH::Vec3(0.0f, config.gravity, 0.0f));
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mNumVelocitySteps = config.iterations;
  settings.mNumPositionSteps = config.iterations;
  settings.mPenetrationSlop = 0.0f;
  runtime_->physics.SetPhysicsSettings(settings);
  runtime_->physics.AddStepListener(&runtime_->gravity);

  runtime_->sphere = new JPH::SphereShape(config.radius);
  JPH::ShapeRefC ground = new JPH::BoxShape(JPH::Vec3(kGroundHalfExtent, 1.0f, kGroundHalfExtent), kConvexRadius);
  JPH::BodyCreationSettings groundSettings(ground.GetPtr(), JPH::RVec3(0.0f, -1.0f, 0.0f), JPH::Quat::sIdentity(),
                                           JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID groundId = runtime_->physics.GetBodyInterface().CreateAndAddBody(groundSettings, JPH::EActivation::DontActivate);
  groundBody_ = groundId.GetIndexAndSequenceNumber();

  for (std::uint32_t slot = 0; slot < capacity_; ++slot) {
    JPH::BodyCreationSettings bodySettings(runtime_->sphere.GetPtr(), JPH::RVec3::sZero(), JPH::Quat::sIdentity(),
                                           JPH::EMotionType::Dynamic, kLayerMoving);
    bodySettings.mRestitution = restitution_;
    bodySettings.mLinearDamping = drag_;
    bodySettings.mAllowSleeping = true;
    JPH::Body* body = runtime_->physics.GetBodyInterface().CreateBody(bodySettings);
    if (body == nullptr) return kFull;
    bodyIds_[slot] = body->GetID().GetIndexAndSequenceNumber();
  }
  return kOk;
}

void World::removeBody(std::uint32_t index) {
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(index);
  bodies.RemoveBody(id);
  bodies.DestroyBody(id);
}

Status World::addBox(const float* box) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (statics_ == limits_.statics) return kTooManyStatics;
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

Status World::configurePlanet(double radius, double cellSize, double gravity, double maxHeight) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(gravity > 0.0)) return kRange;
  if (!planet::configure(planet::state(), radius, cellSize, maxHeight)) return kRange;
  if (groundBody_ != kNoBody) {
    removeBody(groundBody_);
    groundBody_ = kNoBody;
  }
  if (planetBody_ != kNoBody) {
    removeBody(planetBody_);
    planetBody_ = kNoBody;
  }
  runtime_->physics.SetGravity(JPH::Vec3::sZero());
  runtime_->planetShape = new planet::PlanetShape(planet::state(), static_cast<float>(radius + maxHeight));
  JPH::BodyCreationSettings settings(runtime_->planetShape.GetPtr(), JPH::RVec3::sZero(), JPH::Quat::sIdentity(),
                                     JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  planetBody_ = id.GetIndexAndSequenceNumber();
  planetGravity_ = static_cast<float>(gravity);
  return kOk;
}

Status World::attachVegetation() {
  if (runtime_ == nullptr) return kNotConfigured;
  if (!vegetation::state().configured) return kNotConfigured;
  if (vegetationBody_ != kNoBody) return kOk;
  runtime_->vegetationShape = new vegetation::VegetationShape();
  JPH::BodyCreationSettings settings(runtime_->vegetationShape.GetPtr(), JPH::RVec3::sZero(), JPH::Quat::sIdentity(),
                                     JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  vegetationBody_ = id.GetIndexAndSequenceNumber();
  return kOk;
}

Status World::addTrunk(const float* trunk) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (trunkBodies_ == limits_.trunks) return kFull;
  if (!(trunk[3] > 0.0f) || !(trunk[4] >= 0.0f)) return kRange;
  JPH::ShapeRefC shape = new JPH::CapsuleShape(trunk[4], trunk[3]);
  JPH::BodyCreationSettings settings(shape.GetPtr(), JPH::RVec3(trunk[0], trunk[1], trunk[2]), JPH::Quat::sIdentity(),
                                     JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  trunkBodies_ += 1;
  return kOk;
}

std::int64_t World::spawn(const float* position, const float* velocity) {
  const float row[kBatchFloats] = {position[0], position[1], position[2], velocity[0], velocity[1], velocity[2]};
  std::uint32_t handle = 0;
  const int status = spawnBatch(row, 1, &handle);
  if (status < 0) return status;
  return static_cast<std::int64_t>(handle);
}

int World::spawnBatch(const float* rows, std::uint32_t count, std::uint32_t* handles) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (count > capacity_ - live_ - retired_) return kFull;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  JPH::BodyID* batch = asBodyIds(batch_);
  for (std::uint32_t i = 0; i < count; ++i) {
    const float* row = rows + i * kBatchFloats;
    const int slot = allocateSlot();
    if (slot < 0) return kFull;
    const JPH::BodyID id(bodyIds_[slot]);
    bodies.SetPositionAndRotation(id, JPH::RVec3(row[0], row[1], row[2]), JPH::Quat::sIdentity(), JPH::EActivation::DontActivate);
    batch[i] = id;
    alive_[slot] = 1;
    live_ += 1;
    handles[i] = (static_cast<std::uint32_t>(generations_[slot]) << 16) | static_cast<std::uint32_t>(slot);
  }
  if (count > 0) {
    const JPH::BodyInterface::AddState state = bodies.AddBodiesPrepare(batch, static_cast<int>(count));
    bodies.AddBodiesFinalize(batch, static_cast<int>(count), state, JPH::EActivation::Activate);
  }
  for (std::uint32_t i = 0; i < count; ++i) {
    const float* row = rows + i * kBatchFloats;
    const std::uint32_t slot = handles[i] & kSlotMask;
    bodies.SetLinearVelocity(JPH::BodyID(bodyIds_[slot]), JPH::Vec3(row[3], row[4], row[5]));
    sync(slot);
  }
  return static_cast<int>(count);
}

Status World::despawn(std::uint32_t handle) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  bodies.RemoveBody(id);
  alive_[slot] = 0;
  live_ -= 1;
  if (generations_[slot] == kLastGeneration) {
    generations_[slot] = kRetiredGeneration;
    retired_ += 1;
    return kOk;
  }
  generations_[slot] = static_cast<std::uint16_t>(generations_[slot] + 1);
  freeSlots_[freeCount_] = static_cast<std::uint32_t>(slot);
  freeCount_ += 1;
  return kOk;
}

Status World::setPosition(std::uint32_t handle, const float* position) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  runtime_->physics.GetBodyInterface().SetPosition(JPH::BodyID(bodyIds_[slot]),
                                                   JPH::RVec3(position[0], position[1], position[2]), JPH::EActivation::Activate);
  sync(static_cast<std::uint32_t>(slot));
  return kOk;
}

Status World::setVelocity(std::uint32_t handle, const float* velocity) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  runtime_->physics.GetBodyInterface().SetLinearVelocity(JPH::BodyID(bodyIds_[slot]),
                                                         JPH::Vec3(velocity[0], velocity[1], velocity[2]));
  sync(static_cast<std::uint32_t>(slot));
  return kOk;
}

void World::applyRadialGravity(JPH::BodyInterface& bodies, float dt) {
  if (runtime_ == nullptr || planetBody_ == kNoBody) return;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] == 0) continue;
    const JPH::BodyID id(bodyIds_[slot]);
    const JPH::RVec3 position = bodies.GetCenterOfMassPosition(id);
    const float distance = position.Length();
    if (!(distance > 0.0f)) continue;
    const float scale = -planetGravity_ * dt / distance;
    bodies.AddLinearVelocity(id, JPH::Vec3(position.GetX() * scale, position.GetY() * scale, position.GetZ() * scale));
  }
}

void World::step(std::uint32_t steps) {
  const float dt = 1.0f / static_cast<float>(tickRate_);
  for (std::uint32_t s = 0; s < steps; ++s) {
    if (runtime_ != nullptr) {
      {
        engine::phase::Scope scope(engine::phase::kPhysics);
        runtime_->physics.Update(dt, 1, &runtime_->temp, &runtime_->jobs);
      }
      {
        engine::phase::Scope scope(engine::phase::kReadback);
        for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
          if (alive_[slot] != 0) sync(slot);
        }
      }
    }
    tick_ += 1;
  }
}

void World::setTick(std::uint64_t tick) {
  tick_ = tick;
}

std::uint32_t World::physicsBodies() const {
  return runtime_ == nullptr ? 0 : runtime_->physics.GetNumBodies() - (capacity_ - live_);
}

std::uint32_t World::activeBodies() const {
  return runtime_ == nullptr ? 0 : runtime_->physics.GetNumActiveBodies(JPH::EBodyType::RigidBody);
}

int World::resolve(std::uint32_t handle) const {
  const std::uint32_t slot = handle & kSlotMask;
  if (slot >= fresh_ || alive_[slot] == 0) return -1;
  if (generations_[slot] != (handle >> 16)) return -1;
  return static_cast<int>(slot);
}

int World::allocateSlot() {
  if (freeCount_ > 0) {
    freeCount_ -= 1;
    return static_cast<int>(freeSlots_[freeCount_]);
  }
  if (fresh_ < capacity_) {
    const std::uint32_t slot = fresh_;
    fresh_ += 1;
    return static_cast<int>(slot);
  }
  return -1;
}

void World::sync(std::uint32_t slot) {
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  const JPH::RVec3 p = bodies.GetPosition(id);
  const JPH::Vec3 v = bodies.GetLinearVelocity(id);
  const JPH::Quat q = bodies.GetRotation(id);
  double* position = positions_ + slot * 3;
  double* velocity = velocities_ + slot * 3;
  position[0] = p.GetX();
  position[1] = p.GetY();
  position[2] = p.GetZ();
  velocity[0] = v.GetX();
  velocity[1] = v.GetY();
  velocity[2] = v.GetZ();
  Transform& transform = transforms_[slot];
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
