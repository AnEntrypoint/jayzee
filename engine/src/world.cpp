#include "phase_timer.h"
#include "tick_profile.h"
#include <Jolt/Jolt.h>

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
#if defined(ENGINE_BROADPHASE_INTERVAL)
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseQuadTree.h>
#endif
#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Collision/CollideShape.h>
#include <Jolt/Physics/Collision/CollisionCollectorImpl.h>
#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/NarrowPhaseQuery.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/ShapeCast.h>
#include <Jolt/Physics/Collision/ObjectLayer.h>
#include <Jolt/Physics/Collision/PhysicsMaterial.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>
#include <cmath>
#include <limits>
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

#if !defined(ENGINE_MOVING_LAYERS)
#define ENGINE_MOVING_LAYERS 1
#endif

constexpr JPH::ObjectLayer kLayerNonMoving = 0;
constexpr JPH::ObjectLayer kLayerPlanet = 1;
constexpr JPH::ObjectLayer kLayerMoving = 2;
constexpr std::uint32_t kMovingLayers = ENGINE_MOVING_LAYERS;
constexpr JPH::ObjectLayer kLayerAirborne = static_cast<JPH::ObjectLayer>(kLayerMoving + kMovingLayers);
constexpr std::uint32_t kBroadLayerCount = kLayerMoving + kMovingLayers;
constexpr std::uint32_t kMinParallelRows = 1024;
constexpr std::uint8_t kAirNow = 1;
constexpr std::uint8_t kAirWanted = 2;
constexpr std::uint32_t kCeilingTicks = 4;
constexpr double kCeilingSlackMetres = 1.0;
constexpr double kAirMarginMetres = 0.1;
constexpr std::uint32_t kBroadphaseRebuildSteps = 4;

static_assert(kMovingLayers >= 1 && kMovingLayers <= 8);

JPH::ObjectLayer movingLayerOf(std::uint32_t slot) {
  return static_cast<JPH::ObjectLayer>(kLayerMoving + slot % kMovingLayers);
}

JPH::ObjectLayer airborneLayerOf(std::uint32_t slot) {
  return static_cast<JPH::ObjectLayer>(kLayerAirborne + slot % kMovingLayers);
}

constexpr bool isAirborneLayer(JPH::ObjectLayer layer) {
  return layer >= kLayerAirborne;
}
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

class PeakTempAllocator final : public JPH::TempAllocator {
 public:
  explicit PeakTempAllocator(std::size_t bytes) : inner_(static_cast<JPH::uint>(bytes)) {}

  void* Allocate(JPH::uint size) override {
    void* block = inner_.Allocate(size);
    const std::size_t used = inner_.GetUsage();
    if (used > peak_) peak_ = used;
    return block;
  }

  void Free(void* address, JPH::uint size) override { inner_.Free(address, size); }

  std::size_t peak() const { return peak_; }

 private:
  JPH::TempAllocatorImpl inner_;
  std::size_t peak_ = 0;
};

class BroadPhaseLayers final : public JPH::BroadPhaseLayerInterface {
 public:
  JPH::uint GetNumBroadPhaseLayers() const override { return kBroadLayerCount; }

  JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer layer) const override {
    const JPH::ObjectLayer tree = isAirborneLayer(layer) ? static_cast<JPH::ObjectLayer>(layer - kMovingLayers) : layer;
    return JPH::BroadPhaseLayer(static_cast<JPH::BroadPhaseLayer::Type>(tree));
  }

#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
  const char* GetBroadPhaseLayerName(JPH::BroadPhaseLayer layer) const override {
    return layer == JPH::BroadPhaseLayer(0) ? "non-moving" : layer == JPH::BroadPhaseLayer(1) ? "planet" : "moving";
  }
#endif
};

class ObjectVsBroadPhase final : public JPH::ObjectVsBroadPhaseLayerFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer layer, JPH::BroadPhaseLayer broad) const override {
    const bool fixedTree = broad == JPH::BroadPhaseLayer(0) || broad == JPH::BroadPhaseLayer(1);
    if (layer < kLayerMoving) return !fixedTree;
    if (isAirborneLayer(layer)) return broad != JPH::BroadPhaseLayer(1);
    return true;
  }
};

class ObjectPairs final : public JPH::ObjectLayerPairFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer a, JPH::ObjectLayer b) const override {
    if (a < kLayerMoving && b < kLayerMoving) return false;
    if (a == kLayerPlanet && isAirborneLayer(b)) return false;
    if (b == kLayerPlanet && isAirborneLayer(a)) return false;
    return true;
  }
};

class StandListener final : public JPH::CharacterContactListener {
 public:
  void OnContactSolve(const JPH::CharacterVirtual* character, const JPH::BodyID&, const JPH::SubShapeID&, JPH::RVec3Arg, JPH::Vec3Arg contactNormal,
                      JPH::Vec3Arg contactVelocity, const JPH::PhysicsMaterial*, JPH::Vec3Arg, JPH::Vec3& ioNewCharacterVelocity) override {
    if (standing && contactVelocity.IsNearZero() && !character->IsSlopeTooSteep(contactNormal)) ioNewCharacterVelocity = JPH::Vec3::sZero();
  }

  bool standing = false;
};

}

struct World::Runtime {
  Runtime(std::uint64_t tempBytes, std::uint32_t workers)
      : temp(static_cast<std::size_t>(tempBytes)),
#if defined(ENGINE_THREADS)
        jobs(JPH::cMaxPhysicsJobs, JPH::cMaxPhysicsBarriers, static_cast<int>(workers) - 1)
#else
        jobs(JPH::cMaxPhysicsJobs)
#endif
  {
    static_cast<void>(workers);
  }

  BroadPhaseLayers broadPhase;
  ObjectVsBroadPhase objectVsBroadPhase;
  ObjectPairs objectPairs;
  PeakTempAllocator temp;
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
  StandListener stand;
  std::uint32_t characterCount = 0;
  float characterRadius = 0.0f;
  float characterHalfHeight = 0.0f;
  JPH::ShapeRefC sphere;
  JPH::ShapeRefC planetShape;
  JPH::ShapeRefC vegetationShape;
  JPH::BodyIDVector rebaseIds;
  const JPH::BodyID* activeIds = nullptr;
  float stepDt = 0.0f;
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
  if (!JPH::VerifyJoltVersionID()) std::abort();
  JPH::CollisionDispatch::sInit();
  JPH::ConvexShape::sRegister();
  JPH::SphereShape::sRegister();
  JPH::BoxShape::sRegister();
  JPH::CapsuleShape::sRegister();
  if (JPH::PhysicsMaterial::sDefault == nullptr) JPH::PhysicsMaterial::sDefault = new JPH::PhysicsMaterial();
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
  air_ = carveArray<std::uint8_t>(n);
  ceiling_ = carveArray<float>(n);
  releaseQueue_ = carveArray<std::uint64_t>(n);
  if (releaseQueue_ == nullptr) return kFull;
  if (bodyIds_ == nullptr || batch_ == nullptr || freeSlots_ == nullptr || generations_ == nullptr || alive_ == nullptr ||
      positions_ == nullptr || velocities_ == nullptr || transforms_ == nullptr || air_ == nullptr || ceiling_ == nullptr) {
    return kFull;
  }
  limits_ = capacity;
  return kOk;
}

