# GLMM Parameter Solver for Power Calculations

## Overview

For power calculations in cluster randomized trials with non-Gaussian outcomes, we need to specify generalized linear mixed model (GLMM) parameters that correspond to user-specified marginal quantities. Users typically specify:

- **Baseline prevalence/rate** ($p_0$ for binomial, $\mu_0$ for Poisson)
- **Treatment group prevalence/rate** ($p_1$ for binomial, $\mu_1$ for Poisson)  
- **Intracluster correlation coefficient (ICC)**: correlation between different individuals in the same cluster at the same time point
- **Cluster autocorrelation (CAC)**: decay factor for cluster-level correlation over time
- **Individual autocorrelation (IAC)**: additional correlation for the same individual across time periods (cohort designs only)

The challenge is that these marginal quantities arise from integrating over random effects, creating a nonlinear relationship with the GLMM parameters ($\beta_0$, $\beta_1$, $\sigma_c$, $\sigma_p$, and temporal parameters).

## Model Structure

### Binomial Model (Logit Link)

For individual $j$ in cluster $i$ at period $k$:

$$Y_{ijk} \mid u_i, v_{ij} \sim \text{Bernoulli}(p_{ijk})$$

$$\text{logit}(p_{ijk}) = \beta_0 + \beta_1 X_{ik} + u_{ik} + v_{ij}$$

where:
- $u_{ik}$ is the cluster random effect (with temporal correlation structure)
- $v_{ij} \sim N(0, \sigma_p^2)$ is the individual random effect (cohort designs only)
- $X_{ik}$ is the treatment indicator

### Poisson Model (Log Link)

$$Y_{ijk} \mid u_i, v_{ij} \sim \text{Poisson}(\mu_{ijk})$$

$$\log(\mu_{ijk}) = \beta_0 + \beta_1 X_{ik} + u_{ik} + v_{ij}$$

## Temporal Correlation Structures

For longitudinal designs (stepped-wedge, crossover, etc.), the cluster-level correlation decays over time. We support two structures:

### Nested Exchangeable

The cluster random effect decomposes into permanent and period-specific components:

$$u_{ik} = \alpha_i + \gamma_{ik}$$

where $\alpha_i \sim N(0, \sigma_\alpha^2)$ is the permanent cluster effect and $\gamma_{ik} \sim N(0, \sigma_\gamma^2)$ is the period-specific deviation.

**Correlation between cluster-period means at lag $d$:**

$$\rho_{\text{cluster}}(d) = \begin{cases}
\text{ICC} & d = 0 \\
\text{CAC} \times \text{ICC} & d > 0
\end{cases}$$

where $\text{CAC} = \sigma_\alpha^2 / (\sigma_\alpha^2 + \sigma_\gamma^2)$ is the proportion of cluster variance that is permanent.

### Exponential Decay

The cluster random effect follows an AR(1)-like structure:

