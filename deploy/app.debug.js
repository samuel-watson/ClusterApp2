const { useState, useCallback, useRef, useEffect, useMemo } = React;
const {
  loadWasm,
  createWrapper,
  toWasmVector,
  fromWasmVector,
  EstimatorType
} = window.WasmLoader;
const CellStatus = {
  CONTROL: "control",
  INTERVENTION: "intervention",
  NOT_ENROLLED: "not_enrolled"
};
class DesignCell {
  constructor(status = CellStatus.CONTROL, sampleSize = null, clusterSize = null) {
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
      clusterSize: this.clusterSize
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
    var _a;
    return ((_a = this._grid[0]) == null ? void 0 : _a.length) || 0;
  }
  getCell(row, col) {
    if (row < 0 || row >= this.numSequences || col < 0 || col >= this.numPeriods) {
      return null;
    }
    return this._grid[row][col];
  }
  setCellStatus(row, col, status) {
    const cell = this.getCell(row, col);
    if (cell) cell.status = status;
  }
  getClusters(sequenceIndex) {
    var _a;
    return (_a = this._clustersPerSequence[sequenceIndex]) != null ? _a : 1;
  }
  setClusters(sequenceIndex, count) {
    if (sequenceIndex >= 0 && sequenceIndex < this.numSequences) {
      this._clustersPerSequence[sequenceIndex] = Math.max(1, Math.floor(count));
    }
  }
  insertSequence(index, cells = null) {
    const newRow = cells || Array(this.numPeriods).fill(null).map(() => new DesignCell());
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
      this._grid[sequenceIndex].forEach((cell) => cell.status = status);
    }
  }
  setAllInPeriod(periodIndex, status) {
    if (periodIndex >= 0 && periodIndex < this.numPeriods) {
      this._grid.forEach((row) => row[periodIndex].status = status);
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
      clustersPerSequence: this._clustersPerSequence
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
    const design2 = new TrialDesign(json.numSequences, json.numPeriods);
    design2._grid = json.grid.map(
      (row) => row.map((cell) => {
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
    if (json.clustersPerSequence) {
      design2._clustersPerSequence = [...json.clustersPerSequence];
    }
    return design2;
  }
  static createParallel(numSequences = 2, numPeriods = 1) {
    const design2 = new TrialDesign(numSequences, numPeriods);
    for (let i = 0; i < numSequences; i++) {
      const status = i < numSequences / 2 ? CellStatus.CONTROL : CellStatus.INTERVENTION;
      design2.setAllInSequence(i, status);
    }
    return design2;
  }
  static createSteppedWedge(numSequences = 4, numPeriods = 5) {
    const design2 = new TrialDesign(numSequences, numPeriods);
    for (let i = 0; i < numSequences; i++) {
      for (let j = 0; j < numPeriods; j++) {
        const switchPoint = i + 1;
        const status = j < switchPoint ? CellStatus.CONTROL : CellStatus.INTERVENTION;
        design2.setCellStatus(i, j, status);
      }
    }
    return design2;
  }
  static createCrossover(numSequences = 2, numPeriods = 2, includeWashout = false) {
    const actualPeriods = includeWashout ? numPeriods * 2 - 1 : numPeriods;
    const design2 = new TrialDesign(numSequences, actualPeriods);
    for (let i = 0; i < numSequences; i++) {
      let treatmentPhase = i % 2 === 0;
      for (let j = 0; j < actualPeriods; j++) {
        if (includeWashout && j > 0 && j % 2 === 1) {
          design2.setCellStatus(i, j, CellStatus.NOT_ENROLLED);
        } else {
          design2.setCellStatus(
            i,
            j,
            treatmentPhase ? CellStatus.INTERVENTION : CellStatus.CONTROL
          );
          treatmentPhase = !treatmentPhase;
        }
      }
    }
    return design2;
  }
  static createParallelBaseline(numSequences = 2, numPeriods = 2) {
    const design2 = new TrialDesign(numSequences, numPeriods);
    for (let i = 0; i < numSequences; i++) {
      for (let j = 0; j < numPeriods; j++) {
        if (j === 0) {
          design2.setCellStatus(i, j, CellStatus.CONTROL);
        } else {
          const status = i < numSequences / 2 ? CellStatus.CONTROL : CellStatus.INTERVENTION;
          design2.setCellStatus(i, j, status);
        }
      }
    }
    return design2;
  }
  static createSteppedWedgeImplementation(numSequences = 4, numPeriods = 6) {
    const design2 = new TrialDesign(numSequences, numPeriods);
    for (let i = 0; i < numSequences; i++) {
      for (let j = 0; j < numPeriods; j++) {
        const switchPoint = i + 1;
        let status;
        if (j < switchPoint) {
          status = CellStatus.CONTROL;
        } else if (j === switchPoint) {
          status = CellStatus.NOT_ENROLLED;
        } else {
          status = CellStatus.INTERVENTION;
        }
        design2.setCellStatus(i, j, status);
      }
    }
    return design2;
  }
  static createStaircase(numSequences = 4, numPeriods = 4) {
    const design2 = new TrialDesign(numSequences, numPeriods);
    for (let i = 0; i < numSequences; i++) {
      for (let j = 0; j < numPeriods; j++) {
        if (j === i) {
          design2.setCellStatus(i, j, CellStatus.CONTROL);
        } else if (j === i + 1) {
          design2.setCellStatus(i, j, CellStatus.INTERVENTION);
        } else {
          design2.setCellStatus(i, j, CellStatus.NOT_ENROLLED);
        }
      }
    }
    return design2;
  }
}
function normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
function tCDF(t, df) {
  if (df > 100) {
    return normalCDF(t);
  }
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) {
    const beta = bt * betaCF(x, a, b) / a;
    return t > 0 ? 1 - beta / 2 : beta / 2;
  } else {
    const beta = bt * betaCF(1 - x, b, a) / b;
    return t > 0 ? 1 - (1 - beta) / 2 : (1 - beta) / 2;
  }
}
function tQuantile(p, df) {
  if (df > 100) {
    return normalQuantile(p);
  }
  const z = normalQuantile(p);
  const z2 = z * z;
  const t = z + (z2 * z - 3 * z) / (4 * df) + (z2 * z2 * z - 10 * z2 * z + 9 * z) / (96 * df * df);
  return t;
}
function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239
  ];
  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572
  ];
  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783
  ];
  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}