Status World::configure(const Config& config) {
  if (arena::sealed()) return kSealed;
  if (config.capacity == 0 || config.capacity > limits_.bodies) return kRange;
  if (config.tickRate == 0) return kRange;
  if (config.iterations == 0 || config.iterations > kMaxIterations) return kRange;
  if (!(config.radius > 0.0f)) return kRange;
  if (!joltReady) return kNotConfigured;
  if (bodyIds_ == nullptr) return kNotConfigured;

  forgetPromotions();
  promoteCap_ = 0;
  promotionRefusals_ = 0;
  releaseRuntime();
  physicsOrigin() = PhysicsOrigin{};
  void* raw = pool::allocateAligned(sizeof(Runtime), alignof(Runtime));
  if (raw == nullptr) return kFull;
  runtime_ = new (raw) Runtime(limits_.tempBytes, limits_.workers);
  runtime_->jobs.CreateJob("warm", JPH::Color::sGreen, [] {}, 0);
  const std::uint32_t rowsToClear = std::max(capacity_, config.capacity);
  capacity_ = config.capacity;
  awakeDesign_ = nextAwakeDesign_;
  budget::Capacity sized = limits_;
  sized.bodies = config.capacity;
  budget::Capacity contactSized = limits_;
  contactSized.bodies = std::min(config.capacity, awakeDesign_);
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
  std::fill(generations_, generations_ + rowsToClear, static_cast<std::uint16_t>(0));
  std::fill(alive_, alive_ + rowsToClear, static_cast<std::uint8_t>(0));
  std::fill(air_, air_ + rowsToClear, static_cast<std::uint8_t>(0));
  std::fill(ceiling_, ceiling_ + rowsToClear, std::numeric_limits<float>::quiet_NaN());
  radius_ = config.radius;
  heldCount_ = 0;
  updateErrors_ = 0;
  queueCount_ = 0;
  queueHead_ = 0;
  queueStale_ = true;
  queueDrifted_ = false;
  sinceRefill_ = 0;
  releaseRefills_ = 0;
  viewSet_ = false;

  runtime_->physics.Init(joltBodyCapacity(sized), 0, joltPairCapacity(contactSized), joltContactCapacity(contactSized), runtime_->broadPhase,
                         runtime_->objectVsBroadPhase, runtime_->objectPairs);
  runtime_->physics.SetGravity(JPH::Vec3(0.0f, config.gravity, 0.0f));
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mNumVelocitySteps = config.iterations;
  settings.mNumPositionSteps = config.iterations;
  settings.mPenetrationSlop = 0.0f;
  runtime_->physics.SetPhysicsSettings(settings);
  runtime_->rebaseIds.reserve(joltBodyCapacity(sized));
  tuning_ = 0;
  if (applyTuning(kDefaultTuning) != kOk) return kRange;

  runtime_->sphere = new JPH::SphereShape(config.radius);
  JPH::ShapeRefC ground = new JPH::BoxShape(JPH::Vec3(kGroundHalfExtent, 1.0f, kGroundHalfExtent), kConvexRadius);
  JPH::BodyCreationSettings groundSettings(ground.GetPtr(), JPH::RVec3(0.0f, -1.0f, 0.0f), JPH::Quat::sIdentity(),
                                           JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID groundId = runtime_->physics.GetBodyInterface().CreateAndAddBody(groundSettings, JPH::EActivation::DontActivate);
  groundBody_ = groundId.GetIndexAndSequenceNumber();

  for (std::uint32_t slot = 0; slot < capacity_; ++slot) {
    JPH::BodyCreationSettings bodySettings(runtime_->sphere.GetPtr(), JPH::RVec3::sZero(), JPH::Quat::sIdentity(),
                                           JPH::EMotionType::Dynamic, movingLayerOf(slot));
    bodySettings.mRestitution = restitution_;
    bodySettings.mLinearDamping = drag_;
    bodySettings.mAllowSleeping = true;
    JPH::Body* body = runtime_->physics.GetBodyInterface().CreateBody(bodySettings);
    if (body == nullptr) return kFull;
    body->SetUserData(static_cast<JPH::uint64>(slot) + 1);
    bodyIds_[slot] = body->GetID().GetIndexAndSequenceNumber();
  }
  std::uint32_t spare[pool::kClasses];
  for (std::uint32_t i = 0; i < pool::kClasses; ++i) spare[i] = pool::kPrimeCounts[i];
  if (!pool::refill(spare)) return kFull;
  return kOk;
}

void World::removeBody(std::uint32_t index) {
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(index);
  bodies.RemoveBody(id);
  bodies.DestroyBody(id);
}

Status World::addBox(const double* box) {
  if (arena::sealed()) return kSealed;
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
  if (arena::sealed()) return kSealed;
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
                                     JPH::EMotionType::Static, kLayerPlanet);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  planetBody_ = id.GetIndexAndSequenceNumber();
  planetGravity_ = static_cast<float>(gravity);
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] != kSlotFree && alive_[slot] != kSlotHeld && !spawnAsleep_) runtime_->physics.GetBodyInterface().ActivateBody(JPH::BodyID(bodyIds_[slot]));
  }
  return kOk;
}

Status World::attachVegetation() {
  if (arena::sealed()) return kSealed;
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

void World::forgetPromotions() {
  if (vegetation::isBound()) {
    for (std::uint32_t i = 0; i < promotedCount_; ++i) vegetation::restore(vegetation::state(), promoted_[i].instance);
  }
  promotedCount_ = 0;
}

Status World::setVegetationPromotion(std::uint32_t cap) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (cap > kMaxPromotedInstances) return kRange;
  promoteCap_ = cap;
  return kOk;
}

Status World::restoreVegetation() {
  if (runtime_ == nullptr) return kNotConfigured;
  for (std::uint32_t i = 0; i < promotedCount_; ++i) despawn(promoted_[i].handle);
  forgetPromotions();
  return kOk;
}

