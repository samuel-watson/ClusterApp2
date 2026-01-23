/*import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";

import { 
  loadWasm, 
  isWasmLoaded, 
  createWrapper, 
  toWasmVector, 
  fromWasmVector,
  EstimatorType 
} from './wasmLoader';*/

const { useState, useCallback, useRef, useEffect, useMemo } = React;
const { 
  loadWasm, 
  createWrapper, 
  toWasmVector, 
  fromWasmVector,
  EstimatorType 
} = window.WasmLoader;

// === DATA MODEL ===

const CellStatus = {
  CONTROL: "control",
  INTERVENTION: "intervention",
  NOT_ENROLLED: "not_enrolled",
};

class DesignCell {
  constructor(
    status = CellStatus.CONTROL,
    sampleSize = null,
    clusterSize = null
  ) {
    this.status = status;
    this.sampleSize = sampleSize;
    this.clusterSize = clusterSize;
  }

  clone() {
    return new DesignCell(this.status, this.sampleSize, this.clusterSize);
  }

  toJSON() {
    return {
      status: this.status,
      sampleSize: this.sampleSize,
      clusterSize: this.clusterSize,
    };
  }

  static fromJSON(json) {
    return new DesignCell(json.status, json.sampleSize, json.clusterSize);
  }
}

class TrialDesign {
  constructor(numSequences = 4, numPeriods = 5) {
    this._grid = [];
    this._sequenceLabels = [];
    this._periodLabels = [];
    this._clustersPerSequence = Array(numSequences).fill(1);

    for (let i = 0; i < numSequences; i++) {
      this._sequenceLabels.push(`Sequence ${i + 1}`);
      const row = [];
      for (let j = 0; j < numPeriods; j++) {
        row.push(new DesignCell());
      }
      this._grid.push(row);
    }

    for (let j = 0; j < numPeriods; j++) {
      this._periodLabels.push(`Period ${j}`);
    }
  }

  get numSequences() {
    return this._grid.length;
  }
  get numPeriods() {
    return this._grid[0]?.length || 0;
  }

  getCell(row, col) {
    if (
      row < 0 ||
      row >= this.numSequences ||
      col < 0 ||
      col >= this.numPeriods
    ) {
      return null;
    }
    return this._grid[row][col];
  }

  setCellStatus(row, col, status) {
    const cell = this.getCell(row, col);
    if (cell) cell.status = status;
  }

  getClusters(sequenceIndex) {
    return this._clustersPerSequence[sequenceIndex] ?? 1;
  }

  setClusters(sequenceIndex, count) {
    if (sequenceIndex >= 0 && sequenceIndex < this.numSequences) {
      this._clustersPerSequence[sequenceIndex] = Math.max(1, Math.floor(count));
    }
  }

  insertSequence(index, cells = null) {
    const newRow =
      cells ||
      Array(this.numPeriods)
        .fill(null)
        .map(() => new DesignCell());
    this._grid.splice(index, 0, newRow);
    this._sequenceLabels.splice(index, 0, `Sequence ${index + 1}`);
    this._clustersPerSequence.splice(index, 0, 1);
  }

  removeSequence(index) {
    if (this.numSequences <= 2) return false;
    this._grid.splice(index, 1);
    this._sequenceLabels.splice(index, 1);
    this._clustersPerSequence.splice(index, 1);
    return true;
  }

  insertPeriod(index, cells = null) {
    for (let i = 0; i < this.numSequences; i++) {
      const newCell = cells ? cells[i] : new DesignCell();
      this._grid[i].splice(index, 0, newCell);
    }
    this._periodLabels.splice(index, 0, `Period ${index}`);
  }

  removePeriod(index) {
    if (this.numPeriods <= 1) return false;
    for (let i = 0; i < this.numSequences; i++) {
      this._grid[i].splice(index, 1);
    }
    this._periodLabels.splice(index, 1);
    return true;
  }

  setAllInSequence(sequenceIndex, status) {
    if (sequenceIndex >= 0 && sequenceIndex < this.numSequences) {
      this._grid[sequenceIndex].forEach((cell) => (cell.status = status));
    }
  }

  setAllInPeriod(periodIndex, status) {
    if (periodIndex >= 0 && periodIndex < this.numPeriods) {
      this._grid.forEach((row) => (row[periodIndex].status = status));
    }
  }

  countByStatus(status) {
    let count = 0;
    this._grid.forEach((row) => {
      row.forEach((cell) => {
        if (cell.status === status) count++;
      });
    });
    return count;
  }

  getTotalClusters() {
    return this._clustersPerSequence.reduce((sum, c) => sum + c, 0);
  }

  toJSON() {
    return {
      grid: this._grid.map((row) => row.map((cell) => cell.toJSON())),
      sequenceLabels: this._sequenceLabels,
      periodLabels: this._periodLabels,
      clustersPerSequence: this._clustersPerSequence,
    };
  }

  clone() {
    const newDesign = new TrialDesign(0, 0);
    newDesign._grid = this._grid.map((row) => row.map((cell) => cell.clone()));
    newDesign._sequenceLabels = [...this._sequenceLabels];
    newDesign._periodLabels = [...this._periodLabels];
    newDesign._clustersPerSequence = [...this._clustersPerSequence];
    return newDesign;
  }

  getGrid() {
    return this._grid;
  }

  static fromJSON(json) {
  const design = new TrialDesign(json.numSequences, json.numPeriods);
  
  // Clear and rebuild grid from JSON
  design._grid = json.grid.map(row => 
    row.map(cell => {
      const newCell = new DesignCell(cell.status);
      if (cell.sampleSize != null) {
        newCell.sampleSize = cell.sampleSize;
      }
      if (cell.clusterSize != null) {
        newCell.clusterSize = cell.clusterSize;
      }
      return newCell;
    })
  );
  
  // Restore clusters per sequence
  if (json.clustersPerSequence) {
    design._clustersPerSequence = [...json.clustersPerSequence];
  }
  
  return design;
}

  static createParallel(numSequences = 2, numPeriods = 1) {
    const design = new TrialDesign(numSequences, numPeriods);
    for (let i = 0; i < numSequences; i++) {
      const status =
        i < numSequences / 2 ? CellStatus.CONTROL : CellStatus.INTERVENTION;
      design.setAllInSequence(i, status);
    }
    return design;
  }

  static createSteppedWedge(numSequences = 4, numPeriods = 5) {
    const design = new TrialDesign(numSequences, numPeriods);
    for (let i = 0; i < numSequences; i++) {
      for (let j = 0; j < numPeriods; j++) {
        const switchPoint = i + 1;
        const status =
          j < switchPoint ? CellStatus.CONTROL : CellStatus.INTERVENTION;
        design.setCellStatus(i, j, status);
      }
    }
    return design;
  }

  static createCrossover(
    numSequences = 2,
    numPeriods = 2,
    includeWashout = false
  ) {
    const actualPeriods = includeWashout ? numPeriods * 2 - 1 : numPeriods;
    const design = new TrialDesign(numSequences, actualPeriods);

    for (let i = 0; i < numSequences; i++) {
      let treatmentPhase = i % 2 === 0;
      for (let j = 0; j < actualPeriods; j++) {
        if (includeWashout && j > 0 && j % 2 === 1) {
          design.setCellStatus(i, j, CellStatus.NOT_ENROLLED);
        } else {
          design.setCellStatus(
            i,
            j,
            treatmentPhase ? CellStatus.INTERVENTION : CellStatus.CONTROL
          );
          treatmentPhase = !treatmentPhase;
        }
      }
    }
    return design;
  }

  static createParallelBaseline(numSequences = 2, numPeriods = 2) {
  // First period is baseline (control), then parallel
  const design = new TrialDesign(numSequences, numPeriods);
  for (let i = 0; i < numSequences; i++) {
    for (let j = 0; j < numPeriods; j++) {
      if (j === 0) {
        // Baseline period - all control
        design.setCellStatus(i, j, CellStatus.CONTROL);
      } else {
        // Parallel: first half control, second half intervention
        const status = i < numSequences / 2 ? CellStatus.CONTROL : CellStatus.INTERVENTION;
        design.setCellStatus(i, j, status);
      }
    }
  }
  return design;
}

static createSteppedWedgeImplementation(numSequences = 4, numPeriods = 6) {
  // Stepped wedge with NOT_ENROLLED implementation period between control and intervention
  const design = new TrialDesign(numSequences, numPeriods);
  for (let i = 0; i < numSequences; i++) {
    for (let j = 0; j < numPeriods; j++) {
      const switchPoint = i + 1;
      let status;
      if (j < switchPoint) {
        status = CellStatus.CONTROL;
      } else if (j === switchPoint) {
        status = CellStatus.NOT_ENROLLED;  // Implementation period
      } else {
        status = CellStatus.INTERVENTION;
      }
      design.setCellStatus(i, j, status);
    }
  }
  return design;
}

static createStaircase(numSequences = 4, numPeriods = 4) {
  // Only diagonal cells enrolled - control then intervention
  const design = new TrialDesign(numSequences, numPeriods);
  for (let i = 0; i < numSequences; i++) {
    for (let j = 0; j < numPeriods; j++) {
      if (j === i) {
        design.setCellStatus(i, j, CellStatus.CONTROL);
      } else if (j === i + 1) {
        design.setCellStatus(i, j, CellStatus.INTERVENTION);
      } else {
        design.setCellStatus(i, j, CellStatus.NOT_ENROLLED);
      }
    }
  }
  return design;
}
}



// Normal distribution CDF approximation
function normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return 0.5 * (1.0 + sign * y);
}

// T-distribution CDF approximation (using normal approximation for large df)
function tCDF(t, df) {
  if (df > 100) {
    return normalCDF(t);
  }
  
  // Approximation using incomplete beta function
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  
  // Regularized incomplete beta function approximation
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) +
    a * Math.log(x) + b * Math.log(1 - x)
  );
  
  if (x < (a + 1) / (a + b + 2)) {
    const beta = bt * betaCF(x, a, b) / a;
    return t > 0 ? 1 - beta / 2 : beta / 2;
  } else {
    const beta = bt * betaCF(1 - x, b, a) / b;
    return t > 0 ? 1 - (1 - beta) / 2 : (1 - beta) / 2;
  }
}

// T-distribution quantile approximation
function tQuantile(p, df) {
  if (df > 100) {
    return normalQuantile(p);
  }
  
  // Approximation using normal quantile with correction
  const z = normalQuantile(p);
  const z2 = z * z;
  
  // Cornish-Fisher expansion
  const t = z + (z2 * z - 3 * z) / (4 * df) +
            (z2 * z2 * z - 10 * z2 * z + 9 * z) / (96 * df * df);
  
  return t;
}

