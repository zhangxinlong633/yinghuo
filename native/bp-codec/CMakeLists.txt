cmake_minimum_required(VERSION 3.16)
project(dtn_bp_codec C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(BPLIB_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/bplib")
set(QCBOR_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/QCBOR")

if(NOT EXISTS "${BPLIB_ROOT}/ci/cbor/inc/bplib_cbor.h")
  message(FATAL_ERROR "Missing bplib. Run native/bp-codec/scripts/fetch-deps.sh")
endif()
if(NOT EXISTS "${QCBOR_ROOT}/inc/qcbor/qcbor.h")
  message(FATAL_ERROR "Missing QCBOR. Run native/bp-codec/scripts/fetch-deps.sh")
endif()

add_library(qcbor STATIC
  "${QCBOR_ROOT}/src/qcbor_encode.c"
  "${QCBOR_ROOT}/src/qcbor_decode.c"
  "${QCBOR_ROOT}/src/UsefulBuf.c"
  "${QCBOR_ROOT}/src/ieee754.c"
  "${QCBOR_ROOT}/src/qcbor_err_to_str.c"
)
target_include_directories(qcbor PUBLIC "${QCBOR_ROOT}/inc")

set(BPLIB_INCLUDE_DIRS
  "${BPLIB_ROOT}/inc"
  "${BPLIB_ROOT}/ci/cbor/inc"
  "${BPLIB_ROOT}/ci/cbor/src"
  "${BPLIB_ROOT}/ci/crc/inc"
  "${BPLIB_ROOT}/ci/crc/src"
  "${BPLIB_ROOT}/ci/eid/inc"
  "${BPLIB_ROOT}/ci/mem/inc"
  "${BPLIB_ROOT}/ci/time/inc"
  "${BPLIB_ROOT}/ci/em/inc"
  "${BPLIB_ROOT}/ci/qm/inc"
  "${BPLIB_ROOT}/ci/pl/inc"
  "${BPLIB_ROOT}/ci/rbt/inc"
  "${BPLIB_ROOT}/aa/as/inc"
  "${BPLIB_ROOT}/aa/nc/inc"
  "${BPLIB_ROOT}/aa/arp/inc"
  "${BPLIB_ROOT}/aa/fwp/inc"
  "${BPLIB_ROOT}/cla/inc"
  "${BPLIB_ROOT}/bpa/bi/inc"
  "${BPLIB_ROOT}/bpa/ct/inc"
  "${BPLIB_ROOT}/bpa/ebp/inc"
  "${BPLIB_ROOT}/bpa/pdb/inc"
  "${BPLIB_ROOT}/bpa/pi/inc"
  "${BPLIB_ROOT}/bpa/stor/inc"
  "${BPLIB_ROOT}/version/inc"
)

# codec-only: NASA ci/cbor sources plus the CRC, EID, and memory helpers they call.
# QCBOR is linked in. Full OSAL node init is not part of this target.
file(GLOB BPLIB_CBOR_SOURCES "${BPLIB_ROOT}/ci/cbor/src/*.c")

add_library(dtn_bp_codec SHARED
  src/dtn_bp_codec.c
  src/dtn_bp_codec_link.c
  ${BPLIB_CBOR_SOURCES}
  "${BPLIB_ROOT}/ci/crc/src/bplib_crc.c"
  "${BPLIB_ROOT}/ci/eid/src/bplib_eid.c"
  "${BPLIB_ROOT}/ci/mem/src/bplib_mem.c"
  "${BPLIB_ROOT}/ci/mem/src/bplib_std_allocator.c"
)

target_include_directories(dtn_bp_codec
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
  PRIVATE ${BPLIB_INCLUDE_DIRS}
)
target_compile_definitions(dtn_bp_codec PRIVATE BPLIB_MEM_STD_IMPL)
target_compile_options(dtn_bp_codec PRIVATE -fvisibility=hidden)
target_link_libraries(dtn_bp_codec PRIVATE qcbor)

set_target_properties(dtn_bp_codec PROPERTIES
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
)

add_executable(dtn_bp_codec_smoke src/dtn_bp_codec_smoke.c)
target_link_libraries(dtn_bp_codec_smoke PRIVATE dtn_bp_codec)
set_target_properties(dtn_bp_codec_smoke PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
)
if(APPLE)
  set_target_properties(dtn_bp_codec_smoke PROPERTIES
    BUILD_RPATH "${CMAKE_CURRENT_BINARY_DIR}"
  )
endif()
