cmake_minimum_required(VERSION 3.15)
project(glmm_wasm)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ===== Dependencies directory =====
set(DEPS_DIR ${CMAKE_SOURCE_DIR}/deps)
file(MAKE_DIRECTORY ${DEPS_DIR})

# ===== Download and extract Eigen =====
set(EIGEN_DIR ${DEPS_DIR}/eigen)
if(NOT EXISTS ${EIGEN_DIR}/Eigen/Dense)
    message(STATUS "Downloading Eigen...")
    file(DOWNLOAD
        https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.tar.gz
        ${DEPS_DIR}/eigen.tar.gz
        SHOW_PROGRESS
    )
    
    message(STATUS "Extracting Eigen...")
    execute_process(
        COMMAND ${CMAKE_COMMAND} -E tar xzf ${DEPS_DIR}/eigen.tar.gz
        WORKING_DIRECTORY ${DEPS_DIR}
    )
    
    file(RENAME ${DEPS_DIR}/eigen-3.4.0 ${EIGEN_DIR})
    file(REMOVE ${DEPS_DIR}/eigen.tar.gz)
endif()

# ===== Download and extract Boost =====
set(BOOST_EXTRACT_DIR ${DEPS_DIR}/boost-extract)
set(BOOST_DIR ${DEPS_DIR}/boost)

if(NOT EXISTS ${BOOST_DIR}/boost/version.hpp)
    message(STATUS "Downloading Boost (150MB, may take a few minutes)...")
    
    file(DOWNLOAD
        https://sourceforge.net/projects/boost/files/boost/1.83.0/boost_1_83_0.tar.gz
        ${DEPS_DIR}/boost.tar.gz
        SHOW_PROGRESS
        TIMEOUT 600
    )
    
    message(STATUS "Extracting Boost...")
    execute_process(
        COMMAND ${CMAKE_COMMAND} -E tar xzf ${DEPS_DIR}/boost.tar.gz
        WORKING_DIRECTORY ${DEPS_DIR}
    )
    
    # Find and rename extracted directory
    file(GLOB BOOST_EXTRACTED "${DEPS_DIR}/boost_*")
    if(BOOST_EXTRACTED)
        list(GET BOOST_EXTRACTED 0 BOOST_EXTRACTED_DIR)
        message(STATUS "Found extracted Boost at: ${BOOST_EXTRACTED_DIR}")
        
        if(EXISTS ${BOOST_EXTRACTED_DIR})
            file(RENAME ${BOOST_EXTRACTED_DIR} ${BOOST_DIR})
        endif()
    endif()
    
    file(REMOVE ${DEPS_DIR}/boost.tar.gz)
endif()

# ===== Verify Boost =====
message(STATUS "Looking for Boost headers...")

set(POSSIBLE_BOOST_PATHS
    ${BOOST_DIR}
    ${BOOST_DIR}/boost
    ${DEPS_DIR}/boost_1_83_0
)

set(BOOST_FOUND FALSE)
foreach(path ${POSSIBLE_BOOST_PATHS})
    if(EXISTS ${path}/boost/version.hpp)
        set(BOOST_INCLUDE_DIR ${path})
        set(BOOST_FOUND TRUE)
        message(STATUS "✓ Found boost/version.hpp at: ${BOOST_INCLUDE_DIR}")
        break()
    endif()
endforeach()

if(NOT BOOST_FOUND)
    message(STATUS "Searching in ${DEPS_DIR}:")
    file(GLOB_RECURSE VERSION_FILES "${DEPS_DIR}/*/version.hpp")
    foreach(file ${VERSION_FILES})
        message(STATUS "  Found version.hpp at: ${file}")
    endforeach()
    
    message(FATAL_ERROR "Could not find boost/version.hpp in any expected location")
endif()

# ===== Verify Eigen =====
if(NOT EXISTS ${EIGEN_DIR}/Eigen/Dense)
    message(FATAL_ERROR "Eigen/Dense not found at ${EIGEN_DIR}")
else()
    message(STATUS "✓ Found Eigen/Dense at: ${EIGEN_DIR}")
endif()

# ===== GLMMR Library =====
# Path to your glmmr library headers (user must provide this)
set(GLMMR_INCLUDE_DIR "${CMAKE_SOURCE_DIR}/../glmmr/include" CACHE PATH "Path to glmmr headers")

if(NOT EXISTS ${GLMMR_INCLUDE_DIR}/glmmr.h)
    # Check alternative locations
    set(POSSIBLE_GLMMR_PATHS
        ${CMAKE_SOURCE_DIR}/../glmmr/include
        ${CMAKE_SOURCE_DIR}/../glmmr
        ${CMAKE_SOURCE_DIR}/../../glmmr/include
        ${DEPS_DIR}/glmmr/include
    )
    
    set(GLMMR_FOUND FALSE)
    foreach(path ${POSSIBLE_GLMMR_PATHS})
        if(EXISTS ${path}/glmmr.h)
            set(GLMMR_INCLUDE_DIR ${path})
            set(GLMMR_FOUND TRUE)
            message(STATUS "✓ Found glmmr.h at: ${GLMMR_INCLUDE_DIR}")
            break()
        endif()
    endforeach()
    
    if(NOT GLMMR_FOUND)
        message(WARNING "glmmr.h not found. Set GLMMR_INCLUDE_DIR to the correct path.")
        message(WARNING "Searched in: ${POSSIBLE_GLMMR_PATHS}")
    endif()
else()
    message(STATUS "✓ Found glmmr.h at: ${GLMMR_INCLUDE_DIR}")
endif()

# ===== Source files =====
set(SOURCES
    glmm_wasm.cpp
)

# ===== Create the WASM library =====
add_executable(glmm_wasm ${SOURCES})

# Include directories
target_include_directories(glmm_wasm PRIVATE
    ${GLMMR_INCLUDE_DIR}
    ${EIGEN_DIR}
    ${BOOST_INCLUDE_DIR}
)

# ===== Emscripten-specific settings =====
if(EMSCRIPTEN)
    set_target_properties(glmm_wasm PROPERTIES
        SUFFIX ".js"
    )
    
    # Emscripten compile flags
    target_compile_options(glmm_wasm PRIVATE
        -O3
        -fexceptions  # Enable exceptions (needed for glmmr)
        -msimd128
    )
    
    # Emscripten link flags
    target_link_options(glmm_wasm PRIVATE
    --bind
    "SHELL:-s WASM=1"
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_NAME='createGLMMModule'"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s INITIAL_MEMORY=64MB"
    "SHELL:-s MAXIMUM_MEMORY=512MB"
    "SHELL:-s NO_EXIT_RUNTIME=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
    "SHELL:-s ENVIRONMENT='web'"
    "SHELL:-s DISABLE_EXCEPTION_CATCHING=0"
    "SHELL:-s STACK_SIZE=2097152"
    "SHELL:-s DISABLE_EXCEPTION_CATCHING=0"
    -fexceptions
    -O3
)
endif()

# ===== Print configuration summary =====
message(STATUS "")
message(STATUS "=== Configuration Summary ===")
message(STATUS "  Eigen:  ${EIGEN_DIR}")
message(STATUS "  Boost:  ${BOOST_INCLUDE_DIR}")
message(STATUS "  GLMMR:  ${GLMMR_INCLUDE_DIR}")
message(STATUS "=============================")