// Normal quantile (inverse CDF) approximation
function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  
  // Rational approximation
  const a = [
    -3.969683028665376e+01,
    2.209460984245205e+02,
    -2.759285104469687e+02,
    1.383577518672690e+02,
    -3.066479806614716e+01,
    2.506628277459239e+00
  ];
  const b = [
    -5.447609879822406e+01,
    1.615858368580409e+02,
    -1.556989798598866e+02,
    6.680131188771972e+01,
    -1.328068155288572e+01
  ];
  const c = [
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
    4.374664141464968e+00,
    2.938163982698783e+00
  ];
  const d = [
    7.784695709041462e-03,
    3.224671290700398e-01,
    2.445134137142996e+00,
    3.754408661907416e+00
  ];
  
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q, r;
  
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

// Log gamma function
function lgamma(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += cof[j] / ++y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

// Continued fraction for incomplete beta
function betaCF(x, a, b) {
  const maxIter = 100;
  const eps = 3e-7;
  
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  
  return h;
}

// Singleton WASM wrapper instance per design
let wasmReady = false;

const MathsInterface = {
  // Cache for GLMM wrapper objects (keyed by design ID)
  _modelCache: new Map(),

  // Column names for data matrix
  _colnames: ['cl', 't', 'n', 'int', 'int2', 'int12', 'control'],

  // Initialize the WASM module (call once at app startup)
  async initialize() {
    if (wasmReady) return true;
    try {
      await loadWasm();
      wasmReady = true;
      console.log('MathsInterface: WASM initialized');
      return true;
    } catch (err) {
      console.error('MathsInterface: Failed to initialize WASM:', err);
      return false;
    }
  },

  // Check if WASM is ready
  isReady() {
    return wasmReady;
  },

 _getDesignHash(design, options = {}) {
  const grid = design.getGrid();
  const structure = grid.map(row => 
    row.map(cell => cell.status === CellStatus.NOT_ENROLLED ? '0' : '1').join(',')
  ).join('|');
  const clusters = design._clustersPerSequence.join(',');
  const totalClusters = design._clustersPerSequence.reduce((a, b) => a + b, 0);
  const corrStructure = options.correlationStructure ?? 'exchangeable';
  const samplingStructure = options.samplingStructure ?? 'cross-sectional';
  const outcomeType = options.outcomeType ?? 'continuous';
  
const hash = `${design.numSequences}-${design.numPeriods}-${structure}-${clusters}-${totalClusters}-${corrStructure}-${samplingStructure}-${outcomeType}`;
  
  console.log('_getDesignHash:', hash);
  return hash;
},

  // Convert design to data matrix (matches C++ generate_data function)
  _generateDataMatrix(design, options) {
    const grid = design.getGrid();
    const numSequences = design.numSequences;
    const numPeriods = design.numPeriods;

    // Build data matrix: [cl, t, n, int, int2, int12, control]
    const data = [];
    let clNumber = 1;

    for (let i = 0; i < numSequences; i++) {
      const nClusters = design.getClusters(i);
      for (let j = 0; j < nClusters; j++) {
        for (let t = 0; t < numPeriods; t++) {
          const cell = grid[i][t];
          if (cell.status !== CellStatus.NOT_ENROLLED) {
            const isIntervention = cell.status === CellStatus.INTERVENTION ? 1 : 0;
            const clusterPeriodSize = cell.sampleSize ?? options.meanClusterSize ?? 20;
            
            const row = [
              clNumber,                    // cl: cluster number
              t + 1,                       // t: time period (1-indexed)
              clusterPeriodSize,           // n: cluster-period size
              isIntervention,              // int: intervention indicator
              0,                           // int2: second intervention (not used currently)
              0,                           // int12: interaction (int * int2)
              1 - isIntervention           // control: control indicator
            ];
            data.push(row);
          }
        }
        clNumber++;
      }
    }

    return data;
  },

  // Build formula string (matches C++ formula generation)
  _buildFormula(design, options) {
    let formula = 'int';
    const reString = options.heterogeneousTe ? 'int' : '1';
    
    // Two treatments (if applicable)
    if (options.twoTreatments) {
      formula += '+int2+int12';
    }

    // Time effects (if more than one period)
    if (design.numPeriods > 1) {
      if (options.timeEffect === 'linear') {
        formula += '+t';
      } else {
        formula += '+factor(t)'; // Fixed effects (default)
      }
    }

    // Covariance structure for cluster random effects
    switch (options.correlationStructure) {
      case 'exchangeable':
        formula += `+(${reString}|gr(cl))`;
        if (options.heterogeneousTe) formula += '+(control|gr(cl))';
        break;
      case 'nested_exchangeable':
        formula += `+(${reString}|gr(cl))+(${reString}|gr(cl,t))`;
        if (options.heterogeneousTe) formula += '+(control|gr(cl))+(control|gr(cl,t))';
        break;
      case 'exponential_decay':
        formula += `+(${reString}|gr(cl)*ar0(t))`;
        if (options.heterogeneousTe) formula += '+(control|gr(cl)*ar0(t))';
        break;
      case 'exponential_function':
        formula += `+(${reString}|gr(cl)*fexp0(t))`;
        if (options.heterogeneousTe) formula += '+(control|gr(cl)*fexp0(t))';
        break;
      default:
        formula += `+(${reString}|gr(cl))`;
    }

    // Individual-level covariance for cohort sampling
    if (options.samplingStructure === 'closed_cohort') {
      formula += '+(1|gr(cl))';
    } else if (options.samplingStructure === 'open_cohort') {
      formula += '+(1|gr(cl)*ar0(t))';
    }

    return formula;
  },

  // Get family string from outcome type
  _getFamily(outcomeType) {
    switch (outcomeType) {
      case 'binary': return 'binomial';
      case 'count': return 'poisson';
      default: return 'gaussian';
    }
  },

  // Get link function from outcome type
  _getLink(outcomeType) {
    switch (outcomeType) {
      case 'binary': return 'logit';
      case 'count': return 'log';
      default: return 'identity';
    }
  },

  // Get estimator code from string
  _getEstimatorCode(estimator) {
    return EstimatorType[estimator] ?? EstimatorType.mixed_model;
  },

  _getCorrelationStructure(correlationStructure) {
  const valid = ['exchangeable', 'nested_exchangeable', 'exponential_decay', 'exponential_function'];
  if (valid.includes(correlationStructure)) {
    return correlationStructure;
  }
  console.warn('Unknown correlation structure:', correlationStructure);
  return 'exchangeable';
},

_getSamplingStructure(samplingStructure) {
  switch (samplingStructure) {
    case 'cross-sectional': return 'cross_section';
    case 'closed-cohort': return 'closed_cohort';
    case 'open-cohort': return 'open_cohort';
    default: return 'cross_section';
  }
},
  // Calculate mean cluster-period size from data matrix
  _getMeanN(dataMatrix) {
    if (dataMatrix.length === 0) return 20;
    const totalN = dataMatrix.reduce((sum, row) => sum + row[2], 0);
    return totalN / dataMatrix.length;
  },

  // Create or retrieve WASM wrapper for a design
  _getWrapper(designId, design, options) {
    console.log('=== _getWrapper START ===');
  console.log('designId:', designId);
  
  if (!wasmReady) {
    throw new Error('WASM not initialized');
  }

  const hash = this._getDesignHash(design, options);
  const cached = this._modelCache.get(designId);

  console.log('=== _getWrapper ===');
  console.log('designId:', designId);
  console.log('computed hash:', hash);
  console.log('cached entry exists:', !!cached);
  console.log('cached hash:', cached?.hash);
  console.log('hashes match:', cached?.hash === hash);
  console.log('will rebuild:', !cached || cached.hash !== hash);

  

  if (cached && cached.hash === hash) {
    console.log('Reusing cached wrapper');
    this._updateWrapperParameters(cached.wrapper, options, cached.meanN, design.numPeriods);
    return cached.wrapper;
  }

  console.log('Building new wrapper...');
  
  const dataMatrix = this._generateDataMatrix(design, options);
console.log('dataMatrix rows:', dataMatrix.length);
console.log('dataMatrix cols:', dataMatrix[0]?.length);

const formula = this._buildFormula(design, options);
const family = this._getFamily(options.outcomeType);
const link = this._getLink(options.outcomeType);
const corrStructure = this._getCorrelationStructure(options.correlationStructure);
const samplingStructure = this._getSamplingStructure(options.samplingStructure);
const meanN = this._getMeanN(dataMatrix);  // Add this line

console.log('formula:', formula);
console.log('family:', family, 'link:', link);
console.log('corrStructure:', corrStructure);
console.log('samplingStructure:', samplingStructure);
console.log('meanN:', meanN);

  // Clean up old wrapper
  if (cached && cached.wrapper) {
    console.log('Deleting old wrapper');
    cached.wrapper.delete();
  }

  const wrapper = createWrapper();
  console.log('Wrapper created, now initializing...');
  
  const flatData = dataMatrix.flat();
  const nRows = dataMatrix.length;
  const nCols = dataMatrix[0]?.length ?? 7;
  
  console.log('nRows:', nRows, 'nCols:', nCols, 'flatData length:', flatData.length);
  
  const wasmData = toWasmVector(flatData);
  
  try {
    console.log('About to call wrapper.initialize with:');
  console.log('  formula:', formula);
  console.log('  nRows:', nRows, 'nCols:', nCols);
  console.log('  family:', family, 'link:', link);
  console.log('  corrStructure:', corrStructure);
  console.log('  samplingStructure:', samplingStructure);
    const success = wrapper.initialize(
      formula, wasmData, nRows, nCols, family, link, corrStructure, samplingStructure
    );
    console.log('initialize returned:', success);
      
      if (!success) {
        const error = wrapper.getLastError();
        console.error('WASM initialize failed:', error);
        throw new Error(`Model initialization failed: ${error}`);
      }
      
      console.log('Setting alpha...');
  wrapper.setAlpha(options.alpha ?? 0.05);
  
  console.log('Setting target power...');
  wrapper.setTargetPower(options.targetPower ?? 0.80);
  
  console.log('Setting include intercept...');
  wrapper.setIncludeIntercept(options.includeIntercept !== false);
  
  console.log('Calling _updateWrapperParameters...');
  this._updateWrapperParameters(wrapper, options, meanN, design.numPeriods);
  
  console.log('Caching wrapper...');
  this._modelCache.set(designId, { hash, wrapper, meanN, dataMatrix });
  
  console.log('_getWrapper complete');
  return wrapper;
      
    } finally {
      wasmData.delete(); // Clean up WASM memory
    }
  },

  // Transform parameters to link scale
_transformToLinkScale(baseline, treatmentEffect, outcomeType) {
  switch (outcomeType) {
    case 'binary': {
      // Logit link
      // baseline is control probability (e.g., 0.3)
      // treatmentEffect is absolute risk difference (e.g., 0.1 means 30% -> 40%)
      
      const p0 = Math.max(0.001, Math.min(0.999, baseline));
      const p1 = Math.max(0.001, Math.min(0.999, baseline + treatmentEffect));
      
      const baselineLink = Math.log(p0 / (1 - p0));  // logit(p0)
      const teLink = Math.log(p1 / (1 - p1)) - baselineLink;  // logit(p1) - logit(p0)
      
      return { baselineLink, teLink };
    }
    
    case 'count': {
      // Log link
      // baseline is control rate (e.g., 5 events per unit time)
      // treatmentEffect is rate ratio (e.g., 1.3 means 30% higher rate)
      
      const mu = Math.max(0.001, baseline);
      const baselineLink = Math.log(mu);
      const teLink = Math.log(treatmentEffect);  // log(RR)
      
      return { baselineLink, teLink };
    }
    
    default: {
      // Identity link: no transformation
      return { baselineLink: baseline, teLink: treatmentEffect };
    }
  }
},

  _updateWrapperParameters(wrapper, options, meanN, numPeriods) {
    console.log('=== _updateWrapperParameters START ===');
  if (!wrapper) {
    console.error('_updateWrapperParameters called with undefined wrapper');
    return;
  }
  
  const icc = options.icc ?? 0.05;
  const iac = options.iac ?? 0.8;
  const cacOrLengthscale = options.temporalCorrelation ?? options.cac ?? 0.8;
  const te = options.treatmentEffect ?? 0.5;
  const baseline = options.baseline ?? 0.5;
  const clusterSize = options.meanClusterSize ?? 20;
  const outcomeType = options.outcomeType ?? 'continuous';
  const replacementRate = options.replacementRate ?? 1.0;
  
  console.log('Parameters:', { icc, iac, cacOrLengthscale, te, baseline, clusterSize, outcomeType, replacementRate, numPeriods });
  
  const { baselineLink, teLink } = this._transformToLinkScale(baseline, te, outcomeType);
  console.log('Transformed:', { baselineLink, teLink });
  
  console.log('Calling setTreatmentEffect...');
  wrapper.setTreatmentEffect(teLink);
  
  console.log('Calling setAlpha...');
  wrapper.setAlpha(options.alpha ?? 0.05);
  
  console.log('Calling setTargetPower...');
  wrapper.setTargetPower(options.targetPower ?? 0.80);
  
  console.log('Calling setIncludeIntercept...');
  wrapper.setIncludeIntercept(options.includeIntercept !== false);
  
  console.log('Calling updateWeights...');
  wrapper.updateWeights(clusterSize);
  
  console.log('Calling updateParameters...');
  wrapper.updateParameters(
    icc, 
    iac, 
    cacOrLengthscale, 
    teLink, 
    baselineLink, 
    clusterSize, 
    numPeriods,
    replacementRate
  );
  
  console.log('=== _updateWrapperParameters COMPLETE ===');
},

  // === PUBLIC API ===

  calculateResults(design, options, designId = 'default') {
    if (!wasmReady) {
    // Return placeholder until WASM loads
    return {
      power: '---',
      dof: '---',
      se: '---',
      mde: '---',
      ciWidth: '---',
      error: 'WASM loading...'
    };
  }
    try {
      const wrapper = this._getWrapper(designId, design, options);
  console.log('Got wrapper, calling calculatePower...');
  const estimatorCode = this._getEstimatorCode(options.estimator);
  console.log('estimatorCode:', estimatorCode);
  
  const cv = options.sampleSizeMode === 'exact' ? 0 : (options.cvClusterSize ?? 0);
const result = wrapper.calculatePower(estimatorCode, cv);
  console.log('calculatePower returned:', result);
      
      if (!result.valid) {
        console.warn('Power calculation warning:', result.error);
        // Return placeholder values if calculation failed
        return {
          power: 'N/A',
          dof: 'N/A',
          se: 'N/A',
          mde: 'N/A',
          ciWidth: 'N/A',
          error: result.error
        };
      }
      
      return {
        power: result.power.toFixed(3),
        dof: Math.round(result.dof),
        se: result.se.toFixed(4),
        mde: result.mde.toFixed(4),
        ciWidth: result.ci_width.toFixed(4),
        error: null
      };
      
    } catch (err) {
      console.error('calculateResults error:', err);
      return {
        power: 'Error',
        dof: 'Error',
        se: 'Error',
        mde: 'Error',
        ciWidth: 'Error',
        error: err.message
      };
    }
  },

  calculateResultsWithClusters(design, options, totalClusters) {
  console.log('=== calculateResultsWithClusters START ===');
  console.log('totalClusters:', totalClusters);
  console.log('correlationStructure:', options.correlationStructure);
  console.log('samplingStructure:', options.samplingStructure);
  
  const originalClusters = [...design._clustersPerSequence];
  const currentTotal = design.getTotalClusters();
  const scale = totalClusters / currentTotal;
  
  const newClusters = originalClusters.map(c => Math.max(1, Math.round(c * scale)));
  
  console.log('originalClusters:', originalClusters);
  console.log('newClusters:', newClusters);
  console.log('scale:', scale);
    console.log('actual total after scaling:', newClusters.reduce((a, b) => a + b, 0));

  
  design._clustersPerSequence = newClusters;
  
  const tempId = `_plot_clusters_${totalClusters}`;
  console.log('tempId:', tempId);
  
  try {
    const result = this.calculateResults(design, options, tempId);
    design._clustersPerSequence = originalClusters;
    return result;
  } catch (err) {
    console.error('calculateResultsWithClusters error:', err);
    design._clustersPerSequence = originalClusters;
    throw err;
  }
},

  calculateSampleSize(design, meanClusterSize) {
  const grid = design.getGrid();
  for (let i = 0; i < design.numSequences; i++) {
    for (let j = 0; j < design.numPeriods; j++) {
      const cell = grid[i][j];
      if (cell.status !== CellStatus.NOT_ENROLLED) {
        cell.sampleSize = meanClusterSize;
      }
    }
  }
},

clearPlotCache() {
  for (const [key, cached] of this._modelCache) {
    if (key.startsWith('_plot_')) {
      if (cached.wrapper) {
        cached.wrapper.delete();
      }
      this._modelCache.delete(key);
    }
  }
},

  calculateOptimalWeights(design, options = {}) {
    if (!wasmReady) {
    return this._getFallbackWeights(design);
  }
    try {
      const wrapper = this._getWrapper('_weights', design, options);
      const N = options.weightIterations ?? 100;
      
      const wasmWeights = wrapper.calculateOptimalWeights(N);
      const flatWeights = fromWasmVector(wasmWeights);
      
      // Reshape flat weights to grid format [sequences][periods]
      const grid = design.getGrid();
      const numSequences = design.numSequences;
      const numPeriods = design.numPeriods;
      
      const weights = [];
      let weightIdx = 0;
      
      for (let i = 0; i < numSequences; i++) {
        const nClusters = design.getClusters(i);
        const row = [];
        
        for (let j = 0; j < numPeriods; j++) {
          const cell = grid[i][j];
          if (cell.status === CellStatus.NOT_ENROLLED) {
            row.push(0);
          } else {
            // Average weights across clusters in this sequence
            let avgWeight = 0;
            for (let c = 0; c < nClusters; c++) {
              if (weightIdx < flatWeights.length) {
                avgWeight += flatWeights[weightIdx++];
              }
            }
            row.push(nClusters > 0 ? avgWeight / nClusters : 0);
          }
        }
        weights.push(row);
      }
      
      // Normalize to max = 1
      const maxWeight = Math.max(...weights.flat());
      if (maxWeight > 0) {
        for (let i = 0; i < numSequences; i++) {
          for (let j = 0; j < numPeriods; j++) {
            weights[i][j] = weights[i][j] / maxWeight;
          }
        }
      }
      
      return weights;
      
    } catch (err) {
      console.error('calculateOptimalWeights error:', err);
      // Return fallback weights
      return this._getFallbackWeights(design);
    }
  },

  // Fallback weights when WASM fails
  _getFallbackWeights(design) {
    const grid = design.getGrid();
    const weights = [];
    const numPeriods = design.numPeriods;
    const numSequences = design.numSequences;

    for (let i = 0; i < numSequences; i++) {
      const row = [];
      for (let j = 0; j < numPeriods; j++) {
        const cell = grid[i][j];
        if (cell.status === CellStatus.NOT_ENROLLED) {
          row.push(0);
        } else {
          // Simple placeholder weight
          const seqCenter = (numSequences - 1) / 2;
          const perCenter = (numPeriods - 1) / 2;
          const seqDist = 1 - Math.abs(i - seqCenter) / numSequences;
          const perDist = 1 - Math.abs(j - perCenter) / numPeriods;
          row.push(0.3 + 0.7 * seqDist * perDist);
        }
      }
      weights.push(row);
    }

    // Normalize
    const maxWeight = Math.max(...weights.flat());
    if (maxWeight > 0) {
      for (let i = 0; i < numSequences; i++) {
        for (let j = 0; j < numPeriods; j++) {
          weights[i][j] = weights[i][j] / maxWeight;
        }
      }
    }

    return weights;
  },

  // Clear cache (useful when switching between designs)
  clearCache() {
    // Clean up WASM wrappers
    for (const [, cached] of this._modelCache) {
      if (cached.wrapper) {
        cached.wrapper.delete();
      }
    }
    this._modelCache.clear();
  },

  // Debug: get generated data and formula
  debug(design, options) {
    const dataMatrix = this._generateDataMatrix(design, options);
    return {
      dataMatrix,
      formula: this._buildFormula(design, options),
      family: this._getFamily(options.outcomeType),
      link: this._getLink(options.outcomeType),
      colnames: this._colnames,
      meanN: this._getMeanN(dataMatrix),
      hash: this._getDesignHash(design)
    };
  },

  // Get wrapper info for debugging
  getWrapperInfo(designId = 'default') {
    if (!wasmReady) {
    throw new Error('WASM not initialized. Call MathsInterface.initialize() first.');
  }

  const hash = this._getDesignHash(design);
    const cached = this._modelCache.get(designId);
    console.log('_getWrapper:', { designId, hash, hasCached: !!cached, cachedHash: cached?.hash });

  if (cached && cached.hash === hash) {
    console.log('Reusing cached wrapper, updating parameters...');
  this._updateWrapperParameters(cached.wrapper, options, cached.meanN, design.numPeriods);
    return cached.wrapper;
  }

  console.log('Creating new wrapper...');
    if (!cached || !cached.wrapper) {
      return null;
    }
    return {
      formula: cached.wrapper.getFormula(),
      totalN: cached.wrapper.getTotalN(),
      totalClusterPeriods: cached.wrapper.getTotalClusterPeriods(),
      nClusters: cached.wrapper.getNClusters(),
      numParameters: cached.wrapper.getNumParameters(),
      isValid: cached.wrapper.isValid(),
      lastError: cached.wrapper.getLastError(),
      dataRows: cached.wrapper.getDataRows(),
      dataCols: cached.wrapper.getDataCols()
    };
  }
};

const createDefaultOptions = () => ({
  // Outcome
  outcomeType: 'continuous',  // 'continuous', 'binary', 'count'
  
  // Treatment effect
  treatmentEffect: 0.5,
  baseline: 0.5,
  
  // Cluster parameters
  meanClusterSize: 20,
  cvClusterSize: 0.0,
  
  // Correlation parameters
  icc: 0.05,
  iac: 0.0,
  cac: 0.8,
  temporalCorrelation: 0.8,
  replacementRate: 0.5,
  // Structure
  correlationStructure: 'exchangeable',  // 'exchangeable', 'nested_exchangeable', 'exponential_decay', 'autoregressive'
  samplingStructure: 'cross_section',    // 'cross_section', 'closed_cohort', 'open_cohort'
  individualCovariance: 'exchangeable',
  
  // Analysis
  estimator: 'mixed_model',  // 'mixed_model', 'mixed_model_ttest', 'satterthwaite', 'kenward_roger', 'gee_independence', 'gee_independence_robust'
  alpha: 0.05,
  targetPower: 0.80,
  
  // Model
  includeIntercept: true,
  timeEffect: 'fixed_effects',  // 'fixed_effects', 'linear'
  heterogeneousTe: false,
  twoTreatments: false
});

const createDesignEntry = (name, preset = "parallel") => {
  let design;
  switch (preset) {
    case "parallel":
      design = TrialDesign.createParallel(2, 1);
      design._clustersPerSequence = design._clustersPerSequence.map(() => 10);
      break;
    case "parallel-baseline":
      design = TrialDesign.createParallelBaseline(2, 2);
      break;
    case "stepped-wedge":
      design = TrialDesign.createSteppedWedge(4, 5);
      break;
    case "stepped-wedge-implementation":
      design = TrialDesign.createSteppedWedgeImplementation(4, 6);
      break;
    case "crossover":
      design = TrialDesign.createCrossover(2, 2, false);
      break;
    case "crossover-washout":
      design = TrialDesign.createCrossover(2, 2, true);
      break;
    case "staircase":
      design = TrialDesign.createStaircase(4, 5);
      break;
    default:
      design = TrialDesign.createSteppedWedge(4, 5);
  }
  MathsInterface.calculateSampleSize(design, 20);
  return {
    name,
    design,
    options: createDefaultOptions(),
  };
};

// === UI COMPONENTS ===

const statusConfig = {
  [CellStatus.CONTROL]: {
    label: "Control",
    shortLabel: "C",
    bg: "bg-slate-100",
    border: "border-slate-300",
    text: "text-slate-700",
    hoverBg: "hover:bg-slate-200",
  },
  [CellStatus.INTERVENTION]: {
    label: "Intervention",
    shortLabel: "I",
    bg: "bg-emerald-100",
    border: "border-emerald-400",
    text: "text-emerald-800",
    hoverBg: "hover:bg-emerald-200",
  },
  [CellStatus.NOT_ENROLLED]: {
    label: "Not enrolled",
    shortLabel: "—",
    bg: "bg-gray-50",
    border: "border-gray-200",
    text: "text-gray-400",
    hoverBg: "hover:bg-gray-100",
  },
};

const statusCycle = [
  CellStatus.CONTROL,
  CellStatus.INTERVENTION,
  CellStatus.NOT_ENROLLED,
];

const designColors = [
  {
    bg: "bg-blue-500",
    text: "text-blue-600",
    light: "bg-blue-50",
    border: "border-blue-500",
    hex: "#3b82f6",
  },
  {
    bg: "bg-purple-500",
    text: "text-purple-600",
    light: "bg-purple-50",
    border: "border-purple-500",
    hex: "#a855f7",
  },
  {
    bg: "bg-orange-500",
    text: "text-orange-600",
    light: "bg-orange-50",
    border: "border-orange-500",
    hex: "#f97316",
  },
];

const ContextMenu = ({ x, y, items, onClose }) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 min-w-[160px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, idx) =>
        item.separator ? (
          <div key={idx} className="h-px bg-slate-200 my-1" />
        ) : (
          <button
            key={idx}
            onClick={() => {
              item.action();
              onClose();
            }}
            disabled={item.disabled}
            className={`w-full text-left px-3 py-1.5 text-sm
              ${
                item.disabled
                  ? "text-slate-300 cursor-not-allowed"
                  : "text-slate-700 hover:bg-slate-100"
              }
              ${
                item.danger && !item.disabled
                  ? "text-red-600 hover:bg-red-50"
                  : ""
              }
            `}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
};

const InsertButton = ({ onClick, className = "" }) => (
  <button
    onClick={onClick}
    className={`
      flex items-center justify-center
      bg-blue-500 text-white rounded-full
      opacity-0 group-hover:opacity-100 focus:opacity-100
      transition-opacity duration-150
      shadow-sm hover:shadow-md hover:bg-blue-600
      focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1
      w-4 h-4 text-xs
      ${className}
    `}
  >
    +
  </button>
);

const PeriodHeader = ({ index, onContextMenu, cellSize }) => (
  <div
    className="flex items-center justify-center font-medium text-slate-600 text-sm 
               cursor-context-menu select-none hover:bg-slate-100 rounded transition-colors"
    style={{ width: cellSize, height: 32 }}
    onContextMenu={(e) => {
      e.preventDefault();
      onContextMenu(e, index);
    }}
    title="Right-click for options"
  >
    T{index}
  </div>
);

const SequenceHeader = ({
  index,
  clusters,
  onClustersChange,
  onContextMenu,
  cellSize,
}) => (
  <div
    className="flex items-center justify-end gap-2 pr-2"
    style={{ width: 100, height: cellSize }}
  >
    <input
      type="number"
      min="1"
      value={clusters}
      onChange={(e) => onClustersChange(index, parseInt(e.target.value) || 1)}
      className="w-12 px-1 py-0.5 text-sm text-center border border-slate-300 rounded
                 focus:outline-none focus:ring-1 focus:ring-blue-500"
      title="Number of clusters"
    />
    <div
      className="font-medium text-slate-600 text-sm cursor-context-menu select-none 
                 hover:bg-slate-100 rounded px-1 transition-colors"
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, index);
      }}
      title="Right-click for options"
    >
      Seq {index + 1}
    </div>
  </div>
);