void World::promoteTouched() {
  const vegetation::Touch* touches = nullptr;
  const std::uint32_t count = vegetation::drainTouches(touches);
  vegetation::Field& field = vegetation::state();
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  for (std::uint32_t i = 0; i < count; ++i) {
    const vegetation::Touch& touch = touches[i];
    if (promotedCount_ >= promoteCap_ || capacity_ - live_ - retired_ == 0) {
      promotionRefusals_ += 1;
      continue;
    }
    if (!vegetation::promote(field, touch.instance)) continue;
    const int slot = allocateSlot();
    if (slot < 0) {
      vegetation::restore(field, touch.instance);
      promotionRefusals_ += 1;
      continue;
    }
    const JPH::BodyID id(bodyIds_[slot]);
    bodies.SetPositionAndRotation(id, JPH::RVec3(touch.x, touch.y, touch.z), JPH::Quat::sIdentity(), JPH::EActivation::DontActivate);
    if ((air_[slot] & kAirNow) != 0) bodies.SetObjectLayer(id, movingLayerOf(static_cast<std::uint32_t>(slot)));
    air_[slot] = 0;
    ceiling_[slot] = std::numeric_limits<float>::quiet_NaN();
    bodies.AddBody(id, JPH::EActivation::Activate);
    bodies.SetLinearAndAngularVelocity(id, JPH::Vec3::sZero(), JPH::Vec3::sZero());
    alive_[slot] = kSlotAlive;
    live_ += 1;
    promoted_[promotedCount_] = PromotedRow{touch.instance, (static_cast<std::uint32_t>(generations_[slot]) << kSlotBits) | static_cast<std::uint32_t>(slot)};
    promotedCount_ += 1;
    sync(static_cast<std::uint32_t>(slot));
  }
}

namespace {

JPH::RVec3 toBody(const double* p) {
  const PhysicsOrigin& o = physicsOrigin();
  return JPH::RVec3(static_cast<float>(p[0] - o.x), static_cast<float>(p[1] - o.y), static_cast<float>(p[2] - o.z));
}

constexpr JPH::uint kCharacterMaxHits = 32;

bool reserveContactBlocks(std::uint32_t characters) {
  const std::size_t smallest = sizeof(JPH::CharacterVirtual::Contact);
  const std::size_t largest = (kCharacterMaxHits + 1) * sizeof(JPH::CharacterVirtual::Contact) + alignof(JPH::CharacterVirtual::Contact) + sizeof(void*);
  constexpr std::uint32_t kSparesPerCharacter = 2;
  const std::uint32_t spares = kSparesPerCharacter * characters;
  void* held[pool::kClasses * kSparesPerCharacter * kMaxCharacters];
  std::uint32_t count = 0;
  bool complete = true;
  for (std::size_t bytes = smallest; count + spares <= pool::kClasses * kSparesPerCharacter * kMaxCharacters; bytes *= 2) {
    for (std::uint32_t spare = 0; spare < spares; ++spare) {
      held[count] = pool::allocate(std::min(bytes, largest));
      if (held[count] == nullptr) complete = false;
      count += 1;
    }
    if (bytes >= largest) break;
  }
  for (std::uint32_t i = 0; i < count; ++i) pool::release(held[i]);
  return complete;
}

}

int World::addCharacter(const double* spec) {
  if (arena::sealed()) return kSealed;
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(spec[3] > 0.0) || !(spec[4] >= 0.0)) return kRange;
  Runtime& r = *runtime_;
  if (r.characterCount >= kMaxCharacters) return kFull;
  const float radius = static_cast<float>(spec[3]);
  const float halfHeight = static_cast<float>(spec[4]);
  if (r.characterCount == 0) {
    r.characterSettings.mMaxNumHits = kCharacterMaxHits;
    r.characterSettings.mShape = new JPH::CapsuleShape(halfHeight, radius);
    r.characterRadius = radius;
    r.characterHalfHeight = halfHeight;
  } else if (radius != r.characterRadius || halfHeight != r.characterHalfHeight) {
    return kRange;
  }
  const std::uint32_t index = r.characterCount;
  follow(spec[0], spec[1], spec[2]);
  r.characters[index] = new JPH::CharacterVirtual(&r.characterSettings, toBody(spec), JPH::Quat::sIdentity(), &r.physics);
  r.characters[index]->SetListener(&r.stand);
  if (!reserveContactBlocks(index + 1)) return kFull;
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
    JPH::Vec3 up = JPH::Vec3::sAxisY();
    if (distance > 0.0) {
      const double scale = -static_cast<double>(planetGravity_) / distance;
      gravity = JPH::Vec3(static_cast<float>(x * scale), static_cast<float>(y * scale), static_cast<float>(z * scale));
      up = JPH::Vec3(static_cast<float>(x / distance), static_cast<float>(y / distance), static_cast<float>(z / distance));
    }
    c->SetUp(up);
    if (c->GetGroundState() == JPH::CharacterBase::EGroundState::OnGround) {
      r.characterFall[i] = gravity * dt;
    } else {
      r.characterFall[i] += gravity * dt;
    }
    JPH::CharacterVirtual::ExtendedUpdateSettings extended;
    extended.mStickToFloorStepDown = up * -characterStickDown_;
    extended.mWalkStairsStepUp = up * characterStepUp_;
    r.stand.standing = r.characterCommand[i] == JPH::Vec3::sZero();
    c->SetLinearVelocity(r.characterCommand[i] + r.characterFall[i]);
    c->ExtendedUpdate(dt, gravity, extended, broad, object, JPH::BodyFilter(), JPH::ShapeFilter(), r.temp);
  }
}

Status World::tuneCharacters(float stepUp, float stickDown) {
  if (!(stepUp >= 0.0f) || !(stickDown >= 0.0f)) return kRange;
  characterStepUp_ = stepUp;
  characterStickDown_ = stickDown;
  return kOk;
}

void World::classify(std::uint32_t joltBody, QueryHit& out) const {
  out.handle = 0;
  if (joltBody == planetBody_) {
    out.kind = kHitPlanet;
    return;
  }
  if (joltBody == vegetationBody_) {
    out.kind = kHitVegetation;
    return;
  }
  const JPH::uint64 tag = runtime_->physics.GetBodyInterfaceNoLock().GetUserData(JPH::BodyID(joltBody));
  if (tag == 0) {
    out.kind = kHitStatic;
    return;
  }
  const std::uint32_t slot = static_cast<std::uint32_t>(tag - 1);
  out.kind = kHitBody;
  out.handle = (static_cast<std::uint32_t>(generations_[slot]) << kSlotBits) | slot;
}

