#include "phase_timer.h"
#include <Jolt/Jolt.h>

#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#if defined(ENGINE_THREADS)
#include <Jolt/Core/JobSystemThreadPool.h>
#endif
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Character/CharacterVirtual.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#include <Jolt/Physics/Collision/ObjectLayer.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsStepListener.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>
#include <cmath>
#include <new>

#include "arena.h"
#include <cstring>

#include "physics_origin.h"
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
    owner_.applyRadialGravity(*context.mPhysicsSystem, context.mDeltaTime);
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
  JPH::CharacterVirtualSettings characterSettings;
  JPH::Ref<JPH::CharacterVirtual> characters[kMaxCharacters];
  JPH::Vec3 characterCommand[kMaxCharacters];
  JPH::Vec3 characterFall[kMaxCharacters];
  std::uint32_t characterCount = 0;
  float characterRadius = 0.0f;
  float characterHalfHeight = 0.0f;
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
  physicsOrigin() = PhysicsOrigin{};
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

Status World::addBox(const double* box) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (statics_ == limits_.statics) return kTooManyStatics;
  const double extentX = (box[3] - box[0]) * 0.5;
  const double extentY = (box[4] - box[1]) * 0.5;
  const double extentZ = (box[5] - box[2]) * 0.5;
  if (!(extentX > 0.0 && extentY > 0.0 && extentZ > 0.0)) return kZeroThickness;
  const float halfX = static_cast<float>(extentX);
  const float halfY = static_cast<float>(extentY);
  const float halfZ = static_cast<float>(extentZ);
  const float radius = std::min(kConvexRadius, std::min(halfX, std::min(halfY, halfZ)));
  JPH::ShapeRefC shape = new JPH::BoxShape(JPH::Vec3(halfX, halfY, halfZ), radius);
  follow((box[0] + box[3]) * 0.5, (box[1] + box[4]) * 0.5, (box[2] + box[5]) * 0.5);
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::RVec3 center(static_cast<float>((box[0] + box[3]) * 0.5 - o.x),
                          static_cast<float>((box[1] + box[4]) * 0.5 - o.y),
                          static_cast<float>((box[2] + box[5]) * 0.5 - o.z));
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
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] != 0) runtime_->physics.GetBodyInterface().ActivateBody(JPH::BodyID(bodyIds_[slot]));
  }
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

namespace {

JPH::RVec3 toBody(const double* p) {
  const PhysicsOrigin& o = physicsOrigin();
  return JPH::RVec3(static_cast<float>(p[0] - o.x), static_cast<float>(p[1] - o.y), static_cast<float>(p[2] - o.z));
}

}

int World::addCharacter(const double* spec) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(spec[3] > 0.0) || !(spec[4] >= 0.0)) return kRange;
  Runtime& r = *runtime_;
  if (r.characterCount >= kMaxCharacters) return kFull;
  const float radius = static_cast<float>(spec[3]);
  const float halfHeight = static_cast<float>(spec[4]);
  if (r.characterCount == 0) {
    r.characterSettings.mShape = new JPH::CapsuleShape(halfHeight, radius);
    r.characterRadius = radius;
    r.characterHalfHeight = halfHeight;
  } else if (radius != r.characterRadius || halfHeight != r.characterHalfHeight) {
    return kRange;
  }
  const std::uint32_t index = r.characterCount;
  follow(spec[0], spec[1], spec[2]);
  r.characters[index] = new JPH::CharacterVirtual(&r.characterSettings, toBody(spec), JPH::Quat::sIdentity(), &r.physics);
  r.characterCount += 1;
  return static_cast<int>(index);
}

void World::setCharacterVelocity(std::uint32_t index, const float* velocity) {
  if (runtime_ == nullptr || index >= runtime_->characterCount) return;
  runtime_->characterCommand[index] = JPH::Vec3(velocity[0], velocity[1], velocity[2]);
}

bool World::characterSupported(std::uint32_t index) const {
  return runtime_ != nullptr && index < runtime_->characterCount && runtime_->characters[index]->IsSupported();
}

