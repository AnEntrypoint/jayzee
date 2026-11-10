cmake_minimum_required(VERSION 3.22)
project(engine_core LANGUAGES CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "engine_core builds only through emcmake with Emscripten 4.0.10")
endif()

set(ENGINE_TIER_MIB 64 CACHE STRING "Fixed memory tier in MiB")
option(ENGINE_LEAK_ON_TICK "Retain one block per tick, the witness that the memory gate catches growth" OFF)
option(ENGINE_PHASE_TIMERS "Per-phase timers inside engine_tick, for the diagnostic build only" OFF)
option(ENGINE_THREADS "Multithreaded Jolt job system on pthreads, a separate artifact from the single-threaded build" OFF)
option(ENGINE_WASM_SIMD "Jolt SSE4.2 intrinsics compiled to wasm SIMD, a separate artifact from the scalar build" OFF)

math(EXPR ENGINE_TIER_BYTES "${ENGINE_TIER_MIB} * 1024 * 1024")
set(ENGINE_NAME "engine-core-${ENGINE_TIER_MIB}mib")
if(ENGINE_LEAK_ON_TICK)
  string(APPEND ENGINE_NAME "-leak")
endif()
if(ENGINE_PHASE_TIMERS)
  string(APPEND ENGINE_NAME "-timed")
endif()
if(ENGINE_THREADS)
  string(APPEND ENGINE_NAME "-threads")
endif()
if(ENGINE_WASM_SIMD)
  string(APPEND ENGINE_NAME "-simd")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)

add_compile_options(-O2 -g0 -ffp-contract=off -fno-fast-math -fno-exceptions -fno-rtti)
if(ENGINE_THREADS)
  add_compile_options(-pthread)
endif()

set(CROSS_PLATFORM_DETERMINISTIC ON CACHE BOOL "" FORCE)
set(INTERPROCEDURAL_OPTIMIZATION OFF CACHE BOOL "" FORCE)
set(DOUBLE_PRECISION OFF CACHE BOOL "" FORCE)
set(CPP_EXCEPTIONS_ENABLED OFF CACHE BOOL "" FORCE)
set(CPP_RTTI_ENABLED OFF CACHE BOOL "" FORCE)
set(USE_WASM_SIMD ${ENGINE_WASM_SIMD} CACHE BOOL "" FORCE)
set(GENERATE_DEBUG_SYMBOLS OFF CACHE BOOL "" FORCE)
set(ENABLE_OBJECT_STREAM OFF CACHE BOOL "" FORCE)
set(TARGET_UNIT_TESTS OFF CACHE BOOL "" FORCE)
set(TARGET_HELLO_WORLD OFF CACHE BOOL "" FORCE)
set(TARGET_PERFORMANCE_TEST OFF CACHE BOOL "" FORCE)
set(TARGET_SAMPLES OFF CACHE BOOL "" FORCE)
set(TARGET_VIEWER OFF CACHE BOOL "" FORCE)

include(FetchContent)
FetchContent_Declare(
  JoltPhysics
  GIT_REPOSITORY https://github.com/jrouwe/JoltPhysics.git
  GIT_TAG 0373ec0dd762e4bc2f6acdb08371ee84fa23c6db
  GIT_SHALLOW FALSE
  SOURCE_SUBDIR Build
)
FetchContent_MakeAvailable(JoltPhysics)

add_executable(engine_core
  src/engine_core.cpp
  src/phase_timer.cpp
  src/arena.cpp
  src/budget.cpp
  src/pool_alloc.cpp
  src/world.cpp
  src/bridge.cpp
  src/planet_frame.cpp
  src/page_cache.cpp
  src/planet_shape.cpp
  src/vegetation.cpp
  src/codec.cpp
  src/textures.cpp
  src/model_pool.cpp
  src/device_tier.cpp
  src/exports_models.cpp
  src/materials.cpp
  src/exports_materials.cpp
  src/interest.cpp
  src/snapshot_delta.cpp
  src/exports_interest.cpp
  src/render/render_frame.cpp
  src/render/render_webgpu.cpp
  src/render/render_webgl2.cpp
  src/exports_render.cpp)
target_link_libraries(engine_core PRIVATE Jolt)
target_compile_options(engine_core PRIVATE --use-port=emdawnwebgpu)
math(EXPR ENGINE_ARENA_BYTES "${ENGINE_TIER_BYTES} - 4 * 1024 * 1024")
target_compile_definitions(engine_core PRIVATE JPH_CROSS_PLATFORM_DETERMINISTIC ENGINE_ARENA_BYTES=${ENGINE_ARENA_BYTES}ull)

