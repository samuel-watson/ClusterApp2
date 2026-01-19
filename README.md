# GLMM WASM Build Instructions

This guide explains how to compile the C++ GLMM library to WebAssembly for use in the Trial Design web app.

## Prerequisites

### 1. Emscripten SDK

Install and activate Emscripten:

```bash
# Clone the SDK
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk

# Install and activate latest version
./emsdk install latest
./emsdk activate latest

# Set up environment (run this each session, or add to shell profile)
source ./emsdk_env.sh   # Linux/Mac
# or
emsdk_env.bat           # Windows
```

### 2. Your GLMMR Library

You need your header-only glmmr library accessible. The build will look for it at `../glmmr/include` by default.

**Eigen and Boost are downloaded automatically** — you don't need to install them!

## Project Structure

```
trial-design/
├── wasm/
│   ├── glmm_wasm.cpp     # WASM interface
│   ├── CMakeLists.txt    # Build configuration (auto-downloads Eigen/Boost)
│   ├── build.sh          # Linux/Mac build script
│   ├── build.bat         # Windows build script
│   └── deps/             # (created automatically) Downloaded dependencies
├── src/
│   ├── App.jsx           # React app
│   ├── wasmLoader.js     # WASM loader
│   └── ...
├── public/
│   ├── glmm_wasm.js      # (generated) WASM loader
│   └── glmm_wasm.wasm    # (generated) WASM binary
└── glmmr/
    └── include/
        └── glmmr.h       # Your library headers
```

## Building

### Quick Start

**Linux/Mac:**
```bash
cd wasm
./build.sh
```

**Windows:**
```cmd
cd wasm
build.bat
```

The first build will download Eigen (~2MB) and Boost (~150MB), which may take a few minutes.

### Custom GLMMR Location

If your glmmr library is elsewhere:

```bash
export GLMMR_DIR=/path/to/glmmr/include
./build.sh
```

Or on Windows:
```cmd
set GLMMR_DIR=C:\path\to\glmmr\include
build.bat
```

### Manual Build

```bash
cd wasm
mkdir build && cd build

# Configure with Emscripten
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DGLMMR_INCLUDE_DIR="/path/to/glmmr/include"

# Build
emmake make -j4

# Copy outputs to public folder
cp glmm_wasm.js glmm_wasm.wasm ../../public/
```

## Output Files

After building:

- `public/glmm_wasm.js` — JavaScript loader/glue code
- `public/glmm_wasm.wasm` — WebAssembly binary

## Testing the Build

### Quick Test Page

Create `public/test.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>GLMM WASM Test</title>
</head>
<body>
    <h1>GLMM WASM Test</h1>
    <pre id="output">Loading...</pre>
    
    <script src="glmm_wasm.js"></script>
    <script>
        async function test() {
            const output = document.getElementById('output');
            
            try {
                const Module = await createGLMMModule();
                output.textContent = 'Module loaded!\n\n';
                
                const wrapper = new Module.GLMMWrapper();
                output.textContent += 'Wrapper created!\n\n';
                
                // Test data (simple 2x2 crossover design)
                const data = new Module.VectorDouble();
                // [cl, t, n, int, int2, int12, control]
                [1, 1, 20, 0, 0, 0, 1].forEach(v => data.push_back(v));
                [1, 2, 20, 1, 0, 0, 0].forEach(v => data.push_back(v));
                [2, 1, 20, 1, 0, 0, 0].forEach(v => data.push_back(v));
                [2, 2, 20, 0, 0, 0, 1].forEach(v => data.push_back(v));
                
                const formula = 'int+factor(t)+(1|gr(cl))';
                
                const success = wrapper.initialize(formula, data, 4, 7, 'gaussian', 'identity');
                
                if (success) {
                    output.textContent += 'Model initialized!\n\n';
                    
                    wrapper.setTreatmentEffect(0.5);
                    const result = wrapper.calculatePower(0);
                    
                    output.textContent += `Power: ${result.power.toFixed(3)}\n`;
                    output.textContent += `DoF: ${result.dof}\n`;
                    output.textContent += `SE: ${result.se.toFixed(4)}\n`;
                    output.textContent += `MDE: ${result.mde.toFixed(4)}\n`;
                } else {
                    output.textContent += `Error: ${wrapper.getLastError()}\n`;
                }
                
                data.delete();
                wrapper.delete();
            } catch (err) {
                output.textContent = `Error: ${err.message}\n${err.stack}`;
            }
        }
        test();
    </script>
</body>
</html>
```

Serve and test:
```bash
cd public
python -m http.server 8080
# Open http://localhost:8080/test.html
```

## Troubleshooting

### "Module not found" error
- Ensure `glmm_wasm.js` and `glmm_wasm.wasm` are in `public/`
- Check browser console for 404 errors

### Download failures during CMake
- Check your internet connection
- Try running CMake again (it will resume downloads)
- For Boost, the download is ~150MB and may timeout on slow connections

### Compilation errors
- Verify your glmmr.h path is correct
- Check that glmmr is compatible with the downloaded Eigen/Boost versions
- Look for missing includes

### Memory errors at runtime
- The default is 64MB initial, 512MB max
- Increase `INITIAL_MEMORY` in CMakeLists.txt if needed
- Call `.delete()` on WASM objects to free memory

## Adapting the Interface

The `glmm_wasm.cpp` may need adjustments for your exact glmmr API:

1. **Line ~50** — Model template type: `glmmr::Model<glmmr::Bits<double>>`
2. **Line ~100** — `updateParameters()` — implement based on your covariance API
3. **Lines ~130+** — Verify `model->matrix.information_matrix()` and similar

## Next Steps

Once building and testing works:

1. Update `MathsInterface` in React to use the WASM loader
2. Wire up design/options to WASM model initialization
3. Connect the recalculate flow to real WASM results