$$\text{Corr}(u_{ik}, u_{ik'}) = \lambda^{|k - k'|}$$

**Correlation between cluster-period means at lag $d$:**

$$\rho_{\text{cluster}}(d) = \lambda^{|d|} \times \text{ICC}$$

### Unified Framework

Both structures can be expressed through a "decay at lag 1" parameter:

| Structure | Cluster correlation at lag $d$ | Cluster correlation at lag 1 |
|-----------|-------------------------------|------------------------------|
| Nested Exchangeable | $\text{CAC} \times \text{ICC}$ (constant for $d > 0$) | $\text{CAC} \times \text{ICC}$ |
| Exponential Decay | $\lambda^d \times \text{ICC}$ | $\lambda \times \text{ICC}$ |

From the solver's perspective, both structures are equivalent at lag 1 with `decay_at_lag1 = CAC` (nested exchangeable) or `decay_at_lag1 = λ` (exponential decay).

## Within-Individual Correlation

For cohort designs, the within-individual correlation at lag $d$ combines cluster-level and individual-level components:

$$\rho_{\text{within}}(d) = \rho_{\text{cluster}}(d) + \text{IAC} \times (1 - \text{ICC})$$

The individual component $\text{IAC} \times (1 - \text{ICC})$ is **constant across lags** because the individual random effect $v_{ij}$ is the same for all observations on that individual.

### IAC Interpretation

The IAC is a reparameterization of within-person correlation, not a separate quantity:

$$\text{IAC} = \frac{\rho_{\text{within-person}} - \text{ICC}}{1 - \text{ICC}}$$

This parameterization ensures:
- IAC $\in [0, 1]$ regardless of ICC value
- IAC $= 0$ implies cross-sectional design (no individual persistence)
- IAC $= 1$ implies all non-cluster variation is individual-level

**Example:** If a user wants within-person correlation of 0.6 with ICC of 0.1, they input IAC $= (0.6 - 0.1)/(1 - 0.1) = 0.556$.

## Computing Marginal Moments

We use Gauss-Hermite quadrature to compute expectations over the random effects.

### Binomial Case

The marginal mean is:

$$E[Y] = E_{u,v}[\text{expit}(\beta_0 + u + v)]$$

For correlations, we need:

$$E[Y \cdot Y'] = \begin{cases}
E_u\left[\left(E_v[\text{expit}(\beta_0 + u + v)]\right)^2\right] & \text{different individuals (ICC)} \\
E_{u,v}\left[\text{expit}(\beta_0 + u + v)^2\right] & \text{same individual (within-individual correlation)}
\end{cases}$$

The ICC is then:

$$\text{ICC} = \frac{E[YY']_{\text{diff}} - E[Y]^2}{E[Y](1 - E[Y])}$$

### Poisson Case

The marginal mean is:

$$E[Y] = E_{u,v}[\exp(\beta_0 + u + v)]$$

For Poisson, the marginal variance includes both the Poisson component and the random effect variation:

$$\text{Var}(Y) = E[\mu] + E[\mu^2] - E[\mu]^2$$

The ICC uses this variance in the denominator:

$$\text{ICC} = \frac{E[YY']_{\text{diff}} - E[Y]^2}{\text{Var}(Y)}$$

## Gauss-Hermite Quadrature Implementation

For a function $f(x)$ where $x \sim N(0, \sigma^2)$:

$$E[f(x)] = \frac{1}{\sqrt{\pi}} \sum_{i=1}^{n} w_i f(\sqrt{2}\sigma \cdot x_i)$$

where $x_i$ and $w_i$ are the Gauss-Hermite nodes and weights.

For nested random effects, we use two-dimensional quadrature:

$$E_{u,v}[f(u,v)] = \frac{1}{\pi} \sum_{i=1}^{n} \sum_{j=1}^{n} w_i w_j f(\sqrt{2}\sigma_c x_i, \sqrt{2}\sigma_p x_j)$$

We use 7-point quadrature, which provides good accuracy for smooth integrands.

## Optimization: Levenberg-Marquardt Algorithm

**Cross-sectional (3 parameters):**

We solve for $\boldsymbol{\theta} = (\beta_0, \beta_1, \log\sigma_c)$ such that:

$$\hat{p}_0(\boldsymbol{\theta}) = p_0$$

$$\hat{p}_1(\boldsymbol{\theta}) = p_1$$

$$\widehat{\text{ICC}}(\boldsymbol{\theta}) = \text{ICC}$$

**Cohort with temporal correlation (4+ parameters):**

We solve for $\boldsymbol{\theta} = (\beta_0, \beta_1, \log\sigma_c, \log\sigma_p)$ (plus temporal parameters as needed) such that:

$$\hat{p}_0(\boldsymbol{\theta}) = p_0$$

$$\hat{p}_1(\boldsymbol{\theta}) = p_1$$

$$\widehat{\text{ICC}}(\boldsymbol{\theta}) = \text{ICC}$$

$$\widehat{\text{IAC}}(\boldsymbol{\theta}) = \text{IAC}$$

For nested exchangeable or exponential decay, the cluster variance structure is determined by the CAC or $\lambda$ parameter, which affects how ICC is distributed across permanent and temporal components.

### Algorithm

1. **Initialize** with approximate closed-form solutions based on attenuation factors
2. **Iterate:**
   - Compute residuals $\mathbf{r}$ and numerical Jacobian $\mathbf{J}$
   - Solve $(J^T J + \lambda I)\boldsymbol{\delta} = J^T \mathbf{r}$
   - Line search to find step size $\alpha$ that reduces $\|\mathbf{r}\|^2$
   - Update $\boldsymbol{\theta} \leftarrow \boldsymbol{\theta} + \alpha \boldsymbol{\delta}$
   - Adjust damping: decrease $\lambda$ if improving, increase otherwise
3. **Converge** when $\|\mathbf{r}\|_{\text{RMS}} < 10^{-6}$

We work on the log scale for variance parameters ($\log\sigma_c$, $\log\sigma_p$) to ensure positivity and improve optimization stability.

## Plausibility Checks

### Variance Magnitude Warnings

High correlation values (especially IAC) can require extreme random effect variances. We issue warnings when:

- **Moderate** (warning code 1): Total latent variance $\sigma_c^2 + \sigma_p^2 > \pi^2/3$
- **Extreme** (warning code 2): Total latent variance $\sigma_c^2 + \sigma_p^2 > 2\pi^2/3$
- **Non-convergence** (warning code 3): Solver failed to find valid parameters

### Interpretation of Extreme Variance (Binomial Case)

When $\sigma_p$ is large (e.g., $\sigma_p > 2$), most individuals have latent propensities pushed to extremes. For example, with $\sigma_p = 3$ and $v_i \sim N(0, 9)$:

- ~68% of individuals have $|v_i| > 3$, giving $\text{expit}(v_i) < 0.05$ or $> 0.95$
- ~95% of individuals have $|v_i| > 6$, giving essentially deterministic responses

This means high marginal correlation arises from individuals being "fixed responders" or "fixed non-responders," rather than from moderate clustering. While mathematically valid, this may not match the scientific interpretation users expect.

**Concrete example:** With $p = 0.5$ and IAC $= 0.8$, two observations on the same individual have:

- $P(\text{both } 1) = 0.45$
- $P(\text{both } 0) = 0.45$
- $P(\text{different}) = 0.10$

This means 90% of individuals are "consistent" across periods—they either respond in both or neither. The GLMM achieves this by pushing individuals to extreme latent propensities.

**When is this plausible?**
- Genetic susceptibility to a condition
- Stable chronic diseases
- Fixed traits or preferences

**When is this implausible?**
- Acute symptoms that fluctuate
- Treatment responses with genuine uncertainty
- Behaviours influenced by context

### Implausible Parameter Combinations

Certain combinations of ICC, CAC, and IAC are inherently problematic:

#### Low CAC with High IAC

When CAC is very small (clusters decorrelate quickly over time) but IAC is high (individuals stay highly correlated), the model requires:

- Small cluster temporal correlation: $\rho_{\text{cluster}}(d) \approx 0$ for $d > 0$
- Large within-individual correlation: $\rho_{\text{within}}(d) = \rho_{\text{cluster}}(d) + \text{IAC}(1-\text{ICC})$

This creates a situation where almost all the temporal correlation within individuals must come from the individual random effect $\sigma_p^2$, requiring very large $\sigma_p$.

#### Constraint: Effective IAC at Different Lags

For exponential decay, as lag $d$ increases:

$$\rho_{\text{cluster}}(d) = \lambda^d \times \text{ICC} \to 0$$

$$\rho_{\text{within}}(d) = \lambda^d \times \text{ICC} + \text{IAC}(1-\text{ICC}) \to \text{IAC}(1-\text{ICC})$$

The "effective" individual contribution relative to cluster correlation changes with lag. If we define an effective IAC at lag $d$:

$$\text{IAC}_{\text{eff}}(d) = \frac{\rho_{\text{within}}(d) - \rho_{\text{cluster}}(d)}{1 - \rho_{\text{cluster}}(d)} = \frac{\text{IAC}(1-\text{ICC})}{1 - \lambda^d \times \text{ICC}}$$

At lag 0: $\text{IAC}_{\text{eff}}(0) = \text{IAC}$

As $d \to \infty$: $\text{IAC}_{\text{eff}}(\infty) = \text{IAC}(1-\text{ICC})$

This is always non-negative for valid parameter ranges, but the interpretation shifts across lags.

#### Constraint: Positive Semi-Definiteness

The correlation matrix must be positive semi-definite. For the combined structure (cluster temporal correlation plus constant individual effect), this generally holds when:

1. $0 \leq \text{ICC} \leq 1$
2. $0 \leq \text{CAC} \leq 1$ (or $0 \leq \lambda \leq 1$)
3. $0 \leq \text{IAC} \leq 1$
4. $\rho_{\text{within}}(d) \leq 1$ for all $d$

The last constraint simplifies to:

$$\text{CAC} \times \text{ICC} + \text{IAC}(1-\text{ICC}) \leq 1$$

Which is satisfied whenever all parameters are in $[0, 1]$.

However, while the correlation structure may be mathematically valid, the implied variance components may be unrealistically large for practical GLMM estimation.

### Practical Guidance

| Scenario | Risk | Recommendation |
|----------|------|----------------|
| High IAC (> 0.6), any ICC | Requires large $\sigma_p$ | Consider whether 60%+ consistency is scientifically reasonable |
| Low CAC (< 0.3), high IAC (> 0.5) | Individual effect dominates temporal structure | Verify that clusters truly decorrelate quickly |
| Moderate ICC (0.1-0.2), high IAC (> 0.7) | Large total latent variance | Design effect approximations may not match GLMM results |

## Usage in Power Calculations

After solving for $(\beta_0, \beta_1, \sigma_c, \sigma_p)$ and temporal parameters:

1. These parameters define the GLMM for power calculation
2. At the cluster-period level:
   - Cluster random effect variance: $\sigma_c^2$
   - Cohort effect variance: $\sigma_p^2 / n$ (where $n$ is cluster-period size)
3. The Fisher information matrix is computed using these parameters
4. Power is derived from the variance of the treatment effect estimator

**Note on design effects:** The design effect approach treats correlation as a variance adjustment without specifying the generative mechanism. When fitting an actual GLMM, you're committing to the latent structure—if the fitted variance components differ substantially from assumptions, power calculations may have been misleading.

## References

- Eldridge, S. M., Ukoumunne, O. C., & Carlin, J. B. (2009). The intra-cluster correlation coefficient in cluster randomized trials: a review of definitions. *International Statistical Review*, 77(3), 378-394.

- Preisser, J. S., Stamm, J. W., Long, D. L., & Kincade, M. E. (2012). Review and recommendations for zero-inflated count regression modeling of dental caries indices in epidemiological studies. *Caries Research*, 46(4), 413-423.

- Liu, G. F., Lu, K., Mogg, R., Mallick, M., & Mehrotra, D. V. (2009). Should baseline be a covariate or dependent variable in analyses of change from baseline in clinical trials?. *Statistics in Medicine*, 28(20), 2509-2530.

- Hooper, R., Teerenstra, S., de Hoop, E., & Eldridge, S. (2016). Sample size calculation for stepped wedge and other longitudinal cluster randomised trials. *Statistics in Medicine*, 35(26), 4718-4728.
