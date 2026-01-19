@echo off
REM build.bat - Build script for GLMM WASM module (Windows)
REM Run from the wasm\ directory

setlocal

REM Configuration - adjust these paths to your setup
if "%GLMMR_DIR%"=="" set GLMMR_DIR=..\glmmr\include
if "%EIGEN_DIR%"=="" set EIGEN_DIR=..\eigen
if "%BOOST_DIR%"=="" set BOOST_DIR=..\boost

set BUILD_DIR=build
set OUTPUT_DIR=..\public

echo === GLMM WASM Build Script ===
echo.
echo Using paths:
echo   GLMMR: %GLMMR_DIR%
echo   Eigen: %EIGEN_DIR%
echo   Boost: %BOOST_DIR%
echo.

REM Check if Emscripten is available
where emcmake >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Emscripten not found!
    echo.
    echo Please install and activate Emscripten SDK:
    echo   git clone https://github.com/emscripten-core/emsdk.git
    echo   cd emsdk
    echo   emsdk install latest
    echo   emsdk activate latest
    echo   emsdk_env.bat
    echo.
    exit /b 1
)

REM Create build directory
if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"
cd "%BUILD_DIR%"

REM Run CMake with Emscripten
echo Running CMake...
call emcmake cmake .. ^
    -DCMAKE_BUILD_TYPE=Release ^
    -DGLMMR_INCLUDE_DIR="%GLMMR_DIR%" ^
    -DEIGEN_INCLUDE_DIR="%EIGEN_DIR%" ^
    -DBOOST_INCLUDE_DIR="%BOOST_DIR%" ^
    -G "MinGW Makefiles"

if %ERRORLEVEL% neq 0 (
    echo CMake failed!
    exit /b 1
)

REM Build
echo Building...
call emmake mingw32-make -j4

if %ERRORLEVEL% neq 0 (
    echo Build failed!
    exit /b 1
)

REM Copy output files
echo Copying output files...
if not exist "..\%OUTPUT_DIR%" mkdir "..\%OUTPUT_DIR%"
copy glmm_wasm.js "..\%OUTPUT_DIR%\"
copy glmm_wasm.wasm "..\%OUTPUT_DIR%\"

echo.
echo === Build complete! ===
echo Output files:
echo   %OUTPUT_DIR%\glmm_wasm.js
echo   %OUTPUT_DIR%\glmm_wasm.wasm
echo.
echo To use in your React app, copy these files to the public\ directory
echo and load using the loader script.

cd ..
endlocal