void World::characterPosition(std::uint32_t index, float* out) const {
  out[0] = out[1] = out[2] = 0.0f;
  if (runtime_ == nullptr || index >= runtime_->characterCount) return;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::RVec3 at = runtime_->characters[index]->GetPosition();
  out[0] = static_cast<float>(at.GetX() + o.x);
  out[1] = static_cast<float>(at.GetY() + o.y);
  out[2] = static_cast<float>(at.GetZ() + o.z);
}

void World::characterBodyPosition(std::uint32_t index, float* out) const {
  out[0] = out[1] = out[2] = 0.0f;
  if (runtime_ == nullptr || index >= runtime_->characterCount) return;
  const JPH::RVec3 at = runtime_->characters[index]->GetPosition();
  out[0] = static_cast<float>(at.GetX());
  out[1] = static_cast<float>(at.GetY());
  out[2] = static_cast<float>(at.GetZ());
}

void World::updateCharacters(float dt) {
  if (runtime_ == nullptr) return;
  Runtime& r = *runtime_;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::DefaultBroadPhaseLayerFilter broad(r.objectVsBroadPhase, kLayerMoving);
  const JPH::DefaultObjectLayerFilter object(r.objectPairs, kLayerMoving);
  for (std::uint32_t i = 0; i < r.characterCount; ++i) {
    JPH::Ref<JPH::CharacterVirtual>& c = r.characters[i];
    const JPH::RVec3 at = c->GetPosition();
    const double x = at.GetX() + o.x;
    const double y = at.GetY() + o.y;
    const double z = at.GetZ() + o.z;
    const double distance = std::sqrt(x * x + y * y + z * z);
    JPH::Vec3 gravity = JPH::Vec3::sZero();
    if (distance > 0.0) {
      const double scale = -static_cast<double>(planetGravity_) / distance;
      gravity = JPH::Vec3(static_cast<float>(x * scale), static_cast<float>(y * scale), static_cast<float>(z * scale));
    }
    if (c->IsSupported()) {
      r.characterFall[i] = JPH::Vec3::sZero();
    } else {
      r.characterFall[i] += gravity * dt;
    }
    c->SetLinearVelocity(r.characterCommand[i] + r.characterFall[i]);
    c->Update(dt, gravity, broad, object, JPH::BodyFilter(), JPH::ShapeFilter(), r.temp);
  }
}

Status World::addTrunk(const double* trunk) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (trunkBodies_ == limits_.trunks) return kFull;
  if (!(trunk[3] > 0.0) || !(trunk[4] >= 0.0)) return kRange;
  JPH::ShapeRefC shape = new JPH::CapsuleShape(static_cast<float>(trunk[4]), static_cast<float>(trunk[3]));
  follow(trunk[0], trunk[1], trunk[2]);
  const JPH::RVec3 at = toBody(trunk);
  JPH::BodyCreationSettings settings(shape.GetPtr(), at, JPH::Quat::sIdentity(), JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  trunkBodies_ += 1;
  return kOk;
}

std::int64_t World::spawn(const double* position, const double* velocity) {
  const double row[kBatchWords] = {position[0], position[1], position[2], velocity[0], velocity[1], velocity[2]};
  std::uint32_t handle = 0;
  const int status = spawnBatch(row, 1, &handle);
  if (status < 0) return status;
  return static_cast<std::int64_t>(handle);
}