int World::castRay(const double* origin, const double* direction, QueryHit& out) {
  if (runtime_ == nullptr) return kNotConfigured;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::RRayCast ray(toBody(origin), JPH::Vec3(static_cast<float>(direction[0]), static_cast<float>(direction[1]), static_cast<float>(direction[2])));
  JPH::RayCastResult hit;
  out.kind = kHitNone;
  out.handle = 0;
  if (!runtime_->physics.GetNarrowPhaseQueryNoLock().CastRay(ray, hit)) return 0;
  const JPH::RVec3 at = ray.GetPointOnRay(hit.mFraction);
  JPH::Vec3 normal = JPH::Vec3::sZero();
  const JPH::Body* body = runtime_->physics.GetBodyLockInterfaceNoLock().TryGetBody(hit.mBodyID);
  if (body != nullptr) normal = body->GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, at);
  out.fraction = hit.mFraction;
  out.position[0] = at.GetX() + o.x;
  out.position[1] = at.GetY() + o.y;
  out.position[2] = at.GetZ() + o.z;
  out.normal[0] = normal.GetX();
  out.normal[1] = normal.GetY();
  out.normal[2] = normal.GetZ();
  classify(hit.mBodyID.GetIndexAndSequenceNumber(), out);
  return 1;
}

int World::castRound(double radius, double halfHeight, const double* origin, const double* direction, QueryHit& out) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(radius > 0.0) || !(halfHeight >= 0.0)) return kRange;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::RMat44 start = JPH::RMat44::sTranslation(toBody(origin));
  const JPH::Vec3 sweep(static_cast<float>(direction[0]), static_cast<float>(direction[1]), static_cast<float>(direction[2]));
  out.kind = kHitNone;
  out.handle = 0;
  auto sweepShape = [&](const JPH::Shape& shape) {
    shape.SetEmbedded();
    const JPH::RShapeCast cast(&shape, JPH::Vec3::sOne(), start, sweep);
    JPH::ClosestHitCollisionCollector<JPH::CastShapeCollector> collector;
    runtime_->physics.GetNarrowPhaseQueryNoLock().CastShape(cast, JPH::ShapeCastSettings(), JPH::RVec3::sZero(), collector);
    if (!collector.HadHit()) return 0;
    const JPH::ShapeCastResult& hit = collector.mHit;
    const JPH::Vec3 normal = -hit.mPenetrationAxis.NormalizedOr(JPH::Vec3::sZero());
    out.fraction = hit.mFraction;
    out.position[0] = hit.mContactPointOn2.GetX() + o.x;
    out.position[1] = hit.mContactPointOn2.GetY() + o.y;
    out.position[2] = hit.mContactPointOn2.GetZ() + o.z;
    out.normal[0] = normal.GetX();
    out.normal[1] = normal.GetY();
    out.normal[2] = normal.GetZ();
    classify(hit.mBodyID2.GetIndexAndSequenceNumber(), out);
    return 1;
  };
  if (halfHeight > 0.0) {
    const JPH::CapsuleShape capsule(static_cast<float>(halfHeight), static_cast<float>(radius));
    return sweepShape(capsule);
  }
  const JPH::SphereShape sphere(static_cast<float>(radius));
  return sweepShape(sphere);
}

int World::probePlanet(double radius, double halfHeight, bool planetFirst, double maxSeparation, const double* center, QueryHit& out) {
  if (runtime_ == nullptr || planetBody_ == kNoBody) return kNotConfigured;
  if (!(radius > 0.0) || !(halfHeight >= 0.0) || !(maxSeparation >= 0.0)) return kRange;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::Mat44 at = JPH::Mat44::sTranslation(toBody(center));
  const JPH::Mat44 planetAt = JPH::Mat44::sIdentity();
  const JPH::Shape* planetShape = runtime_->planetShape.GetPtr();
  out.kind = kHitNone;
  out.handle = 0;
  auto probe = [&](const JPH::Shape& shape) {
    shape.SetEmbedded();
    JPH::CollideShapeSettings settings;
    settings.mMaxSeparationDistance = static_cast<float>(maxSeparation);
    JPH::ClosestHitCollisionCollector<JPH::CollideShapeCollector> collector;
    if (planetFirst) {
      JPH::CollisionDispatch::sCollideShapeVsShape(planetShape, &shape, JPH::Vec3::sOne(), JPH::Vec3::sOne(), planetAt, at,
                                                   JPH::SubShapeIDCreator(), JPH::SubShapeIDCreator(), settings, collector);
    } else {
      JPH::CollisionDispatch::sCollideShapeVsShape(&shape, planetShape, JPH::Vec3::sOne(), JPH::Vec3::sOne(), at, planetAt,
                                                   JPH::SubShapeIDCreator(), JPH::SubShapeIDCreator(), settings, collector);
    }
    if (!collector.HadHit()) return 0;
    const JPH::CollideShapeResult& hit = collector.mHit;
    const JPH::Vec3 onPlanet = planetFirst ? hit.mContactPointOn1 : hit.mContactPointOn2;
    const JPH::Vec3 axis = hit.mPenetrationAxis.NormalizedOr(JPH::Vec3::sZero());
    const JPH::Vec3 normal = planetFirst ? axis : -axis;
    out.fraction = hit.mPenetrationDepth;
    out.position[0] = onPlanet.GetX() + o.x;
    out.position[1] = onPlanet.GetY() + o.y;
    out.position[2] = onPlanet.GetZ() + o.z;
    out.normal[0] = normal.GetX();
    out.normal[1] = normal.GetY();
    out.normal[2] = normal.GetZ();
    out.kind = kHitPlanet;
    return 1;
  };
  if (halfHeight > 0.0) {
    const JPH::CapsuleShape capsule(static_cast<float>(halfHeight), static_cast<float>(radius));
    return probe(capsule);
  }
  const JPH::SphereShape sphere(static_cast<float>(radius));
  return probe(sphere);
}

Status World::addTrunk(const double* trunk) {
  if (arena::sealed()) return kSealed;
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
    if ((air_[slot] & kAirNow) != 0) bodies.SetObjectLayer(id, movingLayerOf(static_cast<std::uint32_t>(slot)));
    air_[slot] = 0;
    ceiling_[slot] = std::numeric_limits<float>::quiet_NaN();
    batch[i] = id;
    alive_[slot] = kSlotAlive;
    live_ += 1;
    handles[i] = (static_cast<std::uint32_t>(generations_[slot]) << kSlotBits) | static_cast<std::uint32_t>(slot);
  }
  const std::uint32_t woken = wakeCount(count);
  if (woken > 0) {
    const JPH::BodyInterface::AddState state = bodies.AddBodiesPrepare(batch, static_cast<int>(woken));
    bodies.AddBodiesFinalize(batch, static_cast<int>(woken), state, JPH::EActivation::Activate);
  }
  if (woken < count && spawnAsleep_) {
    const JPH::BodyInterface::AddState state = bodies.AddBodiesPrepare(batch + woken, static_cast<int>(count - woken));
    bodies.AddBodiesFinalize(batch + woken, static_cast<int>(count - woken), state, JPH::EActivation::DontActivate);
  }
  const JPH::BodyLockInterfaceNoLock& locks = runtime_->physics.GetBodyLockInterfaceNoLock();
  for (std::uint32_t i = 0; i < count; ++i) {
    const double* row = rows + i * kBatchWords;
    const std::uint32_t slot = handles[i] & kSlotMask;
    const JPH::Vec3 launch(static_cast<float>(row[3]), static_cast<float>(row[4]), static_cast<float>(row[5]));
    if (i < woken) {
      bodies.SetLinearVelocity(JPH::BodyID(bodyIds_[slot]), launch);
    } else {
      JPH::Body* body = locks.TryGetBody(JPH::BodyID(bodyIds_[slot]));
      if (body != nullptr) body->SetLinearVelocityClamped(launch);
      if (!spawnAsleep_) {
        alive_[slot] = kSlotHeld;
        heldCount_ += 1;
        queueStale_ = true;
      }
    }
    sync(slot);
    if (alive_[slot] == kSlotHeld) hide(slot);
  }
  return static_cast<int>(count);
}