function lgamma(x) {
  const cof = [
    76.18009172947146,
    -86.50532032941678,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -5395239384953e-18
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += cof[j] / ++y;
  }
  return -tmp + Math.log(2.5066282746310007 * ser / x);
}
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
let wasmReady = false;
const MathsInterface = {
  // Cache for GLMM wrapper objects (keyed by design ID)
  _modelCache: /* @__PURE__ */ new Map(),
  // Column names for data matrix
  _colnames: ["cl", "t", "n", "int", "int2", "int12", "control"],
  // Initialize the WASM module (call once at app startup)
  async initialize() {
    if (wasmReady) return true;
    try {
      await loadWasm();
      wasmReady = true;
      console.log("MathsInterface: WASM initialized");
      return true;
    } catch (err) {
      console.error("MathsInterface: Failed to initialize WASM:", err);
      return false;
    }
  },
  // Check if WASM is ready
  isReady() {
    return wasmReady;
  },
  _getDesignHash(design2, options2 = {}) {
    var _a, _b, _c, _d, _e;
    const grid = design2.getGrid();
    const structure = grid.map(
      (row) => row.map((cell) => cell.status === CellStatus.NOT_ENROLLED ? "0" : "1").join(",")
    ).join("|");
    const clusters = design2._clustersPerSequence.join(",");
    const totalClusters = design2._clustersPerSequence.reduce((a, b) => a + b, 0);
    const corrStructure = (_a = options2.correlationStructure) != null ? _a : "exchangeable";
    const samplingStructure = (_b = options2.samplingStructure) != null ? _b : "cross_section";
    const outcomeType = (_c = options2.outcomeType) != null ? _c : "continuous";
    const meanClusterSize = (_d = options2.meanClusterSize) != null ? _d : 20;
    const sampleSizeMode = (_e = options2.sampleSizeMode) != null ? _e : "fixed";
    const hash = `${design2.numSequences}-${design2.numPeriods}-${structure}-${clusters}-${totalClusters}-${corrStructure}-${samplingStructure}-${outcomeType}-${sampleSizeMode}-${meanClusterSize}`;
    console.log("_getDesignHash:", hash);
    return hash;
  },
  // Convert design to data matrix (matches C++ generate_data function)
  _generateDataMatrix(design2, options2) {
    var _a, _b, _c;
    const grid = design2.getGrid();
    const numSequences = design2.numSequences;
    const numPeriods = design2.numPeriods;
    const data = [];
    let clNumber = 1;
    for (let i = 0; i < numSequences; i++) {
      const nClusters = design2.getClusters(i);
      for (let j = 0; j < nClusters; j++) {
        for (let t = 0; t < numPeriods; t++) {
          const cell = grid[i][t];
          if (cell.status !== CellStatus.NOT_ENROLLED) {
            const isIntervention = cell.status === CellStatus.INTERVENTION ? 1 : 0;
            const clusterPeriodSize = options2.sampleSizeMode === "exact" ? (_b = (_a = cell.sampleSize) != null ? _a : options2.meanClusterSize) != null ? _b : 20 : (_c = options2.meanClusterSize) != null ? _c : 20;
            const row = [
              clNumber,
              // cl: cluster number
              t + 1,
              // t: time period (1-indexed)
              clusterPeriodSize,
              // n: cluster-period size
              isIntervention,
              // int: intervention indicator
              0,
              // int2: second intervention (not used currently)
              0,
              // int12: interaction (int * int2)
              1 - isIntervention
              // control: control indicator
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
  _buildFormula(design2, options2) {
    let formula = "int";
    const reString = options2.heterogeneousTe ? "int" : "1";
    if (options2.twoTreatments) {
      formula += "+int2+int12";
    }
    if (design2.numPeriods > 1) {
      if (options2.timeEffect === "linear") {
        formula += "+t";
      } else {
        formula += "+factor(t)";
      }
    }
    switch (options2.correlationStructure) {
      case "exchangeable":
        formula += `+(${reString}|gr(cl))`;
        if (options2.heterogeneousTe) formula += "+(control|gr(cl))";
        break;
      case "nested_exchangeable":
        formula += `+(${reString}|gr(cl))+(${reString}|gr(cl,t))`;
        if (options2.heterogeneousTe) formula += "+(control|gr(cl))+(control|gr(cl,t))";
        break;
      case "exponential_decay":
        formula += `+(${reString}|gr(cl)*ar0(t))`;
        if (options2.heterogeneousTe) formula += "+(control|gr(cl)*ar0(t))";
        break;
      case "exponential_function":
        formula += `+(${reString}|gr(cl)*fexp0(t))`;
        if (options2.heterogeneousTe) formula += "+(control|gr(cl)*fexp0(t))";
        break;
      default:
        formula += `+(${reString}|gr(cl))`;
    }
    if (options2.samplingStructure === "closed_cohort") {
      formula += "+(1|gr(cl))";
    } else if (options2.samplingStructure === "open_cohort") {
      formula += "+(1|gr(cl)*ar0(t))";
    }
    return formula;
  },
  // Get family string from outcome type
  _getFamily(outcomeType) {
    switch (outcomeType) {
      case "binary":
        return "binomial";
      case "count":
        return "poisson";
      default:
        return "gaussian";
    }
  },
  // Get link function from outcome type
  _getLink(outcomeType) {
    switch (outcomeType) {
      case "binary":
        return "logit";
      case "count":
        return "log";
      default:
        return "identity";
    }
  },
  // Get estimator code from string
  _getEstimatorCode(estimator) {
    var _a;
    return (_a = EstimatorType[estimator]) != null ? _a : EstimatorType.mixed_model;
  },
  _getCorrelationStructure(correlationStructure) {
    const valid = ["exchangeable", "nested_exchangeable", "exponential_decay", "exponential_function"];
    if (valid.includes(correlationStructure)) {
      return correlationStructure;
    }
    console.warn("Unknown correlation structure:", correlationStructure);
    return "exchangeable";
  },
  _getSamplingStructure(samplingStructure) {
    switch (samplingStructure) {
      case "cross_section":
        return "cross_section";
      case "closed_cohort":
        return "closed_cohort";
      case "open_cohort":
        return "open_cohort";
      default:
        return "cross_section";
    }
  },
  // Calculate mean cluster-period size from data matrix
  _getMeanN(dataMatrix) {
    if (dataMatrix.length === 0) return 20;
    const totalN = dataMatrix.reduce((sum, row) => sum + row[2], 0);
    return totalN / dataMatrix.length;
  },
  // Create or retrieve WASM wrapper for a design
  _getWrapper(designId, design2, options2) {
    var _a, _b, _c, _d, _e;
    console.log("=== _getWrapper START ===");
    console.log("designId:", designId);
    if (!wasmReady) {
      throw new Error("WASM not initialized");
    }
    const hash = this._getDesignHash(design2, options2);
    const cached = this._modelCache.get(designId);
    console.log("=== _getWrapper ===");
    console.log("designId:", designId);
    console.log("computed hash:", hash);
    console.log("cached entry exists:", !!cached);
    console.log("cached hash:", cached == null ? void 0 : cached.hash);
    console.log("hashes match:", (cached == null ? void 0 : cached.hash) === hash);
    console.log("will rebuild:", !cached || cached.hash !== hash);
    if (cached && cached.hash === hash) {
      console.log("Reusing cached wrapper");
      this._updateWrapperParameters(cached.wrapper, options2, cached.meanN, design2.numPeriods);
      return cached.wrapper;
    }
    console.log("Building new wrapper...");
    const dataMatrix = this._generateDataMatrix(design2, options2);
    console.log("dataMatrix rows:", dataMatrix.length);
    console.log("dataMatrix cols:", (_a = dataMatrix[0]) == null ? void 0 : _a.length);
    const formula = this._buildFormula(design2, options2);
    const family = this._getFamily(options2.outcomeType);
    const link = this._getLink(options2.outcomeType);
    const corrStructure = this._getCorrelationStructure(options2.correlationStructure);
    const samplingStructure = this._getSamplingStructure(options2.samplingStructure);
    const meanN = this._getMeanN(dataMatrix);
    console.log("formula:", formula);
    console.log("family:", family, "link:", link);
    console.log("corrStructure:", corrStructure);
    console.log("samplingStructure:", samplingStructure);
    console.log("meanN:", meanN);
    if (cached && cached.wrapper) {
      console.log("Deleting old wrapper");
      cached.wrapper.delete();
    }
    const wrapper = createWrapper();
    console.log("Wrapper created, now initializing...");
    const flatData = dataMatrix.flat();
    const nRows = dataMatrix.length;
    const nCols = (_c = (_b = dataMatrix[0]) == null ? void 0 : _b.length) != null ? _c : 7;
    console.log("nRows:", nRows, "nCols:", nCols, "flatData length:", flatData.length);
    const wasmData = toWasmVector(flatData);
    try {
      console.log("About to call wrapper.initialize with:");
      console.log("  formula:", formula);
      console.log("  nRows:", nRows, "nCols:", nCols);
      console.log("  family:", family, "link:", link);
      console.log("  corrStructure:", corrStructure);
      console.log("  samplingStructure:", samplingStructure);
      const success = wrapper.initialize(
        formula,
        wasmData,
        nRows,
        nCols,
        family,
        link,
        corrStructure,
        samplingStructure
      );
      console.log("initialize returned:", success);
      if (!success) {
        const error = wrapper.getLastError();
        console.error("WASM initialize failed:", error);
        throw new Error(`Model initialization failed: ${error}`);
      }
      console.log("Setting alpha...");
      wrapper.setAlpha((_d = options2.alpha) != null ? _d : 0.05);
      console.log("Setting target power...");
      wrapper.setTargetPower((_e = options2.targetPower) != null ? _e : 0.8);
      console.log("Setting include intercept...");
      wrapper.setIncludeIntercept(options2.includeIntercept !== false);
      console.log("Calling _updateWrapperParameters...");
      this._updateWrapperParameters(wrapper, options2, meanN, design2.numPeriods);
      console.log("Caching wrapper...");
      this._modelCache.set(designId, { hash, wrapper, meanN, dataMatrix });
      console.log("_getWrapper complete");
      return wrapper;
    } finally {
      wasmData.delete();
    }
  },
  // Transform parameters to link scale
  _transformToLinkScale(baseline, treatmentEffect, outcomeType) {
    switch (outcomeType) {
      case "binary": {
        const p0 = Math.max(1e-3, Math.min(0.999, baseline));
        const p1 = Math.max(1e-3, Math.min(0.999, baseline + treatmentEffect));
        const baselineLink = Math.log(p0 / (1 - p0));
        const teLink = Math.log(p1 / (1 - p1)) - baselineLink;
        return { baselineLink, teLink };
      }
      case "count": {
        const mu = Math.max(1e-3, baseline);
        const baselineLink = Math.log(mu);
        const teLink = Math.log(treatmentEffect);
        return { baselineLink, teLink };
      }
      default: {
        return { baselineLink: baseline, teLink: treatmentEffect };
      }
    }
  },
  _updateWrapperParameters(wrapper, options2, meanN, numPeriods) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    console.log("=== _updateWrapperParameters START ===");
    if (!wrapper) {
      console.error("_updateWrapperParameters called with undefined wrapper");
      return;
    }
    const icc = (_a = options2.icc) != null ? _a : 0.05;
    const iac = (_b = options2.iac) != null ? _b : 0.8;
    const cacOrLengthscale = (_d = (_c = options2.temporalCorrelation) != null ? _c : options2.cac) != null ? _d : 0.8;
    const te = (_e = options2.treatmentEffect) != null ? _e : 0.5;
    const baseline = (_f = options2.baseline) != null ? _f : 0.5;
    const clusterSize = (_g = options2.meanClusterSize) != null ? _g : 20;
    const outcomeType = (_h = options2.outcomeType) != null ? _h : "continuous";
    const replacementRate = (_i = options2.replacementRate) != null ? _i : 1;
    console.log("Parameters:", { icc, iac, cacOrLengthscale, te, baseline, clusterSize, outcomeType, replacementRate, numPeriods });
    const { baselineLink, teLink } = this._transformToLinkScale(baseline, te, outcomeType);
    console.log("Transformed:", { baselineLink, teLink });
    console.log("Calling setTreatmentEffect...");
    wrapper.setTreatmentEffect(teLink);
    console.log("Calling setAlpha...");
    wrapper.setAlpha((_j = options2.alpha) != null ? _j : 0.05);
    console.log("Calling setTargetPower...");
    wrapper.setTargetPower((_k = options2.targetPower) != null ? _k : 0.8);
    console.log("Calling setIncludeIntercept...");
    wrapper.setIncludeIntercept(options2.includeIntercept !== false);
    console.log("Calling updateWeights...");
    wrapper.updateWeights(clusterSize);
    console.log("Calling updateParameters...");
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
    console.log("=== _updateWrapperParameters COMPLETE ===");
  },
  // === PUBLIC API ===
  getVerificationBundle(design2, options2, designId = "_verify") {
    var _a;
    if (!wasmReady) {
      throw new Error("WASM not initialized");
    }
    const tempId = "_verify_export";
    const oldCached = this._modelCache.get(tempId);
    if (oldCached && oldCached.wrapper) {
      oldCached.wrapper.delete();
      this._modelCache.delete(tempId);
    }
    const wrapper = this._getWrapper(tempId, design2, options2);
    const estimatorCode = this._getEstimatorCode(options2.estimator);
    const cv = options2.sampleSizeMode === "exact" ? 0 : (_a = options2.cvClusterSize) != null ? _a : 0;
    const raw = wrapper.getVerificationBundle(estimatorCode, cv);
    const convertMatrix = (me) => {
      if (!me || me.rows === 0 || me.cols === 0) return null;
      const size = me.data.size();
      if (size !== me.rows * me.cols) {
        console.warn(`Matrix dimension mismatch: ${me.rows}\xD7${me.cols} but data has ${size} elements`);
        return null;
      }
      const flatData = [];
      for (let i = 0; i < size; i++) flatData.push(me.data.get(i));
      const matrix = [];
      for (let i = 0; i < me.rows; i++) {
        matrix.push(flatData.slice(i * me.cols, (i + 1) * me.cols));
      }
      return { data: matrix, rows: me.rows, cols: me.cols, label: me.label };
    };
    const convertVector = (v) => {
      const arr = [];
      for (let i = 0; i < v.size(); i++) arr.push(v.get(i));
      return arr;
    };
    const result = {
      X: convertMatrix(raw.X),
      Sigma: convertMatrix(raw.Sigma),
      M: convertMatrix(raw.M),
      Minv: convertMatrix(raw.Minv),
      bread: convertMatrix(raw.bread),
      meat: convertMatrix(raw.meat),
      V_working: convertMatrix(raw.V_working),
      Sigma_true: convertMatrix(raw.Sigma_true),
      beta: convertVector(raw.beta),
      theta: convertVector(raw.theta),
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
      error: raw.error,
      dataMatrix: this._generateDataMatrix(design2, options2),
      numSequences: design2.numSequences,
      numPeriods: design2.numPeriods,
      totalClusters: design2.getTotalClusters(),
      clustersPerSequence: [...design2._clustersPerSequence],
      target_icc: raw.target_icc,
      target_iac: raw.target_iac,
      target_baseline: raw.target_baseline,
      target_baseline_trt: raw.target_baseline_trt,
      achieved_icc: raw.achieved_icc,
      achieved_iac: raw.achieved_iac,
      achieved_baseline: raw.achieved_baseline,
      achieved_baseline_trt: raw.achieved_baseline_trt,
      raw_sigma_c: raw.raw_sigma_c,
      raw_sigma_p: raw.raw_sigma_p,
      solver_iterations: raw.solver_iterations,
      solver_converged: raw.solver_converged,
      correlation_warning: raw.correlation_warning
    };
    const cached = this._modelCache.get(tempId);
    if (cached && cached.wrapper) {
      cached.wrapper.delete();
    }
    this._modelCache.delete(tempId);
    return result;
  },
  getCorrelationWarning(designId = "default") {
    if (!wasmReady) {
      return 0;
    }
    const cached = this._modelCache.get(designId);
    if (!cached || !cached.wrapper) {
      return 0;
    }
    const result = cached.wrapper.getCorrelationWarning();
    return result;
  },
  calculateResults(design2, options2, designId = "default") {
    var _a;
    if (!wasmReady) {
      return {
        power: "---",
        dof: "---",
        se: "---",
        mde: "---",
        ciWidth: "---",
        error: "WASM loading..."
      };
    }
    try {
      const wrapper = this._getWrapper(designId, design2, options2);
      console.log("Got wrapper, calling calculatePower...");
      const estimatorCode = this._getEstimatorCode(options2.estimator);
      console.log("estimatorCode:", estimatorCode);
      const cv = options2.sampleSizeMode === "exact" ? 0 : (_a = options2.cvClusterSize) != null ? _a : 0;
      const result = wrapper.calculatePower(estimatorCode, cv);
      console.log("calculatePower returned:", result);
      if (!result.valid) {
        console.warn("Power calculation warning:", result.error);
        return {
          power: "N/A",
          dof: "N/A",
          se: "N/A",
          mde: "N/A",
          ciWidth: "N/A",
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
      console.error("calculateResults error:", err);
      return {
        power: "Error",
        dof: "Error",
        se: "Error",
        mde: "Error",
        ciWidth: "Error",
        error: err.message
      };
    }
  },
  calculateResultsWithClusters(design2, options2, totalClusters) {
    console.log("=== calculateResultsWithClusters START ===");
    console.log("totalClusters:", totalClusters);
    console.log("correlationStructure:", options2.correlationStructure);
    console.log("samplingStructure:", options2.samplingStructure);
    const originalClusters = [...design2._clustersPerSequence];
    const currentTotal = design2.getTotalClusters();
    const scale = totalClusters / currentTotal;
    const newClusters = originalClusters.map((c) => Math.max(1, Math.round(c * scale)));
    console.log("originalClusters:", originalClusters);
    console.log("newClusters:", newClusters);
    console.log("scale:", scale);
    console.log("actual total after scaling:", newClusters.reduce((a, b) => a + b, 0));
    design2._clustersPerSequence = newClusters;
    const tempId = `_plot_clusters_${totalClusters}`;
    console.log("tempId:", tempId);
    try {
      const result = this.calculateResults(design2, options2, tempId);
      design2._clustersPerSequence = originalClusters;
      return result;
    } catch (err) {
      console.error("calculateResultsWithClusters error:", err);
      design2._clustersPerSequence = originalClusters;
      throw err;
    }
  },
  calculateSampleSize(design2, meanClusterSize) {
    const grid = design2.getGrid();
    for (let i = 0; i < design2.numSequences; i++) {
      for (let j = 0; j < design2.numPeriods; j++) {
        const cell = grid[i][j];
        if (cell.status !== CellStatus.NOT_ENROLLED) {
          cell.sampleSize = meanClusterSize;
        }
      }
    }
  },
  clearPlotCache() {
    for (const [key, cached] of this._modelCache) {
      if (key.startsWith("_plot_")) {
        if (cached.wrapper) {
          cached.wrapper.delete();
        }
        this._modelCache.delete(key);
      }
    }
  },
  calculateOptimalSequenceWeights(design2, options2 = {}) {
    var _a, _b;
    if (!wasmReady) {
      const n = design2.numSequences;
      return Array(n).fill(1 / n);
    }
    const originalClusters = [...design2._clustersPerSequence];
    design2._clustersPerSequence = Array(design2.numSequences).fill(1);
    const tempId = "_seq_weights_canonical";
    try {
      const wrapper = this._getWrapper(tempId, design2, options2);
      const sequenceMembership = [];
      const grid = design2.getGrid();
      for (let seq = 0; seq < design2.numSequences; seq++) {
        for (let t = 0; t < design2.numPeriods; t++) {
          const cell = grid[seq][t];
          if (cell.status !== CellStatus.NOT_ENROLLED) {
            sequenceMembership.push(seq);
          }
        }
      }
      const wasmSeqMem = toWasmVector(sequenceMembership);
      const maxIter = (_a = options2.weightIterations) != null ? _a : 100;
      const tol = (_b = options2.weightTolerance) != null ? _b : 1e-6;
      const result = wrapper.calculateOptimalSequenceWeights(wasmSeqMem, maxIter, tol);
      wasmSeqMem.delete();
      if (!result.valid) {
        console.warn("Optimal sequence weights failed:", result.error);
        design2._clustersPerSequence = originalClusters;
        const n = design2.numSequences;
        return Array(n).fill(1 / n);
      }
      design2._clustersPerSequence = originalClusters;
      if (!result.valid) {
        console.warn("Optimal sequence weights failed:", result.error);
        const n = design2.numSequences;
        return Array(n).fill(1 / n);
      }
      console.log(`Optimal sequence weights converged in ${result.iterations} iterations`);
      const weights = fromWasmVector(result.weights);
      console.log("Sequence weights (raw):", weights);
      const maxW = Math.max(...weights);
      const normalized = maxW > 0 ? weights.map((w) => w / maxW) : weights;
      console.log("Sequence weights (normalized to max=1):", normalized);
      return weights;
    } catch (err) {
      console.error("calculateOptimalSequenceWeights error:", err);
      design2._clustersPerSequence = originalClusters;
      const n = design2.numSequences;
      return Array(n).fill(1 / n);
    }
  },
  calculateOptimalWeights(design2, options2 = {}) {
    var _a;
    if (!wasmReady) {
      return this._getFallbackWeights(design2);
    }
    try {
      const wrapper = this._getWrapper("_weights", design2, options2);
      const N = (_a = options2.weightIterations) != null ? _a : 100;
      const wasmWeights = wrapper.calculateOptimalWeights(N);
      const flatWeights = fromWasmVector(wasmWeights);
      const grid = design2.getGrid();
      const numSequences = design2.numSequences;
      const numPeriods = design2.numPeriods;
      const weights = [];
      let weightIdx = 0;
      for (let i = 0; i < numSequences; i++) {
        const nClusters = design2.getClusters(i);
        const row = [];
        for (let j = 0; j < numPeriods; j++) {
          const cell = grid[i][j];
          if (cell.status === CellStatus.NOT_ENROLLED) {
            row.push(0);
          } else {
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
      console.error("calculateOptimalWeights error:", err);
      return this._getFallbackWeights(design2);
    }
  },
  // Fallback weights when WASM fails
  _getFallbackWeights(design2) {
    const grid = design2.getGrid();
    const weights = [];
    const numPeriods = design2.numPeriods;
    const numSequences = design2.numSequences;
    for (let i = 0; i < numSequences; i++) {
      const row = [];
      for (let j = 0; j < numPeriods; j++) {
        const cell = grid[i][j];
        if (cell.status === CellStatus.NOT_ENROLLED) {
          row.push(0);
        } else {
          const seqCenter = (numSequences - 1) / 2;
          const perCenter = (numPeriods - 1) / 2;
          const seqDist = 1 - Math.abs(i - seqCenter) / numSequences;
          const perDist = 1 - Math.abs(j - perCenter) / numPeriods;
          row.push(0.3 + 0.7 * seqDist * perDist);
        }
      }
      weights.push(row);
    }
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
    for (const [, cached] of this._modelCache) {
      if (cached.wrapper) {
        cached.wrapper.delete();
      }
    }
    this._modelCache.clear();
  },
  // Debug: get generated data and formula
  debug(design2, options2) {
    const dataMatrix = this._generateDataMatrix(design2, options2);
    return {
      dataMatrix,
      formula: this._buildFormula(design2, options2),
      family: this._getFamily(options2.outcomeType),
      link: this._getLink(options2.outcomeType),
      colnames: this._colnames,
      meanN: this._getMeanN(dataMatrix),
      hash: this._getDesignHash(design2)
    };
  },
  // Get wrapper info for debugging
  getWrapperInfo(designId = "default") {
    if (!wasmReady) {
      throw new Error("WASM not initialized. Call MathsInterface.initialize() first.");
    }
    const hash = this._getDesignHash(design);
    const cached = this._modelCache.get(designId);
    console.log("_getWrapper:", { designId, hash, hasCached: !!cached, cachedHash: cached == null ? void 0 : cached.hash });
    if (cached && cached.hash === hash) {
      console.log("Reusing cached wrapper, updating parameters...");
      this._updateWrapperParameters(cached.wrapper, options, cached.meanN, design.numPeriods);
      return cached.wrapper;
    }
    console.log("Creating new wrapper...");
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
  outcomeType: "continuous",
  // 'continuous', 'binary', 'count'
  // Treatment effect
  treatmentEffect: 0.5,
  baseline: 0.5,
  // Cluster parameters
  meanClusterSize: 20,
  cvClusterSize: 0,
  // Correlation parameters
  icc: 0.05,
  iac: 0,
  cac: 0.8,
  temporalCorrelation: 0.8,
  replacementRate: 0.5,
  // Structure
  correlationStructure: "exchangeable",
  // 'exchangeable', 'nested_exchangeable', 'exponential_decay', 'autoregressive'
  samplingStructure: "cross_section",
  // 'cross_section', 'closed_cohort', 'open_cohort'
  individualCovariance: "exchangeable",
  // Analysis
  estimator: "mixed_model",
  // 'mixed_model', 'mixed_model_ttest', 'satterthwaite', 'kenward_roger', 'gee_independence', 'gee_independence_robust'
  alpha: 0.05,
  targetPower: 0.8,
  // Model
  includeIntercept: true,
  timeEffect: "fixed_effects",
  // 'fixed_effects', 'linear'
  heterogeneousTe: false,
  twoTreatments: false
});
const createDesignEntry = (name, preset = "parallel") => {
  let design2;
  switch (preset) {
    case "parallel":
      design2 = TrialDesign.createParallel(2, 1);
      design2._clustersPerSequence = design2._clustersPerSequence.map(() => 10);
      break;
    case "parallel-baseline":
      design2 = TrialDesign.createParallelBaseline(2, 2);
      break;
    case "stepped-wedge":
      design2 = TrialDesign.createSteppedWedge(4, 5);
      break;
    case "stepped-wedge-implementation":
      design2 = TrialDesign.createSteppedWedgeImplementation(4, 6);
      break;
    case "crossover":
      design2 = TrialDesign.createCrossover(2, 2, false);
      break;
    case "crossover-washout":
      design2 = TrialDesign.createCrossover(2, 2, true);
      break;
    case "staircase":
      design2 = TrialDesign.createStaircase(4, 5);
      break;
    default:
      design2 = TrialDesign.createSteppedWedge(4, 5);
  }
  MathsInterface.calculateSampleSize(design2, 20);
  return {
    name,
    design: design2,
    options: createDefaultOptions()
  };
};
const statusConfig = {
  [CellStatus.CONTROL]: {
    label: "Control",
    shortLabel: "C",
    bg: "bg-slate-100",
    border: "border-slate-300",
    text: "text-slate-700",
    hoverBg: "hover:bg-slate-200"
  },
  [CellStatus.INTERVENTION]: {
    label: "Intervention",
    shortLabel: "I",
    bg: "bg-emerald-100",
    border: "border-emerald-400",
    text: "text-emerald-800",
    hoverBg: "hover:bg-emerald-200"
  },
  [CellStatus.NOT_ENROLLED]: {
    label: "Not enrolled",
    shortLabel: "\u2014",
    bg: "bg-gray-50",
    border: "border-gray-200",
    text: "text-gray-400",
    hoverBg: "hover:bg-gray-100"
  }
};
const statusCycle = [
  CellStatus.CONTROL,
  CellStatus.INTERVENTION,
  CellStatus.NOT_ENROLLED
];
const designColors = [
  {
    bg: "bg-blue-500",
    text: "text-blue-600",
    light: "bg-blue-50",
    border: "border-blue-500",
    hex: "#3b82f6"
  },
  {
    bg: "bg-purple-500",
    text: "text-purple-600",
    light: "bg-purple-50",
    border: "border-purple-500",
    hex: "#a855f7"
  },
  {
    bg: "bg-orange-500",
    text: "text-orange-600",
    light: "bg-orange-50",
    border: "border-orange-500",
    hex: "#f97316"
  }
];
const NumericInput = ({ value, onChange, min, max, step, className }) => {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);
  return /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      step,
      min,
      max,
      value: focused ? raw : value,
      onChange: (e) => setRaw(e.target.value),
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false);
        const parsed = parseFloat(raw);
        if (isNaN(parsed)) {
          onChange(min != null ? min : 0);
        } else {
          let clamped = parsed;
          if (min != null) clamped = Math.max(min, clamped);
          if (max != null) clamped = Math.min(max, clamped);
          onChange(clamped);
        }
      },
      className
    }
  );
};
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
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      ref: menuRef,
      className: "fixed bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 min-w-[160px]",
      style: { left: x, top: y }
    },
    items.map(
      (item, idx) => item.separator ? /* @__PURE__ */ React.createElement("div", { key: idx, className: "h-px bg-slate-200 my-1" }) : /* @__PURE__ */ React.createElement(
        "button",
        {
          key: idx,
          onClick: () => {
            item.action();
            onClose();
          },
          disabled: item.disabled,
          className: `w-full text-left px-3 py-1.5 text-sm
              ${item.disabled ? "text-slate-300 cursor-not-allowed" : "text-slate-700 hover:bg-slate-100"}
              ${item.danger && !item.disabled ? "text-red-600 hover:bg-red-50" : ""}
            `
        },
        item.label
      )
    )
  );
};
const InsertButton = ({ onClick, className = "" }) => /* @__PURE__ */ React.createElement(
  "button",
  {
    onClick,
    className: `
      flex items-center justify-center
      bg-blue-500 text-white rounded-full
      opacity-0 group-hover:opacity-100 focus:opacity-100
      transition-opacity duration-150
      shadow-sm hover:shadow-md hover:bg-blue-600
      focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1
      w-4 h-4 text-xs
      ${className}
    `
  },
  "+"
);
const PeriodHeader = ({ index, onContextMenu, cellSize }) => /* @__PURE__ */ React.createElement(
  "div",
  {
    className: "flex items-center justify-center font-medium text-slate-600 text-sm \r\n               cursor-context-menu select-none hover:bg-slate-100 rounded transition-colors",
    style: { width: cellSize, height: 32 },
    onContextMenu: (e) => {
      e.preventDefault();
      onContextMenu(e, index);
    },
    title: "Right-click for options"
  },
  "T",
  index
);
const SequenceHeader = ({
  index,
  clusters,
  onClustersChange,
  onContextMenu,
  cellSize
}) => /* @__PURE__ */ React.createElement(
  "div",
  {
    className: "flex items-center justify-end gap-2 pr-2",
    style: { width: 100, height: cellSize }
  },
  /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "1",
      value: clusters,
      onChange: (e) => onClustersChange(index, parseInt(e.target.value) || 1),
      className: "w-12 px-1 py-0.5 text-sm text-center border border-slate-300 rounded\r\n                 focus:outline-none focus:ring-1 focus:ring-blue-500",
      title: "Number of clusters"
    }
  ),
  /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "font-medium text-slate-600 text-sm cursor-context-menu select-none \r\n                 hover:bg-slate-100 rounded px-1 transition-colors",
      onContextMenu: (e) => {
        e.preventDefault();
        onContextMenu(e, index);
      },
      title: "Right-click for options"
    },
    "Seq ",
    index + 1
  )
);
const DesignCellComponent = ({
  cell,
  rowIndex,
  colIndex,
  onClick,
  onContextMenu,
  cellSize,
  sampleSizeMode,
  scale = 1
}) => {
  const config = statusConfig[cell.status];
  const scaledSize = cellSize * (0.4 + 0.6 * scale);
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "flex items-center justify-center",
      style: { width: cellSize, height: cellSize }
    },
    /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onClick(rowIndex, colIndex),
        onContextMenu: (e) => onContextMenu(e, rowIndex, colIndex),
        className: `
          ${config.bg} ${config.border} ${config.text} ${config.hoverBg}
          border-2 rounded-lg transition-all duration-300 ease-in-out
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
          flex flex-col items-center justify-center
        `,
        style: {
          width: scaledSize,
          height: scaledSize,
          fontSize: `${Math.max(0.6, scale) * 100}%`
        },
        title: `${config.label}${sampleSizeMode === "exact" && cell.sampleSize ? ` (n=${cell.sampleSize})` : ""}${scale < 1 ? ` (weight: ${(scale * 100).toFixed(0)}%)` : ""}${sampleSizeMode === "exact" && cell.status !== CellStatus.NOT_ENROLLED ? " \u2014 Right-click to set size" : ""}`
      },
      sampleSizeMode === "exact" && cell.sampleSize !== null && cell.status !== CellStatus.NOT_ENROLLED && /* @__PURE__ */ React.createElement("span", { className: "font-semibold text-sm" }, "n=", cell.sampleSize),
      /* @__PURE__ */ React.createElement("span", { className: "text-[10px] uppercase tracking-wide opacity-70" }, config.shortLabel)
    )
  );
};
const ResultsTable = ({
  designs,
  cachedResults,
  isStale,
  isCalculating,
  onRecalculate
}) => {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `bg-white rounded-xl shadow-lg border border-slate-200 p-4 transition-opacity ${isStale ? "opacity-60" : ""}`
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-3" }, /* @__PURE__ */ React.createElement("h2", { className: "text-sm font-semibold text-slate-700" }, "Results Comparison"), isStale && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: onRecalculate,
        disabled: isCalculating,
        className: "px-3 py-1 text-xs bg-blue-500 text-white rounded-lg\r\n                       hover:bg-blue-600 disabled:bg-blue-300 transition-colors\r\n                       flex items-center gap-1"
      },
      isCalculating ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "animate-spin" }, "\u27F3"), " Calculating...") : /* @__PURE__ */ React.createElement(React.Fragment, null, "\u27F3 Recalculate")
    )),
    /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "w-full text-sm" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "border-b border-slate-200" }, /* @__PURE__ */ React.createElement("th", { className: "text-left py-2 px-3 font-medium text-slate-600" }, "Metric"), designs.map((d, i) => /* @__PURE__ */ React.createElement(
      "th",
      {
        key: i,
        className: `text-center py-2 px-3 font-medium ${designColors[i].text}`
      },
      d.name
    )))), /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", { className: "border-b border-slate-100" }, /* @__PURE__ */ React.createElement("td", { className: "py-2 px-3 text-slate-600" }, "Power"), cachedResults.map((r, i) => /* @__PURE__ */ React.createElement("td", { key: i, className: "text-center py-2 px-3 font-mono" }, r.power))), /* @__PURE__ */ React.createElement("tr", { className: "border-b border-slate-100" }, /* @__PURE__ */ React.createElement("td", { className: "py-2 px-3 text-slate-600" }, "Degrees of Freedom"), cachedResults.map((r, i) => /* @__PURE__ */ React.createElement("td", { key: i, className: "text-center py-2 px-3 font-mono" }, r.dof))), /* @__PURE__ */ React.createElement("tr", { className: "border-b border-slate-100" }, /* @__PURE__ */ React.createElement("td", { className: "py-2 px-3 text-slate-600" }, "Standard Error"), cachedResults.map((r, i) => /* @__PURE__ */ React.createElement("td", { key: i, className: "text-center py-2 px-3 font-mono" }, r.se))), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "py-2 px-3 text-slate-600" }, "Min. Detectable Effect"), cachedResults.map((r, i) => /* @__PURE__ */ React.createElement("td", { key: i, className: "text-center py-2 px-3 font-mono" }, r.mde)))))),
    isStale && !isCalculating && /* @__PURE__ */ React.createElement("p", { className: "text-xs text-amber-600 mt-2 text-center" }, "\u26A0 Results are outdated. Click Recalculate to update.")
  );
};
const PowerWarning = ({ warning, selectedEstimator, designName }) => {
  if (!warning) return null;
  const estimatorLabels = {
    mixed_model: "Model-based",
    mixed_model_ttest: "Model-based t-test",
    satterthwaite: "Satterthwaite",
    kenward_roger: "Kenward-Roger",
    gee_independence: "GEE Independence",
    gee_independence_robust: "GEE Independence Robust",
    gee_exchangeable: "GEE Exchangeable Robust",
    gee_exchangeable_ttest: "GEE Exchangeable Robust t-test",
    design_effect: "Design Effect",
    design_effect_ttest: "Design Effect t-test"
  };
  const isRobust = ["gee_exchangeable", "gee_independence_robust", "gee_exchangeable_ttest"].includes(selectedEstimator);
  const isSmallSampleCorrected = ["satterthwaite", "kenward_roger", "mixed_model_ttest", "gee_exchangeable_ttest", "design_effect_ttest"].includes(selectedEstimator);
  return /* @__PURE__ */ React.createElement("div", { className: "bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-start gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-amber-600 text-lg" }, "\u26A0\uFE0F"), /* @__PURE__ */ React.createElement("div", { className: "flex-1" }, /* @__PURE__ */ React.createElement("p", { className: "font-medium text-amber-800 mb-2" }, "Power estimate may be optimistic"), /* @__PURE__ */ React.createElement("p", { className: "text-amber-700 mb-2" }, "The selected estimator for ", designName, " (", estimatorLabels[selectedEstimator], ") shows power of", " ", /* @__PURE__ */ React.createElement("span", { className: "font-mono font-semibold" }, (warning.selectedPower * 100).toFixed(1), "%"), ", which is more than 10 percentage points higher than", " ", warning.lowEstimators.length === 1 ? estimatorLabels[warning.lowEstimators[0].key] : `${warning.lowEstimators.length} other estimators`, " ", "(lowest: ", /* @__PURE__ */ React.createElement("span", { className: "font-mono font-semibold" }, (warning.minOtherPower * 100).toFixed(1), "%"), ")."), /* @__PURE__ */ React.createElement("p", { className: "text-amber-700" }, !isSmallSampleCorrected && !isRobust && /* @__PURE__ */ React.createElement(React.Fragment, null, "Consider using a small sample correction (Satterthwaite or Kenward-Roger) or robust covariance estimation (GEE Exchangeable Robust) for more conservative estimates."), isSmallSampleCorrected && !isRobust && /* @__PURE__ */ React.createElement(React.Fragment, null, "You are using a small sample correction. Consider also comparing with robust covariance estimation (GEE Exchangeable Robust)."), isRobust && !isSmallSampleCorrected && /* @__PURE__ */ React.createElement(React.Fragment, null, "You are using robust covariance estimation. Consider also comparing with small sample corrections (Satterthwaite or Kenward-Roger)."), isRobust && isSmallSampleCorrected && /* @__PURE__ */ React.createElement(React.Fragment, null, "This estimator already includes corrections. The difference may reflect genuine variation in power across inference approaches for this design.")))));
};
const CorrelationWarning = ({ warningCode }) => {
  console.log("CorrelationWarning rendered with:", warningCode);
  if (!warningCode || warningCode === 0) return null;
  const isSevere = warningCode > 1;
  return /* @__PURE__ */ React.createElement("div", { className: `${isSevere ? "bg-red-50 border-red-300" : "bg-amber-50 border-amber-300"} border rounded-xl p-4 text-sm` }, /* @__PURE__ */ React.createElement("div", { className: "flex items-start gap-2" }, /* @__PURE__ */ React.createElement("span", { className: `${isSevere ? "text-red-600" : "text-amber-600"} text-lg` }, "\u26A0\uFE0F"), /* @__PURE__ */ React.createElement("div", { className: "flex-1" }, /* @__PURE__ */ React.createElement("p", { className: `font-medium ${isSevere ? "text-red-800" : "text-amber-800"} mb-2` }, warningCode === 1 && "Correlation parameters require high random effect variance", warningCode === 2 && "Correlation parameters may not be realistic", warningCode === 3 && "Could not solve for valid model parameters"), /* @__PURE__ */ React.createElement("p", { className: isSevere ? "text-red-700" : "text-amber-700" }, warningCode === 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, "The specified ICC/IAC combination requires moderately high random effect variance in the underlying GLMM. For binomial models this may mean differences in power for marginal (GLMM) and conditional (GEE) models, compare the estimators in the menu. ", " ", /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "https://github.com/samuel-watson/ClusterApp2/blob/master/solver.md",
      target: "_blank",
      rel: "noopener noreferrer",
      className: "underline hover:text-red-900"
    },
    "Learn more"
  )), warningCode === 2 && /* @__PURE__ */ React.createElement(React.Fragment, null, "The specified ICC/IAC combination requires extreme random effect variance. This implies most individuals have near-deterministic outcomes (always respond or never respond), with the marginal prevalence arising from the population mix rather than individual-level uncertainty. Consider reducing IAC or increasing ICC for more realistic modelling assumptions. For binomial models this will mean differences in power for marginal (GLMM) and conditional (GEE) models, compare the estimators in the menu. ", " ", /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "https://github.com/samuel-watson/ClusterApp2/blob/master/solver.md",
      target: "_blank",
      rel: "noopener noreferrer",
      className: "underline hover:text-red-900"
    },
    "Learn more"
  )), warningCode === 3 && /* @__PURE__ */ React.createElement(React.Fragment, null, "The solver could not find valid GLMM parameters matching the specified ICC and IAC. This combination is not likely to be achievable in a mixed model. This may arise if the correlation parameters imply most individuals have near-deterministic outcomes (always respond or never respond), with the marginal prevalence arising from the population mix rather than individual-level uncertainty. Power calculations are unreliable. ", " ", /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "https://github.com/samuel-watson/ClusterApp2/blob/master/solver.md",
      target: "_blank",
      rel: "noopener noreferrer",
      className: "underline hover:text-red-900"
    },
    "Learn more"
  ))))));
};
const PlotArea = ({
  designs,
  activeIndex,
  cachedResults,
  isStale,
  isCalculating,
  cacheVersion
}) => {
  var _a, _b, _c, _d;
  const plotRef = useRef(null);
  const [plotlyLoaded, setPlotlyLoaded] = useState(false);
  const [xAxis, setXAxis] = useState("icc");
  const [yAxis, setYAxis] = useState("power");
  const [plotType, setPlotType] = useState("line");
  const [targetPower, setTargetPower] = useState(0.8);
  const [surfaceResolution, setSurfaceResolution] = useState(10);
  const xAxisOptions = [
    { value: "icc", label: "ICC", min: 0, max: 0.3, steps: 30 },
    {
      value: "meanClusterSize",
      label: "Cluster-Period Size",
      min: 5,
      max: 100,
      steps: 30
    },
    {
      value: "treatmentEffect",
      label: "Treatment Effect",
      min: 0,
      max: 2,
      steps: 30
    },
    { value: "baseline", label: "Baseline", min: 0.01, max: 0.5, steps: 30 },
    {
      value: "totalClusters",
      label: "Total Clusters",
      min: 2,
      max: 50,
      steps: 30
    }
  ];
  const yAxisOptions = [
    { value: "power", label: "Power" },
    { value: "mde", label: "Min. Detectable Effect" }
  ];
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
  const plotData = useMemo(() => {
    if (!currentXConfig) {
      console.log("No currentXConfig");
      return [];
    }
    console.log("Generating plot data:", { xAxis, currentXConfig });
    MathsInterface.clearPlotCache();
    return designs.map((d, idx) => {
      const xValues = [];
      const yValues = [];
      const { min, max, steps } = currentXConfig;
      console.log("Plot range:", { min, max, steps });
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
          const tempId = `_plot_line_${idx}`;
          result = MathsInterface.calculateResults(d.design, modifiedOptions, tempId);
        } else {
          modifiedOptions[xAxis] = xVal;
          const tempId = `_plot_line_${idx}`;
          result = MathsInterface.calculateResults(d.design, modifiedOptions, tempId);
        }
        if (i === 0 || i === steps) {
          console.log(`Point ${i}: x=${xVal}, ${xAxis}=${modifiedOptions[xAxis]}, power=${result.power}`);
        }
        yValues.push(parseFloat(yAxis === "power" ? result.power : result.mde));
      }
      console.log("Y values range:", Math.min(...yValues), "to", Math.max(...yValues));
      return {
        x: xValues,
        y: yValues,
        type: "scatter",
        mode: "lines",
        name: d.name,
        line: { color: designColors[idx].hex, width: 2.5 }
      };
    });
  }, [cacheVersion, xAxis, yAxis, currentXConfig]);
  const surfaceData = useMemo(() => {
    if (plotType === "line") return null;
    MathsInterface.clearPlotCache();
    const d = designs[activeIndex];
    const clusterSizes = Array.from(
      { length: surfaceResolution },
      (_, i) => 5 + i * Math.floor(100 / surfaceResolution)
    );
    const totalClusters = Array.from(
      { length: surfaceResolution },
      (_, i) => 2 + i * Math.floor(50 / surfaceResolution)
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
        [1, "#22c55e"]
      ],
      contours: plotType === "contour" ? {
        coloring: "heatmap",
        showlabels: true,
        labelfont: { size: 10, color: "#475569" }
      } : void 0,
      hovertemplate: "Size: %{x}<br>Clusters: %{y}<br>Power: %{z:.3f}<extra></extra>",
      colorbar: {
        title: { text: "Power", font: { size: 11 } },
        tickfont: { size: 10 }
      }
    };
  }, [
    cacheVersion,
    plotType,
    activeIndex,
    targetPower,
    surfaceResolution
  ]);
  useEffect(() => {
    if (!plotlyLoaded || !plotRef.current || !window.Plotly) return;
    let data, layout;
    if (plotType === "line") {
      const shapes = yAxis === "power" ? [
        {
          type: "line",
          x0: currentXConfig.min,
          x1: currentXConfig.max,
          y0: targetPower,
          y1: targetPower,
          line: { color: "#94a3b8", width: 1.5, dash: "dash" }
        }
      ] : [];
      data = plotData;
      layout = {
        margin: { l: 55, r: 25, t: 25, b: 50 },
        xaxis: {
          title: { text: currentXConfig.label, font: { size: 12 } },
          gridcolor: "#e2e8f0",
          tickfont: { size: 10 }
        },
        yaxis: {
          title: {
            text: yAxis === "power" ? "Power" : "Min. Detectable Effect",
            font: { size: 12 }
          },
          gridcolor: "#e2e8f0",
          range: yAxis === "power" ? [0, 1.02] : void 0,
          tickfont: { size: 10 }
        },
        shapes,
        legend: {
          orientation: "h",
          y: -0.2,
          x: 0.5,
          xanchor: "center",
          font: { size: 11 }
        },
        paper_bgcolor: "white",
        plot_bgcolor: "#f8fafc",
        font: { family: "system-ui, -apple-system, sans-serif" },
        hovermode: "x unified"
      };
    } else {
      data = [surfaceData];
      layout = {
        margin: { l: 55, r: 80, t: 25, b: 50 },
        xaxis: {
          title: { text: "Cluster-Period Size", font: { size: 12 } },
          tickfont: { size: 10 }
        },
        yaxis: {
          title: { text: "Total Clusters", font: { size: 12 } },
          tickfont: { size: 10 }
        },
        paper_bgcolor: "white",
        font: { family: "system-ui, -apple-system, sans-serif" },
        annotations: plotType === "contour" ? [
          {
            x: surfaceData.x[Math.floor(surfaceData.x.length * 0.7)],
            y: surfaceData.y[Math.floor(surfaceData.y.length * 0.3)],
            text: `${(targetPower * 100).toFixed(0)}% power`,
            showarrow: false,
            font: { size: 10, color: "#475569" }
          }
        ] : []
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
        scale: 2
      },
      displaylogo: false
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
    cacheVersion
  ]);
  const exportPlot = (format) => {
    if (!plotRef.current || !window.Plotly) return;
    window.Plotly.downloadImage(plotRef.current, {
      format,
      filename: "power_analysis",
      height: 600,
      width: 900,
      scale: 2
    });
  };
  return /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-xl shadow-lg border border-slate-200 p-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-3 flex-wrap gap-2" }, /* @__PURE__ */ React.createElement("h2", { className: "text-sm font-semibold text-slate-700" }, "Analysis Plot"), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 flex-wrap" }, /* @__PURE__ */ React.createElement(
    "select",
    {
      value: plotType,
      onChange: (e) => setPlotType(e.target.value),
      className: "px-2 py-1 text-xs border border-slate-300 rounded\r\n                 focus:outline-none focus:ring-1 focus:ring-blue-500"
    },
    /* @__PURE__ */ React.createElement("option", { value: "line" }, "Line Plot"),
    /* @__PURE__ */ React.createElement("option", { value: "heatmap" }, "Power Surface (Heatmap)"),
    /* @__PURE__ */ React.createElement("option", { value: "contour" }, "Power Surface (Contour)")
  ), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Target:"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      step: "0.05",
      min: "0.5",
      max: "0.99",
      value: targetPower,
      onChange: (e) => setTargetPower(
        Math.min(
          0.99,
          Math.max(0.5, parseFloat(e.target.value) || 0.8)
        )
      ),
      className: "w-14 px-1 py-1 text-xs border border-slate-300 rounded\r\n               focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
    }
  )), plotType === "line" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    "select",
    {
      value: xAxis,
      onChange: (e) => setXAxis(e.target.value),
      className: "px-2 py-1 text-xs border border-slate-300 rounded\r\n           focus:outline-none focus:ring-1 focus:ring-blue-500"
    },
    xAxisOptions.map((opt) => /* @__PURE__ */ React.createElement("option", { key: opt.value, value: opt.value }, "X: ", opt.label))
  ), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Range:"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      value: (_b = (_a = customRange == null ? void 0 : customRange.min) != null ? _a : currentXConfig == null ? void 0 : currentXConfig.min) != null ? _b : 0,
      onChange: (e) => setCustomRange((r) => {
        var _a2, _b2;
        return {
          min: parseFloat(e.target.value),
          max: (_b2 = (_a2 = r == null ? void 0 : r.max) != null ? _a2 : currentXConfig == null ? void 0 : currentXConfig.max) != null ? _b2 : 1
        };
      }),
      className: "w-14 px-1 py-1 text-xs border border-slate-300 rounded\r\n         focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "text-xs text-slate-400" }, "to"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      value: (_d = (_c = customRange == null ? void 0 : customRange.max) != null ? _c : currentXConfig == null ? void 0 : currentXConfig.max) != null ? _d : 1,
      onChange: (e) => setCustomRange((r) => {
        var _a2, _b2;
        return {
          min: (_b2 = (_a2 = r == null ? void 0 : r.min) != null ? _a2 : currentXConfig == null ? void 0 : currentXConfig.min) != null ? _b2 : 0,
          max: parseFloat(e.target.value)
        };
      }),
      className: "w-14 px-1 py-1 text-xs border border-slate-300 rounded\r\n         focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
    }
  )), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: yAxis,
      onChange: (e) => setYAxis(e.target.value),
      className: "px-2 py-1 text-xs border border-slate-300 rounded\r\n           focus:outline-none focus:ring-1 focus:ring-blue-500"
    },
    yAxisOptions.map((opt) => /* @__PURE__ */ React.createElement("option", { key: opt.value, value: opt.value }, "Y: ", opt.label))
  )), plotType !== "line" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "text-xs text-slate-500 self-center" }, "Using ", designs[activeIndex].name), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Resolution:"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "5",
      max: "30",
      value: surfaceResolution,
      onChange: (e) => setSurfaceResolution(
        Math.min(30, Math.max(5, parseInt(e.target.value) || 15))
      ),
      className: "w-12 px-1 py-1 text-xs border border-slate-300 rounded\r\n                   focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-1" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => exportPlot("png"),
      className: "px-2 py-1 text-xs bg-slate-100 border border-slate-300 rounded\r\n                   hover:bg-slate-200 transition-colors",
      title: "Download as PNG"
    },
    "PNG"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => exportPlot("svg"),
      className: "px-2 py-1 text-xs bg-slate-100 border border-slate-300 rounded\r\n                   hover:bg-slate-200 transition-colors",
      title: "Download as SVG"
    },
    "SVG"
  )))), /* @__PURE__ */ React.createElement("div", { className: `relative ${isStale ? "opacity-60" : ""}` }, isStale && /* @__PURE__ */ React.createElement("div", { className: "absolute inset-0 flex items-center justify-center z-10 pointer-events-none" }, /* @__PURE__ */ React.createElement("span", { className: "bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-full" }, "Outdated")), !plotlyLoaded ? /* @__PURE__ */ React.createElement("div", { className: "h-64 flex items-center justify-center text-slate-400" }, "Loading plot library...") : /* @__PURE__ */ React.createElement("div", { ref: plotRef, style: { width: "100%", height: "280px" } })));
};
function App() {
  var _a;
  const [designs, setDesigns] = useState(() => [createDesignEntry("Design 1")]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState(null);
  const [cellSize, setCellSize] = useState(72);
  const [weightMode, setWeightMode] = useState("none");
  const [rowWeights, setRowWeights] = useState(null);
  const designGridRef = useRef(null);
  const [resultsStale, setResultsStale] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [cachedResults, setCachedResults] = useState(
    () => designs.map((d, i) => MathsInterface.calculateResults(d.design, d.options, `design-${i}`))
  );
  const [cacheVersion, setCacheVersion] = useState(0);
  const [cachedWeights, setCachedWeights] = useState(
    () => designs.map((d) => ({
      cell: MathsInterface.calculateOptimalWeights(d.design),
      row: Array(d.design.numSequences).fill(1)
    }))
  );
  const [wasmLoaded, setWasmLoaded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const activeDesign = designs[activeIndex];
  const design2 = activeDesign.design;
  const options2 = activeDesign.options;
  const weights = weightMode !== "none" ? cachedWeights[activeIndex] || null : null;
  const getEstimators = (outcomeType) => {
    if (outcomeType === "binary" || outcomeType === "count") {
      return [
        { key: "mixed_model", label: "GLMM (Conditional)" },
        { key: "mixed_model_ttest", label: "GLMM (Conditional), t-test" },
        { key: "satterthwaite", label: "GLMM (Conditional), Satterthwaite" },
        { key: "kenward_roger", label: "GLMM (Conditional), Kenward-Roger" },
        { key: "gee_exchangeable", label: "GEE (Marginal; Robust)" },
        { key: "gee_exchangeable_ttest", label: "GEE (Marginal; Robust), t-test" },
        { key: "design_effect", label: "Design Effect" },
        { key: "design_effect_ttest", label: "Design Effect, t-test" }
      ];
    }
    return [
      { key: "mixed_model", label: "Model-based" },
      { key: "mixed_model_ttest", label: "Model-based, t-test" },
      { key: "satterthwaite", label: "Satterthwaite" },
      { key: "kenward_roger", label: "Kenward-Roger" },
      { key: "gee_independence_robust", label: "GEE Independence Robust" }
    ];
  };
  const powerWarning = useMemo(() => {
    if (!wasmLoaded || resultsStale || isCalculating) return null;
    const currentResult = cachedResults[activeIndex];
    const currentPower = parseFloat(currentResult == null ? void 0 : currentResult.power);
    if (isNaN(currentPower)) return null;
    const currentEstimator = options2.estimator;
    const d = designs[activeIndex];
    const outcomeType = d.options.outcomeType || options2.outcomeType || "continuous";
    const family = outcomeType === "binary" ? "binomial" : outcomeType === "count" ? "poisson" : "gaussian";
    const otherPowers = getEstimators(outcomeType).filter((e) => e.key !== currentEstimator).map((e) => {
      const modifiedOptions = { ...d.options, estimator: e.key };
      const result = MathsInterface.calculateResults(d.design, modifiedOptions, `_compare_${e.key}`);
      return {
        ...e,
        power: parseFloat(result.power)
      };
    }).filter((e) => !isNaN(e.power));
    if (otherPowers.length === 0) return null;
    const maxDiff = Math.max(...otherPowers.map((e) => currentPower - e.power));
    const minOtherPower = Math.min(...otherPowers.map((e) => e.power));
    const lowEstimators = otherPowers.filter((e) => currentPower - e.power >= 0.1);
    if (maxDiff >= 0.1) {
      return {
        selectedPower: currentPower,
        minOtherPower,
        difference: maxDiff,
        lowEstimators
      };
    }
    return null;
  }, [wasmLoaded, resultsStale, isCalculating, cachedResults, activeIndex, options2.estimator, options2.outcomeType, designs]);
  const correlationWarning = useMemo(() => {
    if (!wasmLoaded || resultsStale || isCalculating) return 0;
    const currentResult = cachedResults[activeIndex];
    const currentPower = parseFloat(currentResult == null ? void 0 : currentResult.power);
    if (isNaN(currentPower)) return 0;
    const d = designs[activeIndex];
    if (!d) return 0;
    const outcomeType = (options2 == null ? void 0 : options2.outcomeType) || "continuous";
    const samplingStructure = (options2 == null ? void 0 : options2.samplingStructure) || "cross_sectional";
    const iac = (options2 == null ? void 0 : options2.iac) || 0;
    console.log("correlation family: ", outcomeType);
    console.log("correlation iac: ", iac);
    console.log("correlation samp: ", samplingStructure);
    if (outcomeType === "continuous") return 0;
    console.log("correlation passed early exit");
    const warning = MathsInterface.getCorrelationWarning(`design-${activeIndex}`);
    console.log("Got warning:", warning);
    if (warning === 3) return 3;
    if (samplingStructure === "cross_section" || iac <= 0) return 0;
    return warning;
  }, [wasmLoaded, resultsStale, isCalculating, cachedResults, activeIndex, designs, options2]);
  useEffect(() => {
    MathsInterface.initialize().then((success) => {
      setWasmLoaded(success);
      hideLoading();
      if (!success) {
        console.error("Failed to initialize WASM module");
      }
    });
  }, []);
  useEffect(() => {
    setResultsStale(true);
  }, [designs]);
  useEffect(() => {
    const validEstimators = getEstimators(options2.outcomeType).map((e) => e.key);
    if (!validEstimators.includes(options2.estimator)) {
      updateOptions("estimator", "mixed_model");
    }
  }, [options2.outcomeType]);
  const recalculateResults = useCallback(async () => {
    if (!MathsInterface.isReady()) {
      console.warn("WASM not ready yet");
      return;
    }
    setIsCalculating(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const newResults = designs.map(
      (d, i) => MathsInterface.calculateResults(d.design, d.options, `design-${i}`)
    );
    const newWeights = designs.map((d, i) => {
      const cellWeights = MathsInterface.calculateOptimalWeights(d.design, d.options, `design-${i}`);
      const seqWeights = MathsInterface.calculateOptimalSequenceWeights(d.design, d.options, `design-${i}`);
      console.log("Raw sequence weights:", seqWeights);
      const maxW = Math.max(...seqWeights);
      const normalizedRow = maxW > 0 ? seqWeights.map((w) => w / maxW) : seqWeights;
      console.log("Normalized row weights:", normalizedRow);
      return {
        cell: cellWeights,
        row: normalizedRow
      };
    });
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
          design: newDesigns[activeIndex].design.clone()
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
            [key]: value
          }
        };
        return newDesigns;
      });
    },
    [activeIndex]
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  const addNewDesign = useCallback(() => {
    if (designs.length >= 3) return;
    const newDesign = createDesignEntry(`Design ${designs.length + 1}`);
    setDesigns((prev) => [...prev, newDesign]);
    setActiveIndex(designs.length);
    setAddMenuOpen(false);
  }, [designs.length]);
  const duplicateDesign = useCallback((sourceIndex) => {
    if (designs.length >= 3) return;
    const source = designs[sourceIndex];
    const newEntry = {
      name: `Design ${designs.length + 1}`,
      design: source.design.clone(),
      options: { ...source.options }
    };
    setDesigns((prev) => [...prev, newEntry]);
    setActiveIndex(designs.length);
    setAddMenuOpen(false);
  }, [designs]);
  useEffect(() => {
    if (!addMenuOpen) return;
    const handleClickOutside = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [addMenuOpen]);
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
        cell.sampleSize = nextStatus === CellStatus.NOT_ENROLLED ? null : entry.options.meanClusterSize;
      });
    },
    [updateActiveDesign]
  );
  const handleCellContextMenu = useCallback(
    (e, rowIndex, colIndex) => {
      if (options2.sampleSizeMode !== "exact") return;
      const cell = design2.getCell(rowIndex, colIndex);
      if (cell.status === CellStatus.NOT_ENROLLED) return;
      e.preventDefault();
      const newSize = prompt(
        "Enter cluster-period size:",
        cell.sampleSize || options2.meanClusterSize
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
      options2.sampleSizeMode,
      options2.meanClusterSize,
      design2,
      updateActiveDesign
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
            action: () => updateActiveDesign((entry) => entry.design.insertPeriod(index))
          },
          {
            label: "Insert period after",
            action: () => updateActiveDesign(
              (entry) => entry.design.insertPeriod(index + 1)
            )
          },
          { separator: true },
          {
            label: "Set all to Control",
            action: () => updateActiveDesign(
              (entry) => entry.design.setAllInPeriod(index, CellStatus.CONTROL)
            )
          },
          {
            label: "Set all to Intervention",
            action: () => updateActiveDesign(
              (entry) => entry.design.setAllInPeriod(index, CellStatus.INTERVENTION)
            )
          },
          { separator: true },
          {
            label: "Delete period",
            action: () => updateActiveDesign((entry) => entry.design.removePeriod(index)),
            danger: true,
            disabled: design2.numPeriods <= 1
          }
        ]
      });
    },
    [design2.numPeriods, updateActiveDesign]
  );
  const handleSequenceContextMenu = useCallback(
    (e, index) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: "Insert sequence above",
            action: () => updateActiveDesign((entry) => entry.design.insertSequence(index))
          },
          {
            label: "Insert sequence below",
            action: () => updateActiveDesign(
              (entry) => entry.design.insertSequence(index + 1)
            )
          },
          { separator: true },
          {
            label: "Set all to Control",
            action: () => updateActiveDesign(
              (entry) => entry.design.setAllInSequence(index, CellStatus.CONTROL)
            )
          },
          {
            label: "Set all to Intervention",
            action: () => updateActiveDesign(
              (entry) => entry.design.setAllInSequence(index, CellStatus.INTERVENTION)
            )
          },
          { separator: true },
          {
            label: "Delete sequence",
            action: () => updateActiveDesign((entry) => entry.design.removeSequence(index)),
            danger: true,
            disabled: design2.numSequences <= 2
          }
        ]
      });
    },
    [design2.numSequences, updateActiveDesign]
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
    if (!window.html2canvas) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      document.head.appendChild(script);
      await new Promise((resolve) => script.onload = resolve);
    }
    try {
      const canvas = await window.html2canvas(designGridRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false
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
      case "binary":
        return {
          label: "Risk Difference",
          tooltip: "Absolute risk difference (e.g., 0.1 means 10 percentage point increase from baseline probability)",
          placeholder: "e.g., 0.1"
        };
      case "count":
        return {
          label: "Rate Ratio",
          tooltip: "Ratio of treatment to control rate (e.g., 1.3 means 30% higher rate)",
          placeholder: "e.g., 1.3"
        };
      default:
        return {
          label: "Mean Difference",
          tooltip: "Difference in means between treatment and control groups",
          placeholder: "e.g., 0.5"
        };
    }
  };
  const grid = design2.getGrid();
  const numSequences = design2.numSequences;
  const numPeriods = design2.numPeriods;
  const [showTooltip, setShowTooltip] = useState(false);
  const [showCorrTooltip, setShowCorrTooltip] = useState(false);
  const teInfo = getTreatmentEffectInfo(options2.outcomeType);
  return /* @__PURE__ */ React.createElement("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto" }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "mb-4" }, /* @__PURE__ */ React.createElement("h1", { className: "text-2xl font-bold text-slate-800 tracking-tight" }, "Cluster Trial Design Tool"), /* @__PURE__ */ React.createElement("p", { className: "text-slate-500 mt-1 text-sm" }, "Compare up to 3 designs. Click cells to cycle status. Right-click headers for options.")), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, designs.map((d, i) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: i,
      className: `flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors
                    ${i === activeIndex ? `${designColors[i].light} ${designColors[i].border} border-2` : "bg-white border border-slate-200 hover:bg-slate-50"}`,
      onClick: () => setActiveIndex(i)
    },
    /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        value: d.name,
        onChange: (e) => renameDesign(i, e.target.value),
        onClick: (e) => e.stopPropagation(),
        className: `bg-transparent text-sm font-medium w-20 focus:outline-none
                      ${i === activeIndex ? designColors[i].text : "text-slate-600"}`
      }
    ),
    designs.length > 1 && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (e) => {
          e.stopPropagation();
          removeDesign(i);
        },
        className: "text-slate-400 hover:text-red-500 text-xs",
        title: "Remove design"
      },
      "\xD7"
    )
  )), designs.length < 3 && /* @__PURE__ */ React.createElement("div", { className: "relative", ref: addMenuRef }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setAddMenuOpen((prev) => !prev),
      className: "px-3 py-1.5 bg-white border border-dashed border-slate-300 rounded-lg\r\n                 text-sm text-slate-500 hover:bg-slate-50 hover:border-slate-400 transition-colors"
    },
    "+ Add Design"
  ), addMenuOpen && /* @__PURE__ */ React.createElement("div", { className: "absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-[160px]" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: addNewDesign,
      className: "w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
    },
    "New blank design"
  ), /* @__PURE__ */ React.createElement("div", { className: "border-t border-slate-100 my-0.5" }), designs.map((d, i) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: i,
      onClick: () => duplicateDesign(i),
      className: "w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
    },
    'Duplicate "',
    d.name,
    '"'
  ))))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm font-medium text-slate-600" }, "Presets:"), [
    "parallel",
    "parallel-baseline",
    "stepped-wedge",
    "stepped-wedge-implementation",
    "crossover",
    "crossover-washout",
    "staircase"
  ].map((preset) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: preset,
      onClick: () => loadPreset(preset),
      className: "px-2 py-1 bg-white border border-slate-300 rounded text-xs\r\n               hover:bg-slate-50 transition-colors capitalize"
    },
    preset.replace(/-/g, " ")
  )), /* @__PURE__ */ React.createElement("div", { className: "h-4 w-px bg-slate-300 mx-1" }), /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-1 text-xs text-slate-600" }, "Size:", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "range",
      min: "56",
      max: "96",
      value: cellSize,
      onChange: (e) => setCellSize(Number(e.target.value)),
      className: "w-16"
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "flex gap-1" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setWeightMode(weightMode === "cell" ? "none" : "cell"),
      className: `px-2 py-1 text-xs border rounded transition-colors
      ${weightMode === "cell" ? `bg-blue-100 border-blue-400 text-blue-700 ${resultsStale ? "opacity-60" : ""}` : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"}`
    },
    weightMode === "cell" ? "\u2713 Cell Weights" : "Cell Weights",
    weightMode === "cell" && resultsStale && " *"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setWeightMode(weightMode === "row" ? "none" : "row"),
      className: `px-2 py-1 text-xs border rounded transition-colors
      ${weightMode === "row" ? `bg-blue-100 border-blue-400 text-blue-700 ${resultsStale ? "opacity-60" : ""}` : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"}`
    },
    weightMode === "row" ? "\u2713 Row Weights" : "Row Weights",
    weightMode === "row" && resultsStale && " *"
  )), /* @__PURE__ */ React.createElement("div", { className: "h-4 w-px bg-slate-300 mx-1" }), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: exportDesignImage,
      className: "px-2 py-1 text-xs bg-white border border-slate-300 rounded\r\n             hover:bg-slate-50 transition-colors",
      title: "Export design as PNG"
    },
    "\u{1F4E5} Export Design"
  ))), /* @__PURE__ */ React.createElement(
    "div",
    {
      ref: designGridRef,
      className: "bg-white rounded-xl shadow-lg border border-slate-200 p-4 overflow-x-auto"
    },
    " ",
    /* @__PURE__ */ React.createElement("div", { className: "inline-block" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center mb-1 group" }, /* @__PURE__ */ React.createElement("div", { style: { width: 100 } }), /* @__PURE__ */ React.createElement("div", { className: "flex items-center" }, /* @__PURE__ */ React.createElement("div", { className: "w-2 flex justify-center" }, /* @__PURE__ */ React.createElement(
      InsertButton,
      {
        onClick: () => updateActiveDesign((e) => e.design.insertPeriod(0))
      }
    )), Array(numPeriods).fill(null).map((_, j) => /* @__PURE__ */ React.createElement(React.Fragment, { key: j }, /* @__PURE__ */ React.createElement(
      PeriodHeader,
      {
        index: j,
        onContextMenu: handlePeriodContextMenu,
        cellSize
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "w-2 flex justify-center" }, /* @__PURE__ */ React.createElement(
      InsertButton,
      {
        onClick: () => updateActiveDesign(
          (e) => e.design.insertPeriod(j + 1)
        )
      }
    )))))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center h-2 group" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        style: { width: 100 },
        className: "flex justify-end pr-1"
      },
      /* @__PURE__ */ React.createElement(
        InsertButton,
        {
          onClick: () => updateActiveDesign((e) => e.design.insertSequence(0))
        }
      )
    )), grid.map((row, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: i }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center group" }, /* @__PURE__ */ React.createElement(
      SequenceHeader,
      {
        index: i,
        clusters: design2.getClusters(i),
        onClustersChange: (idx, val) => updateActiveDesign(
          (e) => e.design.setClusters(idx, val)
        ),
        onContextMenu: handleSequenceContextMenu,
        cellSize
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "flex items-center" }, /* @__PURE__ */ React.createElement("div", { className: "w-2" }), row.map((cell, j) => {
      var _a2, _b;
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: j }, /* @__PURE__ */ React.createElement(
        DesignCellComponent,
        {
          cell,
          rowIndex: i,
          colIndex: j,
          onClick: handleCellClick,
          onContextMenu: handleCellContextMenu,
          cellSize,
          sampleSizeMode: options2.sampleSizeMode,
          scale: weightMode === "cell" && ((_a2 = cachedWeights[activeIndex]) == null ? void 0 : _a2.cell) ? cachedWeights[activeIndex].cell[i][j] : weightMode === "row" && ((_b = cachedWeights[activeIndex]) == null ? void 0 : _b.row) ? cachedWeights[activeIndex].row[i] : 1
        }
      ), /* @__PURE__ */ React.createElement("div", { className: "w-2" }));
    }))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center h-2 group" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        style: { width: 100 },
        className: "flex justify-end pr-1"
      },
      /* @__PURE__ */ React.createElement(
        InsertButton,
        {
          onClick: () => updateActiveDesign(
            (e) => e.design.insertSequence(i + 1)
          )
        }
      )
    ))))))
  ), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-3" }, Object.entries(statusConfig).map(([status, config]) => /* @__PURE__ */ React.createElement("div", { key: status, className: "flex items-center gap-1.5" }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `w-3 h-3 rounded ${config.bg} ${config.border} border`
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "text-xs text-slate-600" }, config.label)))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-xl shadow-lg border border-slate-200 p-4" }, /* @__PURE__ */ React.createElement("h2", { className: "text-sm font-semibold text-slate-700 mb-3" }, "Analysis Options"), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Outcome Type"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: options2.outcomeType,
      onChange: (e) => updateOptions("outcomeType", e.target.value),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
    },
    /* @__PURE__ */ React.createElement("option", { value: "continuous" }, "Continuous"),
    /* @__PURE__ */ React.createElement("option", { value: "binary" }, "Binary"),
    /* @__PURE__ */ React.createElement("option", { value: "count" }, "Count")
  )), (options2.outcomeType === "binary" || options2.outcomeType === "count") && /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Baseline"), /* @__PURE__ */ React.createElement(
    NumericInput,
    {
      step: "0.01",
      min: 1e-3,
      value: options2.baseline,
      onChange: (v) => updateOptions("baseline", v),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n             focus:outline-none focus:ring-1 focus:ring-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500 flex items-center gap-1" }, teInfo.label, /* @__PURE__ */ React.createElement("div", { className: "relative inline-block" }, /* @__PURE__ */ React.createElement(
    "svg",
    {
      className: "w-3.5 h-3.5 text-slate-400 cursor-help",
      onMouseEnter: () => setShowTooltip(true),
      onMouseLeave: () => setShowTooltip(false),
      fill: "none",
      viewBox: "0 0 24 24",
      stroke: "currentColor"
    },
    /* @__PURE__ */ React.createElement(
      "path",
      {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      }
    )
  ), showTooltip && /* @__PURE__ */ React.createElement("div", { className: "absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 \r\n                        px-2 py-1 text-xs text-white bg-slate-800 rounded shadow-lg\r\n                        whitespace-nowrap" }, teInfo.tooltip, /* @__PURE__ */ React.createElement("div", { className: "absolute top-full left-1/2 -translate-x-1/2 \r\n                          border-4 border-transparent border-t-slate-800" })))), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      step: "0.1",
      value: options2.treatmentEffect,
      placeholder: teInfo.placeholder,
      onChange: (e) => updateOptions("treatmentEffect", parseFloat(e.target.value) || 0),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n               focus:outline-none focus:ring-1 focus:ring-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "ICC"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      step: "0.01",
      min: "0",
      max: "1",
      value: options2.icc,
      onChange: (e) => updateOptions(
        "icc",
        Math.min(
          1,
          Math.max(0, parseFloat(e.target.value) || 0)
        )
      ),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Estimator"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: options2.estimator,
      onChange: (e) => updateOptions("estimator", e.target.value),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n               focus:outline-none focus:ring-1 focus:ring-blue-500\r\n               w-auto"
    },
    getEstimators(options2.outcomeType).map((est) => /* @__PURE__ */ React.createElement("option", { key: est.key, value: est.key }, est.label))
  )), numPeriods > 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Sampling"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: options2.samplingStructure,
      onChange: (e) => updateOptions("samplingStructure", e.target.value),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n                                     focus:outline-none focus:ring-1 focus:ring-blue-500"
    },
    /* @__PURE__ */ React.createElement("option", { value: "cross_section" }, "Cross-section"),
    /* @__PURE__ */ React.createElement("option", { value: "closed_cohort" }, "Closed Cohort"),
    /* @__PURE__ */ React.createElement("option", { value: "open_cohort" }, "Open Cohort")
  )), (options2.samplingStructure === "closed_cohort" || options2.samplingStructure === "open_cohort") && /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "IAC"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      step: "0.01",
      min: "0",
      max: "1",
      value: options2.iac,
      onChange: (e) => updateOptions(
        "iac",
        Math.min(
          1,
          Math.max(0, parseFloat(e.target.value) || 0)
        )
      ),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n                                       focus:outline-none focus:ring-1 focus:ring-blue-500"
    }
  )), options2.samplingStructure === "open_cohort" && /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500 flex items-center gap-1" }, "Replacement Rate", /* @__PURE__ */ React.createElement("div", { className: "relative inline-block group" }, /* @__PURE__ */ React.createElement(
    "svg",
    {
      className: "w-3.5 h-3.5 text-slate-400 cursor-help",
      fill: "none",
      viewBox: "0 0 24 24",
      stroke: "currentColor"
    },
    /* @__PURE__ */ React.createElement(
      "path",
      {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      }
    )
  ), /* @__PURE__ */ React.createElement("div", { className: "absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 \r\n                        px-2 py-1 text-xs text-white bg-slate-800 rounded shadow-lg\r\n                        whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity" }, "Proportion of individuals replaced each period (0 = closed, 1 = cross-sectional)", /* @__PURE__ */ React.createElement("div", { className: "absolute top-full left-1/2 -translate-x-1/2 \r\n                          border-4 border-transparent border-t-slate-800" })))), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      step: "0.1",
      min: "0",
      max: "1",
      value: (_a = options2.replacementRate) != null ? _a : 0.5,
      onChange: (e) => updateOptions(
        "replacementRate",
        Math.min(1, Math.max(0, parseFloat(e.target.value) || 0))
      ),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n                 focus:outline-none focus:ring-1 focus:ring-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500 flex items-center gap-1" }, "Correlation", /* @__PURE__ */ React.createElement("div", { className: "relative inline-block" }, /* @__PURE__ */ React.createElement(
    "svg",
    {
      className: "w-3.5 h-3.5 text-slate-400 cursor-help",
      onMouseEnter: () => setShowCorrTooltip(true),
      onMouseLeave: () => setShowCorrTooltip(false),
      fill: "none",
      viewBox: "0 0 24 24",
      stroke: "currentColor"
    },
    /* @__PURE__ */ React.createElement(
      "path",
      {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      }
    )
  ), showCorrTooltip && /* @__PURE__ */ React.createElement("div", { className: "absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 \r\n                                              px-3 py-2 text-xs text-white bg-slate-800 rounded shadow-lg\r\n                                              w-64 whitespace-normal" }, {
    exchangeable: "Constant correlation between all periods within a cluster: Cor(t, t') = \u03C4\xB2.",
    nested_exchangeable: "Exchangeable with a cluster autocorrelation (CAC) parameter: within-period correlation is \u03C4\xB2 and between-period is \u03C4\xB2 \xD7 CAC.",
    exponential_decay: "Correlation decays as a power of the time lag: \u03C4\xB2\u03BB^|t\u2212t'|, where \u03BB \u2208 (0,1) controls the rate of decay.",
    exponential_function: "Correlation decays via an exponential function: \u03C4\xB2 exp(\u2212|t\u2212t'| / \u03BB), where \u03BB is the lengthscale."
  }[options2.correlationStructure], /* @__PURE__ */ React.createElement("div", { className: "absolute top-full left-1/2 -translate-x-1/2 \r\n                                                border-4 border-transparent border-t-slate-800" })))), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: options2.correlationStructure,
      onChange: (e) => updateOptions(
        "correlationStructure",
        e.target.value
      ),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n                                     focus:outline-none focus:ring-1 focus:ring-blue-500"
    },
    /* @__PURE__ */ React.createElement("option", { value: "exchangeable" }, "Exchangeable"),
    /* @__PURE__ */ React.createElement("option", { value: "nested_exchangeable" }, "Nested Exch."),
    /* @__PURE__ */ React.createElement("option", { value: "exponential_decay" }, "Exp. Decay"),
    /* @__PURE__ */ React.createElement("option", { value: "exponential_function" }, "Exp. Function")
  )), options2.correlationStructure !== "exchangeable" && /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, options2.correlationStructure === "nested_exchangeable" ? "CAC" : "Lengthscale"), /* @__PURE__ */ React.createElement(
    NumericInput,
    {
      step: "0.1",
      min: 1e-3,
      value: options2.temporalCorrelation,
      onChange: (v) => updateOptions("temporalCorrelation", v),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n             focus:outline-none focus:ring-1 focus:ring-blue-500"
    }
  ))))), /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-xl shadow-lg border border-slate-200 p-4" }, /* @__PURE__ */ React.createElement("h2", { className: "text-sm font-semibold text-slate-700 mb-3" }, "Sample Size Options"), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Mode"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: options2.sampleSizeMode,
      onChange: (e) => updateOptions("sampleSizeMode", e.target.value),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n                                 focus:outline-none focus:ring-1 focus:ring-blue-500"
    },
    /* @__PURE__ */ React.createElement("option", { value: "fixed" }, "Fixed Parameters"),
    /* @__PURE__ */ React.createElement("option", { value: "exact" }, "Exact Cell Sizes")
  )), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "Mean Size"), /* @__PURE__ */ React.createElement(
    NumericInput,
    {
      step: "1",
      min: 1,
      value: options2.meanClusterSize,
      onChange: (v) => updateOptions("meanClusterSize", Math.floor(v)),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n             focus:outline-none focus:ring-1 focus:ring-blue-500"
    }
  )), options2.sampleSizeMode !== "exact" && /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs text-slate-500" }, "CV of Sizes"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      step: "0.1",
      min: "0",
      value: options2.cvClusterSize,
      onChange: (e) => updateOptions(
        "cvClusterSize",
        Math.max(0, parseFloat(e.target.value) || 0)
      ),
      className: "px-2 py-1 text-sm border border-slate-300 rounded\r\n                                   focus:outline-none focus:ring-1 focus:ring-blue-500"
    }
  ))), options2.sampleSizeMode === "exact" && /* @__PURE__ */ React.createElement("p", { className: "text-xs text-slate-500 mt-2" }, "Right-click cells to set individual sizes"), /* @__PURE__ */ React.createElement("div", { className: "mt-3 pt-3 border-t border-slate-200 grid grid-cols-3 gap-2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-lg font-bold text-slate-800" }, numSequences), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-slate-500" }, "Sequences")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-lg font-bold text-slate-800" }, numPeriods), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-slate-500" }, "Periods")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-lg font-bold text-blue-600" }, design2.getTotalClusters()), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-slate-500" }, "Clusters")))))), /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement(
    ResultsTable,
    {
      designs,
      cachedResults,
      isStale: resultsStale,
      isCalculating,
      onRecalculate: recalculateResults
    }
  ), /* @__PURE__ */ React.createElement(
    CorrelationWarning,
    {
      warningCode: correlationWarning
    }
  ), /* @__PURE__ */ React.createElement(
    PowerWarning,
    {
      warning: powerWarning,
      selectedEstimator: options2.estimator,
      designName: activeDesign.name
    }
  ), /* @__PURE__ */ React.createElement(
    PlotArea,
    {
      designs,
      activeIndex,
      cachedResults,
      isStale: resultsStale,
      isCalculating,
      cacheVersion
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-xl shadow-lg border border-slate-200 p-4" }, /* @__PURE__ */ React.createElement("h2", { className: "text-sm font-semibold text-slate-700 mb-2" }, "Save & Load"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-slate-500 mb-3" }, "Export your designs to a JSON file, or import a previously saved session."), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        const exportData = designs.map((d) => ({
          name: d.name,
          design: d.design.toJSON(),
          options: d.options,
          results: MathsInterface.calculateResults(d.design, d.options)
        }));
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "trial-designs.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      className: "flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium\r\n                 hover:bg-slate-800 transition-colors"
    },
    "Export"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => document.getElementById("import-file").click(),
      className: "flex-1 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium\r\n                 hover:bg-slate-50 transition-colors"
    },
    "Import"
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      id: "import-file",
      type: "file",
      accept: ".json",
      className: "hidden",
      onChange: (e) => {
        var _a2;
        const file = (_a2 = e.target.files) == null ? void 0 : _a2[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const importedData = JSON.parse(event.target.result);
            const newDesigns = importedData.map((item, idx) => ({
              name: item.name || `Design ${idx + 1}`,
              design: TrialDesign.fromJSON(item.design),
              options: { ...createDefaultOptions(), ...item.options }
            }));
            if (newDesigns.length > 0) {
              setDesigns(newDesigns);
              setActiveIndex(0);
              setResultsStale(true);
            }
          } catch (err) {
            console.error("Import failed:", err);
            alert("Failed to import file: " + err.message);
          }
        };
        reader.readAsText(file);
        e.target.value = "";
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-xl shadow-lg border border-slate-200 p-4" }, /* @__PURE__ */ React.createElement("h2", { className: "text-sm font-semibold text-slate-700 mb-2" }, "Verification Report"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-slate-500 mb-3" }, "Export a full computation audit with matrices, R verification script, and documentation for regulatory review."), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: async () => {
        var _a2;
        console.log("Export button clicked");
        try {
          setIsExporting(true);
          console.log("About to call ReportGenerator");
          console.log("ReportGenerator exists:", !!window.ReportGenerator);
          console.log("generateBundle exists:", !!((_a2 = window.ReportGenerator) == null ? void 0 : _a2.generateBundle));
          console.log(window.ReportGenerator.generateBundle.toString());
          await window.ReportGenerator.generateBundle(
            design2,
            options2,
            activeDesign.name
          );
          console.log("Export complete");
        } catch (err) {
          console.error("Export failed:", err);
          console.error("Stack:", err.stack);
          alert("Export failed: " + err.message);
        } finally {
          setIsExporting(false);
        }
      },
      disabled: isExporting || resultsStale,
      className: "w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm\r\n                   font-medium hover:bg-blue-700 disabled:bg-slate-300\r\n                   transition-colors flex items-center justify-center gap-2"
    },
    isExporting ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "animate-spin" }, "\u27F3"), " Generating...") : "\u{1F4E6} Export Verification Bundle"
  ), resultsStale && /* @__PURE__ */ React.createElement("p", { className: "text-xs text-amber-600 mt-2" }, "Recalculate results before exporting."))))), contextMenu && /* @__PURE__ */ React.createElement(
    ContextMenu,
    {
      x: contextMenu.x,
      y: contextMenu.y,
      items: contextMenu.items,
      onClose: () => setContextMenu(null)
    }
  ));
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(/* @__PURE__ */ React.createElement(App, null));