int World::spawnBatch(const double* rows, std::uint32_t count, std::uint32_t* handles) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (count > capacity_ - live_ - retired_) return kFull;
  if (count > 0) follow(rows[0], rows[1], rows[2]);
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  JPH::BodyID* batch = asBodyIds(batch_);
  for (std::uint32_t i = 0; i < count; ++i) {
    const double* row = rows + i * kBatchWords;
    const int slot = allocateSlot();
    if (slot < 0) return kFull;
    const JPH::BodyID id(bodyIds_[slot]);
    bodies.SetPositionAndRotation(id, toBody(row), JPH::Quat::sIdentity(), JPH::EActivation::DontActivate);
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
    const double* row = rows + i * kBatchWords;
    const std::uint32_t slot = handles[i] & kSlotMask;
    bodies.SetLinearVelocity(JPH::BodyID(bodyIds_[slot]), JPH::Vec3(static_cast<float>(row[3]), static_cast<float>(row[4]), static_cast<float>(row[5])));
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

Status World::setPosition(std::uint32_t handle, const double* position) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  follow(position[0], position[1], position[2]);
  runtime_->physics.GetBodyInterface().SetPosition(JPH::BodyID(bodyIds_[slot]), toBody(position), JPH::EActivation::Activate);
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

Status World::follow(double x, double y, double z) {
  const PhysicsOrigin& o = physicsOrigin();
  const double dx = x - o.x;
  const double dy = y - o.y;
  const double dz = z - o.z;
  if (dx * dx + dy * dy + dz * dz <= kRebaseMetres * kRebaseMetres) return kOk;
  rebase(x, y, z);
  return kOk;
}

void World::rebase(double x, double y, double z) {
  PhysicsOrigin& o = physicsOrigin();
  rebases_ += 1;
  if (runtime_ != nullptr) {
    JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterfaceNoLock();
    const JPH::RVec3 shift(static_cast<float>(x - o.x), static_cast<float>(y - o.y), static_cast<float>(z - o.z));
    JPH::BodyIDVector ids;
    runtime_->physics.GetBodies(ids);
    for (const JPH::BodyID id : ids) {
      const std::uint32_t index = id.GetIndexAndSequenceNumber();
      if (index == planetBody_ || index == vegetationBody_) continue;
      bodies.SetPosition(id, bodies.GetPosition(id) - shift, JPH::EActivation::DontActivate);
    }
    for (std::uint32_t i = 0; i < runtime_->characterCount; ++i) {
      runtime_->characters[i]->SetPosition(runtime_->characters[i]->GetPosition() - shift);
    }
  }
  o.x = x;
  o.y = y;
  o.z = z;
  if (runtime_ == nullptr) return;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] != 0) sync(slot);
  }
}

void World::applyRadialGravity(JPH::PhysicsSystem& system, float dt) {
  if (runtime_ == nullptr || planetBody_ == kNoBody) return;
  constexpr float kSleepSpeed = 0.5f;
  const PhysicsOrigin& o = physicsOrigin();
  JPH::BodyInterface& bodies = system.GetBodyInterfaceNoLock();
  const JPH::BodyLockInterfaceNoLock& locks = system.GetBodyLockInterfaceNoLock();
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] == 0) continue;
    const JPH::BodyID id(bodyIds_[slot]);
    if (!bodies.IsActive(id)) continue;
    const JPH::RVec3 position = bodies.GetCenterOfMassPosition(id);
    const double x = position.GetX() + o.x;
    const double y = position.GetY() + o.y;
    const double z = position.GetZ() + o.z;
    const double distance = std::sqrt(x * x + y * y + z * z);
    if (!(distance > 0.0)) continue;
    const double scale = -static_cast<double>(planetGravity_) * dt / distance;
    bodies.AddLinearVelocity(id, JPH::Vec3(static_cast<float>(x * scale), static_cast<float>(y * scale), static_cast<float>(z * scale)));
    const bool mayRest = bodies.GetLinearVelocity(id).Length() < kSleepSpeed;
    JPH::Body* body = locks.TryGetBody(id);
    if (body != nullptr && body->GetAllowSleeping() != mayRest) body->SetAllowSleeping(mayRest);
  }
}

void World::step(std::uint32_t steps) {
  const float dt = 1.0f / static_cast<float>(tickRate_);
  for (std::uint32_t s = 0; s < steps; ++s) {
    if (runtime_ != nullptr) {
      updateCharacters(dt);
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

Status World::applyPoses(const Transform* rows, std::uint32_t count) {
  if (transforms_ == nullptr || count != limits_.bodies) return kRange;
  std::memcpy(transforms_, rows, static_cast<std::size_t>(count) * sizeof(Transform));
  return kOk;
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
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterfaceNoLock();
  const JPH::BodyID id(bodyIds_[slot]);
  const JPH::RVec3 p = bodies.GetPosition(id);
  const JPH::Vec3 v = bodies.GetLinearVelocity(id);
  const JPH::Quat q = bodies.GetRotation(id);
  const PhysicsOrigin& o = physicsOrigin();
  double* position = positions_ + slot * 3;
  double* velocity = velocities_ + slot * 3;
  position[0] = p.GetX() + o.x;
  position[1] = p.GetY() + o.y;
  position[2] = p.GetZ() + o.z;
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