Status World::despawn(std::uint32_t handle) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  if (alive_[slot] == kSlotHeld) {
    heldCount_ -= 1;
  } else {
    bodies.RemoveBody(id);
  }
  alive_[slot] = kSlotFree;
  live_ -= 1;
  if (generations_[slot] == kBodyLastGeneration) {
    generations_[slot] = kBodyRetiredGeneration;
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
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  if (alive_[slot] == kSlotHeld) {
    bodies.SetPosition(id, toBody(position), JPH::EActivation::DontActivate);
    bodies.AddBody(id, JPH::EActivation::Activate);
    alive_[slot] = kSlotAlive;
    heldCount_ -= 1;
  } else {
    bodies.SetPosition(id, toBody(position), JPH::EActivation::Activate);
  }
  ceiling_[slot] = std::numeric_limits<float>::quiet_NaN();
  sync(static_cast<std::uint32_t>(slot));
  return kOk;
}

Status World::setVelocity(std::uint32_t handle, const float* velocity) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  const JPH::Vec3 next(velocity[0], velocity[1], velocity[2]);
  if (alive_[slot] == kSlotHeld) {
    JPH::Body* body = runtime_->physics.GetBodyLockInterfaceNoLock().TryGetBody(id);
    if (body != nullptr) body->SetLinearVelocityClamped(next);
    bodies.AddBody(id, JPH::EActivation::Activate);
    alive_[slot] = kSlotAlive;
    heldCount_ -= 1;
  } else {
    bodies.SetLinearVelocity(id, next);
  }
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
    const double shiftX = o.x - x;
    const double shiftY = o.y - y;
    const double shiftZ = o.z - z;
    auto shifted = [&](JPH::RVec3Arg at) {
      return JPH::RVec3(static_cast<float>(static_cast<double>(at.GetX()) + shiftX), static_cast<float>(static_cast<double>(at.GetY()) + shiftY),
                        static_cast<float>(static_cast<double>(at.GetZ()) + shiftZ));
    };
    runtime_->physics.GetBodies(runtime_->rebaseIds);
    for (const JPH::BodyID id : runtime_->rebaseIds) {
      const std::uint32_t index = id.GetIndexAndSequenceNumber();
      if (index == planetBody_ || index == vegetationBody_) continue;
      const JPH::uint64 tag = bodies.GetUserData(id);
      if (tag != 0 && alive_[tag - 1] != 0) {
        const double* anchor = positions_ + (tag - 1) * 3;
        bodies.SetPosition(id, JPH::RVec3(static_cast<float>(anchor[0] - x), static_cast<float>(anchor[1] - y), static_cast<float>(anchor[2] - z)),
                           JPH::EActivation::DontActivate);
      } else {
        bodies.SetPosition(id, shifted(bodies.GetPosition(id)), JPH::EActivation::DontActivate);
      }
    }
    for (std::uint32_t i = 0; i < runtime_->characterCount; ++i) {
      runtime_->characters[i]->SetPosition(shifted(runtime_->characters[i]->GetPosition()));
    }
  }
  o.x = x;
  o.y = y;
  o.z = z;
  if (runtime_ == nullptr) return;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] == kSlotFree) continue;
    sync(slot);
    if (alive_[slot] == kSlotHeld) hide(slot);
  }
}

void World::pull(JPH::Body& body, std::uint32_t slot, const PhysicsOrigin& o, float dt) {
  constexpr float kSleepSpeed = 0.5f;
  const JPH::RVec3 position = body.GetCenterOfMassPosition();
  const double x = position.GetX() + o.x;
  const double y = position.GetY() + o.y;
  const double z = position.GetZ() + o.z;
  const double distance = std::sqrt(x * x + y * y + z * z);
  if (!(distance > 0.0)) return;
  const double scale = -static_cast<double>(planetGravity_) * dt / distance;
  body.SetLinearVelocityClamped(body.GetLinearVelocity() + JPH::Vec3(static_cast<float>(x * scale), static_cast<float>(y * scale), static_cast<float>(z * scale)));
  const float speed = body.GetLinearVelocity().Length();
  const bool mayRest = speed < kSleepSpeed;
  if (body.GetAllowSleeping() != mayRest) body.SetAllowSleeping(mayRest);
  if ((tuning_ & kTuneAirborne) == 0) return;
  float ceiling = ceiling_[slot];
  if (ceiling != ceiling || (tick_ + slot) % kCeilingTicks == 0) {
    const double horizon = static_cast<double>(dt) * kCeilingTicks;
    const double reach = (static_cast<double>(speed) + static_cast<double>(planetGravity_) * horizon) * horizon + radius_ + kCeilingSlackMetres;
    ceiling = static_cast<float>(planet::ceilingAt(planet::state(), x, y, z, reach));
    ceiling_[slot] = ceiling;
  }
  const double clearance = distance - planet::state().radius - static_cast<double>(ceiling) - radius_;
  const bool airborne = clearance > static_cast<double>(speed) * dt + kAirMarginMetres;
  air_[slot] = static_cast<std::uint8_t>((air_[slot] & kAirNow) | (airborne ? kAirWanted : 0));
}

namespace {

constexpr std::uint64_t kLowBitOfEachByte = 0x0101010101010101ull;
constexpr std::uint32_t kWordBytes = 8;
static_assert(kAirNow == 1 && kAirWanted == 2);
static_assert((kSlotAlive & 1) == 1 && (kSlotAwakeSynced & 1) == 1 && (kSlotFree & 1) == 0 && (kSlotAsleepSynced & 1) == 0 && (kSlotHeld & 1) == 0);

std::uint64_t wordAt(const std::uint8_t* bytes) {
  std::uint64_t word;
  std::memcpy(&word, bytes, kWordBytes);
  return word;
}

}

