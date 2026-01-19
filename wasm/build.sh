#!/bin/bash

# build.sh - Build script for GLMM WASM module
# Run from the wasm/ directory

set -e  # Exit on error

# Configuration - only GLMMR needs to be specified
GLMMR_DIR="${GLMMR_DIR:-../glmmr/include}"

# Output directory
BUILD_DIR="build"
OUTPUT_DIR="../public"

echo "=== GLMM WASM Build Script ==="
echo ""
echo "Eigen and Boost will be downloaded automatically."
echo "GLMMR path: $GLMMR_DIR"
echo ""

# Check if Emscripten is available
if ! command -v emcmake &> /dev/null; then
    echo "ERROR: Emscripten not found!"
    echo ""
    echo "Please install and activate Emscripten SDK:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    echo ""
    exit 1
fi

# Check if GLMMR path exists
if [ ! -f "$GLMMR_DIR/glmmr.h" ]; then
    echo "WARNING: glmmr.h not found at: $GLMMR_DIR"
    echo "Set GLMMR_DIR environment variable to correct path"
    echo "  export GLMMR_DIR=/path/to/glmmr/include"
    echo ""
fi

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Run CMake with Emscripten
echo "Running CMake (will download Eigen and Boost if needed)..."
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DGLMMR_INCLUDE_DIR="$GLMMR_DIR"

# Build
echo ""
echo "Building..."
emmake make -j$(nproc 2>/dev/null || echo 4)

# Copy output files
echo ""
echo "Copying output files..."
mkdir -p "../$OUTPUT_DIR"
cp glmm_wasm.js "../$OUTPUT_DIR/"
cp glmm_wasm.wasm "../$OUTPUT_DIR/"

echo ""
echo "=== Build complete! ==="
echo "Output files:"
echo "  $OUTPUT_DIR/glmm_wasm.js"
echo "  $OUTPUT_DIR/glmm_wasm.wasm"
echo ""
echo "To use in your React app, copy these files to the public/ directory"
