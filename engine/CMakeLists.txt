cmake_minimum_required(VERSION 3.22)
project(engine_core LANGUAGES CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "engine_core builds only through emcmake with Emscripten 4.0.10")
endif()

set(ENGINE_TIER_MIB 64 CACHE STRING "Fixed memory tier in MiB")
option(ENGINE_LEAK_ON_TICK "Retain one block per tick, the witness that the memory gate catches growth" OFF)

math(EXPR ENGINE_TIER_BYTES "${ENGINE_TIER_MIB} * 1024 * 1024")
set(ENGINE_NAME "engine-core-${ENGINE_TIER_MIB}mib")
if(ENGINE_LEAK_ON_TICK)
  string(APPEND ENGINE_NAME "-leak")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)

add_compile_options(-O2 -g0 -ffp-contract=off -fno-fast-math -fno-exceptions -fno-rtti)

set(CROSS_PLATFORM_DETERMINISTIC ON CACHE BOOL "" FORCE)
set(DOUBLE_PRECISION OFF CACHE BOOL "" FORCE)
set(CPP_EXCEPTIONS_ENABLED OFF CACHE BOOL "" FORCE)
set(CPP_RTTI_ENABLED OFF CACHE BOOL "" FORCE)
set(USE_WASM_SIMD OFF CACHE BOOL "" FORCE)
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
  src/world.cpp
  src/bridge.cpp
  src/planet_frame.cpp
  src/page_cache.cpp
  src/planet_shape.cpp
  src/vegetation.cpp
  src/codec.cpp)
target_link_libraries(engine_core PRIVATE Jolt)
target_compile_definitions(engine_core PRIVATE JPH_CROSS_PLATFORM_DETERMINISTIC)

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
  _engine_codec_decode_inputs)
string(JOIN "," ENGINE_EXPORT_LIST ${ENGINE_EXPORTS})

target_link_options(engine_core PRIVATE
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=web,node
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,HEAPU32,HEAPF32,HEAPF64
  -sSTRICT=1
  -sINITIAL_MEMORY=${ENGINE_TIER_BYTES}
  -sEXPORTED_FUNCTIONS=${ENGINE_EXPORT_LIST})

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