void World::applyAirLayers() {
  if ((tuning_ & kTuneAirborne) == 0 || planetBody_ == kNoBody) return;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterfaceNoLock();
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (slot % kWordBytes == 0 && slot + kWordBytes <= fresh_) {
      const std::uint64_t word = wordAt(air_ + slot);
      if (((word ^ (word >> 1)) & kLowBitOfEachByte) == 0) {
        slot += kWordBytes - 1;
        continue;
      }
    }
    const std::uint8_t flags = air_[slot];
    const bool now = (flags & kAirNow) != 0;
    const bool wanted = (flags & kAirWanted) != 0;
    if (now == wanted) continue;
    if (alive_[slot] == kSlotFree || alive_[slot] == kSlotHeld) {
      air_[slot] = now ? static_cast<std::uint8_t>(kAirNow | kAirWanted) : 0;
      continue;
    }
    bodies.SetObjectLayer(JPH::BodyID(bodyIds_[slot]), wanted ? airborneLayerOf(slot) : movingLayerOf(slot));
    air_[slot] = wanted ? static_cast<std::uint8_t>(kAirNow | kAirWanted) : 0;
  }
}

void World::gravityRange(std::uint32_t begin, std::uint32_t end) {
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::BodyLockInterfaceNoLock& locks = runtime_->physics.GetBodyLockInterfaceNoLock();
  const JPH::BodyID* active = runtime_->activeIds;
  const float dt = runtime_->stepDt;
  for (std::uint32_t i = begin; i < end; ++i) {
    JPH::Body* body = locks.TryGetBody(active[i]);
    if (body == nullptr) continue;
    const JPH::uint64 tag = body->GetUserData();
    if (tag == 0 || alive_[tag - 1] == kSlotFree) continue;
    pull(*body, static_cast<std::uint32_t>(tag - 1), o, dt);
  }
}

void World::syncRange(std::uint32_t begin, std::uint32_t end) {
  const JPH::BodyLockInterfaceNoLock& locks = runtime_->physics.GetBodyLockInterfaceNoLock();
  const JPH::BodyID* active = runtime_->activeIds;
  const bool pullAfter = (tuning_ & kTuneGravityAfterStep) != 0 && planetBody_ != kNoBody;
  const PhysicsOrigin& o = physicsOrigin();
  for (std::uint32_t i = begin; i < end; ++i) {
    JPH::Body* body = locks.TryGetBody(active[i]);
    if (body == nullptr) continue;
    const JPH::uint64 tag = body->GetUserData();
    if (tag == 0 || alive_[tag - 1] == kSlotFree) continue;
    const std::uint32_t slot = static_cast<std::uint32_t>(tag - 1);
    sync(slot);
    alive_[slot] = kSlotAwakeSynced;
    if (pullAfter) pull(*body, slot, o, runtime_->stepDt);
  }
}

void World::forActiveRanges(std::uint32_t count, bool gravity) {
  const std::uint32_t lanes = static_cast<std::uint32_t>(runtime_->jobs.GetMaxConcurrency());
  if (lanes > 1 && count >= kMinParallelRows) {
    const std::uint32_t chunk = (count + lanes - 1) / lanes;
    JPH::JobSystem::Barrier* barrier = runtime_->jobs.CreateBarrier();
    for (std::uint32_t begin = 0; begin < count; begin += chunk) {
      const std::uint32_t end = std::min(count, begin + chunk);
      if (gravity) {
        barrier->AddJob(runtime_->jobs.CreateJob("gravity rows", JPH::Color::sWhite, [this, begin, end] { gravityRange(begin, end); }));
      } else {
        barrier->AddJob(runtime_->jobs.CreateJob("readback rows", JPH::Color::sWhite, [this, begin, end] { syncRange(begin, end); }));
      }
    }
    runtime_->jobs.WaitForJobs(barrier);
    runtime_->jobs.DestroyBarrier(barrier);
    return;
  }
  if (gravity) {
    gravityRange(0, count);
  } else {
    syncRange(0, count);
  }
}

void World::applyRadialGravity(JPH::PhysicsSystem& system, float dt) {
  if (runtime_ == nullptr || planetBody_ == kNoBody) return;
  runtime_->activeIds = system.GetActiveBodiesUnsafe(JPH::EBodyType::RigidBody);
  runtime_->stepDt = dt;
  forActiveRanges(system.GetNumActiveBodies(JPH::EBodyType::RigidBody), true);
}

std::uint32_t World::awakeLimit() const {
  const bool bounded = capacity_ > awakeDesign_;
  if (awakeBudget_ == 0) return bounded ? awakeDesign_ : 0;
  return bounded ? std::min(awakeBudget_, awakeDesign_) : awakeBudget_;
}

std::uint32_t World::wakeCount(std::uint32_t count) const {
  if (spawnAsleep_) return 0;
  const std::uint32_t limit = awakeLimit();
  if (limit == 0) return count;
  if (heldCount_ != 0) return 0;
  const std::uint32_t active = runtime_->physics.GetNumActiveBodies(JPH::EBodyType::RigidBody);
  return active >= limit ? 0 : std::min(count, limit - active);
}

bool World::inView(std::uint32_t slot, double cosine, double& distance) const {
  const double* p = positions_ + slot * 3;
  const double dx = p[0] - viewEye_[0];
  const double dy = p[1] - viewEye_[1];
  const double dz = p[2] - viewEye_[2];
  distance = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (distance > viewRange_) return false;
  return dx * viewDir_[0] + dy * viewDir_[1] + dz * viewDir_[2] >= cosine * distance;
}

namespace {

constexpr std::uint32_t kReleaseKeyShift = 32;

std::uint32_t orderedBits(float metres) {
  std::uint32_t bits = 0;
  std::memcpy(&bits, &metres, sizeof(bits));
  return bits;
}

std::uint32_t slotOf(std::uint64_t entry) {
  return static_cast<std::uint32_t>(entry);
}

}