const DesignCellComponent = ({
  cell,
  rowIndex,
  colIndex,
  onClick,
  onContextMenu,
  cellSize,
  sampleSizeMode,
  scale = 1,
}) => {
  const config = statusConfig[cell.status];
  const scaledSize = cellSize * (0.4 + 0.6 * scale); // Min 40% size

  return (
    <div
      className="flex items-center justify-center"
      style={{ width: cellSize, height: cellSize }}
    >
      <button
        onClick={() => onClick(rowIndex, colIndex)}
        onContextMenu={(e) => onContextMenu(e, rowIndex, colIndex)}
        className={`
          ${config.bg} ${config.border} ${config.text} ${config.hoverBg}
          border-2 rounded-lg transition-all duration-300 ease-in-out
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
          flex flex-col items-center justify-center
        `}
        style={{
          width: scaledSize,
          height: scaledSize,
          fontSize: `${Math.max(0.6, scale) * 100}%`,
        }}
        title={`${config.label}${
          sampleSizeMode === "exact" && cell.sampleSize
            ? ` (n=${cell.sampleSize})`
            : ""
        }${scale < 1 ? ` (weight: ${(scale * 100).toFixed(0)}%)` : ""}${
          sampleSizeMode === "exact" && cell.status !== CellStatus.NOT_ENROLLED
            ? " — Right-click to set size"
            : ""
        }`}
      >
        {sampleSizeMode === "exact" &&
          cell.sampleSize !== null &&
          cell.status !== CellStatus.NOT_ENROLLED && (
            <span className="font-semibold text-sm">n={cell.sampleSize}</span>
          )}
        <span className="text-[10px] uppercase tracking-wide opacity-70">
          {config.shortLabel}
        </span>
      </button>
    </div>
  );
};

