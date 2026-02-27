(function(global) {
  'use strict';

const ReportGenerator = {
    
    // === MATRIX TO CSV ===
    matrixToCSV(matrix) {
        if (!matrix || !matrix.data) return '';
        return matrix.data.map(row => 
            row.map(v => v.toPrecision(15)).join(',')
        ).join('\n');
    },
    
    vectorToCSV(vec, label = 'value') {
        return [label, ...vec.map(v => v.toPrecision(15))].join('\n');
    },
    
    // === SHA-256 HASH (for traceability) ===
    async computeHash(content) {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0')).join('');
    },
    
    // === ESTIMATOR METADATA ===
    getEstimatorInfo(name) {
        const info = {
            mixed_model: {
                label: 'GLMM model-based (z-test)',
                distribution: 'normal',
                varianceFormula: 'Var(δ̂) = [M⁻¹]_{idx,idx} where M = X\'Σ⁻¹X',
                references: [
                    'Hussey MA, Hughes JP. Design and analysis of stepped wedge cluster randomized trials. Contemp Clin Trials. 2007;28(2):182-191.',
                    'Hooper R, et al. Sample size calculation for stepped wedge and other longitudinal cluster randomised trials. Stat Med. 2016;35(26):4718-4728.'
                ]
            },
            mixed_model_ttest: {
                label: 'GLMM model-based (t-test, between-within df)',
                distribution: 't',
                dfFormula: 'df = (total cluster-periods) − p',
                varianceFormula: 'Var(δ̂) = [M⁻¹]_{idx,idx} where M = X\'Σ⁻¹X',
                references: [
                    'Hussey MA, Hughes JP (2007).',
                    'Li F, et al. An evaluation of constrained randomization for the design and analysis of group-randomized trials with binary outcomes. Stat Med. 2017.'
                ]
            },
            satterthwaite: {
                label: 'Satterthwaite approximation (KR df, GLS SE)',
                distribution: 't',
                dfFormula: 'Satterthwaite-type df from Kenward-Roger method',
                varianceFormula: 'Var(δ̂) = [M⁻¹]_{idx,idx} (GLS variance)',
                references: [
                    'Kenward MG, Roger JH. Small sample inference for fixed effects from restricted maximum likelihood. Biometrics. 1997;53(3):983-997.'
                ]
            },
            kenward_roger: {
                label: 'Kenward-Roger (KR df + KR adjusted SE)',
                distribution: 't',
                dfFormula: 'Kenward-Roger approximation',
                varianceFormula: 'Var(δ̂) = [Φ_A]_{idx,idx} (KR-adjusted covariance)',
                references: [
                    'Kenward MG, Roger JH (1997).',
                    'Kenward MG, Roger JH. An improved approximation to the precision of fixed effects from restricted maximum likelihood. Comput Stat Data Anal. 2009;53(7):2583-2595.'
                ]
            },
            gee_independence_robust: {
                label: 'GEE independence working, robust/sandwich SE',
                distribution: 'normal',
                varianceFormula: 'Var(δ̂) = (X\'X)⁻¹ X\'ΣX (X\'X)⁻¹',
                references: [
                    'Liang KY, Zeger SL. Longitudinal data analysis using generalized linear models. Biometrika. 1986;73(1):13-22.'
                ]
            },
            gee_exchangeable: {
                label: 'GEE exchangeable working, sandwich SE (z-test)',
                distribution: 'normal',
                varianceFormula: 'Var(δ̂) = M⁻¹ B M⁻¹ where M = X\'V_w⁻¹X, B = X\'V_w⁻¹ Σ V_w⁻¹ X',
                references: [
                    'Li F, et al. Sample size determination for GEE analyses of stepped wedge cluster randomized trials. Biometrics. 2018;74(4):1450-1458.',
                    'Kasza J, et al. Information content of cluster-period cells in stepped wedge trials. Biometrics. 2019.'
                ]
            },
            gee_exchangeable_ttest: {
                label: 'GEE exchangeable working, sandwich SE (t-test)',
                distribution: 't',
                dfFormula: 'df = (total cluster-periods) − p',
                varianceFormula: 'Var(δ̂) = M⁻¹ B M⁻¹',
                references: [
                    'Li F, et al. (2018).',
                    'Ford WP, Westgate PM. Improved confidence interval estimation for cluster randomized trials. Stat Med. 2020.'
                ]
            },
            design_effect: {
                label: 'Design effect (marginal, z-test)',
                distribution: 'normal',
                varianceFormula: 'Var(δ̂) = [M⁻¹]_{idx,idx} where M = X\'V⁻¹X, V is the Kasza–Hemming covariance on the probability scale with totalvar = p̄(1−p̄), and δ is the risk difference p₁ − p₀',
                references: [
                    'Hemming K, et al. Sample size calculations for stepped wedge and cluster randomised trials: a unified approach. J Clin Epidemiol. 2020.',
                    'Kasza J, Hemming K, et al. Impact of non-uniform correlation structure on sample size and power in multiple-period cluster randomised trials. Stat Methods Med Res. 2019.'
                ]
            },
            design_effect_ttest: {
                label: 'Design effect (marginal, t-test)',
                distribution: 't',
                dfFormula: 'df = (total cluster-periods) − p',
                varianceFormula: 'Var(δ̂) = [M⁻¹]_{idx,idx} where M = X\'V⁻¹X, V is the Kasza–Hemming covariance on the probability scale with totalvar = p̄(1−p̄), and δ is the risk difference p₁ − p₀',
                references: [
                    'Hemming K, et al. (2020).',
                    'Kasza J, Hemming K (2019).'
                ]
            }
        };
        return info[name] || { label: name, distribution: 'normal', 
            varianceFormula: 'Unknown', references: [] };
    },
    
    // === R SCRIPT GENERATION ===
    generateRScript(bundle) {
        const info = this.getEstimatorInfo(bundle.estimator_name);
        const isSandwich = ['gee_independence_robust', 'gee_exchangeable', 
                           'gee_exchangeable_ttest'].includes(bundle.estimator_name);
        const isDesignEffect = bundle.estimator_name.startsWith('design_effect');
        const usesT = info.distribution === 't';
        
        let script = `#!/usr/bin/env Rscript
# ============================================================================
# Verification Script for Cluster Trial Power Calculation
# Generated: ${new Date().toISOString()}
# Estimator: ${info.label}
# ============================================================================
# This script independently reproduces the power calculation using
# the exported matrices. Run in base R (no packages required).
# ============================================================================

cat("=== Cluster Trial Power Verification ===\\n\\n")

# --- Load matrices ---
X <- as.matrix(read.csv("design_matrix.csv", header = FALSE))
cat("Design matrix X:", nrow(X), "x", ncol(X), "\\n")
`;

        if (isSandwich && bundle.V_working) {
            script += `
V_working <- as.matrix(read.csv("working_covariance.csv", header = FALSE))
Sigma_true <- as.matrix(read.csv("true_covariance.csv", header = FALSE))
cat("Working covariance V_w:", nrow(V_working), "x", ncol(V_working), "\\n")
cat("True covariance Sigma:", nrow(Sigma_true), "x", ncol(Sigma_true), "\\n")
`;
        } else {
            script += `
V <- as.matrix(read.csv("covariance_matrix.csv", header = FALSE))
cat("Covariance matrix V:", nrow(V), "x", ncol(V), "\\n")
`;
        }

        script += `
# --- Parameters ---
alpha <- ${bundle.alpha}
target_power <- ${bundle.target_power}
delta <- ${bundle.te}  # Treatment effect${isDesignEffect ? ' (risk difference)' : ' (link scale)'}
idx <- ${bundle.idx + 1}  # R is 1-indexed
cat("\\nTreatment effect (delta):", delta, "\\n")
cat("Significance level (alpha):", alpha, "\\n")
cat("Parameter index:", idx, "\\n\\n")
`;

        if (isSandwich && bundle.V_working) {
            // Sandwich estimator
            script += `
# --- Sandwich variance estimator ---
# Bread: M^{-1} where M = X' V_w^{-1} X
V_inv_X <- solve(V_working, X)
M <- t(X) %*% V_inv_X
M_inv <- solve(M)

# Meat: B = X' V_w^{-1} Sigma V_w^{-1} X
B <- t(V_inv_X) %*% Sigma_true %*% V_inv_X

# Sandwich: Var(beta_hat) = M^{-1} B M^{-1}
sandwich_var <- M_inv %*% B %*% M_inv

var_delta <- sandwich_var[idx, idx]
se_delta <- sqrt(var_delta)

cat("Bread matrix M (first 3x3):\\n")
print(round(M[1:min(3,nrow(M)), 1:min(3,ncol(M))], 6))
cat("\\nMeat matrix B (first 3x3):\\n")
print(round(B[1:min(3,nrow(B)), 1:min(3,ncol(B))], 6))
`;
        } else if (bundle.estimator_name === 'gee_independence_robust') {
            script += `
# --- GEE Independence Robust (Sandwich) ---
V <- as.matrix(read.csv("covariance_matrix.csv", header = FALSE))
XtX <- t(X) %*% X
XtX_inv <- solve(XtX)
meat <- t(X) %*% V %*% X
sandwich_var <- XtX_inv %*% meat %*% XtX_inv

var_delta <- sandwich_var[idx, idx]
se_delta <- sqrt(var_delta)
`;
        } else {
            // Model-based (GLS or Kenward-Roger)
            script += `
# --- Information matrix ---
# M = X' V^{-1} X
M <- t(X) %*% solve(V) %*% X
M_inv <- solve(M)

var_delta <- M_inv[idx, idx]
se_delta <- sqrt(var_delta)

cat("Information matrix M (first 3x3):\\n")
print(round(M[1:min(3,nrow(M)), 1:min(3,ncol(M))], 6))
`;
        }

        // Degrees of freedom
        if (usesT) {
            script += `
# --- Degrees of freedom ---
dof <- ${bundle.dof.toFixed(4)}
cat("\\nDegrees of freedom:", dof, "\\n")
`;
        }

        // Power calculation
        if (usesT) {
            script += `
# --- Power calculation (t-distribution) ---
t_crit <- qt(1 - alpha/2, df = dof)
ncp <- abs(delta) / se_delta  # Non-centrality parameter
power <- 1 - pt(t_crit, df = dof, ncp = ncp)
mde <- (t_crit + qt(target_power, df = dof)) * se_delta
`;
        } else {
            script += `
# --- Power calculation (normal distribution) ---
z_crit <- qnorm(1 - alpha/2)
z_power <- qnorm(target_power)
ncp <- abs(delta) / se_delta
power <- pnorm(ncp - z_crit)
mde <- (z_crit + z_power) * se_delta
`;
        }

        script += `
# --- Results ---
cat("\\n=== VERIFICATION RESULTS ===\\n")
cat("Var(delta_hat):", var_delta, "\\n")
cat("SE(delta_hat): ", se_delta, "\\n")
cat("Power:         ", round(power, 6), "\\n")
cat("MDE:           ", mde, "\\n")
cat("\\n=== COMPARISON WITH TOOL OUTPUT ===\\n")
cat("Tool SE:    ${bundle.se.toFixed(6)}\\n")
cat("Tool power: ${bundle.power.toFixed(6)}\\n")
cat("SE match:   ", abs(se_delta - ${bundle.se}) < 1e-4, "\\n")
cat("Power match:", abs(power - ${bundle.power}) < 1e-3, "\\n")

# Check
if (abs(se_delta - ${bundle.se}) < 1e-4 && abs(power - ${bundle.power}) < 1e-3) {
    cat("\\n*** VERIFICATION PASSED ***\\n")
} else {
    cat("\\n*** VERIFICATION DISCREPANCY - investigate ***\\n")
    cat("SE difference: ", abs(se_delta - ${bundle.se}), "\\n")
    cat("Power difference: ", abs(power - ${bundle.power}), "\\n")
}
`;

        return script;
    },
    
    // === HTML REPORT ===
    generateHTMLReport(bundle, designName, designGrid, options) {
        const info = this.getEstimatorInfo(bundle.estimator_name);
        const timestamp = new Date().toISOString();
        
        const familyLabel = {
            gaussian: 'Continuous (Gaussian)',
            binomial: 'Binary (Binomial)',
            poisson: 'Count (Poisson)'
        }[bundle.family] || bundle.family;
        
        const corrLabel = {
            exchangeable: 'Exchangeable',
            nested_exchangeable: 'Nested exchangeable',
            exponential_decay: 'Exponential decay',
            exponential_function: 'Exponential function'
        }[bundle.correlation_structure] || bundle.correlation_structure;
        
        const sampLabel = {
            cross_section: 'Cross-sectional',
            closed_cohort: 'Closed cohort',
            open_cohort: 'Open cohort'
        }[bundle.sampling_structure] || bundle.sampling_structure;
        
        // Build design grid HTML
        let gridHTML = '<table class="design-grid"><tr><th></th>';
        for (let j = 0; j < bundle.numPeriods; j++) {
            gridHTML += `<th>T${j}</th>`;
        }
        gridHTML += '</tr>';
        for (let i = 0; i < designGrid.length; i++) {
            gridHTML += `<tr><td class="seq-label">Seq ${i+1} (×${bundle.clustersPerSequence[i]})</td>`;
            for (let j = 0; j < designGrid[i].length; j++) {
                const status = designGrid[i][j].status;
                const cls = status === 'intervention' ? 'cell-int' : 
                           status === 'control' ? 'cell-ctrl' : 'cell-ne';
                const label = status === 'intervention' ? 'I' : 
                             status === 'control' ? 'C' : '—';
                gridHTML += `<td class="${cls}">${label}</td>`;
            }
            gridHTML += '</tr>';
        }
        gridHTML += '</table>';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Verification Report — ${designName}</title>
<style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 900px; 
           margin: 40px auto; padding: 0 20px; color: #1e293b; line-height: 1.6; }
    h1 { border-bottom: 3px solid #3b82f6; padding-bottom: 12px; }
    h2 { color: #1e40af; margin-top: 2em; border-bottom: 1px solid #cbd5e1; 
         padding-bottom: 6px; }
    h3 { color: #334155; }
    .meta { background: #f1f5f9; padding: 16px; border-radius: 8px; 
            font-size: 0.9em; margin-bottom: 2em; }
    .note { font-size: 0.85em; color: #475569; background: #f8fafc; 
        padding: 10px; border-radius: 4px; border-left: 3px solid #94a3b8;
        margin: 0.5em 0 1em 0; }
    .meta dt { font-weight: 600; }
    .result-box { background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px;
                  padding: 20px; margin: 1em 0; }
    .result-box .power { font-size: 2em; font-weight: 700; color: #1e40af; }
    table { border-collapse: collapse; margin: 1em 0; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 12px; text-align: center; }
    th { background: #f1f5f9; font-weight: 600; }
    .design-grid td, .design-grid th { width: 48px; height: 36px; font-size: 0.85em; }
    .cell-int { background: #d1fae5; color: #065f46; font-weight: 600; }
    .cell-ctrl { background: #f1f5f9; color: #475569; }
    .cell-ne { background: #f8fafc; color: #94a3b8; }
    .seq-label { text-align: right; font-weight: 600; background: white; width: 120px; }
    .formula { font-family: 'Cambria Math', 'STIX', serif; background: #f8fafc; 
               padding: 12px; border-radius: 4px; border-left: 4px solid #3b82f6; 
               margin: 1em 0; }
    .param-table td:first-child { text-align: left; font-weight: 500; }
    .param-table td:nth-child(2) { font-family: monospace; }
    .references { font-size: 0.85em; }
    .references li { margin-bottom: 0.5em; }
    .layer-tag { display: inline-block; background: #3b82f6; color: white; 
                 font-size: 0.75em; padding: 2px 8px; border-radius: 4px; 
                 vertical-align: middle; margin-right: 8px; }
    .files-list { background: #f8fafc; padding: 12px; border-radius: 8px; }
    .files-list code { background: #e2e8f0; padding: 2px 6px; border-radius: 3px; }
    @media print { body { max-width: none; } }
</style>
</head>
<body>

<h1>Verification Report</h1>

<div class="meta">
    <strong>${designName}</strong><br>
    Generated: ${timestamp}<br>
    Software: ClusterApp v2.0 (WASM backend)<br>
    Estimator: ${info.label}<br>
    Engine: ClusterApp WASM <code>${window.WasmLoader.getWasmHash() || '?'}</code>
</div>

<!-- ============================================ -->
<h2><span class="layer-tag">Layer 1</span> Summary</h2>

<div class="result-box">
    <div class="power">${(bundle.power * 100).toFixed(1)}% power</div>
    <p>to detect a treatment effect of <strong>${bundle.te.toFixed(4)}</strong> 
    ${bundle.family === 'binomial' && bundle.estimator_name.startsWith('design_effect') 
        ? '(risk difference)' : `(${bundle.link} scale)`}
    at α = ${bundle.alpha} (two-sided)
    with <strong>${bundle.totalClusters}</strong> clusters across 
    <strong>${bundle.numPeriods}</strong> period(s).</p>
    <p>SE(δ̂) = ${bundle.se.toFixed(6)} · df = ${typeof bundle.dof === 'number' ? bundle.dof.toFixed(1) : bundle.dof} · MDE = ${(bundle.se * 2.8).toFixed(4)}</p>
</div>

<p><strong>Design structure:</strong></p>
${gridHTML}
<p>${bundle.numSequences} sequences, ${bundle.numPeriods} periods, 
${bundle.totalClusters} total clusters 
(${bundle.clustersPerSequence.join(', ')} per sequence).</p>

<p><strong>Outcome:</strong> ${familyLabel}, ${bundle.link} link<br>
<strong>Correlation:</strong> ${corrLabel} (${sampLabel} sampling)<br>
<strong>Analysis:</strong> ${info.label}</p>

<!-- ============================================ -->
<h2><span class="layer-tag">Layer 2</span> Statistical Detail</h2>

<h3>Model specification</h3>
<div class="formula">
    <code>${bundle.formula}</code>
</div>

<h3>User-specified parameters</h3>
<table class="param-table">
    <tr><th>Parameter</th><th>Value</th></tr>
    <tr><td>Baseline (natural scale)</td><td>${options.baseline}</td></tr>
    <tr><td>Treatment effect (natural scale)</td><td>${options.treatmentEffect}</td></tr>
    <tr><td>ICC</td><td>${options.icc}</td></tr>
    ${options.iac > 0 ? `<tr><td>IAC</td><td>${options.iac}</td></tr>` : ''}
    ${bundle.correlation_structure !== 'exchangeable' 
        ? `<tr><td>${bundle.correlation_structure === 'nested_exchangeable' ? 'CAC' : 'Lengthscale'}</td>
           <td>${options.temporalCorrelation ?? options.cac}</td></tr>` : ''}
    <tr><td>Mean cluster-period size</td><td>${options.meanClusterSize}</td></tr>
    ${options.cvClusterSize > 0 ? `<tr><td>CV of cluster size</td><td>${options.cvClusterSize}</td></tr>` : ''}
    <tr><td>Sampling structure</td><td>${sampLabel}</td></tr>
    <tr><td>Correlation structure</td><td>${corrLabel}</td></tr>
    <tr><td>α (two-sided)</td><td>${options.alpha}</td></tr>
    <tr><td>Target power</td><td>${options.targetPower}</td></tr>
</table>

<h3>Model parameters (${bundle.link} scale)</h3>
<p class="note">The model is parameterised on the ${bundle.link} scale. 
For non-Gaussian families, β and θ are solved numerically to match the 
user-specified marginal ICC, IAC, and baseline prevalence/rate.
Covariance parameters θ are at the cluster-period level: individual-level 
variance components are scaled by 1/m where m is the mean cluster-period size.</p>
<table class="param-table">
    <tr><th>Parameter</th><th>Value</th><th>Interpretation</th></tr>
    ${bundle.beta.map((b, i) => 
        `<tr><td>β<sub>${i}</sub></td><td>${b.toFixed(6)}</td>
         <td>${i === 0 ? 'Intercept (' + bundle.link + ' scale)' 
              : i === 1 ? 'Treatment effect (' + bundle.link + ' scale)' 
              : 'Period ' + i + ' fixed effect'}</td></tr>`
    ).join('\n    ')}
    ${bundle.theta.map((t, i) => {
        let interp = 'Covariance parameter ' + i;
        const cs = bundle.correlation_structure;
        const ss = bundle.sampling_structure;
        const m = options.meanClusterSize;
        
        if (cs === 'exchangeable') {
            if (i === 0) interp = 'σ²<sub>c</sub> (cluster variance)';
            if (ss === 'closed_cohort' && i === 1) 
                interp = `σ²<sub>p</sub>/m (individual variance ÷ ${m}; raw σ²<sub>p</sub> ≈ ${(t * m).toFixed(6)})`;
            if (ss === 'open_cohort' && i === 1)
                interp = `σ²<sub>p</sub>/m (individual variance ÷ ${m}; raw σ²<sub>p</sub> ≈ ${(t * m).toFixed(6)})`;
            if (ss === 'open_cohort' && i === 2)
                interp = 'Replacement rate';
        } else if (cs === 'nested_exchangeable') {
            if (i === 0) interp = `σ²<sub>c</sub> × CAC (between-period cluster variance; σ²<sub>c</sub> = θ₀+θ₁ ≈ ${(bundle.theta[0] + bundle.theta[1]).toFixed(6)})`;
            if (i === 1) interp = 'σ²<sub>c</sub> × (1−CAC) (within-period cluster variance)';
            if (ss !== 'cross_section' && i === 2)
                interp = `σ²<sub>p</sub>/m (individual variance ÷ ${m}; raw σ²<sub>p</sub> ≈ ${(t * m).toFixed(6)})`;
            if (ss === 'open_cohort' && i === 3)
                interp = 'Replacement rate';
        } else {
            // exponential_decay or exponential_function
            if (i === 0) interp = 'σ²<sub>c</sub> (cluster variance)';
            if (i === 1) interp = 'Decay parameter (lengthscale)';
            if (ss !== 'cross_section' && i === 2)
                interp = `σ²<sub>p</sub>/m (individual variance ÷ ${m}; raw σ²<sub>p</sub> ≈ ${(t * m).toFixed(6)})`;
            if (ss === 'open_cohort' && i === 3)
                interp = 'Replacement rate';
        }
        
        return `<tr><td>θ<sub>${i}</sub></td><td>${t.toFixed(6)}</td><td>${interp}</td></tr>`;
    }).join('\n    ')}
</table>

${bundle.family !== 'gaussian' ? `
<h3>Parameter mapping verification</h3>
<p class="note">For ${bundle.family} models, the solver finds β and σ on the 
${bundle.link} scale to reproduce the target marginal moments. 
The mapping is nonlinear — the same ICC on the natural scale can require 
very different random effect variances depending on the baseline prevalence/rate.</p>
<table class="param-table">
    <tr><th>Quantity</th><th>Value</th></tr>
    <tr><td>Total RE variance (${bundle.link} scale)</td>
        <td>${bundle.theta.filter((_, i) => {
            // Sum variance components, skip decay/replacement params
            const cs = bundle.correlation_structure;
            const ss = bundle.sampling_structure;
            if (cs === 'exchangeable') return i === 0 || (ss !== 'cross_section' && i === 1);
            if (cs === 'nested_exchangeable') return i <= 1 || (ss !== 'cross_section' && i === 2);
            return i === 0 || (ss !== 'cross_section' && i === 2);
        }).reduce((a, t, i) => {
            // Scale back individual-level terms by m
            const cs = bundle.correlation_structure;
            const isIndiv = (cs === 'exchangeable' && i >= 1) ||
                           (cs === 'nested_exchangeable' && i >= 2) ||
                           (cs !== 'exchangeable' && cs !== 'nested_exchangeable' && i >= 1);
            return a + (isIndiv ? t * options.meanClusterSize : t);
        }, 0).toFixed(4)}</td></tr>
    <tr><td>π²/3 (logistic variance)</td><td>${(Math.PI * Math.PI / 3).toFixed(4)}</td></tr>
</table>
` : ''}

<h3>Variance of treatment effect estimator</h3>
<div class="formula">${info.varianceFormula}</div>

<table>
    <tr><td>Var(δ̂)</td><td>${bundle.var_delta.toExponential(6)}</td></tr>
    <tr><td>SE(δ̂)</td><td>${bundle.se.toFixed(6)}</td></tr>
    <tr><td>Degrees of freedom</td><td>${typeof bundle.dof === 'number' ? bundle.dof.toFixed(2) : bundle.dof}</td></tr>
</table>

<h3>Power formula</h3>
<div class="formula">
${info.distribution === 't' 
    ? 'Power = P(t<sub>df,ncp</sub> > t<sub>α/2,df</sub>) where ncp = |δ| / SE(δ̂)'
    : 'Power = Φ(|δ|/SE(δ̂) − z<sub>α/2</sub>)'}
</div>

<h3>References</h3>
<ol class="references">
${info.references.map(r => `    <li>${r}</li>`).join('\n')}
</ol>

<!-- ============================================ -->
<h2><span class="layer-tag">Layer 3</span> Computation Audit</h2>

<h3>Exported files</h3>
<div class="files-list">
    <p><code>design_matrix.csv</code> — X (${bundle.X?.rows}×${bundle.X?.cols})</p>
    <p><code>covariance_matrix.csv</code> — ${bundle.Sigma ? `Σ or V (${bundle.Sigma.rows}×${bundle.Sigma.cols})` : 'N/A'}</p>
    ${bundle.V_working ? `<p><code>working_covariance.csv</code> — V<sub>w</sub> (${bundle.V_working.rows}×${bundle.V_working.cols})</p>` : ''}
    ${bundle.Sigma_true ? `<p><code>true_covariance.csv</code> — Σ<sub>true</sub> (${bundle.Sigma_true.rows}×${bundle.Sigma_true.cols})</p>` : ''}
    ${bundle.bread ? `<p><code>bread_matrix.csv</code> — Bread M⁻¹ (${bundle.bread.rows}×${bundle.bread.cols})</p>` : ''}
    ${bundle.meat ? `<p><code>meat_matrix.csv</code> — Meat B (${bundle.meat.rows}×${bundle.meat.cols})</p>` : ''}
    <p><code>information_matrix.csv</code> — ${bundle.M ? `M (${bundle.M.rows}×${bundle.M.cols})` : 'N/A'}</p>
    <p><code>verify.R</code> — Self-contained R verification script</p>
</div>

<h3>Design matrix preview (first 10 rows)</h3>
<table>
    <tr>${['cl','t','n','int','int2','int12','ctrl'].map(h => `<th>${h}</th>`).join('')}</tr>
    ${bundle.dataMatrix.slice(0, 10).map(row => 
        '<tr>' + row.map(v => `<td>${v}</td>`).join('') + '</tr>'
    ).join('\n    ')}
    ${bundle.dataMatrix.length > 10 ? '<tr><td colspan="7">...</td></tr>' : ''}
</table>

<h3>Information matrix preview</h3>
${bundle.M ? `<table>
    ${bundle.M.data.slice(0, Math.min(5, bundle.M.rows)).map(row => 
        '<tr>' + row.slice(0, Math.min(5, bundle.M.cols))
            .map(v => `<td>${v.toExponential(4)}</td>`).join('') + '</tr>'
    ).join('\n    ')}
</table>` : '<p>Not applicable for this estimator.</p>'}

<h3>Verification instructions</h3>
<ol>
    <li>Unzip the verification bundle</li>
    <li>Open R (base R, no packages required)</li>
    <li>Set working directory: <code>setwd("path/to/unzipped/folder")</code></li>
    <li>Run: <code>source("verify.R")</code></li>
    <li>Confirm output reads <strong>VERIFICATION PASSED</strong></li>
</ol>

<hr>
<p style="font-size: 0.8em; color: #94a3b8;">
Report generated by ClusterApp Verification Module · ${timestamp}
</p>

</body>
</html>`;
    },
    
    // === MAIN EXPORT FUNCTION ===
    async generateBundle(design, options, designName) {
        
    
    const bundle = window.MathsInterface.getVerificationBundle(
        design, options, `_verify_${designName}`
    );
    


        
        if (!bundle.valid) {
            throw new Error(`Verification bundle failed: ${bundle.error}`);
        }
        
        const zip = new JSZip();
        const folderName = `verification_${designName.replace(/\s+/g, '_')}_${
            new Date().toISOString().slice(0,10)}`;
        const folder = zip.folder(folderName);
        
        // CSV matrices
        if (bundle.X) {
            folder.file('design_matrix.csv', this.matrixToCSV(bundle.X));
        }
        if (bundle.Sigma) {
            folder.file('covariance_matrix.csv', this.matrixToCSV(bundle.Sigma));
        }
        if (bundle.M) {
            folder.file('information_matrix.csv', this.matrixToCSV(bundle.M));
        }
        if (bundle.Minv) {
            folder.file('inverse_information_matrix.csv', this.matrixToCSV(bundle.Minv));
        }
        if (bundle.bread) {
            folder.file('bread_matrix.csv', this.matrixToCSV(bundle.bread));
        }
        if (bundle.meat) {
            folder.file('meat_matrix.csv', this.matrixToCSV(bundle.meat));
        }
        if (bundle.V_working) {
            folder.file('working_covariance.csv', this.matrixToCSV(bundle.V_working));
        }
        if (bundle.Sigma_true) {
            folder.file('true_covariance.csv', this.matrixToCSV(bundle.Sigma_true));
        }
        
        // Parameters
        folder.file('beta.csv', this.vectorToCSV(bundle.beta, 'beta'));
        folder.file('theta.csv', this.vectorToCSV(bundle.theta, 'theta'));
        
        // Data matrix
        const dataCSV = 'cl,t,n,int,int2,int12,control\n' + 
            bundle.dataMatrix.map(r => r.join(',')).join('\n');
        folder.file('data_matrix.csv', dataCSV);
        
        // R script
        const rScript = this.generateRScript(bundle);
        folder.file('verify.R', rScript);
        
        // HTML report
        const grid = design.getGrid().map(row => 
            row.map(cell => ({ status: cell.status }))
        );
        const htmlReport = this.generateHTMLReport(
            bundle, designName, grid, options
        );
        folder.file('report.html', htmlReport);
        
        // Metadata JSON
        const metadata = {
            software: 'ClusterApp v2.0',
            version: window.WasmLoader.getWasmHash() || 'unknown',
            generated: new Date().toISOString(),
            estimator: bundle.estimator_name,
            formula: bundle.formula,
            family: bundle.family,
            link: bundle.link,
            correlation_structure: bundle.correlation_structure,
            sampling_structure: bundle.sampling_structure,
            alpha: bundle.alpha,
            target_power: bundle.target_power,
            results: {
                power: bundle.power,
                se: bundle.se,
                dof: bundle.dof,
                var_delta: bundle.var_delta
            }
        };
        const metaJSON = JSON.stringify(metadata, null, 2);
        folder.file('metadata.json', metaJSON);
        
        // Compute hash of all content for traceability
        const hashInput = rScript + metaJSON + 
            (bundle.X ? this.matrixToCSV(bundle.X) : '') +
            (bundle.Sigma ? this.matrixToCSV(bundle.Sigma) : '');
        const hash = await this.computeHash(hashInput);
        folder.file('checksum.sha256', hash);
        metadata.sha256 = hash;
        folder.file('metadata.json', JSON.stringify(metadata, null, 2));
        
        const zipBlob = await zip.generateAsync({ type: 'blob' });
console.log('ZIP blob size:', zipBlob.size, 'bytes');

if (zipBlob.size === 0) {
    throw new Error('Generated ZIP is empty');
}

const url = URL.createObjectURL(zipBlob);
const a = document.createElement('a');
a.href = url;
a.download = `${folderName}.zip`;
document.body.appendChild(a);
//a.click();
window.open(url, '_blank');
// Delay cleanup so the browser has time to start the download
setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}, 1000);
        
        return { success: true, hash, bundle };
    }
};

  global.ReportGenerator = ReportGenerator;
})(window);