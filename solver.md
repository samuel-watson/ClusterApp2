# GLMM Parameter Solver for Power Calculations

## Overview

For power calculations in cluster randomized trials with non-Gaussian outcomes, we need to specify generalized linear mixed model (GLMM) parameters that correspond to user-specified marginal quantities. Users typically specify:

- **Baseline prevalence/rate** ($p_0$ for binomial, $\mu_0$ for Poisson)
- **Treatment group prevalence/rate** ($p_1$ for binomial, $\mu_1$ for Poisson)  
- **Intracluster correlation coefficient (ICC)**: correlation between different individuals in the same cluster
- **Individual autocorrelation (IAC)**: additional correlation for the same individual across time periods (cohort designs only)

The challenge is that these marginal quantities arise from integrating over random effects, creating a nonlinear relationship with the GLMM parameters ($\beta_0$, $\beta_1$, $\sigma_c$, $\sigma_p$).

## Model Structure

### Binomial Model (Logit Link)

For individual $j$ in cluster $i$ at period $k$:

$$Y_{ijk} \mid u_i, v_{ij} \sim \text{Bernoulli}(p_{ijk})$$

$$\text{logit}(p_{ijk}) = \beta_0 + \beta_1 X_{ik} + u_i + v_{ij}$$

where:
- $u_i \sim N(0, \sigma_c^2)$ is the cluster random effect
- $v_{ij} \sim N(0, \sigma_p^2)$ is the individual random effect (cohort designs only)
- $X_{ik}$ is the treatment indicator

### Poisson Model (Log Link)

$$Y_{ijk} \mid u_i, v_{ij} \sim \text{Poisson}(\mu_{ijk})$$

$$\log(\mu_{ijk}) = \beta_0 + \beta_1 X_{ik} + u_i + v_{ij}$$

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

## Defining IAC

The individual autocorrelation (IAC) represents the additional correlation due to repeated measurements on the same individual, beyond the cluster-level correlation. We define it as:

$$\text{IAC} = \frac{\rho_{\text{within-individual}} - \text{ICC}}{1 - \text{ICC}}$$

where $\rho_{\text{within-individual}}$ is the correlation between observations on the same individual across different periods.

This definition ensures:
- IAC = 0 implies no additional individual-level correlation (cross-sectional)
- IAC = 1 implies perfect within-individual correlation given the cluster
- The marginal ICC remains interpretable as the between-cluster correlation

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

**Cohort (4 parameters):**

We solve for $\boldsymbol{\theta} = (\beta_0, \beta_1, \log\sigma_c, \log\sigma_p)$ such that:

$$\hat{p}_0(\boldsymbol{\theta}) = p_0$$

$$\hat{p}_1(\boldsymbol{\theta}) = p_1$$

$$\widehat{\text{ICC}}(\boldsymbol{\theta}) = \text{ICC}$$

$$\widehat{\text{IAC}}(\boldsymbol{\theta}) = \text{IAC}$$

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

High IAC values with low ICC can require extreme random effect variances. We issue warnings when:

- **Moderate** (warning code 1): Total latent variance $\sigma_c^2 + \sigma_p^2 > \pi^2/3$
- **Extreme** (warning code 2): Total latent variance $\sigma_c^2 + \sigma_p^2 > 2\pi^2/3$
- **Non-convergence** (warning code 3): Solver failed to find valid parameters

### Interpretation of Extreme Variance

When $\sigma_p$ is large (e.g., $\sigma_p > 2$), most individuals have latent propensities pushed to extremes. For example, with $\sigma_p = 3$:

- ~68% of individuals have $|v| > 3$, giving $\text{expit}(v) < 0.05$ or $> 0.95$
- These individuals have nearly deterministic outcomes

This means high marginal correlation arises from individuals being "fixed responders" or "fixed non-responders," rather than from moderate clustering. While mathematically valid, this may not match the scientific interpretation users expect.

## Usage in Power Calculations

After solving for $(\beta_0, \beta_1, \sigma_c, \sigma_p)$:

1. These parameters define the GLMM for power calculation
2. At the cluster-period level:
   - Cluster random effect variance: $\sigma_c^2$
   - Cohort effect variance: $\sigma_p^2 / n$ (where $n$ is cluster-period size)
3. The Fisher information matrix is computed using these parameters
4. Power is derived from the variance of the treatment effect estimator

## References

- Eldridge, S. M., Ukoumunne, O. C., & Carlin, J. B. (2009). The intra-cluster correlation coefficient in cluster randomized trials: a review of definitions. *International Statistical Review*, 77(3), 378-394.

- Preisser, J. S., Stamm, J. W., Long, D. L., & Kincade, M. E. (2012). Review and recommendations for zero-inflated count regression modeling of dental caries indices in epidemiological studies. *Caries Research*, 46(4), 413-423.

- Liu, G. F., Lu, K., Mogg, R., Mallick, M., & Mehrotra, D. V. (2009). Should baseline be a covariate or dependent variable in analyses of change from baseline in clinical trials?. *Statistics in Medicine*, 28(20), 2509-2530.
