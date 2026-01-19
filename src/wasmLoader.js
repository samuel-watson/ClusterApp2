// wasmLoader.js
// Loads and provides interface to the GLMM WASM module

let wasmModule = null;
let isLoading = false;
let loadPromise = null;

// Estimator type mapping (matches C++ enum)
export const EstimatorType = {
  mixed_model: 0,
  mixed_model_ttest: 1,
  satterthwaite: 2,
  kenward_roger: 3,
  gee_independence: 4,
  gee_independence_robust: 5
};

// Load the WASM module
export async function loadWasm() {
  if (wasmModule) return wasmModule;
  if (loadPromise) return loadPromise;
  
  isLoading = true;
  
  loadPromise = new Promise(async (resolve, reject) => {
    try {
      // Load the module script
      const script = document.createElement('script');
      script.src = '/glmm_wasm.js';  // Adjust path if needed
      
      script.onload = async () => {
        try {
          // The script exposes createGLMMModule as a factory function
          if (typeof createGLMMModule === 'undefined') {
            throw new Error('WASM module factory not found');
          }
          
          wasmModule = await createGLMMModule({
            // Optional: configure module
            // locateFile: (path) => `/wasm/${path}`
          });
          
          isLoading = false;
          console.log('GLMM WASM module loaded successfully');
          resolve(wasmModule);
        } catch (err) {
          isLoading = false;
          reject(err);
        }
      };
      
      script.onerror = () => {
        isLoading = false;
        reject(new Error('Failed to load WASM script'));
      };
      
      document.head.appendChild(script);
      
    } catch (err) {
      isLoading = false;
      reject(err);
    }
  });
  
  return loadPromise;
}

// Check if module is loaded
export function isWasmLoaded() {
  return wasmModule !== null;
}

// Get the raw module (for advanced use)
export function getModule() {
  return wasmModule;
}

// Create a new GLMM wrapper instance
export function createWrapper() {
  if (!wasmModule) {
    throw new Error('WASM module not loaded. Call loadWasm() first.');
  }
  return new wasmModule.GLMMWrapper();
}

// Convert JS array to WASM vector
export function toWasmVector(arr) {
  if (!wasmModule) {
    throw new Error('WASM module not loaded');
  }
  const vec = new wasmModule.VectorDouble();
  arr.forEach(v => vec.push_back(v));
  return vec;
}

// Convert WASM vector to JS array
export function fromWasmVector(vec) {
  const arr = [];
  for (let i = 0; i < vec.size(); i++) {
    arr.push(vec.get(i));
  }
  return arr;
}

// High-level interface class that manages the wrapper
export class GLMMInterface {
  constructor() {
    this.wrapper = null;
    this.isInitialized = false;
    this.lastError = '';
  }
  
  async init() {
    await loadWasm();
    this.wrapper = createWrapper();
    return this;
  }
  
  // Initialize model with design data
  initializeModel(formula, dataMatrix, family, link) {
    if (!this.wrapper) {
      throw new Error('Interface not initialized. Call init() first.');
    }
    
    // Flatten the 2D data matrix to 1D (row-major)
    const flatData = dataMatrix.flat();
    const nRows = dataMatrix.length;
    const nCols = dataMatrix[0].length;
    
    // Convert to WASM vector
    const wasmData = toWasmVector(flatData);
    
    try {
      const success = this.wrapper.initialize(
        formula,
        wasmData,
        nRows,
        nCols,
        family,
        link
      );
      
      this.isInitialized = success;
      
      if (!success) {
        this.lastError = this.wrapper.getLastError();
      }
      
      return success;
    } finally {
      wasmData.delete();  // Clean up WASM memory
    }
  }
  
  // Update model parameters
 updateParameters(icc, iac, cacOrLengthscale, treatmentEffect, baseline, meanN) {
  if (!this.wrapper || !this.isInitialized) {
    throw new Error('Model not initialized');
  }
  return this.wrapper.updateParameters(icc, iac, cacOrLengthscale, treatmentEffect, baseline, meanN);
}
  
  // Set analysis parameters
  setAnalysisParams({ alpha, targetPower, treatmentEffect, includeIntercept }) {
    if (!this.wrapper) {
      throw new Error('Interface not initialized');
    }
    
    if (alpha !== undefined) this.wrapper.setAlpha(alpha);
    if (targetPower !== undefined) this.wrapper.setTargetPower(targetPower);
    if (treatmentEffect !== undefined) this.wrapper.setTreatmentEffect(treatmentEffect);
    if (includeIntercept !== undefined) this.wrapper.setIncludeIntercept(includeIntercept);
  }
  
  // Calculate power and other metrics
  calculatePower(estimator = 'mixed_model') {
    if (!this.wrapper || !this.isInitialized) {
      throw new Error('Model not initialized');
    }
    
    const estimatorCode = EstimatorType[estimator] ?? 0;
    const result = this.wrapper.calculatePower(estimatorCode);
    
    // Convert to plain JS object
    return {
      power: result.power,
      dof: result.dof,
      se: result.se,
      mde: result.mde,
      ci_width: result.ci_width,
      valid: result.valid,
      error: result.error
    };
  }
  
  // Calculate optimal weights
  calculateOptimalWeights(N = 100) {
    if (!this.wrapper || !this.isInitialized) {
      throw new Error('Model not initialized');
    }
    
    const wasmWeights = this.wrapper.calculateOptimalWeights(N);
    return fromWasmVector(wasmWeights);
  }
  
  // Getters
  getTotalN() {
    return this.wrapper?.getTotalN() ?? 0;
  }
  
  getTotalClusterPeriods() {
    return this.wrapper?.getTotalClusterPeriods() ?? 0;
  }
  
  getNClusters() {
    return this.wrapper?.getNClusters() ?? 0;
  }
  
  getFormula() {
    return this.wrapper?.getFormula() ?? '';
  }
  
  isValid() {
    return this.wrapper?.isValid() ?? false;
  }
  
  getLastError() {
    return this.wrapper?.getLastError() ?? this.lastError;
  }
  
  // Clean up
  dispose() {
    if (this.wrapper) {
      this.wrapper.delete();
      this.wrapper = null;
      this.isInitialized = false;
    }
  }
}

// Singleton instance for simple usage
let defaultInterface = null;

export async function getDefaultInterface() {
  if (!defaultInterface) {
    defaultInterface = new GLMMInterface();
    await defaultInterface.init();
  }
  return defaultInterface;
}
