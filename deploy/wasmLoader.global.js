// wasmLoader.global.js
// Browser-compatible WASM loader that exposes functions to window scope
// This file should be loaded AFTER glmm_wasm.js

(function(global) {
  'use strict';
  
  let wasmModule = null;
  let isLoading = false;
  let loadPromise = null;

  // Estimator type mapping (matches C++ enum)
  const EstimatorType = {
    mixed_model: 0,
    mixed_model_ttest: 1,
    satterthwaite: 2,
    kenward_roger: 3,
    gee_independence: 4,
    gee_independence_robust: 5,
    gee_exchangeable: 6,
    gee_exchangeable_ttest: 7,
    design_effect: 8,
    design_effect_ttest: 9
  };

  // Load the WASM module
  let wasmHash = null;

async function loadWasm() {
    if (wasmModule) return wasmModule;
    if (loadPromise) return loadPromise;
    
    isLoading = true;
    
    loadPromise = new Promise(async (resolve, reject) => {
      try {
        if (typeof createGLMMModule === 'undefined') {
          throw new Error('WASM module factory not found.');
        }
        
        // Fetch the binary and hash it before instantiation
        const wasmResponse = await fetch('glmm_wasm.wasm');
        const wasmBytes = await wasmResponse.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', wasmBytes);
        wasmHash = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
        
        console.log('WASM hash:', wasmHash);
        
        wasmModule = await createGLMMModule({
          wasmBinary: wasmBytes   // pass pre-fetched bytes so it doesn't fetch twice
        });
        
        isLoading = false;
        console.log('GLMM WASM module loaded successfully');
        resolve(wasmModule);
      } catch (err) {
        isLoading = false;
        reject(err);
      }
    });
    
    return loadPromise;
}

function getWasmHash() {
    return wasmHash;
}

  // Check if module is loaded
  function isWasmLoaded() {
    return wasmModule !== null;
  }

  // Get the raw module
  function getModule() {
    return wasmModule;
  }

  // Create a new GLMM wrapper instance
  function createWrapper() {
    if (!wasmModule) {
      throw new Error('WASM module not loaded. Call loadWasm() first.');
    }
    return new wasmModule.GLMMWrapper();
  }

  // Convert JS array to WASM vector
  function toWasmVector(arr) {
    if (!wasmModule) {
      throw new Error('WASM module not loaded');
    }
    const vec = new wasmModule.VectorDouble();
    arr.forEach(v => vec.push_back(v));
    return vec;
  }

  // Convert WASM vector to JS array
  function fromWasmVector(vec) {
    const arr = [];
    for (let i = 0; i < vec.size(); i++) {
      arr.push(vec.get(i));
    }
    return arr;
  }

  // High-level interface class
  class GLMMInterface {
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
    
    initializeModel(formula, dataMatrix, family, link, correlationStructure = 'exchangeable', samplingStructure = 'cross_section') {
  if (!this.wrapper) {
    throw new Error('Interface not initialized. Call init() first.');
  }
  
  const flatData = dataMatrix.flat();
  const nRows = dataMatrix.length;
  const nCols = dataMatrix[0].length;
  const wasmData = toWasmVector(flatData);
  
  try {
    const success = this.wrapper.initialize(
      formula, 
      wasmData, 
      nRows, 
      nCols, 
      family, 
      link,
      correlationStructure,
      samplingStructure
    );
    this.isInitialized = success;
    if (!success) {
      this.lastError = this.wrapper.getLastError();
    }
    return success;
  } finally {
    wasmData.delete();
  }
}
    
    updateParameters(icc, iac, cacOrLengthscale, treatmentEffect, baseline, meanN, numPeriods, replacementRate = 1.0) {
  if (!this.wrapper || !this.isInitialized) {
    throw new Error('Model not initialized');
  }
  return this.wrapper.updateParameters(icc, iac, cacOrLengthscale, treatmentEffect, baseline, meanN, numPeriods, replacementRate);
}

updateWeights(meanClusterSize) {
  if (!this.wrapper || !this.isInitialized) {
    throw new Error('Model not initialized');
  }
  return this.wrapper.updateWeights(meanClusterSize);
}

getVerificationBundle(estimator = 'mixed_model', cv = 0.0) {
    if (!this.wrapper || !this.isInitialized) {
        throw new Error('Model not initialized');
    }
    const estimatorCode = typeof estimator === 'string'
        ? (EstimatorType[estimator] ?? 0)
        : estimator;
    
    const raw = this.wrapper.getVerificationBundle(estimatorCode, cv);
    
    // Convert MatrixExport objects to JS-friendly format
    const convertMatrix = (me) => {
        if (!me || !me.data || me.rows === 0) return null;
        const flatData = fromWasmVector(me.data);
        // Reshape to 2D array
        const matrix = [];
        for (let i = 0; i < me.rows; i++) {
            const row = [];
            for (let j = 0; j < me.cols; j++) {
                row.push(flatData[i * me.cols + j]);
            }
            matrix.push(row);
        }
        return { data: matrix, rows: me.rows, cols: me.cols, label: me.label };
    };
    
    return {
        X: convertMatrix(raw.X),
        Sigma: convertMatrix(raw.Sigma),
        M: convertMatrix(raw.M),
        Minv: convertMatrix(raw.Minv),
        bread: convertMatrix(raw.bread),
        meat: convertMatrix(raw.meat),
        V_working: convertMatrix(raw.V_working),
        Sigma_true: convertMatrix(raw.Sigma_true),
        beta: fromWasmVector(raw.beta),
        theta: fromWasmVector(raw.theta),
        var_delta: raw.var_delta,
        se: raw.se,
        dof: raw.dof,
        power: raw.power,
        te: raw.te,
        alpha: raw.alpha,
        target_power: raw.target_power,
        idx: raw.idx,
        estimator_name: raw.estimator_name,
        formula: raw.formula,
        family: raw.family,
        link: raw.link,
        correlation_structure: raw.correlation_structure,
        sampling_structure: raw.sampling_structure,
        valid: raw.valid,
        error: raw.error
    };
}

getCorrelationWarning() {
    if (!this.wrapper || !this.isInitialized) {
        return 0;
    }
    return this.wrapper.getCorrelationWarning();
}
    
    setAnalysisParams({ alpha, targetPower, treatmentEffect, includeIntercept }) {
      if (!this.wrapper) {
        throw new Error('Interface not initialized');
      }
      if (alpha !== undefined) this.wrapper.setAlpha(alpha);
      if (targetPower !== undefined) this.wrapper.setTargetPower(targetPower);
      if (treatmentEffect !== undefined) this.wrapper.setTreatmentEffect(treatmentEffect);
      if (includeIntercept !== undefined) this.wrapper.setIncludeIntercept(includeIntercept);
    }
    
    calculatePower(estimator = 'mixed_model', cv = 0.0) {
  if (!this.wrapper || !this.isInitialized) {
    throw new Error('Model not initialized');
  }
  const estimatorCode = typeof estimator === 'string' 
    ? (EstimatorType[estimator] ?? 0)
    : estimator;
  const result = this.wrapper.calculatePower(estimatorCode, cv);
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
    
    calculateOptimalWeights(N = 100) {
      if (!this.wrapper || !this.isInitialized) {
        throw new Error('Model not initialized');
      }
      const wasmWeights = this.wrapper.calculateOptimalWeights(N);
      return fromWasmVector(wasmWeights);
    }
    
    getTotalN() { return this.wrapper?.getTotalN() ?? 0; }
    getTotalClusterPeriods() { return this.wrapper?.getTotalClusterPeriods() ?? 0; }
    getNClusters() { return this.wrapper?.getNClusters() ?? 0; }
    getNumParameters() { return this.wrapper?.getNumParameters() ?? 0; }
    getFormula() { return this.wrapper?.getFormula() ?? ''; }
    isValid() { return this.wrapper?.isValid() ?? false; }
    getLastError() { return this.wrapper?.getLastError() ?? this.lastError; }
    getDataRows() { return this.wrapper?.getDataRows() ?? 0; }
    getDataCols() { return this.wrapper?.getDataCols() ?? 0; }
    
    dispose() {
      if (this.wrapper) {
        this.wrapper.delete();
        this.wrapper = null;
        this.isInitialized = false;
      }
    }

    calculateOptimalSequenceWeights(sequenceMembership, maxIter = 100, tol = 1e-6) {
  if (!this.wrapper || !this.isInitialized) {
    throw new Error('Model not initialized');
  }
  const wasmSeqMem = toWasmVector(sequenceMembership);
  try {
    const result = this.wrapper.calculateOptimalSequenceWeights(wasmSeqMem, maxIter, tol);
    return {
      weights: fromWasmVector(result.weights),
      valid: result.valid,
      error: result.error,
      iterations: result.iterations
    };
  } finally {
    wasmSeqMem.delete();
  }
}
  }

  // Expose everything to global scope
  global.WasmLoader = {
    loadWasm,
    isWasmLoaded,
    getModule,
    createWrapper,
    toWasmVector,
    fromWasmVector,
    EstimatorType,
    GLMMInterface,
    getWasmHash
  };

})(window);