set(ENGINE_EXPORTS
  _engine_init
  _engine_world_configure
  _engine_world_add_box
  _engine_world_add_trunk
  _engine_spawn
  _engine_set_position
  _engine_set_velocity
  _engine_set_tick
  _engine_tick
  _engine_ticks
  _engine_memory_bytes
  _engine_body_count
  _engine_retired_slots
  _engine_physics_bodies
  _engine_positions
  _engine_velocities
  _engine_transforms
  _engine_control
  _engine_inputs
  _engine_events
  _engine_stage
  _engine_stage_handles
  _engine_spawn_batch
  _engine_despawn
  _engine_mark_warmup
  _engine_allocations_since_warmup
  _engine_allocations_total
  _engine_planet_configure
  _engine_planet_locate
  _engine_planet_resolve
  _engine_planet_key
  _engine_models_load
  _engine_models_unload
  _engine_models_live
  _engine_models_bound
  _engine_models_pool_bytes
  _engine_models_dirty
  _engine_models_uploaded
  _engine_models_bind_plan
  _engine_models_vertex_ptr
  _engine_models_index_ptr
  _engine_models_vertex_count
  _engine_models_index_count
  _engine_models_mark_dirty
  _engine_models_acquire
  _engine_models_cluster_stride
  _engine_models_cluster_bytes
  _engine_models_clusters_ptr
  _engine_device_plan_tier
  _engine_device_tier_vram
  _engine_device_tier_budget
  _engine_planet_scratch
  _engine_planet_height
  _engine_planet_gap_queries
  _engine_planet_resident
  _engine_page_stage
  _engine_page_samples
  _engine_page_commit
  _engine_page_release
  _engine_page_lookup
  _engine_veg_configure
  _engine_veg_place
  _engine_veg_attach
  _engine_veg_placed
  _engine_codec_bytes
  _engine_codec_values
  _engine_codec_encode_entity
  _engine_codec_decode_entity
  _engine_codec_encode_player
  _engine_codec_decode_player
  _engine_codec_encode_quat
  _engine_codec_decode_quat
  _engine_codec_encode_inputs
  _engine_codec_decode_inputs
  _engine_codec_encode_packet
  _engine_codec_decode_packet
  _engine_codec_packet_epoch
  _engine_codec_counts
  _engine_allocation_failures
  _engine_arena_seal
  _engine_arena_used
  _engine_interest_configure
  _engine_interest_outside
  _engine_interest_set_client
  _engine_interest_truncated
  _engine_interest_update
  _engine_interest_visible_count
  _engine_layout
  _engine_material_add
  _engine_material_count
  _engine_material_is_live
  _engine_material_live_count
  _engine_material_remove
  _engine_material_set
  _engine_material_slot
  _engine_material_stride_bytes
  _engine_material_view_offset
  _engine_render_albedo_staging
  _engine_render_allocations_since_warmup
  _engine_render_api_calls_last_frame
  _engine_render_backend
  _engine_render_bind_materials
  _engine_render_body_classes
  _engine_render_camera
  _engine_render_checksum
  _engine_render_commit_albedo
  _engine_render_creates_after_seal
  _engine_render_frame
  _engine_render_frames
  _engine_render_init
  _engine_render_light_count
  _engine_render_lights
  _engine_render_mark_page
  _engine_render_material_table
  _engine_render_pages
  _engine_render_place_page
  _engine_render_placements
  _engine_render_seal
  _engine_render_set_light_count
  _engine_render_set_model_path
  _engine_render_model_path
  _engine_render_model_path_effective
  _engine_render_set_occlusion
  _engine_render_occlusion
  _engine_render_set_count_readback
  _engine_render_cull_ready
  _engine_render_cull_counts
  _engine_models_slot_of
  _engine_render_unplace_page
  _engine_render_uploads
  _engine_render_visible
  _engine_snapshot_capacity_bytes
  _engine_snapshot_encode
  _engine_snapshot_offset
  _engine_texture_add
  _engine_texture_count
  _engine_texture_is_live
  _engine_texture_layer
  _engine_texture_live_count
  _engine_texture_remove)
if(ENGINE_PHASE_TIMERS)
  list(APPEND ENGINE_EXPORTS _engine_phase_total_ms _engine_phase_count _engine_sim_active_bodies)
endif()
string(JOIN "," ENGINE_EXPORT_LIST ${ENGINE_EXPORTS})

target_link_options(engine_core PRIVATE
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=web,node
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,HEAPU32,HEAPF32,HEAPF64
  -sSTRICT=1
  --use-port=emdawnwebgpu
  -sMIN_WEBGL_VERSION=2
  -sMAX_WEBGL_VERSION=2
  -sUSE_WEBGL2=1
  -lGL
  -lhtml5
  -sSTACK_SIZE=1048576
  -sINITIAL_MEMORY=${ENGINE_TIER_BYTES}
  -sEXPORTED_FUNCTIONS=${ENGINE_EXPORT_LIST})

if(ENGINE_PHASE_TIMERS)
  target_compile_definitions(engine_core PRIVATE ENGINE_PHASE_TIMERS)
endif()
if(ENGINE_THREADS)
  target_compile_definitions(engine_core PRIVATE ENGINE_THREADS)
  target_link_options(engine_core PRIVATE -pthread -sPTHREAD_POOL_SIZE=3 -sDEFAULT_PTHREAD_STACK_SIZE=524288)
endif()
if(ENGINE_LEAK_ON_TICK)
  target_compile_definitions(engine_core PRIVATE ENGINE_LEAK_ON_TICK)
  target_link_options(engine_core PRIVATE -sALLOW_MEMORY_GROWTH=1)
else()
  target_link_options(engine_core PRIVATE -sALLOW_MEMORY_GROWTH=0 -sMAXIMUM_MEMORY=${ENGINE_TIER_BYTES})
endif()

set_target_properties(engine_core PROPERTIES
  OUTPUT_NAME ${ENGINE_NAME}
  SUFFIX ".mjs"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/out")