// Results Table Component
const ResultsTable = ({
  designs,
  cachedResults,
  isStale,
  isCalculating,
  onRecalculate,
}) => {
  return (
    <div
      className={`bg-white rounded-xl shadow-lg border border-slate-200 p-4 transition-opacity ${
        isStale ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">
          Results Comparison
        </h2>
        {isStale && (
          <button
            onClick={onRecalculate}
            disabled={isCalculating}
            className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg
                       hover:bg-blue-600 disabled:bg-blue-300 transition-colors
                       flex items-center gap-1"
          >
            {isCalculating ? (
              <>
                <span className="animate-spin">⟳</span> Calculating...
              </>
            ) : (
              <>⟳ Recalculate</>
            )}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-3 font-medium text-slate-600">
                Metric
              </th>
              {designs.map((d, i) => (
                <th
                  key={i}
                  className={`text-center py-2 px-3 font-medium ${designColors[i].text}`}
                >
                  {d.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2 px-3 text-slate-600">Power</td>
              {cachedResults.map((r, i) => (
                <td key={i} className="text-center py-2 px-3 font-mono">
                  {r.power}
                </td>
              ))}
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 px-3 text-slate-600">Degrees of Freedom</td>
              {cachedResults.map((r, i) => (
                <td key={i} className="text-center py-2 px-3 font-mono">
                  {r.dof}
                </td>
              ))}
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 px-3 text-slate-600">Standard Error</td>
              {cachedResults.map((r, i) => (
                <td key={i} className="text-center py-2 px-3 font-mono">
                  {r.se}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-2 px-3 text-slate-600">
                Min. Detectable Effect
              </td>
              {cachedResults.map((r, i) => (
                <td key={i} className="text-center py-2 px-3 font-mono">
                  {r.mde}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {isStale && !isCalculating && (
        <p className="text-xs text-amber-600 mt-2 text-center">
          ⚠ Results are outdated. Click Recalculate to update.
        </p>
      )}
    </div>
  );
};

// Power Warning Component
const PowerWarning = ({ warning, selectedEstimator, designName }) => {
  if (!warning) return null;
  
  const estimatorLabels = {
    mixed_model: 'Model-based',
    mixed_model_ttest: 'Model-based t-test',
    satterthwaite: 'Satterthwaite',
    kenward_roger: 'Kenward-Roger',
    gee_independence: 'GEE Independence',
    gee_independence_robust: 'GEE Independence Robust',
  };
  
  const isRobust = selectedEstimator.includes('robust') || selectedEstimator === 'gee_independence_robust';
  const isSmallSampleCorrected = ['satterthwaite', 'kenward_roger', 'mixed_model_ttest'].includes(selectedEstimator);
  
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm">
      <div className="flex items-start gap-2">
        <span className="text-amber-600 text-lg">⚠️</span>
        <div className="flex-1">
          <p className="font-medium text-amber-800 mb-2">
            Power estimate may be optimistic
          </p>
          <p className="text-amber-700 mb-2">
            The selected estimator for {designName} ({estimatorLabels[selectedEstimator]}) shows power of{' '}
            <span className="font-mono font-semibold">{(warning.selectedPower * 100).toFixed(1)}%</span>, 
            which is more than 10 percentage points higher than{' '}
            {warning.lowEstimators.length === 1 
              ? estimatorLabels[warning.lowEstimators[0].key]
              : `${warning.lowEstimators.length} other estimators`
            }{' '}
            (lowest: <span className="font-mono font-semibold">{(warning.minOtherPower * 100).toFixed(1)}%</span>).
          </p>
          <p className="text-amber-700">
            {!isSmallSampleCorrected && !isRobust && (
              <>Consider using a small sample correction (Satterthwaite or Kenward-Roger) or robust covariance estimation (GEE Independence Robust) for more conservative estimates.</>
            )}
            {isSmallSampleCorrected && !isRobust && (
              <>You are using a small sample correction. Consider also comparing with robust covariance estimation (GEE Independence Robust).</>
            )}
            {isRobust && !isSmallSampleCorrected && (
              <>You are using robust covariance estimation. Consider also comparing with small sample corrections (Satterthwaite or Kenward-Roger).</>
            )}
            {isRobust && isSmallSampleCorrected && (
              <>This estimator already includes corrections. The difference may reflect genuine variation in power across inference approaches for this design.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

// Plot Component using Plotly via CDN
const PlotArea = ({
  designs,
  activeIndex,
  cachedResults,
  isStale,
  isCalculating,
  cacheVersion,
}) => {
  const plotRef = useRef(null);
  const [plotlyLoaded, setPlotlyLoaded] = useState(false);
  const [xAxis, setXAxis] = useState("icc");
  const [yAxis, setYAxis] = useState("power");
  const [plotType, setPlotType] = useState("line"); // 'line', 'heatmap', or 'contour'
  const [targetPower, setTargetPower] = useState(0.8);
  const [surfaceResolution, setSurfaceResolution] = useState(10);

  const xAxisOptions = [
    { value: "icc", label: "ICC", min: 0, max: 0.3, steps: 30 },
    {
      value: "meanClusterSize",
      label: "Cluster-Period Size",
      min: 5,
      max: 100,
      steps: 30,
    },
    {
      value: "treatmentEffect",
      label: "Treatment Effect",
      min: 0,
      max: 2,
      steps: 30,
    },
    { value: "baseline", label: "Baseline", min: 0.01, max: 0.5, steps: 30 },
    {
      value: "totalClusters",
      label: "Total Clusters",
      min: 2,
      max: 50,
      steps: 30,
    },
  ];

  const yAxisOptions = [
    { value: "power", label: "Power" },
    { value: "mde", label: "Min. Detectable Effect" },
  ];

  // Load Plotly from CDN
  useEffect(() => {
    if (window.Plotly) {
      setPlotlyLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.plot.ly/plotly-2.27.0.min.js";
    script.async = true;
    script.onload = () => setPlotlyLoaded(true);
    document.head.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, []);

  const [customRange, setCustomRange] = useState(null);

useEffect(() => {
  setCustomRange(null);
}, [xAxis]);

const currentXConfig = useMemo(() => {
  const base = xAxisOptions.find((o) => o.value === xAxis);
  if (customRange) {
    return { ...base, min: customRange.min, max: customRange.max };
  }
  return base;
}, [xAxis, customRange]);

  // Generate plot data
  const plotData = useMemo(() => {
   
  if (!currentXConfig) {
    console.log('No currentXConfig');
    return [];
  }

  console.log('Generating plot data:', { xAxis, currentXConfig });

  // Clear old plot cache
  MathsInterface.clearPlotCache();

  return designs.map((d, idx) => {
    const xValues = [];
    const yValues = [];

    const { min, max, steps } = currentXConfig;
    console.log('Plot range:', { min, max, steps });

    for (let i = 0; i <= steps; i++) {
      const xVal = min + (max - min) * (i / steps);
      xValues.push(xVal);

      const modifiedOptions = { ...d.options };
      let result;

      if (xAxis === "totalClusters") {
        result = MathsInterface.calculateResultsWithClusters(
          d.design,
          modifiedOptions,
          Math.round(xVal)
        );
      } else if (xAxis === "meanClusterSize") {
  modifiedOptions.meanClusterSize = xVal;
  const tempId = `_plot_line_${idx}`;  // ✓ Same ID = reuse model, update weights
  result = MathsInterface.calculateResults(d.design, modifiedOptions, tempId);
} else {
        modifiedOptions[xAxis] = xVal;
  // Use design-specific ID so different designs don't share cache
  const tempId = `_plot_line_${idx}`;
  result = MathsInterface.calculateResults(d.design, modifiedOptions, tempId);
      }

      // Debug first and last iteration
      if (i === 0 || i === steps) {
        console.log(`Point ${i}: x=${xVal}, ${xAxis}=${modifiedOptions[xAxis]}, power=${result.power}`);
      }

      yValues.push(parseFloat(yAxis === "power" ? result.power : result.mde));
    }

    console.log('Y values range:', Math.min(...yValues), 'to', Math.max(...yValues));

      return {
        x: xValues,
        y: yValues,
        type: "scatter",
        mode: "lines",
        name: d.name,
        line: { color: designColors[idx].hex, width: 2.5 },
      };
    });
  }, [cacheVersion, xAxis, yAxis, currentXConfig]);

  const surfaceData = useMemo(() => {
  if (plotType === "line") return null;

  MathsInterface.clearPlotCache();
  // Use active design instead of first design
  const d = designs[activeIndex];
  
  const clusterSizes = Array.from({ length: surfaceResolution }, (_, i) => 
    5 + i * Math.floor(100 / surfaceResolution)
  );
  const totalClusters = Array.from({ length: surfaceResolution }, (_, i) => 
    2 + i * Math.floor(50 / surfaceResolution)
  );

  const zValues = totalClusters.map((clusters) => {
    return clusterSizes.map((size) => {
      const modifiedOptions = { ...d.options, meanClusterSize: size };
      const result = MathsInterface.calculateResultsWithClusters(
        d.design,
        modifiedOptions,
        clusters
      );
      return parseFloat(result.power);
    });
  });

  return {
    x: clusterSizes,
    y: totalClusters,
    z: zValues,
    type: plotType,
    colorscale: [
      [0, "#fee2e2"],
      [Math.max(0.01, targetPower - 0.2), "#fef9c3"],
      [targetPower, "#bbf7d0"],
      [1, "#22c55e"],
    ],
    contours:
      plotType === "contour"
        ? {
            coloring: "heatmap",
            showlabels: true,
            labelfont: { size: 10, color: "#475569" },
          }
        : undefined,
    hovertemplate:
      "Size: %{x}<br>Clusters: %{y}<br>Power: %{z:.3f}<extra></extra>",
    colorbar: {
      title: { text: "Power", font: { size: 11 } },
      tickfont: { size: 10 },
    },
  };
}, [
  cacheVersion, 
  plotType, 
  activeIndex, 
  targetPower, 
  surfaceResolution
]);

  // Render plot when data or Plotly changes
  useEffect(() => {
    if (!plotlyLoaded || !plotRef.current || !window.Plotly) return;

    let data, layout;

    if (plotType === "line") {
      const shapes =
        yAxis === "power"
          ? [
              {
                type: "line",
                x0: currentXConfig.min,
                x1: currentXConfig.max,
                y0: targetPower,
                y1: targetPower,
                line: { color: "#94a3b8", width: 1.5, dash: "dash" },
              },
            ]
          : [];

      data = plotData;
      layout = {
        margin: { l: 55, r: 25, t: 25, b: 50 },
        xaxis: {
          title: { text: currentXConfig.label, font: { size: 12 } },
          gridcolor: "#e2e8f0",
          tickfont: { size: 10 },
        },
        yaxis: {
          title: {
            text: yAxis === "power" ? "Power" : "Min. Detectable Effect",
            font: { size: 12 },
          },
          gridcolor: "#e2e8f0",
          range: yAxis === "power" ? [0, 1.02] : undefined,
          tickfont: { size: 10 },
        },
        shapes: shapes,
        legend: {
          orientation: "h",
          y: -0.2,
          x: 0.5,
          xanchor: "center",
          font: { size: 11 },
        },
        paper_bgcolor: "white",
        plot_bgcolor: "#f8fafc",
        font: { family: "system-ui, -apple-system, sans-serif" },
        hovermode: "x unified",
      };
    } else {
      // Heatmap or contour
      data = [surfaceData];
      layout = {
        margin: { l: 55, r: 80, t: 25, b: 50 },
        xaxis: {
          title: { text: "Cluster-Period Size", font: { size: 12 } },
          tickfont: { size: 10 },
        },
        yaxis: {
          title: { text: "Total Clusters", font: { size: 12 } },
          tickfont: { size: 10 },
        },
        paper_bgcolor: "white",
        font: { family: "system-ui, -apple-system, sans-serif" },
        annotations:
          plotType === "contour"
            ? [
                {
                  x: surfaceData.x[Math.floor(surfaceData.x.length * 0.7)],
                  y: surfaceData.y[Math.floor(surfaceData.y.length * 0.3)],
                  text: `${(targetPower * 100).toFixed(0)}% power`,
                  showarrow: false,
                  font: { size: 10, color: "#475569" },
                },
              ]
            : [],
      };
    }

    const config = {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
      toImageButtonOptions: {
        format: "png",
        filename: "power_analysis",
        height: 600,
        width: 900,
        scale: 2,
      },
      displaylogo: false,
    };

    window.Plotly.newPlot(plotRef.current, data, layout, config);

    return () => {
      if (plotRef.current && window.Plotly) {
        window.Plotly.purge(plotRef.current);
      }
    };
  }, [
    plotlyLoaded,
    plotData,
    surfaceData,
    plotType,
    yAxis,
    currentXConfig,
    targetPower,
    cacheVersion,
  ]);

  const exportPlot = (format) => {
    if (!plotRef.current || !window.Plotly) return;

    window.Plotly.downloadImage(plotRef.current, {
      format: format,
      filename: "power_analysis",
      height: 600,
      width: 900,
      scale: 2,
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Analysis Plot</h2>
        <div className="flex gap-2 flex-wrap">
          <select
            value={plotType}
            onChange={(e) => setPlotType(e.target.value)}
            className="px-2 py-1 text-xs border border-slate-300 rounded
                 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="line">Line Plot</option>
            <option value="heatmap">Power Surface (Heatmap)</option>
            <option value="contour">Power Surface (Contour)</option>
          </select>

          <div className="flex items-center gap-1">
            <label className="text-xs text-slate-500">Target:</label>
            <input
              type="number"
              step="0.05"
              min="0.5"
              max="0.99"
              value={targetPower}
              onChange={(e) =>
                setTargetPower(
                  Math.min(
                    0.99,
                    Math.max(0.5, parseFloat(e.target.value) || 0.8)
                  )
                )
              }
              className="w-14 px-1 py-1 text-xs border border-slate-300 rounded
               focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
            />
          </div>

          {plotType === "line" && (
  <>
    <select
      value={xAxis}
      onChange={(e) => setXAxis(e.target.value)}
      className="px-2 py-1 text-xs border border-slate-300 rounded
           focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {xAxisOptions.map((opt) => (
        <option key={opt.value} value={opt.value}>
          X: {opt.label}
        </option>
      ))}
    </select>
    
    {/* Add range inputs here */}
    <div className="flex items-center gap-1">
      <label className="text-xs text-slate-500">Range:</label>
      <input
        type="number"
        value={customRange?.min ?? currentXConfig?.min ?? 0}
        onChange={(e) => setCustomRange(r => ({ 
          min: parseFloat(e.target.value),
          max: r?.max ?? currentXConfig?.max ?? 1
        }))}
        className="w-14 px-1 py-1 text-xs border border-slate-300 rounded
         focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
      />
      <span className="text-xs text-slate-400">to</span>
      <input
        type="number"
        value={customRange?.max ?? currentXConfig?.max ?? 1}
        onChange={(e) => setCustomRange(r => ({ 
          min: r?.min ?? currentXConfig?.min ?? 0,
          max: parseFloat(e.target.value)
        }))}
        className="w-14 px-1 py-1 text-xs border border-slate-300 rounded
         focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
      />
    </div>
    
    <select
      value={yAxis}
      onChange={(e) => setYAxis(e.target.value)}
      className="px-2 py-1 text-xs border border-slate-300 rounded
           focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {yAxisOptions.map((opt) => (
        <option key={opt.value} value={opt.value}>
          Y: {opt.label}
        </option>
      ))}
    </select>
  </>
)}

          {plotType !== "line" && (
  <>
    <span className="text-xs text-slate-500 self-center">
      Using {designs[activeIndex].name}
    </span>
    <div className="flex items-center gap-1">
      <label className="text-xs text-slate-500">Resolution:</label>
      <input
        type="number"
        min="5"
        max="30"
        value={surfaceResolution}
        onChange={(e) => setSurfaceResolution(
          Math.min(30, Math.max(5, parseInt(e.target.value) || 15))
        )}
        className="w-12 px-1 py-1 text-xs border border-slate-300 rounded
                   focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
      />
    </div>
  </>
)}

          <div className="flex gap-1">
            <button
              onClick={() => exportPlot("png")}
              className="px-2 py-1 text-xs bg-slate-100 border border-slate-300 rounded
                   hover:bg-slate-200 transition-colors"
              title="Download as PNG"
            >
              PNG
            </button>
            <button
              onClick={() => exportPlot("svg")}
              className="px-2 py-1 text-xs bg-slate-100 border border-slate-300 rounded
                   hover:bg-slate-200 transition-colors"
              title="Download as SVG"
            >
              SVG
            </button>
          </div>
        </div>
      </div>

      <div className={`relative ${isStale ? "opacity-60" : ""}`}>
        {isStale && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-full">
              Outdated
            </span>
          </div>
        )}
        {!plotlyLoaded ? (
          <div className="h-64 flex items-center justify-center text-slate-400">
            Loading plot library...
          </div>
        ) : (
          <div ref={plotRef} style={{ width: "100%", height: "280px" }} />
        )}
      </div>
    </div>
  );
};



// === MAIN COMPONENT ===

function App() {
  const [designs, setDesigns] = useState(() => [createDesignEntry("Design 1")]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState(null);
  const [cellSize, setCellSize] = useState(72);
  const [showWeights, setShowWeights] = useState(false);
  const designGridRef = useRef(null);
  const [resultsStale, setResultsStale] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [cachedResults, setCachedResults] = useState(() =>
    designs.map((d) => MathsInterface.calculateResults(d.design, d.options))
  );
  const [cacheVersion, setCacheVersion] = useState(0);
  const [cachedWeights, setCachedWeights] = useState(() =>
    designs.map((d) => MathsInterface.calculateOptimalWeights(d.design))
  );
  const [wasmLoaded, setWasmLoaded] = useState(false);

  const activeDesign = designs[activeIndex];
  const design = activeDesign.design;
  const options = activeDesign.options;

  const weights = showWeights ? cachedWeights[activeIndex] || null : null;
  // List of all estimators for comparison
const ESTIMATORS = [
  { key: 'mixed_model', label: 'Mixed Model' },
  { key: 'mixed_model_ttest', label: 'Mixed Model t-test' },
  { key: 'satterthwaite', label: 'Satterthwaite' },
  { key: 'kenward_roger', label: 'Kenward-Roger' },
  { key: 'gee_independence', label: 'GEE Independence' },
  { key: 'gee_independence_robust', label: 'GEE Independence Robust' },
];

// Memoized power comparison across estimators
const powerWarning = useMemo(() => {
  if (!wasmLoaded || resultsStale || isCalculating) return null;
  
  const currentResult = cachedResults[activeIndex];
  const currentPower = parseFloat(currentResult?.power);
  if (isNaN(currentPower)) return null;
  
  const currentEstimator = options.estimator;
  const d = designs[activeIndex];
  
  // Calculate power for all other estimators
  const otherPowers = ESTIMATORS
    .filter(e => e.key !== currentEstimator)
    .map(e => {
      const modifiedOptions = { ...d.options, estimator: e.key };
      const result = MathsInterface.calculateResults(d.design, modifiedOptions, `_compare_${e.key}`);
      return {
        ...e,
        power: parseFloat(result.power)
      };
    })
    .filter(e => !isNaN(e.power));
  
  if (otherPowers.length === 0) return null;
  
  // Find the maximum difference where current is higher
  const maxDiff = Math.max(...otherPowers.map(e => currentPower - e.power));
  const minOtherPower = Math.min(...otherPowers.map(e => e.power));
  const lowEstimators = otherPowers.filter(e => currentPower - e.power >= 0.10);
  
  if (maxDiff >= 0.10) {
    return {
      selectedPower: currentPower,
      minOtherPower,
      difference: maxDiff,
      lowEstimators
    };
  }
  
  return null;
}, [wasmLoaded, resultsStale, isCalculating, cachedResults, activeIndex, options.estimator, designs]);


  useEffect(() => {
  MathsInterface.initialize().then(success => {
    setWasmLoaded(success);
    hideLoading();
    if (!success) {
      console.error('Failed to initialize WASM module');
    }
  });
}, []);  // Empty array = runs once on mount

  useEffect(() => {
    setResultsStale(true);
  }, [designs]);

  const recalculateResults = useCallback(async () => {
  if (!MathsInterface.isReady()) {
    console.warn('WASM not ready yet');
    return;
  }
  
  setIsCalculating(true);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const newResults = designs.map((d) =>
    MathsInterface.calculateResults(d.design, d.options)
  );

  const newWeights = designs.map((d) =>
    MathsInterface.calculateOptimalWeights(d.design, d.options)
  );

  
  setCachedResults(newResults);
  setCachedWeights(newWeights);
  setCacheVersion((v) => v + 1);
  setResultsStale(false);
  setIsCalculating(false);
}, [designs, wasmLoaded]);

  const updateActiveDesign = useCallback(
    (modifier) => {
      setDesigns((prev) => {
        const newDesigns = [...prev];
        const newEntry = {
          ...newDesigns[activeIndex],
          design: newDesigns[activeIndex].design.clone(),
        };
        modifier(newEntry);
        newDesigns[activeIndex] = newEntry;
        return newDesigns;
      });
    },
    [activeIndex]
  );

  const updateOptions = useCallback(
    (key, value) => {
      setDesigns((prev) => {
        const newDesigns = [...prev];
        newDesigns[activeIndex] = {
          ...newDesigns[activeIndex],
          options: {
            ...newDesigns[activeIndex].options,
            [key]: value,
          },
        };
        return newDesigns;
      });
    },
    [activeIndex]
  );

  const addDesign = useCallback(() => {
    if (designs.length >= 3) return;
    const newDesign = createDesignEntry(`Design ${designs.length + 1}`);
    setDesigns((prev) => [...prev, newDesign]);
    setActiveIndex(designs.length);
  }, [designs.length]);

  const removeDesign = useCallback(
    (index) => {
      if (designs.length <= 1) return;
      setDesigns((prev) => prev.filter((_, i) => i !== index));
      if (activeIndex >= index && activeIndex > 0) {
        setActiveIndex(activeIndex - 1);
      }
    },
    [designs.length, activeIndex]
  );

  const renameDesign = useCallback((index, newName) => {
    setDesigns((prev) => {
      const newDesigns = [...prev];
      newDesigns[index] = { ...newDesigns[index], name: newName };
      return newDesigns;
    });
  }, []);

  const handleCellClick = useCallback(
    (row, col) => {
      updateActiveDesign((entry) => {
        const cell = entry.design.getCell(row, col);
        const currentIdx = statusCycle.indexOf(cell.status);
        const nextStatus = statusCycle[(currentIdx + 1) % statusCycle.length];
        cell.status = nextStatus;
        cell.sampleSize =
          nextStatus === CellStatus.NOT_ENROLLED
            ? null
            : entry.options.meanClusterSize;
      });
    },
    [updateActiveDesign]
  );

  const handleCellContextMenu = useCallback(
    (e, rowIndex, colIndex) => {
      if (options.sampleSizeMode !== "exact") return;

      const cell = design.getCell(rowIndex, colIndex);
      if (cell.status === CellStatus.NOT_ENROLLED) return;

      e.preventDefault();

      const newSize = prompt(
        "Enter cluster-period size:",
        cell.sampleSize || options.meanClusterSize
      );
      if (newSize !== null) {
        const parsed = parseInt(newSize);
        if (!isNaN(parsed) && parsed > 0) {
          updateActiveDesign((entry) => {
            entry.design.getCell(rowIndex, colIndex).sampleSize = parsed;
          });
        }
      }
    },
    [
      options.sampleSizeMode,
      options.meanClusterSize,
      design,
      updateActiveDesign,
    ]
  );

  const handlePeriodContextMenu = useCallback(
    (e, index) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: "Insert period before",
            action: () =>
              updateActiveDesign((entry) => entry.design.insertPeriod(index)),
          },
          {
            label: "Insert period after",
            action: () =>
              updateActiveDesign((entry) =>
                entry.design.insertPeriod(index + 1)
              ),
          },
          { separator: true },
          {
            label: "Set all to Control",
            action: () =>
              updateActiveDesign((entry) =>
                entry.design.setAllInPeriod(index, CellStatus.CONTROL)
              ),
          },
          {
            label: "Set all to Intervention",
            action: () =>
              updateActiveDesign((entry) =>
                entry.design.setAllInPeriod(index, CellStatus.INTERVENTION)
              ),
          },
          { separator: true },
          {
            label: "Delete period",
            action: () =>
              updateActiveDesign((entry) => entry.design.removePeriod(index)),
            danger: true,
            disabled: design.numPeriods <= 1,
          },
        ],
      });
    },
    [design.numPeriods, updateActiveDesign]
  );

  const handleSequenceContextMenu = useCallback(
    (e, index) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: "Insert sequence above",
            action: () =>
              updateActiveDesign((entry) => entry.design.insertSequence(index)),
          },
          {
            label: "Insert sequence below",
            action: () =>
              updateActiveDesign((entry) =>
                entry.design.insertSequence(index + 1)
              ),
          },
          { separator: true },
          {
            label: "Set all to Control",
            action: () =>
              updateActiveDesign((entry) =>
                entry.design.setAllInSequence(index, CellStatus.CONTROL)
              ),
          },
          {
            label: "Set all to Intervention",
            action: () =>
              updateActiveDesign((entry) =>
                entry.design.setAllInSequence(index, CellStatus.INTERVENTION)
              ),
          },
          { separator: true },
          {
            label: "Delete sequence",
            action: () =>
              updateActiveDesign((entry) => entry.design.removeSequence(index)),
            danger: true,
            disabled: design.numSequences <= 2,
          },
        ],
      });
    },
    [design.numSequences, updateActiveDesign]
  );

  const loadPreset = (preset) => {
  updateActiveDesign((entry) => {
    let newDesign;
    switch (preset) {
      case "parallel":
        newDesign = TrialDesign.createParallel(2, 1);
        break;
      case "parallel-baseline":
        newDesign = TrialDesign.createParallelBaseline(2, 2);
        break;
      case "stepped-wedge":
        newDesign = TrialDesign.createSteppedWedge(4, 5);
        break;
      case "stepped-wedge-implementation":
        newDesign = TrialDesign.createSteppedWedgeImplementation(4, 6);
        break;
      case "crossover":
        newDesign = TrialDesign.createCrossover(2, 2, false);
        break;
      case "crossover-washout":
        newDesign = TrialDesign.createCrossover(2, 2, true);
        break;
      case "staircase":
        newDesign = TrialDesign.createStaircase(4, 5);
        break;
      default:
        return;
    }
    MathsInterface.calculateSampleSize(
      newDesign,
      entry.options.meanClusterSize
    );
    entry.design = newDesign;
  });
};

  const exportDesignImage = async () => {
    if (!designGridRef.current) return;

    // Load html2canvas from CDN if not already loaded
    if (!window.html2canvas) {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      document.head.appendChild(script);
      await new Promise((resolve) => (script.onload = resolve));
    }

    try {
      const canvas = await window.html2canvas(designGridRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
      });

      const link = document.createElement("a");
      link.download = `${activeDesign.name.replace(/\s+/g, "_")}_design.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const getTreatmentEffectInfo = (outcomeType) => {
  switch (outcomeType) {
    case 'binary':
      return {
        label: 'Risk Difference',
        tooltip: 'Absolute risk difference (e.g., 0.1 means 10 percentage point increase from baseline probability)',
        placeholder: 'e.g., 0.1'
      };
    case 'count':
      return {
        label: 'Rate Ratio',
        tooltip: 'Ratio of treatment to control rate (e.g., 1.3 means 30% higher rate)',
        placeholder: 'e.g., 1.3'
      };
    default:
      return {
        label: 'Mean Difference',
        tooltip: 'Difference in means between treatment and control groups',
        placeholder: 'e.g., 0.5'
      };
  }
};

  const grid = design.getGrid();
  const numSequences = design.numSequences;
  const numPeriods = design.numPeriods;
const [showTooltip, setShowTooltip] = useState(false);
const teInfo = getTreatmentEffectInfo(options.outcomeType);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left Column: Design Editor */}
          
          <div className="space-y-4">
            <div className="mb-4">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Cluster Trial Design Tool
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Compare up to 3 designs. Click cells to cycle status. Right-click
            headers for options.
          </p>
        </div>
            {/* Design Tabs */}
            <div className="flex items-center gap-2">
              {designs.map((d, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors
                    ${
                      i === activeIndex
                        ? `${designColors[i].light} ${designColors[i].border} border-2`
                        : "bg-white border border-slate-200 hover:bg-slate-50"
                    }`}
                  onClick={() => setActiveIndex(i)}
                >
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => renameDesign(i, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className={`bg-transparent text-sm font-medium w-20 focus:outline-none
                      ${
                        i === activeIndex
                          ? designColors[i].text
                          : "text-slate-600"
                      }`}
                  />
                  {designs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeDesign(i);
                      }}
                      className="text-slate-400 hover:text-red-500 text-xs"
                      title="Remove design"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {designs.length < 3 && (
                <button
                  onClick={addDesign}
                  className="px-3 py-1.5 bg-white border border-dashed border-slate-300 rounded-lg
                           text-sm text-slate-500 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                >
                  + Add Design
                </button>
              )}
            </div>

            {/* Presets */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-600">
                Presets:
              </span>
              {[
  "parallel",
  "parallel-baseline",
  "stepped-wedge",
  "stepped-wedge-implementation",
  "crossover",
  "crossover-washout",
  "staircase",
].map((preset) => (
  <button
    key={preset}
    onClick={() => loadPreset(preset)}
    className="px-2 py-1 bg-white border border-slate-300 rounded text-xs
               hover:bg-slate-50 transition-colors capitalize"
  >
    {preset.replace(/-/g, " ")}
  </button>
))}
              <div className="h-4 w-px bg-slate-300 mx-1" />
              <label className="flex items-center gap-1 text-xs text-slate-600">
                Size:
                <input
                  type="range"
                  min="56"
                  max="96"
                  value={cellSize}
                  onChange={(e) => setCellSize(Number(e.target.value))}
                  className="w-16"
                />
                <div className="h-4 w-px bg-slate-300 mx-1" />
                <button
                  onClick={() => setShowWeights(!showWeights)}
                  className={`px-2 py-1 text-xs border rounded transition-colors
    ${
      showWeights
        ? `bg-blue-100 border-blue-400 text-blue-700 ${
            resultsStale ? "opacity-60" : ""
          }`
        : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
    }`}
                >
                  {showWeights ? "✓ Weights" : "Show Weights"}
                  {showWeights && resultsStale && " *"}
                </button>

                <button
              onClick={exportDesignImage}
              className="px-2 py-1 text-xs bg-white border border-slate-300 rounded
             hover:bg-slate-50 transition-colors"
              title="Export design as PNG"
            >
              📥 Export Design
            </button>
              </label>
            </div>

            

            {/* Design Grid */}
            <div
              ref={designGridRef}
              className="bg-white rounded-xl shadow-lg border border-slate-200 p-4 overflow-x-auto"
            >
              {" "}
              <div className="inline-block">
                {/* Column headers */}
                <div className="flex items-center mb-1 group">
                  <div style={{ width: 100 }} />
                  <div className="flex items-center">
                    <div className="w-2 flex justify-center">
                      <InsertButton
                        onClick={() =>
                          updateActiveDesign((e) => e.design.insertPeriod(0))
                        }
                      />
                    </div>
                    {Array(numPeriods)
                      .fill(null)
                      .map((_, j) => (
                        <React.Fragment key={j}>
                          <PeriodHeader
                            index={j}
                            onContextMenu={handlePeriodContextMenu}
                            cellSize={cellSize}
                          />
                          <div className="w-2 flex justify-center">
                            <InsertButton
                              onClick={() =>
                                updateActiveDesign((e) =>
                                  e.design.insertPeriod(j + 1)
                                )
                              }
                            />
                          </div>
                        </React.Fragment>
                      ))}
                  </div>
                </div>

                {/* Grid rows */}
                <div className="flex flex-col">
                  <div className="flex items-center h-2 group">
                    <div
                      style={{ width: 100 }}
                      className="flex justify-end pr-1"
                    >
                      <InsertButton
                        onClick={() =>
                          updateActiveDesign((e) => e.design.insertSequence(0))
                        }
                      />
                    </div>
                  </div>

                  {grid.map((row, i) => (
                    <React.Fragment key={i}>
                      <div className="flex items-center group">
                        <SequenceHeader
                          index={i}
                          clusters={design.getClusters(i)}
                          onClustersChange={(idx, val) =>
                            updateActiveDesign((e) =>
                              e.design.setClusters(idx, val)
                            )
                          }
                          onContextMenu={handleSequenceContextMenu}
                          cellSize={cellSize}
                        />
                        <div className="flex items-center">
                          <div className="w-2" />
                          {row.map((cell, j) => (
                            <React.Fragment key={j}>
                              <DesignCellComponent
                                cell={cell}
                                rowIndex={i}
                                colIndex={j}
                                onClick={handleCellClick}
                                onContextMenu={handleCellContextMenu}
                                cellSize={cellSize}
                                sampleSizeMode={options.sampleSizeMode}
                                scale={weights ? weights[i][j] : 1}
                              />
                              <div className="w-2" />
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center h-2 group">
                        <div
                          style={{ width: 100 }}
                          className="flex justify-end pr-1"
                        >
                          <InsertButton
                            onClick={() =>
                              updateActiveDesign((e) =>
                                e.design.insertSequence(i + 1)
                              )
                            }
                          />
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3">
              {Object.entries(statusConfig).map(([status, config]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <div
                    className={`w-3 h-3 rounded ${config.bg} ${config.border} border`}
                  />
                  <span className="text-xs text-slate-600">{config.label}</span>
                </div>
              ))}
            </div>

            {/* Options Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Analysis Options */}
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-700 mb-3">
                  Analysis Options
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">
                      Outcome Type
                    </label>
                    <select
                      value={options.outcomeType}
                      onChange={(e) =>
                        updateOptions("outcomeType", e.target.value)
                      }
                      className="px-2 py-1 text-sm border border-slate-300 rounded
                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="continuous">Continuous</option>
                      <option value="binary">Binary</option>
                      <option value="count">Count</option>
                    </select>
                  </div>

                  {(options.outcomeType === "binary" ||
                    options.outcomeType === "count") && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-500">Baseline</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.001"
                        value={options.baseline}
                        onChange={(e) =>
                          updateOptions(
                            "baseline",
                            Math.max(0.001, parseFloat(e.target.value) || 0.001)
                          )
                        }
                        className="px-2 py-1 text-sm border border-slate-300 rounded
                                   focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
  <label className="text-xs text-slate-500 flex items-center gap-1">
    {teInfo.label}
    <div className="relative inline-block">
      <svg
        className="w-3.5 h-3.5 text-slate-400 cursor-help"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {showTooltip && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 
                        px-2 py-1 text-xs text-white bg-slate-800 rounded shadow-lg
                        whitespace-nowrap">
          {teInfo.tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 
                          border-4 border-transparent border-t-slate-800" />
        </div>
      )}
    </div>
  </label>
  <input
    type="number"
    step="0.1"
    value={options.treatmentEffect}
    placeholder={teInfo.placeholder}
    onChange={(e) =>
      updateOptions("treatmentEffect", parseFloat(e.target.value) || 0)
    }
    className="px-2 py-1 text-sm border border-slate-300 rounded
               focus:outline-none focus:ring-1 focus:ring-blue-500"
  />
</div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">ICC</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={options.icc}
                      onChange={(e) =>
                        updateOptions(
                          "icc",
                          Math.min(
                            1,
                            Math.max(0, parseFloat(e.target.value) || 0)
                          )
                        )
                      }
                      className="px-2 py-1 text-sm border border-slate-300 rounded
                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Estimator</label>
                    <select
                      value={options.estimator}
                      onChange={(e) =>
                        updateOptions("estimator", e.target.value)
                      }
                      className="px-2 py-1 text-sm border border-slate-300 rounded
               focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="mixed_model">Model-based</option>
                      <option value="mixed_model_ttest">
                        Model-based, t-test
                      </option>
                      <option value="satterthwaite">Satterthwaite</option>
                      <option value="kenward_roger">Kenward-Roger</option>
                      <option value="gee_independence_robust">
                        GEE Independence Robust
                      </option>
                    </select>
                  </div>

                  {numPeriods > 1 && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-500">
                          Sampling
                        </label>
                        <select
                          value={options.samplingStructure}
                          onChange={(e) =>
                            updateOptions("samplingStructure", e.target.value)
                          }
                          className="px-2 py-1 text-sm border border-slate-300 rounded
                                     focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="cross_section">Cross-section</option>
                          <option value="closed_cohort">Closed Cohort</option>
                          <option value="open_cohort">Open Cohort</option>
                        </select>
                      </div>

                      {(options.samplingStructure === "closed_cohort" ||
                        options.samplingStructure === "open_cohort") && (
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">IAC</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="1"
                            value={options.iac}
                            onChange={(e) =>
                              updateOptions(
                                "iac",
                                Math.min(
                                  1,
                                  Math.max(0, parseFloat(e.target.value) || 0)
                                )
                              )
                            }
                            className="px-2 py-1 text-sm border border-slate-300 rounded
                                       focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      {options.samplingStructure === "open_cohort" && (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-slate-500 flex items-center gap-1">
      Replacement Rate
      <div className="relative inline-block group">
        <svg
          className="w-3.5 h-3.5 text-slate-400 cursor-help"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 
                        px-2 py-1 text-xs text-white bg-slate-800 rounded shadow-lg
                        whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
          Proportion of individuals replaced each period (0 = closed, 1 = cross-sectional)
          <div className="absolute top-full left-1/2 -translate-x-1/2 
                          border-4 border-transparent border-t-slate-800" />
        </div>
      </div>
    </label>
    <input
      type="number"
      step="0.1"
      min="0"
      max="1"
      value={options.replacementRate ?? 0.5}
      onChange={(e) =>
        updateOptions(
          "replacementRate",
          Math.min(1, Math.max(0, parseFloat(e.target.value) || 0))
        )
      }
      className="px-2 py-1 text-sm border border-slate-300 rounded
                 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  </div>
)}

                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-500">
                          Correlation
                        </label>
                        <select
                          value={options.correlationStructure}
                          onChange={(e) =>
                            updateOptions(
                              "correlationStructure",
                              e.target.value
                            )
                          }
                          className="px-2 py-1 text-sm border border-slate-300 rounded
                                     focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="exchangeable">Exchangeable</option>
                          <option value="nested_exchangeable">
                            Nested Exch.
                          </option>
                          <option value="exponential_decay">Exp. Decay</option>
                          <option value="exponential_function">
                            Exp. Function
                          </option>
                        </select>
                      </div>

                      {options.correlationStructure !== "exchangeable" && (
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-500">
                            {options.correlationStructure ===
                            "nested_exchangeable"
                              ? "CAC"
                              : "Lengthscale"}
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.001"
                            value={options.temporalCorrelation}
                            onChange={(e) =>
                              updateOptions(
                                "temporalCorrelation",
                                Math.max(
                                  0.001,
                                  parseFloat(e.target.value) || 0.001
                                )
                              )
                            }
                            className="px-2 py-1 text-sm border border-slate-300 rounded
                                       focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Sample Size Options */}
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-700 mb-3">
                  Sample Size Options
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Mode</label>
                    <select
                      value={options.sampleSizeMode}
                      onChange={(e) =>
                        updateOptions("sampleSizeMode", e.target.value)
                      }
                      className="px-2 py-1 text-sm border border-slate-300 rounded
                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="fixed">Fixed Parameters</option>
                      <option value="exact">Exact Cell Sizes</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Mean Size</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={options.meanClusterSize}
                      onChange={(e) =>
                        updateOptions(
                          "meanClusterSize",
                          Math.max(1, parseInt(e.target.value) || 1)
                        )
                      }
                      className="px-2 py-1 text-sm border border-slate-300 rounded
                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {options.sampleSizeMode !== "exact" && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-500">
                        CV of Sizes
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={options.cvClusterSize}
                        onChange={(e) =>
                          updateOptions(
                            "cvClusterSize",
                            Math.max(0, parseFloat(e.target.value) || 0)
                          )
                        }
                        className="px-2 py-1 text-sm border border-slate-300 rounded
                                   focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>

                {options.sampleSizeMode === "exact" && (
                  <p className="text-xs text-slate-500 mt-2">
                    Right-click cells to set individual sizes
                  </p>
                )}

                {/* Summary Stats */}
                <div className="mt-3 pt-3 border-t border-slate-200 grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-lg font-bold text-slate-800">
                      {numSequences}
                    </div>
                    <div className="text-xs text-slate-500">Sequences</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-slate-800">
                      {numPeriods}
                    </div>
                    <div className="text-xs text-slate-500">Periods</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-blue-600">
                      {design.getTotalClusters()}
                    </div>
                    <div className="text-xs text-slate-500">Clusters</div>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Right Column: Results */}
          <div className="space-y-4">
            <ResultsTable
              designs={designs}
              cachedResults={cachedResults}
              isStale={resultsStale}
              isCalculating={isCalculating}
              onRecalculate={recalculateResults}
            />
  <PowerWarning 
  warning={powerWarning} 
  selectedEstimator={options.estimator}
  designName={activeDesign.name}
/>        
            <PlotArea
              designs={designs}
              activeIndex={activeIndex}
              cachedResults={cachedResults}
              isStale={resultsStale}
              isCalculating={isCalculating}
              cacheVersion={cacheVersion}
            />

              {/* Save & Load */}
<div className="bg-white rounded-xl shadow-lg border border-slate-200 p-4">
  <h2 className="text-sm font-semibold text-slate-700 mb-2">
    Save & Load
  </h2>
  <p className="text-xs text-slate-500 mb-3">
    Export your designs to a JSON file, or import a previously saved session.
  </p>
  <div className="flex gap-2">
    <button
      onClick={() => {
        const exportData = designs.map((d) => ({
          name: d.name,
          design: d.design.toJSON(),
          options: d.options,
          results: MathsInterface.calculateResults(d.design, d.options),
        }));
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'trial-designs.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }}
      className="flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium
                 hover:bg-slate-800 transition-colors"
    >
      Export
    </button>
    <button
      onClick={() => document.getElementById('import-file').click()}
      className="flex-1 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium
                 hover:bg-slate-50 transition-colors"
    >
      Import
    </button>
    <input
      id="import-file"
      type="file"
      accept=".json"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const importedData = JSON.parse(event.target.result);
            
            const newDesigns = importedData.map((item, idx) => ({
              name: item.name || `Design ${idx + 1}`,
              design: TrialDesign.fromJSON(item.design),
              options: { ...createDefaultOptions(), ...item.options },
            }));
            
            if (newDesigns.length > 0) {
              setDesigns(newDesigns);
              setActiveIndex(0);
              setResultsStale(true);
            }
          } catch (err) {
            console.error('Import failed:', err);
            alert('Failed to import file: ' + err.message);
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      }}
    />
  </div>
</div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);