void World::refillReleaseQueue() {
  ENGINE_PROFILE_SCOPE("engine release refill");
  constexpr float kOutOfViewMetres = 1.0e6f;
  constexpr std::uint32_t kLeastChunk = 1024;
  queueStale_ = false;
  queueDrifted_ = false;
  sinceRefill_ = 0;
  releaseRefills_ += 1;
  queueHead_ = 0;
  queueCount_ = 0;
  for (int axis = 0; axis < 3; ++axis) {
    queueEye_[axis] = viewEye_[axis];
    queueDir_[axis] = viewDir_[axis];
  }
  const bool ordered = viewSet_ && (tuning_ & kTuneReleaseBySlot) == 0;
  const double orderingCos = std::max(viewCos_ - kReleaseViewMarginCos, -1.0);
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] != kSlotHeld) continue;
    std::uint64_t entry = slot;
    if (ordered) {
      double distance = 0.0;
      const bool visible = inView(slot, orderingCos, distance);
      entry |= static_cast<std::uint64_t>(orderedBits(static_cast<float>(distance) + (visible ? 0.0f : kOutOfViewMetres))) << kReleaseKeyShift;
    }
    releaseQueue_[queueCount_] = entry;
    queueCount_ += 1;
  }
  if (!ordered) return;
  if ((tuning_ & kTuneReleaseBlocks) != 0) {
    std::uint32_t begin = 0;
    while (begin < queueCount_) {
      const std::uint32_t block = slotOf(releaseQueue_[begin]) / kReleaseBlockSlots;
      std::uint64_t nearest = releaseQueue_[begin] >> kReleaseKeyShift;
      std::uint32_t end = begin;
      while (end < queueCount_ && slotOf(releaseQueue_[end]) / kReleaseBlockSlots == block) {
        nearest = std::min(nearest, releaseQueue_[end] >> kReleaseKeyShift);
        end += 1;
      }
      for (std::uint32_t at = begin; at < end; ++at) releaseQueue_[at] = (nearest << kReleaseKeyShift) | slotOf(releaseQueue_[at]);
      begin = end;
    }
  }
  const std::uint32_t chunk = std::min(queueCount_, std::max(awakeLimit(), kLeastChunk));
  if (chunk < queueCount_) std::nth_element(releaseQueue_, releaseQueue_ + chunk, releaseQueue_ + queueCount_);
  std::sort(releaseQueue_, releaseQueue_ + chunk);
  queueCount_ = chunk;
}

Status World::setReleaseView(const double* eye, const double* direction, double cosHalfAngle, double range) {
  constexpr double kDriftedMetres = 4.0;
  constexpr double kDriftedCos = 0.98;
  constexpr double kJumpedMetres = 64.0;
  constexpr double kJumpedCos = 0.7;
  if (runtime_ == nullptr) return kNotConfigured;
  for (int axis = 0; axis < 3; ++axis) {
    if (!std::isfinite(eye[axis]) || !std::isfinite(direction[axis])) return kRange;
  }
  if (!(cosHalfAngle >= -1.0 && cosHalfAngle <= 1.0) || !(range > 0.0)) return kRange;
  const double length = std::sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
  const double unit[3] = {length > 0.0 ? direction[0] / length : 0.0, length > 0.0 ? direction[1] / length : 0.0, length > 0.0 ? direction[2] / length : 0.0};
  const double cone = length > 0.0 ? cosHalfAngle : -1.0;
  const double mx = eye[0] - queueEye_[0];
  const double my = eye[1] - queueEye_[1];
  const double mz = eye[2] - queueEye_[2];
  const double moved = mx * mx + my * my + mz * mz;
  const double facing = cone > -1.0 ? unit[0] * queueDir_[0] + unit[1] * queueDir_[1] + unit[2] * queueDir_[2] : 1.0;
  if ((tuning_ & kTuneReleaseBySlot) == 0) {
    if (!viewSet_ || cone != viewCos_ || range != viewRange_ || moved > kJumpedMetres * kJumpedMetres || facing < kJumpedCos) {
      queueStale_ = true;
    } else if (moved > kDriftedMetres * kDriftedMetres || facing < kDriftedCos) {
      queueDrifted_ = true;
    }
  }
  for (int axis = 0; axis < 3; ++axis) {
    viewEye_[axis] = eye[axis];
    viewDir_[axis] = unit[axis];
  }
  viewCos_ = cone;
  viewRange_ = range;
  viewSet_ = true;
  return kOk;
}

Status World::clearReleaseView() {
  if (runtime_ == nullptr) return kNotConfigured;
  viewSet_ = false;
  queueStale_ = true;
  return kOk;
}

std::uint32_t World::unsettledInView() const {
  std::uint32_t unsettled = 0;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    const std::uint8_t state = alive_[slot];
    if (state != kSlotHeld && state != kSlotAlive && state != kSlotAwakeSynced) continue;
    double distance = 0.0;
    if (!viewSet_ || inView(slot, viewCos_, distance)) unsettled += 1;
  }
  return unsettled;
}

void World::releaseHeld() {
  if (sinceRefill_ < kDriftRefillSteps) sinceRefill_ += 1;
  if (heldCount_ == 0) return;
  const std::uint32_t active = runtime_->physics.GetNumActiveBodies(JPH::EBodyType::RigidBody);
  const std::uint32_t limit = awakeLimit();
  std::uint32_t room = limit == 0 ? fresh_ : (active >= limit ? 0 : limit - active);
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  JPH::BodyID* batch = asBodyIds(batch_);
  std::uint32_t released = 0;
  while (room > 0 && heldCount_ > 0) {
    if (queueStale_ || queueHead_ == queueCount_ || (queueDrifted_ && sinceRefill_ >= kDriftRefillSteps)) refillReleaseQueue();
    if (queueHead_ == queueCount_) break;
    const std::uint32_t slot = slotOf(releaseQueue_[queueHead_]);
    queueHead_ += 1;
    if (alive_[slot] != kSlotHeld) continue;
    batch[released] = JPH::BodyID(bodyIds_[slot]);
    released += 1;
    alive_[slot] = kSlotAlive;
    heldCount_ -= 1;
    room -= 1;
  }
  if (released > 0) {
    const JPH::BodyInterface::AddState state = bodies.AddBodiesPrepare(batch, static_cast<int>(released));
    bodies.AddBodiesFinalize(batch, static_cast<int>(released), state, JPH::EActivation::Activate);
    const JPH::BodyLockInterfaceNoLock& locks = runtime_->physics.GetBodyLockInterfaceNoLock();
    for (std::uint32_t i = 0; i < released; ++i) {
      const JPH::Body* body = locks.TryGetBody(batch[i]);
      if (body != nullptr) sync(static_cast<std::uint32_t>(body->GetUserData() - 1));
    }
  }
}

Status World::setAwakeDesign(std::uint32_t bodies) {
  if (bodies < kAwakeDesignLeast || bodies > kAwakeDesignBodies) return kRange;
  nextAwakeDesign_ = bodies;
  return kOk;
}

Status World::setAwakeBudget(std::uint32_t bodies) {
  if (runtime_ == nullptr) return kNotConfigured;
  awakeBudget_ = bodies;
  return kOk;
}

Status World::setTuning(std::uint32_t flags) {
  if (runtime_ == nullptr) return kNotConfigured;
  return applyTuning(flags);
}

Status World::applyTuning(std::uint32_t flags) {
  if ((flags & ~kTuneAll) != 0) return kRange;
#if defined(ENGINE_BROADPHASE_INTERVAL)
  JPH::BroadPhaseQuadTree::sRebuildInterval = (flags & kTuneBroadphaseInterval) != 0 ? kBroadphaseRebuildSteps : 1;
#else
  if ((flags & kTuneBroadphaseInterval) != 0) return kRange;
#endif
  const bool wasAirborne = (tuning_ & kTuneAirborne) != 0;
  if (((tuning_ ^ flags) & (kTuneReleaseBySlot | kTuneReleaseBlocks)) != 0) queueStale_ = true;
  tuning_ = flags;
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mUseLargeIslandSplitter = (flags & kTuneWholeIslands) == 0;
  settings.mUseManifoldReduction = (flags & kTuneDirectManifolds) == 0;
  runtime_->physics.SetPhysicsSettings(settings);
  if (wasAirborne && (flags & kTuneAirborne) == 0) {
    JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterfaceNoLock();
    for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
      if ((air_[slot] & kAirNow) != 0) bodies.SetObjectLayer(JPH::BodyID(bodyIds_[slot]), movingLayerOf(slot));
      air_[slot] = 0;
    }
  }
  return kOk;
}

Status World::setSpawnAsleep(bool asleep) {
  if (runtime_ == nullptr) return kNotConfigured;
  spawnAsleep_ = asleep;
  return kOk;
}

Status World::setSleep(float seconds, float pointSpeed) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(seconds > 0.0f) || !(pointSpeed > 0.0f)) return kRange;
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mTimeBeforeSleep = seconds;
  settings.mPointVelocitySleepThreshold = pointSpeed;
  runtime_->physics.SetPhysicsSettings(settings);
  return kOk;
}

std::uint64_t World::tempPeakBytes() const {
  return runtime_ == nullptr ? 0 : runtime_->temp.peak();
}

std::uint32_t World::airborneBodies() const {
  std::uint32_t airborne = 0;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) airborne += (air_[slot] & kAirNow) != 0 && alive_[slot] != kSlotFree ? 1 : 0;
  return airborne;
}

std::uint32_t World::heldBodies() const {
  return heldCount_;
}

void World::optimize() {
  if (runtime_ == nullptr) return;
  runtime_->physics.OptimizeBroadPhase();
}

void World::step(std::uint32_t steps) {
  const float dt = 1.0f / static_cast<float>(tickRate_);
  for (std::uint32_t s = 0; s < steps; ++s) {
    if (runtime_ != nullptr) {
      {
        ENGINE_PROFILE_SCOPE("engine characters");
        updateCharacters(dt);
      }
      {
        engine::phase::Scope scope(engine::phase::kPhysics);
        {
          ENGINE_PROFILE_SCOPE("engine release held");
          releaseHeld();
        }
        runtime_->stepDt = dt;
        {
          ENGINE_PROFILE_SCOPE("engine gravity");
          if ((tuning_ & kTuneGravityAfterStep) == 0) applyRadialGravity(runtime_->physics, dt);
        }
        {
          ENGINE_PROFILE_SCOPE("engine air layers");
          applyAirLayers();
        }
        const bool promoting = promoteCap_ != 0 && vegetationBody_ != kNoBody;
        if (promoting) vegetation::armTouches(true);
        {
          ENGINE_PROFILE_SCOPE("engine jolt update");
          if (runtime_->physics.Update(dt, 1, &runtime_->temp, &runtime_->jobs) != JPH::EPhysicsUpdateError::None) updateErrors_ += 1;
        }
        if (promoting) {
          vegetation::armTouches(false);
          promoteTouched();
        }
      }
      {
        engine::phase::Scope scope(engine::phase::kReadback);
        runtime_->activeIds = runtime_->physics.GetActiveBodiesUnsafe(JPH::EBodyType::RigidBody);
        {
          ENGINE_PROFILE_SCOPE("engine readback rows");
          forActiveRanges(runtime_->physics.GetNumActiveBodies(JPH::EBodyType::RigidBody), false);
        }
        ENGINE_PROFILE_SCOPE("engine readback slots");
        for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
          if (slot % kWordBytes == 0 && slot + kWordBytes <= fresh_ && (wordAt(alive_ + slot) & kLowBitOfEachByte) == 0) {
            slot += kWordBytes - 1;
            continue;
          }
          const std::uint8_t state = alive_[slot];
          if (state == kSlotAwakeSynced) {
            alive_[slot] = kSlotAlive;
          } else if (state == kSlotAlive) {
            sync(slot);
            alive_[slot] = kSlotAsleepSynced;
          }
        }
      }
    }
    tick_ += 1;
  }
}

Status World::applyPoses(const Transform* rows, std::uint32_t count, std::uint32_t epoch) {
  if (transforms_ == nullptr || count != bodyCapacity()) return kRange;
  std::memcpy(transforms_, rows, static_cast<std::size_t>(count) * sizeof(Transform));
  poseEpoch_ = epoch;
  posesTouched_ = false;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] != kSlotFree && alive_[slot] != kSlotHeld) alive_[slot] = kSlotAlive;
  }
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
  if (generations_[slot] != (handle >> kSlotBits)) return -1;
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

std::uint32_t World::poseEpoch() {
  if (posesTouched_) {
    posesTouched_ = false;
    poseEpoch_ += 1;
  }
  return poseEpoch_;
}

void World::hide(std::uint32_t slot) {
  posesTouched_ = true;
  Transform& transform = transforms_[slot];
  transform.qx = 0.0f;
  transform.qy = 0.0f;
  transform.qz = 0.0f;
  transform.qw = 0.0f;
}

void World::sync(std::uint32_t slot) {
  const JPH::Body* body = runtime_->physics.GetBodyLockInterfaceNoLock().TryGetBody(JPH::BodyID(bodyIds_[slot]));
  if (body == nullptr) return;
  const JPH::RVec3 p = body->GetPosition();
  const JPH::Vec3 v = body->GetLinearVelocity();
  const JPH::Quat q = body->GetRotation();
  const PhysicsOrigin& o = physicsOrigin();
  double* position = positions_ + slot * 3;
  double* velocity = velocities_ + slot * 3;
  const bool anchored = static_cast<float>(position[0] - o.x) == p.GetX() && static_cast<float>(position[1] - o.y) == p.GetY() &&
                        static_cast<float>(position[2] - o.z) == p.GetZ();
  if (!anchored) {
    position[0] = p.GetX() + o.x;
    position[1] = p.GetY() + o.y;
    position[2] = p.GetZ() + o.z;
  }
  velocity[0] = v.GetX();
  velocity[1] = v.GetY();
  velocity[2] = v.GetZ();
  posesTouched_ = true;
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
