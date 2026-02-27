// glmm_wasm.cpp
// WASM interface for GLMM library
// Compile with Emscripten
#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <string>
#include <vector>
#include <cmath>
#include <memory>
#include <boost/math/distributions/normal.hpp>
#include <boost/math/distributions/students_t.hpp>

// Include the glmmr header-only library
#include "glmmr.h"

using namespace emscripten;

#include <cmath>
#include <array>
#include <vector>
#include <algorithm>

// Gauss-Hermite nodes and weights (7-point for accuracy)
constexpr int GH_N = 7;
constexpr std::array<double, GH_N> gh_nodes = {
    -2.65196, -1.67355, -0.81629, 0.0, 0.81629, 1.67355, 2.65196
};
constexpr std::array<double, GH_N> gh_weights = {
    0.00097, 0.05455, 0.42560, 0.81026, 0.42560, 0.05455, 0.00097
};

inline double expit(double x) {
    if (x > 20.0) return 1.0;
    if (x < -20.0) return 0.0;
    return 1.0 / (1.0 + std::exp(-x));
}

struct MarginalMoments {
    double mean;           // E[Y]
    double EYY_same_v;     // E_{u,v}[expit(...)^2] - same individual across periods
    double EYY_diff_v;     // E_u[(E_v[expit(...)])^2] - different individuals
};

// Structure to hold the three moments we need
struct MarginalMomentsCohort {
    double mean;
    double EYY_same_period;    // For ICC
    double EYY_same_ind_lag1;  // For within-individual correlation at lag 1
};

MarginalMoments computeMoments(double beta, double sigma_c, double sigma_p) {
    MarginalMoments m = {0.0, 0.0, 0.0};
    
    const double sqrt2 = std::sqrt(2.0);
    const double inv_sqrt_pi = 1.0 / std::sqrt(M_PI);
    
    for (int i = 0; i < GH_N; i++) {
        double u = sqrt2 * sigma_c * gh_nodes[i];
        double w_u = gh_weights[i];
        
        double inner_mean = 0.0;
        double inner_sq = 0.0;
        
        if (sigma_p > 1e-10) {
            for (int j = 0; j < GH_N; j++) {
                double v = sqrt2 * sigma_p * gh_nodes[j];
                double w_v = gh_weights[j];
                
                double p = expit(beta + u + v);
                inner_mean += w_v * p;
                inner_sq += w_v * p * p;
            }
            inner_mean *= inv_sqrt_pi;
            inner_sq *= inv_sqrt_pi;
        } else {
            // No individual effect - cross-sectional
            double p = expit(beta + u);
            inner_mean = p;
            inner_sq = p * p;
        }
        
        m.mean += w_u * inner_mean;
        m.EYY_same_v += w_u * inner_sq;
        m.EYY_diff_v += w_u * inner_mean * inner_mean;
    }
    
    m.mean *= inv_sqrt_pi;
    m.EYY_same_v *= inv_sqrt_pi;
    m.EYY_diff_v *= inv_sqrt_pi;
    
    return m;
}

// Compute moments with cluster decay and individual effect
// decay_at_lag1: CAC for nested exchangeable, lambda for exponential decay
MarginalMomentsCohort computeMomentsCohort(double beta, double sigma_c, double sigma_p, 
                                            double decay_at_lag1) {
    const double sqrt2 = std::sqrt(2.0);
    const double inv_sqrt_pi = 1.0 / std::sqrt(M_PI);
    
    // Decompose cluster variance for lag 1 computation
    // At lag 0 (same period): full sigma_c contributes
    // At lag 1: sigma_c * sqrt(decay) contributes to covariance
    double sigma_c_persistent = sigma_c * std::sqrt(decay_at_lag1);
    double sigma_c_transient = sigma_c * std::sqrt(1.0 - decay_at_lag1);
    
    double mean_Y = 0.0;
    double EYY_same_period = 0.0;   // Different individuals, same period -> ICC
    double EYY_same_ind_lag1 = 0.0; // Same individual, lag 1 -> within-ind correlation
    
    // Loop over persistent cluster effect (shared across periods)
    for (int i_u = 0; i_u < GH_N; i_u++) {
        double u_perm = sqrt2 * sigma_c_persistent * gh_nodes[i_u];
        double w_u = gh_weights[i_u];
        
        // E_{w,v}[expit(...)] where w is transient cluster, v is individual
        double E_wv = 0.0;
        double E_wv_sq = 0.0;  // For same-period correlation (different individuals)
        
        // Loop over transient cluster effect
        for (int i_w = 0; i_w < GH_N; i_w++) {
            double w_trans = (sigma_c_transient > 1e-10) ? 
                             sqrt2 * sigma_c_transient * gh_nodes[i_w] : 0.0;
            double w_w = (sigma_c_transient > 1e-10) ? gh_weights[i_w] : 1.0;
            
            // E_v[expit(...)] given u_perm and w_trans
            double E_v = 0.0;
            
            for (int i_v = 0; i_v < GH_N; i_v++) {
                double v = (sigma_p > 1e-10) ? sqrt2 * sigma_p * gh_nodes[i_v] : 0.0;
                double w_v = (sigma_p > 1e-10) ? gh_weights[i_v] : 1.0;
                
                double p = expit(beta + u_perm + w_trans + v);
                E_v += w_v * p;
            }
            if (sigma_p > 1e-10) E_v *= inv_sqrt_pi;
            
            E_wv += w_w * E_v;
            E_wv_sq += w_w * E_v * E_v;  // (E_v)^2 for different individuals same period
        }
        if (sigma_c_transient > 1e-10) {
            E_wv *= inv_sqrt_pi;
            E_wv_sq *= inv_sqrt_pi;
        }
        
        mean_Y += w_u * E_wv;
        EYY_same_period += w_u * E_wv_sq;
        
        // For same individual at lag 1: shares u_perm and v, but different w
        // E_{v}[(E_w[expit(...)])^2]
        double E_v_of_Ew_sq = 0.0;
        
        for (int i_v = 0; i_v < GH_N; i_v++) {
            double v = (sigma_p > 1e-10) ? sqrt2 * sigma_p * gh_nodes[i_v] : 0.0;
            double w_v = (sigma_p > 1e-10) ? gh_weights[i_v] : 1.0;
            
            // E_w[expit(beta + u_perm + w + v)] given u_perm and v
            double E_w = 0.0;
            
            for (int i_w = 0; i_w < GH_N; i_w++) {
                double w_trans = (sigma_c_transient > 1e-10) ? 
                                 sqrt2 * sigma_c_transient * gh_nodes[i_w] : 0.0;
                double w_w = (sigma_c_transient > 1e-10) ? gh_weights[i_w] : 1.0;
                
                double p = expit(beta + u_perm + w_trans + v);
                E_w += w_w * p;
            }
            if (sigma_c_transient > 1e-10) E_w *= inv_sqrt_pi;
            
            E_v_of_Ew_sq += w_v * E_w * E_w;
        }
        if (sigma_p > 1e-10) E_v_of_Ew_sq *= inv_sqrt_pi;
        
        EYY_same_ind_lag1 += w_u * E_v_of_Ew_sq;
    }
    
    mean_Y *= inv_sqrt_pi;
    EYY_same_period *= inv_sqrt_pi;
    EYY_same_ind_lag1 *= inv_sqrt_pi;
    
    return {mean_Y, EYY_same_period, EYY_same_ind_lag1};
}



// Compute correlations
struct CorrelationsCohort {
    double icc;
    double within_ind_lag1;
    double iac;
};

CorrelationsCohort computeCorrelationsCohort(const MarginalMomentsCohort& m) {
    double EY = m.mean;
    double var_Y = EY * (1.0 - EY);
    
    if (var_Y < 1e-10) {
        return {0.0, 0.0, 0.0};
    }
    
    double icc = (m.EYY_same_period - EY * EY) / var_Y;
    double within_ind = (m.EYY_same_ind_lag1 - EY * EY) / var_Y;
    
    double iac = 0.0;
    if (icc < 1.0 - 1e-10) {
        iac = (within_ind - icc) / (1.0 - icc);
    }
    
    return {icc, within_ind, iac};
}

inline double computeCorr(double EYY, double EY) {
    double var_Y = EY * (1.0 - EY);
    if (var_Y < 1e-10) return 0.0;
    return (EYY - EY * EY) / var_Y;
}

struct SolverResult {
    double beta0;
    double beta1;
    double sigma_c;
    double sigma_p;
    bool converged;
    int iterations;
    int warning_code;  // 0 = OK, 1 = high variance, 2 = extreme variance, 3 = failed
};

int checkPlausibility(double sigma_c, double sigma_p) {
    double total_var = sigma_c * sigma_c + sigma_p * sigma_p;
    static const double pi2_3 = M_PI * M_PI / 3.0;
    
    if (total_var > 2.0 * pi2_3) {
        return 2;  // Extreme
    } else if (total_var > pi2_3) {
        return 1;  // High
    }
    return 0;
}


SolverResult solveParametersCohortBinomial(double p0, double p1, double icc, double iac,
                                            double decay_at_lag1,
                                            int max_iter = 150, double tol = 1e-6) {
    static const double c = 0.588;
    static const double pi2_3 = M_PI * M_PI / 3.0;
    
    // Initial guesses
    double sigma_c_init = std::sqrt(icc * pi2_3 / (1.0 - icc + 0.01));
    sigma_c_init = std::max(0.1, std::min(2.0, sigma_c_init));
    
    // Target within-individual correlation at lag 1
    double target_within_ind = decay_at_lag1 * icc + iac * (1.0 - icc);
    
    // Initial sigma_p based on target
    double sigma_p_init = std::sqrt(std::max(0.01, iac * pi2_3 / (1.0 - iac + 0.01))) * 0.5;
    sigma_p_init = std::max(0.05, std::min(2.0, sigma_p_init));
    
    double V_total = sigma_c_init * sigma_c_init + sigma_p_init * sigma_p_init;
    double atten = std::sqrt(1.0 + c * c * V_total);
    
    double beta0_init = std::log(p0 / (1.0 - p0)) * atten;
    double beta1_init = std::log(p1 / (1.0 - p1)) * atten - beta0_init;
    
    // params = {beta0, beta1, log_sigma_c, log_sigma_p}
    std::array<double, 4> params = {
        beta0_init,
        beta1_init,
        std::log(sigma_c_init),
        std::log(sigma_p_init)
    };
    
    const double beta_max = 10.0;
    const double log_sigma_min = -4.0;
    const double log_sigma_max = 4.0;
    const double eps = 1e-5;
    
    double lambda = 0.1;
    
    for (int iter = 0; iter < max_iter; iter++) {
        double sigma_c = std::exp(params[2]);
        double sigma_p = std::exp(params[3]);
        
        auto m0 = computeMomentsCohort(params[0], sigma_c, sigma_p, decay_at_lag1);
        auto m1 = computeMomentsCohort(params[0] + params[1], sigma_c, sigma_p, decay_at_lag1);
        
        auto corrs0 = computeCorrelationsCohort(m0);
        
        double curr_p0 = m0.mean;
        double curr_p1 = m1.mean;
        double curr_icc = corrs0.icc;
        double curr_within_ind = corrs0.within_ind_lag1;
        
        // Residuals: match p0, p1, ICC, and within-individual correlation at lag 1
        std::array<double, 4> residuals = {
            p0 - curr_p0,
            p1 - curr_p1,
            icc - curr_icc,
            target_within_ind - curr_within_ind
        };
        
        double sum_sq = residuals[0]*residuals[0] + residuals[1]*residuals[1] +
                        residuals[2]*residuals[2] + residuals[3]*residuals[3];
        double rms_resid = std::sqrt(sum_sq / 4.0);
        
        if (iter % 20 == 0) {
            EM_ASM({
                console.log("Iter", $0, ": rms=", $1, "icc=", $2, "within_ind=", $3, 
                            "sigma_c=", $4, "sigma_p=", $5);
            }, iter, rms_resid, curr_icc, curr_within_ind, sigma_c, sigma_p);
        }
        
        if (rms_resid < tol) {
            int warning = checkPlausibility(sigma_c, sigma_p);
            return {params[0], params[1], sigma_c, sigma_p, true, iter, warning};
        }
        
        // Numerical Jacobian
        std::array<std::array<double, 4>, 4> J;
        for (int j = 0; j < 4; j++) {
            std::array<double, 4> params_plus = params;
            double h = std::max(eps, std::abs(params[j]) * eps);
            params_plus[j] += h;
            
            double sc_p = std::exp(params_plus[2]);
            double sp_p = std::exp(params_plus[3]);
            
            auto m0_p = computeMomentsCohort(params_plus[0], sc_p, sp_p, decay_at_lag1);
            auto m1_p = computeMomentsCohort(params_plus[0] + params_plus[1], sc_p, sp_p, decay_at_lag1);
            auto corrs0_p = computeCorrelationsCohort(m0_p);
            
            J[0][j] = (m0_p.mean - curr_p0) / h;
            J[1][j] = (m1_p.mean - curr_p1) / h;
            J[2][j] = (corrs0_p.icc - curr_icc) / h;
            J[3][j] = (corrs0_p.within_ind_lag1 - curr_within_ind) / h;
        }
        
        // Levenberg-Marquardt
        std::array<std::array<double, 4>, 4> JTJ;
        std::array<double, 4> JTr;
        
        for (int i = 0; i < 4; i++) {
            JTr[i] = 0.0;
            for (int k = 0; k < 4; k++) {
                JTr[i] += J[k][i] * residuals[k];
            }
            for (int jj = 0; jj < 4; jj++) {
                JTJ[i][jj] = 0.0;
                for (int k = 0; k < 4; k++) {
                    JTJ[i][jj] += J[k][i] * J[k][jj];
                }
            }
            JTJ[i][i] += lambda;
        }
        
        // Gaussian elimination
        std::array<std::array<double, 5>, 4> aug;
        for (int i = 0; i < 4; i++) {
            for (int jj = 0; jj < 4; jj++) aug[i][jj] = JTJ[i][jj];
            aug[i][4] = JTr[i];
        }
        
        for (int col = 0; col < 4; col++) {
            int pivot = col;
            for (int row = col + 1; row < 4; row++) {
                if (std::abs(aug[row][col]) > std::abs(aug[pivot][col])) pivot = row;
            }
            std::swap(aug[col], aug[pivot]);
            if (std::abs(aug[col][col]) < 1e-14) aug[col][col] = 1e-14;
            
            for (int row = col + 1; row < 4; row++) {
                double factor = aug[row][col] / aug[col][col];
                for (int k = col; k < 5; k++) aug[row][k] -= factor * aug[col][k];
            }
        }
        
        std::array<double, 4> delta = {0, 0, 0, 0};
        for (int i = 3; i >= 0; i--) {
            delta[i] = aug[i][4];
            for (int jj = i + 1; jj < 4; jj++) delta[i] -= aug[i][jj] * delta[jj];
            delta[i] /= aug[i][i];
        }
        
        // Trust region
        double step_norm = std::sqrt(delta[0]*delta[0] + delta[1]*delta[1] +
                                     delta[2]*delta[2] + delta[3]*delta[3]);
        if (step_norm > 2.0) {
            for (int i = 0; i < 4; i++) delta[i] *= 2.0 / step_norm;
        }
        
        // Line search
        double alpha = 1.0;
        bool improved = false;
        
        for (int ls = 0; ls < 15; ls++) {
            std::array<double, 4> params_new = {
                std::max(-beta_max, std::min(beta_max, params[0] + alpha * delta[0])),
                std::max(-beta_max, std::min(beta_max, params[1] + alpha * delta[1])),
                std::max(log_sigma_min, std::min(log_sigma_max, params[2] + alpha * delta[2])),
                std::max(log_sigma_min, std::min(log_sigma_max, params[3] + alpha * delta[3]))
            };
            
            double sc_new = std::exp(params_new[2]);
            double sp_new = std::exp(params_new[3]);
            
            auto m0_new = computeMomentsCohort(params_new[0], sc_new, sp_new, decay_at_lag1);
            auto m1_new = computeMomentsCohort(params_new[0] + params_new[1], sc_new, sp_new, decay_at_lag1);
            auto corrs_new = computeCorrelationsCohort(m0_new);
            
            double new_sum_sq = (p0 - m0_new.mean) * (p0 - m0_new.mean) +
                                (p1 - m1_new.mean) * (p1 - m1_new.mean) +
                                (icc - corrs_new.icc) * (icc - corrs_new.icc) +
                                (target_within_ind - corrs_new.within_ind_lag1) * 
                                (target_within_ind - corrs_new.within_ind_lag1);
            
            if (new_sum_sq < sum_sq) {
                params = params_new;
                improved = true;
                lambda = std::max(1e-8, lambda * 0.7);
                break;
            }
            alpha *= 0.5;
        }
        
        if (!improved) {
            lambda = std::min(1e6, lambda * 3.0);
        }
    }
    
    double sigma_c = std::exp(params[2]);
    double sigma_p = std::exp(params[3]);
    int warning = 3;
    
    EM_ASM({
        console.warn("Cohort solver did not converge.");
    });
    
    return {params[0], params[1], sigma_c, sigma_p, false, max_iter, warning};
}

MarginalMomentsCohort computeMomentsCohortPoisson(double beta, double sigma_c, double sigma_p,
                                                   double decay_at_lag1) {
    const double sqrt2 = std::sqrt(2.0);
    const double inv_sqrt_pi = 1.0 / std::sqrt(M_PI);
    
    double sigma_c_persistent = sigma_c * std::sqrt(decay_at_lag1);
    double sigma_c_transient = sigma_c * std::sqrt(1.0 - decay_at_lag1);
    
    double mean_Y = 0.0;
    double EYY_same_period = 0.0;
    double EYY_same_ind_lag1 = 0.0;
    
    // Loop over persistent cluster effect
    for (int i_u = 0; i_u < GH_N; i_u++) {
        double u_perm = sqrt2 * sigma_c_persistent * gh_nodes[i_u];
        double w_u = gh_weights[i_u];
        
        double E_wv = 0.0;
        double E_wv_sq = 0.0;
        
        // Loop over transient cluster effect
        for (int i_w = 0; i_w < GH_N; i_w++) {
            double w_trans = (sigma_c_transient > 1e-10) ? 
                             sqrt2 * sigma_c_transient * gh_nodes[i_w] : 0.0;
            double w_w = (sigma_c_transient > 1e-10) ? gh_weights[i_w] : 1.0;
            
            double E_v = 0.0;
            
            for (int i_v = 0; i_v < GH_N; i_v++) {
                double v = (sigma_p > 1e-10) ? sqrt2 * sigma_p * gh_nodes[i_v] : 0.0;
                double w_v = (sigma_p > 1e-10) ? gh_weights[i_v] : 1.0;
                
                double mu = std::exp(beta + u_perm + w_trans + v);
                E_v += w_v * mu;
            }
            if (sigma_p > 1e-10) E_v *= inv_sqrt_pi;
            
            E_wv += w_w * E_v;
            E_wv_sq += w_w * E_v * E_v;
        }
        if (sigma_c_transient > 1e-10) {
            E_wv *= inv_sqrt_pi;
            E_wv_sq *= inv_sqrt_pi;
        }
        
        mean_Y += w_u * E_wv;
        EYY_same_period += w_u * E_wv_sq;
        
        // Same individual, different period: shares u_perm and v, different w
        double E_v_of_Ew_sq = 0.0;
        
        for (int i_v = 0; i_v < GH_N; i_v++) {
            double v = (sigma_p > 1e-10) ? sqrt2 * sigma_p * gh_nodes[i_v] : 0.0;
            double w_v = (sigma_p > 1e-10) ? gh_weights[i_v] : 1.0;
            
            double E_w = 0.0;
            
            for (int i_w = 0; i_w < GH_N; i_w++) {
                double w_trans = (sigma_c_transient > 1e-10) ? 
                                 sqrt2 * sigma_c_transient * gh_nodes[i_w] : 0.0;
                double w_w = (sigma_c_transient > 1e-10) ? gh_weights[i_w] : 1.0;
                
                double mu = std::exp(beta + u_perm + w_trans + v);
                E_w += w_w * mu;
            }
            if (sigma_c_transient > 1e-10) E_w *= inv_sqrt_pi;
            
            E_v_of_Ew_sq += w_v * E_w * E_w;
        }
        if (sigma_p > 1e-10) E_v_of_Ew_sq *= inv_sqrt_pi;
        
        EYY_same_ind_lag1 += w_u * E_v_of_Ew_sq;
    }
    
    mean_Y *= inv_sqrt_pi;
    EYY_same_period *= inv_sqrt_pi;
    EYY_same_ind_lag1 *= inv_sqrt_pi;
    
    return {mean_Y, EYY_same_period, EYY_same_ind_lag1};
}

CorrelationsCohort computeCorrelationsCohortPoisson(const MarginalMomentsCohort& m) {
    double EY = m.mean;
    
    // Poisson variance: Var(Y) = E[mu] + Var(mu) = E[Y] + E[Y^2] - E[Y]^2
    // Here E[Y^2] corresponds to same individual same period = EYY_same_period when lag=0
    // But we need E[mu^2], which is EYY_same_period (since for same individual same period, 
    // Y*Y' shares everything)
    
    // Actually for correlation purposes with Poisson:
    // Var(Y) = E[Y] + (E[mu^2] - E[mu]^2)
    // For two observations Y, Y' with E[YY'] = E[mu*mu'], correlation is:
    // Corr = (E[mu*mu'] - E[mu]^2) / Var(Y)
    
    double var_mu = m.EYY_same_period - EY * EY;  // Variance of mu (using same-period as proxy)
    double var_Y = EY + var_mu;
    
    if (var_Y < 1e-10) {
        return {0.0, 0.0, 0.0};
    }
    
    // ICC: different individuals, same period
    double icc = (m.EYY_same_period - EY * EY) / var_Y;
    
    // Within-individual at lag 1
    double within_ind = (m.EYY_same_ind_lag1 - EY * EY) / var_Y;
    
    double iac = 0.0;
    if (icc < 1.0 - 1e-10) {
        iac = (within_ind - icc) / (1.0 - icc);
    }
    
    return {icc, within_ind, iac};
}

MarginalMoments computeMomentsPoisson(double beta, double sigma_c, double sigma_p) {
    MarginalMoments m = {0.0, 0.0, 0.0};
    
    const double sqrt2 = std::sqrt(2.0);
    const double inv_sqrt_pi = 1.0 / std::sqrt(M_PI);
    
    for (int i = 0; i < GH_N; i++) {
        double u = sqrt2 * sigma_c * gh_nodes[i];
        double w_u = gh_weights[i];
        
        double inner_mean = 0.0;
        double inner_sq = 0.0;
        
        if (sigma_p > 1e-10) {
            for (int j = 0; j < GH_N; j++) {
                double v = sqrt2 * sigma_p * gh_nodes[j];
                double w_v = gh_weights[j];
                
                double mu = std::exp(beta + u + v);
                inner_mean += w_v * mu;
                inner_sq += w_v * mu * mu;
            }
            inner_mean *= inv_sqrt_pi;
            inner_sq *= inv_sqrt_pi;
        } else {
            double mu = std::exp(beta + u);
            inner_mean = mu;
            inner_sq = mu * mu;
        }
        
        m.mean += w_u * inner_mean;
        m.EYY_same_v += w_u * inner_sq;
        m.EYY_diff_v += w_u * inner_mean * inner_mean;
    }
    
    m.mean *= inv_sqrt_pi;
    m.EYY_same_v *= inv_sqrt_pi;
    m.EYY_diff_v *= inv_sqrt_pi;
    
    return m;
}

inline double computeCorrPoisson(double EYY, double EY, double EY2_same_v) {
    // For Poisson: Var(Y) = E[mu] + Var(mu) = E[mu] + E[mu^2] - E[mu]^2
    double var_Y = EY + EY2_same_v - EY * EY;
    if (var_Y < 1e-10) return 0.0;
    return (EYY - EY * EY) / var_Y;
}

SolverResult solveParametersCohortPoisson(double mu0, double mu1, double icc, double iac,
                                           double decay_at_lag1,
                                           int max_iter = 150, double tol = 1e-6) {
    // Initial guesses
    double sigma_c_init = std::sqrt(std::max(0.01, icc * 0.5));
    double sigma_p_init = std::sqrt(std::max(0.01, iac * 0.3));
    
    double V_init = sigma_c_init * sigma_c_init + sigma_p_init * sigma_p_init;
    double beta0_init = std::log(mu0) - V_init / 2.0;
    double beta1_init = std::log(mu1) - V_init / 2.0 - beta0_init;
    
    // Target within-individual correlation at lag 1
    double target_within_ind = decay_at_lag1 * icc + iac * (1.0 - icc);
    
    std::array<double, 4> params = {
        beta0_init,
        beta1_init,
        std::log(sigma_c_init),
        std::log(sigma_p_init)
    };
    
    const double beta_max = 10.0;
    const double log_sigma_min = -4.0;
    const double log_sigma_max = 4.0;
    const double eps = 1e-5;
    
    double lambda = 0.1;
    
    for (int iter = 0; iter < max_iter; iter++) {
        double sigma_c = std::exp(params[2]);
        double sigma_p = std::exp(params[3]);
        
        auto m0 = computeMomentsCohortPoisson(params[0], sigma_c, sigma_p, decay_at_lag1);
        auto m1 = computeMomentsCohortPoisson(params[0] + params[1], sigma_c, sigma_p, decay_at_lag1);
        
        auto corrs0 = computeCorrelationsCohortPoisson(m0);
        
        double curr_mu0 = m0.mean;
        double curr_mu1 = m1.mean;
        double curr_icc = corrs0.icc;
        double curr_within_ind = corrs0.within_ind_lag1;
        
        std::array<double, 4> residuals = {
            mu0 - curr_mu0,
            mu1 - curr_mu1,
            icc - curr_icc,
            target_within_ind - curr_within_ind
        };
        
        double sum_sq = residuals[0]*residuals[0] + residuals[1]*residuals[1] +
                        residuals[2]*residuals[2] + residuals[3]*residuals[3];
        double rms_resid = std::sqrt(sum_sq / 4.0);
        
        if (iter % 20 == 0) {
            EM_ASM({
                console.log("Poisson Iter", $0, ": rms=", $1, "icc=", $2, 
                            "within_ind=", $3, "sigma_c=", $4, "sigma_p=", $5);
            }, iter, rms_resid, curr_icc, curr_within_ind, sigma_c, sigma_p);
        }
        
        if (rms_resid < tol) {
            int warning = checkPlausibility(sigma_c, sigma_p);
            return {params[0], params[1], sigma_c, sigma_p, true, iter, warning};
        }
        
        // Numerical Jacobian
        std::array<std::array<double, 4>, 4> J;
        for (int j = 0; j < 4; j++) {
            std::array<double, 4> params_plus = params;
            double h = std::max(eps, std::abs(params[j]) * eps);
            params_plus[j] += h;
            
            double sc_p = std::exp(params_plus[2]);
            double sp_p = std::exp(params_plus[3]);
            
            auto m0_p = computeMomentsCohortPoisson(params_plus[0], sc_p, sp_p, decay_at_lag1);
            auto m1_p = computeMomentsCohortPoisson(params_plus[0] + params_plus[1], sc_p, sp_p, decay_at_lag1);
            auto corrs0_p = computeCorrelationsCohortPoisson(m0_p);
            
            J[0][j] = (m0_p.mean - curr_mu0) / h;
            J[1][j] = (m1_p.mean - curr_mu1) / h;
            J[2][j] = (corrs0_p.icc - curr_icc) / h;
            J[3][j] = (corrs0_p.within_ind_lag1 - curr_within_ind) / h;
        }
        
        // Levenberg-Marquardt
        std::array<std::array<double, 4>, 4> JTJ;
        std::array<double, 4> JTr;
        
        for (int i = 0; i < 4; i++) {
            JTr[i] = 0.0;
            for (int k = 0; k < 4; k++) {
                JTr[i] += J[k][i] * residuals[k];
            }
            for (int jj = 0; jj < 4; jj++) {
                JTJ[i][jj] = 0.0;
                for (int k = 0; k < 4; k++) {
                    JTJ[i][jj] += J[k][i] * J[k][jj];
                }
            }
            JTJ[i][i] += lambda;
        }
        
        // Gaussian elimination
        std::array<std::array<double, 5>, 4> aug;
        for (int i = 0; i < 4; i++) {
            for (int jj = 0; jj < 4; jj++) aug[i][jj] = JTJ[i][jj];
            aug[i][4] = JTr[i];
        }
        
        for (int col = 0; col < 4; col++) {
            int pivot = col;
            for (int row = col + 1; row < 4; row++) {
                if (std::abs(aug[row][col]) > std::abs(aug[pivot][col])) pivot = row;
            }
            std::swap(aug[col], aug[pivot]);
            if (std::abs(aug[col][col]) < 1e-14) aug[col][col] = 1e-14;
            
            for (int row = col + 1; row < 4; row++) {
                double factor = aug[row][col] / aug[col][col];
                for (int k = col; k < 5; k++) aug[row][k] -= factor * aug[col][k];
            }
        }
        
        std::array<double, 4> delta = {0, 0, 0, 0};
        for (int i = 3; i >= 0; i--) {
            delta[i] = aug[i][4];
            for (int jj = i + 1; jj < 4; jj++) delta[i] -= aug[i][jj] * delta[jj];
            delta[i] /= aug[i][i];
        }
        
        // Trust region
        double step_norm = std::sqrt(delta[0]*delta[0] + delta[1]*delta[1] +
                                     delta[2]*delta[2] + delta[3]*delta[3]);
        if (step_norm > 2.0) {
            for (int i = 0; i < 4; i++) delta[i] *= 2.0 / step_norm;
        }
        
        // Line search
        double alpha = 1.0;
        bool improved = false;
        
        for (int ls = 0; ls < 15; ls++) {
            std::array<double, 4> params_new = {
                std::max(-beta_max, std::min(beta_max, params[0] + alpha * delta[0])),
                std::max(-beta_max, std::min(beta_max, params[1] + alpha * delta[1])),
                std::max(log_sigma_min, std::min(log_sigma_max, params[2] + alpha * delta[2])),
                std::max(log_sigma_min, std::min(log_sigma_max, params[3] + alpha * delta[3]))
            };
            
            double sc_new = std::exp(params_new[2]);
            double sp_new = std::exp(params_new[3]);
            
            auto m0_new = computeMomentsCohortPoisson(params_new[0], sc_new, sp_new, decay_at_lag1);
            auto m1_new = computeMomentsCohortPoisson(params_new[0] + params_new[1], sc_new, sp_new, decay_at_lag1);
            auto corrs_new = computeCorrelationsCohortPoisson(m0_new);
            
            double new_sum_sq = (mu0 - m0_new.mean) * (mu0 - m0_new.mean) +
                                (mu1 - m1_new.mean) * (mu1 - m1_new.mean) +
                                (icc - corrs_new.icc) * (icc - corrs_new.icc) +
                                (target_within_ind - corrs_new.within_ind_lag1) * 
                                (target_within_ind - corrs_new.within_ind_lag1);
            
            if (new_sum_sq < sum_sq) {
                params = params_new;
                improved = true;
                lambda = std::max(1e-8, lambda * 0.7);
                break;
            }
            alpha *= 0.5;
        }
        
        if (!improved) {
            lambda = std::min(1e6, lambda * 3.0);
        }
    }
    
    double sigma_c = std::exp(params[2]);
    double sigma_p = std::exp(params[3]);
    
    EM_ASM({
        console.warn("Poisson cohort solver did not converge.");
    });
    
    return {params[0], params[1], sigma_c, sigma_p, false, max_iter, 3};
}

SolverResult solveParametersCrossSectionalBinomial(double p0, double p1, double icc,
                                                    int max_iter = 100, double tol = 1e-6) {
    static const double pi2_3 = M_PI * M_PI / 3.0;
    static const double c = 0.588;
    
    // Initial guesses
    double sigma_c_init = std::sqrt(icc * pi2_3 / (1.0 - icc + 0.01));
    sigma_c_init = std::max(0.1, std::min(2.0, sigma_c_init));
    
    double atten = std::sqrt(1.0 + c * c * sigma_c_init * sigma_c_init);
    double beta0_init = std::log(p0 / (1.0 - p0)) * atten;
    double beta1_init = std::log(p1 / (1.0 - p1)) * atten - beta0_init;
    
    // params = {beta0, beta1, log_sigma_c}
    std::array<double, 3> params = {
        beta0_init,
        beta1_init,
        std::log(sigma_c_init)
    };
    
    const double beta_max = 10.0;
    const double log_sigma_min = -4.0;
    const double log_sigma_max = 4.0;
    const double eps = 1e-5;
    
    double lambda = 0.1;
    
    for (int iter = 0; iter < max_iter; iter++) {
        double sigma_c = std::exp(params[2]);
        
        auto m0 = computeMoments(params[0], sigma_c, 0.0);
        auto m1 = computeMoments(params[0] + params[1], sigma_c, 0.0);
        
        double curr_p0 = m0.mean;
        double curr_p1 = m1.mean;
        double curr_icc = computeCorr(m0.EYY_diff_v, m0.mean);
        
        std::array<double, 3> residuals = {
            p0 - curr_p0,
            p1 - curr_p1,
            icc - curr_icc
        };
        
        double sum_sq = residuals[0]*residuals[0] + residuals[1]*residuals[1] +
                        residuals[2]*residuals[2];
        double rms_resid = std::sqrt(sum_sq / 3.0);
        
        if (iter % 20 == 0) {
            EM_ASM({
                console.log("Binomial XS Iter", $0, ": rms=", $1, "sigma_c=", $2, "icc=", $3);
            }, iter, rms_resid, sigma_c, curr_icc);
        }
        
        if (rms_resid < tol) {
            int warning = checkPlausibility(sigma_c, 0.0);
            return {params[0], params[1], sigma_c, 0.0, true, iter, warning};
        }
        
        // Numerical Jacobian (3x3)
        std::array<std::array<double, 3>, 3> J;
        for (int j = 0; j < 3; j++) {
            std::array<double, 3> params_plus = params;
            double h = std::max(eps, std::abs(params[j]) * eps);
            params_plus[j] += h;
            
            double sc_p = std::exp(params_plus[2]);
            
            auto m0_p = computeMoments(params_plus[0], sc_p, 0.0);
            auto m1_p = computeMoments(params_plus[0] + params_plus[1], sc_p, 0.0);
            
            double icc_p = computeCorr(m0_p.EYY_diff_v, m0_p.mean);
            
            J[0][j] = (m0_p.mean - curr_p0) / h;
            J[1][j] = (m1_p.mean - curr_p1) / h;
            J[2][j] = (icc_p - curr_icc) / h;
        }
        
        // Levenberg-Marquardt (3x3)
        std::array<std::array<double, 3>, 3> JTJ;
        std::array<double, 3> JTr;
        
        for (int i = 0; i < 3; i++) {
            JTr[i] = 0.0;
            for (int k = 0; k < 3; k++) {
                JTr[i] += J[k][i] * residuals[k];
            }
            for (int jj = 0; jj < 3; jj++) {
                JTJ[i][jj] = 0.0;
                for (int k = 0; k < 3; k++) {
                    JTJ[i][jj] += J[k][i] * J[k][jj];
                }
            }
            JTJ[i][i] += lambda;
        }
        
        // Gaussian elimination (3x3)
        std::array<std::array<double, 4>, 3> aug;
        for (int i = 0; i < 3; i++) {
            for (int jj = 0; jj < 3; jj++) aug[i][jj] = JTJ[i][jj];
            aug[i][3] = JTr[i];
        }
        
        for (int col = 0; col < 3; col++) {
            int pivot = col;
            for (int row = col + 1; row < 3; row++) {
                if (std::abs(aug[row][col]) > std::abs(aug[pivot][col])) pivot = row;
            }
            std::swap(aug[col], aug[pivot]);
            if (std::abs(aug[col][col]) < 1e-14) aug[col][col] = 1e-14;
            
            for (int row = col + 1; row < 3; row++) {
                double factor = aug[row][col] / aug[col][col];
                for (int k = col; k < 4; k++) aug[row][k] -= factor * aug[col][k];
            }
        }
        
        std::array<double, 3> delta = {0, 0, 0};
        for (int i = 2; i >= 0; i--) {
            delta[i] = aug[i][3];
            for (int jj = i + 1; jj < 3; jj++) delta[i] -= aug[i][jj] * delta[jj];
            delta[i] /= aug[i][i];
        }
        
        // Trust region
        double step_norm = std::sqrt(delta[0]*delta[0] + delta[1]*delta[1] + delta[2]*delta[2]);
        if (step_norm > 2.0) {
            for (int i = 0; i < 3; i++) delta[i] *= 2.0 / step_norm;
        }
        
        // Line search
        double alpha = 1.0;
        bool improved = false;
        
        for (int ls = 0; ls < 15; ls++) {
            std::array<double, 3> params_new = {
                std::max(-beta_max, std::min(beta_max, params[0] + alpha * delta[0])),
                std::max(-beta_max, std::min(beta_max, params[1] + alpha * delta[1])),
                std::max(log_sigma_min, std::min(log_sigma_max, params[2] + alpha * delta[2]))
            };
            
            double sc_new = std::exp(params_new[2]);
            
            auto m0_new = computeMoments(params_new[0], sc_new, 0.0);
            auto m1_new = computeMoments(params_new[0] + params_new[1], sc_new, 0.0);
            double new_icc = computeCorr(m0_new.EYY_diff_v, m0_new.mean);
            
            double new_sum_sq = (p0 - m0_new.mean) * (p0 - m0_new.mean) +
                                (p1 - m1_new.mean) * (p1 - m1_new.mean) +
                                (icc - new_icc) * (icc - new_icc);
            
            if (new_sum_sq < sum_sq) {
                params = params_new;
                improved = true;
                lambda = std::max(1e-8, lambda * 0.7);
                break;
            }
            alpha *= 0.5;
        }
        
        if (!improved) {
            lambda = std::min(1e6, lambda * 3.0);
        }
    }
    
    double sigma_c = std::exp(params[2]);
    return {params[0], params[1], sigma_c, 0.0, false, max_iter, 3};
}


SolverResult solveParametersCrossSectionalPoisson(double mu0, double mu1, double icc,
                                                   int max_iter = 100, double tol = 1e-6) {
    // Initial guesses
    double sigma_c_init = std::sqrt(std::max(0.01, icc * 0.5));
    double V_init = sigma_c_init * sigma_c_init;
    double beta0_init = std::log(mu0) - V_init / 2.0;
    double beta1_init = std::log(mu1) - V_init / 2.0 - beta0_init;
    
    std::array<double, 3> params = {
        beta0_init,
        beta1_init,
        std::log(sigma_c_init)
    };
    
    const double beta_max = 10.0;
    const double log_sigma_min = -4.0;
    const double log_sigma_max = 4.0;
    const double eps = 1e-5;
    
    double lambda = 0.1;
    
    for (int iter = 0; iter < max_iter; iter++) {
        double sigma_c = std::exp(params[2]);
        
        auto m0 = computeMomentsPoisson(params[0], sigma_c, 0.0);
        auto m1 = computeMomentsPoisson(params[0] + params[1], sigma_c, 0.0);
        
        double curr_mu0 = m0.mean;
        double curr_mu1 = m1.mean;
        double curr_icc = computeCorrPoisson(m0.EYY_diff_v, m0.mean, m0.EYY_same_v);
        
        std::array<double, 3> residuals = {
            mu0 - curr_mu0,
            mu1 - curr_mu1,
            icc - curr_icc
        };
        
        double sum_sq = residuals[0]*residuals[0] + residuals[1]*residuals[1] +
                        residuals[2]*residuals[2];
        double rms_resid = std::sqrt(sum_sq / 3.0);
        
        if (iter % 20 == 0) {
            EM_ASM({
                console.log("Poisson XS Iter", $0, ": rms=", $1, "sigma_c=", $2, "icc=", $3);
            }, iter, rms_resid, sigma_c, curr_icc);
        }
        
        if (rms_resid < tol) {
            int warning = checkPlausibility(sigma_c, 0.0);
            return {params[0], params[1], sigma_c, 0.0, true, iter, warning};
        }
        
        // Numerical Jacobian (3x3)
        std::array<std::array<double, 3>, 3> J;
        for (int j = 0; j < 3; j++) {
            std::array<double, 3> params_plus = params;
            double h = std::max(eps, std::abs(params[j]) * eps);
            params_plus[j] += h;
            
            double sc_p = std::exp(params_plus[2]);
            
            auto m0_p = computeMomentsPoisson(params_plus[0], sc_p, 0.0);
            auto m1_p = computeMomentsPoisson(params_plus[0] + params_plus[1], sc_p, 0.0);
            
            double icc_p = computeCorrPoisson(m0_p.EYY_diff_v, m0_p.mean, m0_p.EYY_same_v);
            
            J[0][j] = (m0_p.mean - curr_mu0) / h;
            J[1][j] = (m1_p.mean - curr_mu1) / h;
            J[2][j] = (icc_p - curr_icc) / h;
        }
        
        // Levenberg-Marquardt (3x3)
        std::array<std::array<double, 3>, 3> JTJ;
        std::array<double, 3> JTr;
        
        for (int i = 0; i < 3; i++) {
            JTr[i] = 0.0;
            for (int k = 0; k < 3; k++) {
                JTr[i] += J[k][i] * residuals[k];
            }
            for (int jj = 0; jj < 3; jj++) {
                JTJ[i][jj] = 0.0;
                for (int k = 0; k < 3; k++) {
                    JTJ[i][jj] += J[k][i] * J[k][jj];
                }
            }
            JTJ[i][i] += lambda;
        }
        
        // Gaussian elimination (3x3)
        std::array<std::array<double, 4>, 3> aug;
        for (int i = 0; i < 3; i++) {
            for (int jj = 0; jj < 3; jj++) aug[i][jj] = JTJ[i][jj];
            aug[i][3] = JTr[i];
        }
        
        for (int col = 0; col < 3; col++) {
            int pivot = col;
            for (int row = col + 1; row < 3; row++) {
                if (std::abs(aug[row][col]) > std::abs(aug[pivot][col])) pivot = row;
            }
            std::swap(aug[col], aug[pivot]);
            if (std::abs(aug[col][col]) < 1e-14) aug[col][col] = 1e-14;
            
            for (int row = col + 1; row < 3; row++) {
                double factor = aug[row][col] / aug[col][col];
                for (int k = col; k < 4; k++) aug[row][k] -= factor * aug[col][k];
            }
        }
        
        std::array<double, 3> delta = {0, 0, 0};
        for (int i = 2; i >= 0; i--) {
            delta[i] = aug[i][3];
            for (int jj = i + 1; jj < 3; jj++) delta[i] -= aug[i][jj] * delta[jj];
            delta[i] /= aug[i][i];
        }
        
        // Trust region
        double step_norm = std::sqrt(delta[0]*delta[0] + delta[1]*delta[1] + delta[2]*delta[2]);
        if (step_norm > 2.0) {
            for (int i = 0; i < 3; i++) delta[i] *= 2.0 / step_norm;
        }
        
        // Line search
        double alpha = 1.0;
        bool improved = false;
        
        for (int ls = 0; ls < 15; ls++) {
            std::array<double, 3> params_new = {
                std::max(-beta_max, std::min(beta_max, params[0] + alpha * delta[0])),
                std::max(-beta_max, std::min(beta_max, params[1] + alpha * delta[1])),
                std::max(log_sigma_min, std::min(log_sigma_max, params[2] + alpha * delta[2]))
            };
            
            double sc_new = std::exp(params_new[2]);
            
            auto m0_new = computeMomentsPoisson(params_new[0], sc_new, 0.0);
            auto m1_new = computeMomentsPoisson(params_new[0] + params_new[1], sc_new, 0.0);
            double new_icc = computeCorrPoisson(m0_new.EYY_diff_v, m0_new.mean, m0_new.EYY_same_v);
            
            double new_sum_sq = (mu0 - m0_new.mean) * (mu0 - m0_new.mean) +
                                (mu1 - m1_new.mean) * (mu1 - m1_new.mean) +
                                (icc - new_icc) * (icc - new_icc);
            
            if (new_sum_sq < sum_sq) {
                params = params_new;
                improved = true;
                lambda = std::max(1e-8, lambda * 0.7);
                break;
            }
            alpha *= 0.5;
        }
        
        if (!improved) {
            lambda = std::min(1e6, lambda * 3.0);
        }
    }
    
    double sigma_c = std::exp(params[2]);
    return {params[0], params[1], sigma_c, 0.0, false, max_iter, 3};
}
// Main entry point
// Main entry point
SolverResult solveGLMMParameters(double y0, double y1, double icc, double iac,
                                  double decay_at_lag1,  // CAC or lambda
                                  const std::string& sampling_structure,
                                  const std::string& family) {
    bool is_cohort = (sampling_structure != "cross_section" && iac > 0.0);
    
    if (family == "binomial") {
        if (is_cohort) {
            return solveParametersCohortBinomial(y0, y1, icc, iac, decay_at_lag1);
        } else {
            return solveParametersCrossSectionalBinomial(y0, y1, icc);
        }
    } else if (family == "poisson") {
        if (is_cohort) {
            return solveParametersCohortPoisson(y0, y1, icc, iac, decay_at_lag1);
        } else {
            return solveParametersCrossSectionalPoisson(y0, y1, icc);
        }
    }
    
    return {0, 0, 0, 0, false, 0, 3};
}

// Result structure returned to JavaScript
struct AnalysisResult {
    double power;
    double dof;
    double se;
    double mde;
    double ci_width;
    bool valid;
    std::string error;
};

struct MatrixExport {
    std::vector<double> data;   // row-major flat data
    int rows;
    int cols;
    std::string label;
};

struct VerificationBundle {
    // Design matrix
    MatrixExport X;
    // Covariance matrix (Sigma for GLMM, V for GEE/design-effect)
    MatrixExport Sigma;
    // Information matrix M = X'V^{-1}X
    MatrixExport M;
    // Inverse information matrix M^{-1}
    MatrixExport Minv;
    // For sandwich estimators:
    MatrixExport bread;       // M^{-1} (bread = inverse of X'V_w^{-1}X)
    MatrixExport meat;        // X'V_w^{-1} Sigma_true V_w^{-1} X
    MatrixExport V_working;   // GEE working covariance
    MatrixExport Sigma_true;  // True covariance
    // Parameter vectors
    std::vector<double> beta;
    std::vector<double> theta;
    // Scalar results
    double var_delta;
    double se;
    double dof;
    double power;
    double te;                // treatment effect used
    double alpha;
    double target_power;
    int idx;                  // treatment effect parameter index
    // Metadata
    std::string estimator_name;
    std::string formula;
    std::string family;
    std::string link;
    std::string correlation_structure;
    std::string sampling_structure;
    bool valid;
    std::string error;
    double target_icc = 0.0;
double target_iac = 0.0;
double target_baseline = 0.0;   // p0 or mu0
double target_baseline_trt = 0.0; // p1 or mu1
double achieved_icc = 0.0;
double achieved_iac = 0.0;
double achieved_baseline = 0.0;
double achieved_baseline_trt = 0.0;
double raw_sigma_c = 0.0;      // before any decomposition
double raw_sigma_p = 0.0;      // before scaling by 1/m
int solver_iterations = 0;
bool solver_converged = false;
int correlation_warning = 0;
};

// Estimator types matching JavaScript
enum class Estimator {
    MixedModel = 0,         // GLS with normal distribution
    MixedModelTTest = 1,    // BW with t-distribution  
    Satterthwaite = 2,
    KenwardRoger = 3,
    GEEIndependence = 4,
    GEEIndependenceRobust = 5,
    GEEModel = 6,
    GEEExchangeable = 6,        // NEW
    GEEExchangeableTTest = 7,
    DesignEffect = 8,
    DesignEffectTTest = 9
};

struct OptimalSequenceWeightsResult {
    std::vector<double> weights;
    bool valid;
    std::string error;
    int iterations;
};

// Wrapper class for the GLMM model
class GLMMWrapper {
private:
    // Model pointer - using void* to be flexible with your actual type
    std::unique_ptr<glmm> model;
    
    // Data storage
    Eigen::ArrayXXd data;
    std::vector<std::string> colnames;
    std::string formula;
    std::string family;
    std::string link;
    
    // Cached optimal weights
    std::vector<double> optimal_weights;
    
    // State
    bool model_valid;
    std::string last_error;
    
    // Analysis parameters
    double alpha;
    double target_power;
    double treatment_effect;
    bool include_intercept;
    std::string correlation_structure;
    std::string sampling_structure;

    int correlation_warning_ = 0;

    // Stored correlation parameters for GEE
    double stored_icc_ = 0.0;
    double stored_iac_ = 0.0;
    double stored_cac_or_lambda_ = 0.0;
    double stored_mu0_ = 0.0;
    double stored_mu1_ = 0.0;
    double stored_mean_n_ = 1.0;
    int stored_num_periods_ = 1;
    // Raw solver outputs (before theta scaling)
    double solved_sigma_c_ = 0.0;
    double solved_sigma_p_ = 0.0;
    int solver_iterations_ = 0;
    bool solver_converged_ = false;

    MatrixExport eigenToExport(const Eigen::MatrixXd& mat, const std::string& label) {
    MatrixExport exp;
    exp.rows = mat.rows();
    exp.cols = mat.cols();
    exp.label = label;
    exp.data.resize(exp.rows * exp.cols);
    for (int i = 0; i < exp.rows; i++) {
        for (int j = 0; j < exp.cols; j++) {
            exp.data[i * exp.cols + j] = mat(i, j);
        }
    }
    return exp;
}

public:
    GLMMWrapper() 
        : model_valid(false)
        , alpha(0.05)
        , target_power(0.80)
        , treatment_effect(0.5)
        , include_intercept(true) 
    {
        colnames = {"cl", "t", "n", "int", "int2", "int12", "control"};
    }
    
    ~GLMMWrapper() = default;
    
    // Initialize model from JavaScript data
    // flat_data is row-major: [row0col0, row0col1, ..., row1col0, ...]
    bool initialize(const std::string& formula_str,
                const std::vector<double>& flat_data,
                int n_rows,
                int n_cols,
                const std::string& family_str,
                const std::string& link_str,
                const std::string& correlation_str = "exchangeable",
                const std::string& sampling_str = "cross_section") {
    try {
        // Convert flat data to Eigen array
        data.resize(n_rows, n_cols);
        for (int i = 0; i < n_rows; i++) {
            for (int j = 0; j < n_cols; j++) {
                data(i, j) = flat_data[i * n_cols + j];
            }
        }
        
        formula = formula_str;
        family = family_str;
        link = link_str;
        correlation_structure = correlation_str;
        sampling_structure = sampling_str;
            // Create the model using your library's constructor
            // Model(const std::string& formula_, const ArrayXXd& data_, 
            //       const strvec& colnames_, std::string family_, std::string link_)
            model = std::make_unique<glmm>(
                formula, data, colnames, family, link
            );

            Eigen::ArrayXd weights(data.rows());
            for (int i = 0; i < data.rows(); i++) {
                if (family == "poisson") {
                    weights(i) = std::log(data(i, 2));  // log(n) for offset
                } else {
                    weights(i) = data(i, 2);  // n for weights/variance
                }
            }

            if (family == "gaussian") {
                model->set_weights(weights);
            } else if (family == "binomial") {
                model->model.data.set_variance(weights);
            } else if (family == "poisson") {
                model->set_offset(weights);
            }
            
            model_valid = true;
            last_error = "";
            return true;
            
        } catch (const std::exception& e) {
            model_valid = false;
            last_error = std::string("Initialize failed: ") + e.what();
            return false;
        } catch (...) {
            model_valid = false;
            last_error = "Initialize failed: unknown error";
            return false;
        }
    }

    int getCorrelationWarning() const { return correlation_warning_; }
    
    // Convert ICC to variance parameters for non-Gaussian models
std::pair<double, double> iccToVarPar(double baseline, double icc, const std::string& family) {
    std::pair<double, double> result;
    double a;
    
    if (family == "poisson") {
        result.first = std::exp(baseline);
        a = result.first * icc / (1.0 - icc);
        result.second = std::log(a / (result.first * result.first) + 1.0);
    }
    else if (family == "binomial") {
        double p = std::exp(baseline) / (1.0 + std::exp(baseline));
        result.first = p * (1.0 - p);
        a = result.first * icc / (1.0 - icc);
        double b = 1.0 + std::exp(baseline);
        result.second = a * b * b / (p * p);
    }
    else {
        // Gaussian
        result.first = baseline;
        result.second = result.first * icc / (1.0 - icc);
    }
    
    return result;
}

// Update model parameters without rebuilding
bool updateParameters(double icc, double iac, double cac_or_lengthscale, 
                      double te, double baseline, double mean_n, int num_periods,
                      double replacement_rate = 1.0) {

                        
    if (!model || !model_valid) {
        last_error = "Model not initialized";
        return false;
    }
    
    try {
        // Build beta vector: [baseline, te, 0, 0, ...] for time fixed effects
        std::vector<double> beta;
        beta.push_back(baseline);  // Intercept
        beta.push_back(te);        // Treatment effect
        
        // Add zeros for time period fixed effects (numPeriods - 1)
        for (int i = 1; i < num_periods; i++) {
            beta.push_back(0.0);
        }
        
        // Build theta vector based on family and covariance structure
        std::vector<double> theta;
        
        if (family == "gaussian") {
            if (correlation_structure == "exchangeable") {
                theta.push_back(icc);
            }
            else if (correlation_structure == "nested_exchangeable") {
                double tau1 = icc * cac_or_lengthscale;  // CAC
                double tau2 = icc * (1.0 - cac_or_lengthscale);
                theta.push_back(tau1);
                theta.push_back(tau2);
            }
            else if (correlation_structure == "exponential_decay" || 
                     correlation_structure == "exponential_function") {
                theta.push_back(icc);
                theta.push_back(cac_or_lengthscale);  // Lengthscale
            }
            
            // Individual-level covariance for cohort sampling
            if (sampling_structure == "closed_cohort") {
                double tau3 = iac * (1.0 - icc);
                tau3 = tau3 / mean_n;
                theta.push_back(tau3);
            }
            else if (sampling_structure == "open_cohort") {
                double tau3 = iac * (1.0 - icc);
                tau3 = tau3 / mean_n;
                theta.push_back(tau3);
                theta.push_back(replacement_rate);  // Replacement rate (0 = closed, 1 = cross-sectional)
            }
            
            // Set residual variance
            if (sampling_structure == "closed_cohort" || sampling_structure == "open_cohort") {
                double tau4 = (1.0 - icc) * (1.0 - iac);
                model->model.data.set_var_par(tau4);
            }
            else {
                model->model.data.set_var_par(1.0 - icc);
            }
        }
        else {
            double cl_level_error = 0.0;
            double tau3 = 0.0;
            if(family == "binomial"){
                double p0 = std::exp(baseline) / (1.0 + std::exp(baseline));
                double p1 = std::exp(baseline + te) / (1.0 + std::exp(baseline + te));
                stored_icc_ = icc;
                stored_iac_ = iac;
                stored_cac_or_lambda_ = cac_or_lengthscale;
                stored_mu0_ = p0;
                stored_mu1_ = p1;
                stored_mean_n_ = mean_n;
                stored_num_periods_ = num_periods;
                auto result = solveGLMMParameters(p0, p1, icc, iac, cac_or_lengthscale, sampling_structure, family);
                correlation_warning_ = result.warning_code;
                solved_sigma_c_ = result.sigma_c;      // add
                solved_sigma_p_ = result.sigma_p;      // add
                solver_iterations_ = result.iterations; // add
                solver_converged_ = result.converged;   // add
                EM_ASM({
                    console.log("=== GLMM Solver Debug ===");
                    console.log("Inputs: p0=", $0, "p1=", $1, "icc=", $2, "iac=", $3);
                    console.log("Converged:", $4, "Iterations:", $5);
                    console.log("beta0=", $6, "beta1=", $7);
                    console.log("sigma_c=", $8, "sigma_p=", $9);
                    }, p0, p1, icc, iac, 
                    result.converged ? 1 : 0, result.iterations,
                    result.beta0, result.beta1, 
                    result.sigma_c, result.sigma_p);
                // Also print the residuals at the solution
                auto m0_check = computeMoments(result.beta0, result.sigma_c, result.sigma_p);
                auto m1_check = computeMoments(result.beta0 + result.beta1, result.sigma_c, result.sigma_p);
                double check_icc = computeCorr(m0_check.EYY_diff_v, m0_check.mean);
                double check_within = computeCorr(m0_check.EYY_same_v, m0_check.mean);
                double check_iac = (check_icc < 1.0 - 1e-10) ? (check_within - check_icc) / (1.0 - check_icc) : 0.0;

                EM_ASM({
                    console.log("Achieved: p0=", $0, "p1=", $1, "icc=", $2, "iac=", $3);
                    console.log("Residuals: p0=", $4, "p1=", $5, "icc=", $6, "iac=", $7);
                }, m0_check.mean, m1_check.mean, check_icc, check_iac,
                p0 - m0_check.mean, p1 - m1_check.mean, icc - check_icc, iac - check_iac);    

                beta[0] = result.beta0;
                beta[1] = result.beta1;
                
                // Cluster variance
                cl_level_error = result.sigma_c * result.sigma_c;
                
                // Cohort effect at cluster-period level
                if (sampling_structure == "closed_cohort" || sampling_structure == "open_cohort") {
                    tau3 = result.sigma_p * result.sigma_p / mean_n;
                }
            } else if (family == "poisson"){
                double mu0 = std::exp(baseline);
                double mu1 = std::exp(baseline + te);
                auto result = solveGLMMParameters(mu0, mu1, icc, iac, cac_or_lengthscale, sampling_structure, family);
                stored_icc_ = icc;
                stored_iac_ = iac;
                stored_cac_or_lambda_ = cac_or_lengthscale;
                stored_mu0_ = mu0;
                stored_mu1_ = mu1;
                stored_mean_n_ = mean_n;
                stored_num_periods_ = num_periods;
                correlation_warning_ = result.warning_code;
                solved_sigma_c_ = result.sigma_c;      // add
                solved_sigma_p_ = result.sigma_p;      // add
                solver_iterations_ = result.iterations; // add
                solver_converged_ = result.converged;   // add
                EM_ASM({
                    console.log("=== GLMM Solver Debug ===");
                    console.log("Inputs: mu0=", $0, "mu1=", $1, "icc=", $2, "iac=", $3);
                    console.log("Converged:", $4, "Iterations:", $5);
                    console.log("beta0=", $6, "beta1=", $7);
                    console.log("sigma_c=", $8, "sigma_p=", $9);
                    }, mu0, mu1, icc, iac, 
                    result.converged ? 1 : 0, result.iterations,
                    result.beta0, result.beta1, 
                    result.sigma_c, result.sigma_p);
                // Also print the residuals at the solution
                auto m0_check = computeMomentsPoisson(result.beta0, result.sigma_c, result.sigma_p);
                auto m1_check = computeMomentsPoisson(result.beta0 + result.beta1, result.sigma_c, result.sigma_p);
                double check_icc = computeCorrPoisson(m0_check.EYY_diff_v, m0_check.mean, m0_check.EYY_same_v);
                double check_within = computeCorrPoisson(m0_check.EYY_same_v, m0_check.mean, m0_check.EYY_same_v);
                double check_iac = (check_icc < 1.0 - 1e-10) ? (check_within - check_icc) / (1.0 - check_icc) : 0.0;

                EM_ASM({
                    console.log("Achieved: mu0=", $0, "mu1=", $1, "icc=", $2, "iac=", $3);
                    console.log("Residuals: mu0=", $4, "p1=", $5, "icc=", $6, "iac=", $7);
                }, m0_check.mean, m1_check.mean, check_icc, check_iac,
                mu0 - m0_check.mean, mu1 - m1_check.mean, icc - check_icc, iac - check_iac);    

                beta[0] = result.beta0;
                beta[1] = result.beta1;
                // Cluster variance
                cl_level_error = result.sigma_c * result.sigma_c;
                
                // Cohort effect at cluster-period level
                if (sampling_structure == "closed_cohort" || sampling_structure == "open_cohort") {
                    tau3 = result.sigma_p * result.sigma_p / mean_n;
                }

            }            
            if (correlation_structure == "nested_exchangeable") {
                theta.push_back(cac_or_lengthscale * cl_level_error);
                theta.push_back((1.0 - cac_or_lengthscale) * cl_level_error);
            }
            else if (correlation_structure == "exponential_decay" || correlation_structure == "exponential_function") {
                theta.push_back(cl_level_error);
                theta.push_back(cac_or_lengthscale);
            }
            else {
                theta.push_back(cl_level_error);
            }
            if (sampling_structure == "closed_cohort" && iac > 0) {
                theta.push_back(tau3);
            } else if (sampling_structure == "open_cohort" && iac > 0) {
                theta.push_back(tau3);
                theta.push_back(replacement_rate);  // Replacement rate
            }
        }
        
        EM_ASM({ console.log("--- beta values ---"); });
        for (size_t i = 0; i < beta.size(); i++) {
            EM_ASM({
                console.log("beta[" + $0 + "] =", $1);
            }, (int)i, beta[i]);
        }

        EM_ASM({ console.log("--- theta values ---"); });
        for (size_t i = 0; i < theta.size(); i++) {
            EM_ASM({
                console.log("theta[" + $0 + "] =", $1);
            }, (int)i, theta[i]);
        }

        // Update the model
        model->update_beta(beta);
        model->update_theta(theta);
        model->matrix.W.update();
        
        return true;
        
    } catch (const std::exception& e) {
        last_error = std::string("updateParameters failed: ") + e.what();
        return false;
    }
}

// Corrected buildGEECovarianceMatrix - now returns V on probability scale
// The calculatePower function will apply the link derivatives

Eigen::MatrixXd buildGEECovarianceMatrix() {
    int n_obs = data.rows();
    Eigen::MatrixXd V = Eigen::MatrixXd::Zero(n_obs, n_obs);
    
    // Use totalvar = 1 (standardized scale) to match design effect formulas
    // This is the approach used by Kasza/Hemming
    // double totalvar = 1.0;
    // In buildGEECovarianceMatrix:
    double mu_bar = (stored_mu0_ + stored_mu1_) / 2.0;
    double totalvar = mu_bar * (1.0 - mu_bar);  // p̄(1-p̄)
    // Variance components on standardized scale
    double sig2CP = stored_icc_ * totalvar;                              // Cluster-period variance
    double sig2E = (1.0 - stored_iac_) * (totalvar - sig2CP);           // Residual variance  
    double sig2 = sig2E / stored_mean_n_;                                // Residual per cluster-period mean
    double sigindiv = (stored_iac_ > 0 && stored_iac_ < 1) 
                    ? sig2E * stored_iac_ / ((1.0 - stored_iac_) * stored_mean_n_)
                    : 0.0;                                               // Individual autocorrelation
    
    // Handle edge cases for IAC
    if (stored_iac_ == 0) {
        sig2E = totalvar - sig2CP;
        sig2 = sig2E / stored_mean_n_;
        sigindiv = 0.0;
    } else if (stored_iac_ >= 1.0 - 1e-10) {
        sig2E = 0.0;
        sig2 = 0.0;
        sigindiv = (totalvar - sig2CP) / stored_mean_n_;
    }
    
    double r = stored_cac_or_lambda_;  // CAC or decay parameter
    
    EM_ASM({
        console.log("=== GEE Variance Components (Kasza/Hemming style) ===");
        console.log("totalvar:", $0);
        console.log("sig2CP:", $1);
        console.log("sig2E:", $2);
        console.log("sig2:", $3);
        console.log("sigindiv:", $4);
        console.log("r (CAC):", $5);
    }, totalvar, sig2CP, sig2E, sig2, sigindiv, r);
    
    // Build covariance matrix for cluster-period means
    for (int i = 0; i < n_obs; i++) {
        int cl_i = static_cast<int>(data(i, 0));
        int t_i = static_cast<int>(data(i, 1));
        
        for (int j = i; j < n_obs; j++) {
            int cl_j = static_cast<int>(data(j, 0));
            int t_j = static_cast<int>(data(j, 1));
            
            double cov_ij = 0.0;
            
            if (cl_i != cl_j) {
                // Different clusters: zero covariance
                cov_ij = 0.0;
            } else {
                // Same cluster
                int lag = std::abs(t_i - t_j);
                
                if (correlation_structure == "nested_exchangeable") {
                    // Constant decay: Vi = sigindiv + diag(sig2 + (1-r)*sig2CP) + r*sig2CP
                    if (lag == 0) {
                        cov_ij = sigindiv + sig2 + sig2CP;
                    } else {
                        cov_ij = sigindiv + r * sig2CP;
                    }
                } else {
                    // Exponential decay: Vi = sigindiv + diag(sig2) + sig2CP * r^lag
                    if (lag == 0) {
                        cov_ij = sigindiv + sig2 + sig2CP;
                    } else {
                        cov_ij = sigindiv + sig2CP * std::pow(r, lag);
                    }
                }
            }
            
            V(i, j) = cov_ij;
            V(j, i) = cov_ij;
        }
    }
    
    // Debug: print sample of V
    EM_ASM({
        console.log("=== V matrix (first cluster) ===");
        console.log("V[0,0]:", $0, "V[0,1]:", $1);
        console.log("Correlation:", $2);
    }, V(0,0), V(0,1), V(0,1)/V(0,0));
    
    return V;
}

    bool updateWeights(double mean_cluster_size) {
        if (!model || !model_valid) {
            last_error = "Model not initialized";
            return false;
        }
        
        try {
            Eigen::ArrayXd weights(data.rows());
            for (int i = 0; i < data.rows(); i++) {
                if (family == "poisson") {
                    weights(i) = std::log(mean_cluster_size);
                } else {
                    weights(i) = mean_cluster_size;
                }
            }
            
            if (family == "gaussian") {
                model->set_weights(weights);
            } else if (family == "binomial") {
                model->model.data.set_variance(weights);
            } else if (family == "poisson") {
                model->set_offset(weights);
            }
            
            model->matrix.W.update();
            return true;
            
        } catch (const std::exception& e) {
            last_error = std::string("updateWeights failed: ") + e.what();
            return false;
        }
    }
    // Set analysis parameters
    void setAlpha(double a) { alpha = a; }
    void setTargetPower(double p) { target_power = p; }
    void setTreatmentEffect(double te) { treatment_effect = te; }
    void setIncludeIntercept(bool inc) { include_intercept = inc; }

    Eigen::MatrixXd applyCVCorrection(const Eigen::MatrixXd& Minv, double cv) {
    if (cv <= 0) return Minv;
    
    Eigen::MatrixXd X = model->model.linear_predictor.X();
    Eigen::MatrixXd Sigma = model->matrix.Sigma();
    Eigen::VectorXd W_diag = model->matrix.W.W();
    
    double cv2 = cv * cv;
    
    // Bias correction: E[Σ_ii] ≈ Σ̄_ii + cv² / W_ii
    // This accounts for E[1/n] > 1/E[n]
    Eigen::VectorXd Sigma_correction = cv2 * W_diag.array().inverse();
    Eigen::MatrixXd Sigma_adj = Sigma;
    Sigma_adj.diagonal() += Sigma_correction;
    
    // Recompute M with adjusted Sigma
    Eigen::LLT<Eigen::MatrixXd> llt_adj(Sigma_adj);
    Eigen::MatrixXd M_adj = X.transpose() * llt_adj.solve(X);
    Eigen::MatrixXd M_adj_inv = M_adj.llt().solve(Eigen::MatrixXd::Identity(M_adj.rows(), M_adj.cols()));
    
    return M_adj_inv;
}
    
    // Calculate power - main analysis function
    // Returns AnalysisResult structure
    // Calculate power - main analysis function
AnalysisResult calculatePower(int estimator_type, double cv = 0.0) {
    AnalysisResult result;
    result.power = 0;
    result.dof = 0;
    result.se = 0;
    result.mde = 0;
    result.ci_width = 0;
    result.valid = false;
    result.error = "";
    double te = model->model.linear_predictor.parameters[1];
    
    if (!model || !model_valid) {
        result.error = "Model not initialized";
        return result;
    }
    
    try {
        // Normal distribution quantiles
        boost::math::normal_distribution<> norm(0.0, 1.0);
        double zcutoff = boost::math::quantile(norm, 1.0 - alpha / 2.0);
        double powercutoff = boost::math::quantile(norm, target_power);
        
        // Treatment effect parameter index
        int idx = include_intercept ? 1 : 0;
        
        Estimator est = static_cast<Estimator>(estimator_type);
        
        if (est == Estimator::MixedModel) {
            // GLS with normal distribution
            Eigen::MatrixXd M = model->matrix.information_matrix();
            Eigen::MatrixXd Minv = M.llt().solve(Eigen::MatrixXd::Identity(M.rows(), M.cols()));
            Minv = applyCVCorrection(Minv, cv);

            double bvar = Minv(idx, idx);
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double zval = std::abs(te / result.se);
            
            result.power = boost::math::cdf(norm, zval - zcutoff);
            result.dof = getTotalN();
            result.ci_width = zcutoff * result.se;
            result.mde = (zcutoff + powercutoff) * result.se;
        }
        else if (est == Estimator::MixedModelTTest) {
            // BW with t-distribution
            Eigen::MatrixXd M = model->matrix.information_matrix();
            Eigen::MatrixXd Minv = M.llt().solve(Eigen::MatrixXd::Identity(M.rows(), M.cols()));
            Minv = applyCVCorrection(Minv, cv);
            double bvar = Minv(idx, idx);
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double zval = std::abs(te / result.se);
            
            double dofbw = getTotalClusterPeriods() - model->model.linear_predictor.P();
            if (dofbw < 1) dofbw = 1;
            
            boost::math::students_t dist(dofbw);
            double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
            double tpowercutoff = boost::math::quantile(dist, target_power);
            
            result.power = boost::math::cdf(dist, zval - tcutoff);
            result.dof = dofbw;
            result.ci_width = tcutoff * result.se;
            result.mde = (tcutoff + tpowercutoff) * result.se;
        }
        else if (est == Estimator::Satterthwaite) {
            // Satterthwaite: KR degrees of freedom with GLS standard errors
            double dofkr;
            
            // Get KR degrees of freedom
            if (correlation_structure != "exchangeable" && correlation_structure != "nested_exchangeable") {
                auto res = model->matrix.template small_sample_correction<glmmr::SE::KRBoth, glmmr::IM::EIM>();
                dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
            } else {
                auto res = model->matrix.template small_sample_correction<glmmr::SE::KR, glmmr::IM::EIM>();
                dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
            }
            
            // Use GLS standard errors
            Eigen::MatrixXd M = model->matrix.information_matrix();
            Eigen::MatrixXd Minv = M.llt().solve(Eigen::MatrixXd::Identity(M.rows(), M.cols()));
            Minv = applyCVCorrection(Minv, cv);
            double bvar = Minv(idx, idx);
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double tval = std::abs(te / result.se);
            
            boost::math::students_t dist(dofkr);
            double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
            double tpowercutoff = boost::math::quantile(dist, target_power);
            
            result.power = dofkr > 1 ? boost::math::cdf(dist, tval - tcutoff) : 0.0;
            result.dof = dofkr;
            result.ci_width = tcutoff * result.se;
            result.mde = (tcutoff + tpowercutoff) * result.se;
        }
        else if (est == Estimator::KenwardRoger) {
            // Kenward-Roger: KR degrees of freedom and KR adjusted standard errors
            double dofkr;
            Eigen::MatrixXd KRcov;
            
            if (correlation_structure != "exchangeable" && correlation_structure != "nested_exchangeable") {
                auto res = model->matrix.template small_sample_correction<glmmr::SE::KRBoth, glmmr::IM::EIM>();
                dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
                KRcov = res.vcov_beta;
            } else {
                auto res = model->matrix.template small_sample_correction<glmmr::SE::KR, glmmr::IM::EIM>();
                dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
                KRcov = res.vcov_beta;
            }
            
            KRcov = applyCVCorrection(KRcov, cv);
            
            double bvar = KRcov(idx, idx);
            
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double tval = std::abs(te / result.se);
            
            boost::math::students_t dist(dofkr);
            double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
            double tpowercutoff = boost::math::quantile(dist, target_power);
            
            result.power = dofkr > 1 ? boost::math::cdf(dist, tval - tcutoff) : 0.0;
            result.dof = dofkr;
            result.ci_width = tcutoff * result.se;
            result.mde = (tcutoff + tpowercutoff) * result.se;
        }
        else if (est == Estimator::GEEIndependence) {
            // GEE with independence working correlation (model-based SE)
            Eigen::MatrixXd M = model->matrix.information_matrix();
            Eigen::MatrixXd Minv = M.llt().solve(Eigen::MatrixXd::Identity(M.rows(), M.cols()));
            Minv = applyCVCorrection(Minv, cv);
            double bvar = Minv(idx, idx);
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double zval = std::abs(te / result.se);
            
            result.power = boost::math::cdf(norm, zval - zcutoff);
            result.dof = getTotalN();
            result.ci_width = zcutoff * result.se;
            result.mde = (zcutoff + powercutoff) * result.se;
        }
        else if (est == Estimator::GEEIndependenceRobust) {
    // GEE with robust/sandwich standard errors
    Eigen::MatrixXd X = model->model.linear_predictor.X();
    Eigen::MatrixXd Sigma = model->matrix.Sigma();
    
    // Apply CV correction to Sigma diagonal
    if (cv > 0) {
        Eigen::VectorXd W_diag = model->matrix.W.W();
        double cv2 = cv * cv;
        Eigen::VectorXd Sigma_correction = cv2 * W_diag.array().inverse();
        Sigma.diagonal() += Sigma_correction;
    }
    
    Eigen::MatrixXd XtX1 = X.transpose() * X;
    Eigen::MatrixXd XtX2 = X.transpose() * Sigma * X;
    
    XtX1 = XtX1.llt().solve(Eigen::MatrixXd::Identity(XtX1.rows(), XtX1.cols()));
    Eigen::MatrixXd XtX = XtX1 * XtX2 * XtX1;
    
    double bvar = XtX(idx, idx);
    if (std::isnan(bvar) || bvar <= 0) {
        result.error = "Invalid variance estimate";
        return result;
    }
    
    result.se = std::sqrt(bvar);
    double zval = std::abs(te / result.se);
    
    result.power = boost::math::cdf(norm, zval - zcutoff);
    result.dof = getTotalN();
    result.ci_width = zcutoff * result.se;
    result.mde = (zcutoff + powercutoff) * result.se;
}
else if (est == Estimator::DesignEffect) {
    Eigen::MatrixXd X = model->model.linear_predictor.X();
    Eigen::MatrixXd V = buildGEECovarianceMatrix();
    int n_obs = X.rows();
    double delta = stored_mu1_ - stored_mu0_; 
    // V is already on correct scale - no delta method needed
    Eigen::MatrixXd Sigma_GEE = V;
    
    // Debug comparison
    Eigen::MatrixXd Sigma_GLMM = model->matrix.Sigma();
    EM_ASM({
        console.log("=== Covariance comparison ===");
        console.log("Sigma_GEE[0,0]:", $0, "Sigma_GLMM[0,0]:", $1, "ratio:", $2);
        console.log("Sigma_GEE[0,1]:", $3, "Sigma_GLMM[0,1]:", $4, "ratio:", $5);
    }, Sigma_GEE(0,0), Sigma_GLMM(0,0), Sigma_GEE(0,0)/Sigma_GLMM(0,0),
       Sigma_GEE(0,1), Sigma_GLMM(0,1), Sigma_GEE(0,1)/Sigma_GLMM(0,1));
    
    // Apply CV correction if needed
    if (cv > 0) {
        double cv2 = cv * cv;
        for (int i = 0; i < n_obs; i++) {
            Sigma_GEE(i, i) *= (1.0 + cv2);
        }
    }
    
    Eigen::LLT<Eigen::MatrixXd> llt(Sigma_GEE);
    if (llt.info() != Eigen::Success) {
        result.error = "GEE covariance matrix not positive definite";
        return result;
    }
    
    Eigen::MatrixXd M_gee = X.transpose() * llt.solve(X);
    Eigen::MatrixXd Minv = M_gee.llt().solve(Eigen::MatrixXd::Identity(M_gee.rows(), M_gee.cols()));
    
    // Compare with GLMM
    Eigen::MatrixXd M_glmm = model->matrix.information_matrix();
    Eigen::MatrixXd Minv_glmm = M_glmm.llt().solve(Eigen::MatrixXd::Identity(M_glmm.rows(), M_glmm.cols()));
    
    EM_ASM({
        console.log("=== Final SE comparison ===");
        console.log("GEE SE:", $0, "GLMM SE:", $1, "ratio:", $2);
    }, std::sqrt(Minv(idx,idx)), std::sqrt(Minv_glmm(idx,idx)),
       std::sqrt(Minv(idx,idx)) / std::sqrt(Minv_glmm(idx,idx)));
    
    double bvar = Minv(idx, idx);
    if (std::isnan(bvar) || bvar <= 0) {
        result.error = "Invalid GEE variance estimate";
        return result;
    }
    
    result.se = std::sqrt(bvar);
    double zval = std::abs(delta / result.se);
    
    result.power = boost::math::cdf(norm, zval - zcutoff);
    result.dof = getTotalN();
    result.ci_width = zcutoff * result.se;
    result.mde = (zcutoff + powercutoff) * result.se;
}
else if (est == Estimator::GEEExchangeable) {
    Eigen::MatrixXd X = model->model.linear_predictor.X();
    int n_obs = X.rows();
    
    // True covariance from GLMM (on linear predictor scale)
    Eigen::MatrixXd Sigma_true = model->matrix.Sigma();
    
    // Build GEE working covariance on probability scale
    Eigen::MatrixXd V_prob = buildGEECovarianceMatrix();
    
    // Transform to linear predictor scale via delta method
    // Var(η) = (dη/dμ)² × Var(μ)
    double mu_bar = (stored_mu0_ + stored_mu1_) / 2.0;
    double deriv_inv;
    if (family == "binomial") {
        deriv_inv = 1.0 / (mu_bar * (1.0 - mu_bar));
    } else if (family == "poisson") {
        deriv_inv = 1.0 / mu_bar;
    } else {
        deriv_inv = 1.0;
    }
    Eigen::MatrixXd V_working = V_prob * (deriv_inv * deriv_inv);
    
    // Apply CV correction if needed
    if (cv > 0) {
        double cv2 = cv * cv;
        for (int i = 0; i < n_obs; i++) {
            V_working(i, i) *= (1.0 + cv2);
            Sigma_true(i, i) *= (1.0 + cv2);
        }
    }
    
    // Model-based info matrix: M = X' V_working⁻¹ X
    Eigen::LLT<Eigen::MatrixXd> llt_V(V_working);
    if (llt_V.info() != Eigen::Success) {
        result.error = "GEE working covariance not positive definite";
        return result;
    }
    Eigen::MatrixXd V_inv_X = llt_V.solve(X);
    Eigen::MatrixXd M = X.transpose() * V_inv_X;
    Eigen::MatrixXd M_inv = M.llt().solve(Eigen::MatrixXd::Identity(M.rows(), M.cols()));
    
    // Meat of sandwich: X' V_working⁻¹ Σ_true V_working⁻¹ X
    Eigen::MatrixXd meat = V_inv_X.transpose() * Sigma_true * V_inv_X;
    
    // Sandwich variance: M⁻¹ × meat × M⁻¹
    Eigen::MatrixXd sandwich = M_inv * meat * M_inv;
    
    // Compare with GLMM and model-based GEE
    Eigen::MatrixXd M_glmm = model->matrix.information_matrix();
    Eigen::MatrixXd Minv_glmm = M_glmm.llt().solve(Eigen::MatrixXd::Identity(M_glmm.rows(), M_glmm.cols()));
    
    EM_ASM({
        console.log("=== GEE Sandwich Variance ===");
        console.log("V_working[0,0]:", $0, "Sigma_true[0,0]:", $1);
        console.log("Model-based GEE Var(β₁):", $2, "SE:", $3);
        console.log("Sandwich GEE Var(β₁):", $4, "SE:", $5);
        console.log("GLMM Var(β₁):", $6, "SE:", $7);
        console.log("Ratio sandwich/GLMM:", $8);
    }, V_working(0,0), Sigma_true(0,0),
       M_inv(idx,idx), std::sqrt(M_inv(idx,idx)),
       sandwich(idx,idx), std::sqrt(sandwich(idx,idx)),
       Minv_glmm(idx,idx), std::sqrt(Minv_glmm(idx,idx)),
       std::sqrt(sandwich(idx,idx)) / std::sqrt(Minv_glmm(idx,idx)));
    
    double bvar = sandwich(idx, idx);
    if (std::isnan(bvar) || bvar <= 0) {
        result.error = "Invalid GEE sandwich variance";
        return result;
    }
    
    result.se = std::sqrt(bvar);
    double zval = std::abs(te / result.se);
    
    result.power = boost::math::cdf(norm, zval - zcutoff);
    result.dof = getTotalN();
    result.ci_width = zcutoff * result.se;
    result.mde = (zcutoff + powercutoff) * result.se;
}
else if (est == Estimator::GEEExchangeableTTest) {
    Eigen::MatrixXd X = model->model.linear_predictor.X();
    int n_obs = X.rows();
    
    // True covariance from GLMM (on linear predictor scale)
    Eigen::MatrixXd Sigma_true = model->matrix.Sigma();
    
    // Build GEE working covariance on probability scale
    Eigen::MatrixXd V_prob = buildGEECovarianceMatrix();
    
    // Transform to linear predictor scale via delta method
    double mu_bar = (stored_mu0_ + stored_mu1_) / 2.0;
    double deriv_inv;
    if (family == "binomial") {
        deriv_inv = 1.0 / (mu_bar * (1.0 - mu_bar));
    } else if (family == "poisson") {
        deriv_inv = 1.0 / mu_bar;
    } else {
        deriv_inv = 1.0;
    }
    Eigen::MatrixXd V_working = V_prob * (deriv_inv * deriv_inv);
    
    // Apply CV correction if needed
    if (cv > 0) {
        double cv2 = cv * cv;
        for (int i = 0; i < n_obs; i++) {
            V_working(i, i) *= (1.0 + cv2);
            Sigma_true(i, i) *= (1.0 + cv2);
        }
    }
    
    // Model-based info matrix: M = X' V_working⁻¹ X
    Eigen::LLT<Eigen::MatrixXd> llt_V(V_working);
    if (llt_V.info() != Eigen::Success) {
        result.error = "GEE working covariance not positive definite";
        return result;
    }
    Eigen::MatrixXd V_inv_X = llt_V.solve(X);
    Eigen::MatrixXd M = X.transpose() * V_inv_X;
    Eigen::MatrixXd M_inv = M.llt().solve(Eigen::MatrixXd::Identity(M.rows(), M.cols()));
    
    // Meat of sandwich: X' V_working⁻¹ Σ_true V_working⁻¹ X
    Eigen::MatrixXd meat = V_inv_X.transpose() * Sigma_true * V_inv_X;
    
    // Sandwich variance: M⁻¹ × meat × M⁻¹
    Eigen::MatrixXd sandwich = M_inv * meat * M_inv;
    
    double bvar = sandwich(idx, idx);
    if (std::isnan(bvar) || bvar <= 0) {
        result.error = "Invalid GEE sandwich variance";
        return result;
    }
    
    result.se = std::sqrt(bvar);
    double tval = std::abs(te / result.se);
    
    // Between-within degrees of freedom
    double dofbw = getTotalClusterPeriods() - model->model.linear_predictor.P();
    if (dofbw < 1) dofbw = 1;
    
    boost::math::students_t dist(dofbw);
    double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
    double tpowercutoff = boost::math::quantile(dist, target_power);
    
    result.power = boost::math::cdf(dist, tval - tcutoff);
    result.dof = dofbw;
    result.ci_width = tcutoff * result.se;
    result.mde = (tcutoff + tpowercutoff) * result.se;
}
else if (est == Estimator::DesignEffectTTest) {
    Eigen::MatrixXd X = model->model.linear_predictor.X();
    Eigen::MatrixXd V = buildGEECovarianceMatrix();  // Kasza/Hemming style with totalvar = p̄(1-p̄)
    int n_obs = X.rows();
    
    // Risk difference as effect measure
    double delta = stored_mu1_ - stored_mu0_;
    
    // Apply CV correction if needed
    if (cv > 0) {
        double cv2 = cv * cv;
        for (int i = 0; i < n_obs; i++) {
            V(i, i) *= (1.0 + cv2);
        }
    }
    
    Eigen::LLT<Eigen::MatrixXd> llt(V);
    if (llt.info() != Eigen::Success) {
        result.error = "Design effect covariance matrix not positive definite";
        return result;
    }
    
    Eigen::MatrixXd M = X.transpose() * llt.solve(X);
    Eigen::MatrixXd Minv = M.llt().solve(Eigen::MatrixXd::Identity(M.rows(), M.cols()));
    
    double bvar = Minv(idx, idx);
    if (std::isnan(bvar) || bvar <= 0) {
        result.error = "Invalid design effect variance";
        return result;
    }
    
    result.se = std::sqrt(bvar);
    double tval = std::abs(delta / result.se);
    
    // Between-within degrees of freedom
    double dofbw = getTotalClusterPeriods() - model->model.linear_predictor.P();
    if (dofbw < 1) dofbw = 1;
    
    boost::math::students_t dist(dofbw);
    double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
    double tpowercutoff = boost::math::quantile(dist, target_power);
    
    result.power = boost::math::cdf(dist, tval - tcutoff);
    result.dof = dofbw;
    result.ci_width = tcutoff * result.se;
    result.mde = (tcutoff + tpowercutoff) * result.se;
}
        else {
            result.error = "Unknown estimator type";
            return result;
        }
        
        result.valid = true;
        return result;
        
    } catch (const std::exception& e) {
        result.error = std::string("calculatePower failed: ") + e.what();
        return result;
    }
}

VerificationBundle getVerificationBundle(int estimator_type, double cv = 0.0) {
    VerificationBundle vb;
    vb.valid = false;
    vb.formula = formula;
    vb.family = family;
    vb.link = link;
    vb.correlation_structure = correlation_structure;
    vb.sampling_structure = sampling_structure;
    vb.alpha = alpha;
    vb.target_power = target_power;
    vb.idx = include_intercept ? 1 : 0;
    // Solver diagnostics for non-Gaussian models
    if (family != "gaussian") {
        vb.target_icc = stored_icc_;
        vb.target_iac = stored_iac_;
        vb.target_baseline = stored_mu0_;
        vb.target_baseline_trt = stored_mu1_;
        vb.raw_sigma_c = solved_sigma_c_;
        vb.raw_sigma_p = solved_sigma_p_;
        vb.solver_iterations = solver_iterations_;
        vb.solver_converged = solver_converged_;
        
        // Forward check: recompute moments from solved parameters
        if (family == "binomial") {
            auto m0 = computeMoments(vb.beta[0], solved_sigma_c_, solved_sigma_p_);
            auto m1 = computeMoments(vb.beta[0] + vb.beta[1], solved_sigma_c_, solved_sigma_p_);
            vb.achieved_baseline = m0.mean;
            vb.achieved_baseline_trt = m1.mean;
            vb.achieved_icc = computeCorr(m0.EYY_diff_v, m0.mean);
            double within = computeCorr(m0.EYY_same_v, m0.mean);
            vb.achieved_iac = (vb.achieved_icc < 1.0 - 1e-10)
                ? (within - vb.achieved_icc) / (1.0 - vb.achieved_icc) : 0.0;
        } else if (family == "poisson") {
            auto m0 = computeMomentsPoisson(vb.beta[0], solved_sigma_c_, solved_sigma_p_);
            auto m1 = computeMomentsPoisson(vb.beta[0] + vb.beta[1], solved_sigma_c_, solved_sigma_p_);
            vb.achieved_baseline = m0.mean;
            vb.achieved_baseline_trt = m1.mean;
            vb.achieved_icc = computeCorrPoisson(m0.EYY_diff_v, m0.mean, m0.EYY_same_v);
            double within = computeCorrPoisson(m0.EYY_same_v, m0.mean, m0.EYY_same_v);
            vb.achieved_iac = (vb.achieved_icc < 1.0 - 1e-10)
                ? (within - vb.achieved_icc) / (1.0 - vb.achieved_icc) : 0.0;
        }
    }
    
    if (!model || !model_valid) {
        vb.error = "Model not initialized";
        return vb;
    }
    
    try {
        // Extract beta and theta
        auto& params = model->model.linear_predictor.parameters;
        vb.beta.resize(params.size());
        for (size_t i = 0; i < params.size(); i++) vb.beta[i] = params[i];
        
        auto& thetaVec = model->model.covariance.parameters_;
        vb.theta.resize(thetaVec.size());
        for (size_t i = 0; i < thetaVec.size(); i++) vb.theta[i] = thetaVec[i];
        
        vb.te = vb.beta.size() > (size_t)vb.idx ? vb.beta[vb.idx] : 0.0;
        
        // Design matrix X
        Eigen::MatrixXd X = model->model.linear_predictor.X();
        vb.X = eigenToExport(X, "design_matrix");
        
        // Branch by estimator
        Estimator est = static_cast<Estimator>(estimator_type);
        int idx = vb.idx;
        
        boost::math::normal_distribution<> norm(0.0, 1.0);
        double zcutoff = boost::math::quantile(norm, 1.0 - alpha / 2.0);
        double powercutoff = boost::math::quantile(norm, target_power);
        
        if (est == Estimator::MixedModel || est == Estimator::MixedModelTTest ||
            est == Estimator::Satterthwaite || est == Estimator::KenwardRoger ||
            est == Estimator::GEEIndependence) {
            
            // GLMM-based: Sigma from model
            Eigen::MatrixXd Sigma = model->matrix.Sigma();
            vb.Sigma = eigenToExport(Sigma, "covariance_matrix");
            
            Eigen::MatrixXd M = model->matrix.information_matrix();
            vb.M = eigenToExport(M, "information_matrix");
            
            Eigen::MatrixXd Minv = M.llt().solve(
                Eigen::MatrixXd::Identity(M.rows(), M.cols()));
            Minv = applyCVCorrection(Minv, cv);
            vb.Minv = eigenToExport(Minv, "inverse_information_matrix");
            
            vb.var_delta = Minv(idx, idx);
            vb.se = std::sqrt(vb.var_delta);
            vb.estimator_name = "glmm_model_based";
            
            if (est == Estimator::MixedModel || est == Estimator::GEEIndependence) {
                double zval = std::abs(vb.te / vb.se);
                vb.power = boost::math::cdf(norm, zval - zcutoff);
                vb.dof = getTotalN();
                vb.estimator_name = (est == Estimator::MixedModel) ? 
                    "mixed_model" : "gee_independence";
            } else if (est == Estimator::MixedModelTTest) {
                double dofbw = getTotalClusterPeriods() - 
                    model->model.linear_predictor.P();
                if (dofbw < 1) dofbw = 1;
                vb.dof = dofbw;
                boost::math::students_t dist(dofbw);
                double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
                vb.power = boost::math::cdf(dist, 
                    std::abs(vb.te / vb.se) - tcutoff);
                vb.estimator_name = "mixed_model_ttest";
            } else if (est == Estimator::Satterthwaite) {
                double dofkr;
                if (correlation_structure != "exchangeable" && 
                    correlation_structure != "nested_exchangeable") {
                    auto res = model->matrix.template 
                        small_sample_correction<glmmr::SE::KRBoth, glmmr::IM::EIM>();
                    dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
                } else {
                    auto res = model->matrix.template 
                        small_sample_correction<glmmr::SE::KR, glmmr::IM::EIM>();
                    dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
                }
                vb.dof = dofkr;
                boost::math::students_t dist(dofkr);
                double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
                vb.power = dofkr > 1 ? boost::math::cdf(dist, 
                    std::abs(vb.te / vb.se) - tcutoff) : 0.0;
                vb.estimator_name = "satterthwaite";
            } else if (est == Estimator::KenwardRoger) {
                Eigen::MatrixXd KRcov;
                double dofkr;
                if (correlation_structure != "exchangeable" && 
                    correlation_structure != "nested_exchangeable") {
                    auto res = model->matrix.template 
                        small_sample_correction<glmmr::SE::KRBoth, glmmr::IM::EIM>();
                    dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
                    KRcov = res.vcov_beta;
                } else {
                    auto res = model->matrix.template 
                        small_sample_correction<glmmr::SE::KR, glmmr::IM::EIM>();
                    dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
                    KRcov = res.vcov_beta;
                }
                KRcov = applyCVCorrection(KRcov, cv);
                vb.Minv = eigenToExport(KRcov, "kr_adjusted_covariance");
                vb.var_delta = KRcov(idx, idx);
                vb.se = std::sqrt(vb.var_delta);
                vb.dof = dofkr;
                boost::math::students_t dist(dofkr);
                double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
                vb.power = dofkr > 1 ? boost::math::cdf(dist, 
                    std::abs(vb.te / vb.se) - tcutoff) : 0.0;
                vb.estimator_name = "kenward_roger";
            }
        }
        else if (est == Estimator::GEEIndependenceRobust) {
            Eigen::MatrixXd X_mat = model->model.linear_predictor.X();
            Eigen::MatrixXd Sigma = model->matrix.Sigma();
            vb.Sigma = eigenToExport(Sigma, "true_covariance_sigma");
            
            if (cv > 0) {
                Eigen::VectorXd W_diag = model->matrix.W.W();
                double cv2 = cv * cv;
                Sigma.diagonal() += cv2 * W_diag.array().inverse().matrix();
            }
            
            Eigen::MatrixXd XtX1 = X_mat.transpose() * X_mat;
            Eigen::MatrixXd XtX2 = X_mat.transpose() * Sigma * X_mat;
            XtX1 = XtX1.llt().solve(
                Eigen::MatrixXd::Identity(XtX1.rows(), XtX1.cols()));
            
            vb.bread = eigenToExport(XtX1, "bread_XtX_inv");
            vb.meat = eigenToExport(XtX2, "meat_XtSigmaX");
            
            Eigen::MatrixXd sandwich = XtX1 * XtX2 * XtX1;
            vb.Minv = eigenToExport(sandwich, "sandwich_variance");
            vb.var_delta = sandwich(idx, idx);
            vb.se = std::sqrt(vb.var_delta);
            vb.dof = getTotalN();
            
            double zval = std::abs(vb.te / vb.se);
            vb.power = boost::math::cdf(norm, zval - zcutoff);
            vb.estimator_name = "gee_independence_robust";
        }
        else if (est == Estimator::GEEExchangeable || 
                 est == Estimator::GEEExchangeableTTest) {
            Eigen::MatrixXd X_mat = model->model.linear_predictor.X();
            Eigen::MatrixXd Sigma_true = model->matrix.Sigma();
            Eigen::MatrixXd V_prob = buildGEECovarianceMatrix();
            
            double mu_bar = (stored_mu0_ + stored_mu1_) / 2.0;
            double deriv_inv = 1.0;
            if (family == "binomial") deriv_inv = 1.0 / (mu_bar * (1.0 - mu_bar));
            else if (family == "poisson") deriv_inv = 1.0 / mu_bar;
            Eigen::MatrixXd V_work = V_prob * (deriv_inv * deriv_inv);
            
            if (cv > 0) {
                double cv2 = cv * cv;
                for (int i = 0; i < V_work.rows(); i++) {
                    V_work(i, i) *= (1.0 + cv2);
                    Sigma_true(i, i) *= (1.0 + cv2);
                }
            }
            
            vb.V_working = eigenToExport(V_work, "gee_working_covariance");
            vb.Sigma_true = eigenToExport(Sigma_true, "true_covariance");
            
            Eigen::LLT<Eigen::MatrixXd> llt_V(V_work);
            Eigen::MatrixXd V_inv_X = llt_V.solve(X_mat);
            Eigen::MatrixXd M = X_mat.transpose() * V_inv_X;
            Eigen::MatrixXd M_inv = M.llt().solve(
                Eigen::MatrixXd::Identity(M.rows(), M.cols()));
            Eigen::MatrixXd meat_mat = V_inv_X.transpose() * Sigma_true * V_inv_X;
            Eigen::MatrixXd sandwich = M_inv * meat_mat * M_inv;
            
            vb.M = eigenToExport(M, "information_matrix");
            vb.bread = eigenToExport(M_inv, "bread_M_inv");
            vb.meat = eigenToExport(meat_mat, "meat_matrix");
            vb.Minv = eigenToExport(sandwich, "sandwich_variance");
            
            vb.var_delta = sandwich(idx, idx);
            vb.se = std::sqrt(vb.var_delta);
            
            if (est == Estimator::GEEExchangeable) {
                double zval = std::abs(vb.te / vb.se);
                vb.power = boost::math::cdf(norm, zval - zcutoff);
                vb.dof = getTotalN();
                vb.estimator_name = "gee_exchangeable";
            } else {
                double dofbw = getTotalClusterPeriods() - 
                    model->model.linear_predictor.P();
                if (dofbw < 1) dofbw = 1;
                vb.dof = dofbw;
                boost::math::students_t dist(dofbw);
                double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
                vb.power = boost::math::cdf(dist, 
                    std::abs(vb.te / vb.se) - tcutoff);
                vb.estimator_name = "gee_exchangeable_ttest";
            }
        }
        else if (est == Estimator::DesignEffect || 
                 est == Estimator::DesignEffectTTest) {
            Eigen::MatrixXd X_mat = model->model.linear_predictor.X();
            Eigen::MatrixXd V = buildGEECovarianceMatrix();
            double delta = stored_mu1_ - stored_mu0_;
            
            if (cv > 0) {
                double cv2 = cv * cv;
                for (int i = 0; i < V.rows(); i++) V(i, i) *= (1.0 + cv2);
            }
            
            vb.Sigma = eigenToExport(V, "design_effect_covariance");
            
            Eigen::LLT<Eigen::MatrixXd> llt(V);
            Eigen::MatrixXd M = X_mat.transpose() * llt.solve(X_mat);
            Eigen::MatrixXd Minv = M.llt().solve(
                Eigen::MatrixXd::Identity(M.rows(), M.cols()));
            
            vb.M = eigenToExport(M, "information_matrix");
            vb.Minv = eigenToExport(Minv, "inverse_information_matrix");
            vb.var_delta = Minv(idx, idx);
            vb.se = std::sqrt(vb.var_delta);
            vb.te = delta;  // Override: design effect uses risk difference
            
            if (est == Estimator::DesignEffect) {
                double zval = std::abs(delta / vb.se);
                vb.power = boost::math::cdf(norm, zval - zcutoff);
                vb.dof = getTotalN();
                vb.estimator_name = "design_effect";
            } else {
                double dofbw = getTotalClusterPeriods() - 
                    model->model.linear_predictor.P();
                if (dofbw < 1) dofbw = 1;
                vb.dof = dofbw;
                boost::math::students_t dist(dofbw);
                double tcutoff = boost::math::quantile(dist, 1.0 - alpha / 2.0);
                vb.power = boost::math::cdf(dist, 
                    std::abs(delta / vb.se) - tcutoff);
                vb.estimator_name = "design_effect_ttest";
            }
        }
        
        vb.valid = true;
        return vb;
        
    } catch (const std::exception& e) {
        vb.error = std::string("getVerificationBundle failed: ") + e.what();
        return vb;
    }
}
    
    // Calculate optimal weights
    std::vector<double> calculateOptimalWeights(int N = 100) {
        optimal_weights.clear();
        
        if (!model || !model_valid) {
            last_error = "Model not initialized";
            return optimal_weights;
        }
        
        try {
            int idx = include_intercept ? 1 : 0;
            
            // Create contrast vector
            Eigen::VectorXd C = Eigen::VectorXd::Zero(model->model.linear_predictor.P());
            C(idx) = 1.0;
            
            // Store original weights
            Eigen::ArrayXd fix_weights = model->model.data.weights;
            
            // Set weights to 1 for optimization
            model->model.data.set_weights(fix_weights.size());
            model->matrix.W.update();
            
            // Calculate optimal weights
            Eigen::ArrayXd weights = model->optim.optimum_weights(N, C, 1e-6);
            
            // Restore original weights
            model->model.data.set_weights(fix_weights);
            model->matrix.W.update();
            
            // Convert to std::vector
            optimal_weights.resize(weights.size());
            for (int i = 0; i < weights.size(); i++) {
                optimal_weights[i] = weights(i);
            }
            
            return optimal_weights;
            
        } catch (const std::exception& e) {
            last_error = std::string("calculateOptimalWeights failed: ") + e.what();
            return optimal_weights;
        }
    }
    
OptimalSequenceWeightsResult calculateOptimalSequenceWeights(
    const std::vector<double>& sequence_membership_dbl,
    int max_iter = 100,
    double tol = 1e-6
) {
    OptimalSequenceWeightsResult result;
    result.valid = false;
    result.iterations = 0;
    
    if (!model || !model_valid) {
        result.error = "Model not initialized";
        return result;
    }
    
    try {
        std::vector<int> sequence_membership(sequence_membership_dbl.size());
        for (size_t i = 0; i < sequence_membership_dbl.size(); i++) {
            sequence_membership[i] = static_cast<int>(sequence_membership_dbl[i]);
        }

        Eigen::MatrixXd X = model->model.linear_predictor.X();
        Eigen::MatrixXd Sigma = model->matrix.Sigma();
        
        int n = X.rows();
        int p = X.cols();
        
        if ((int)sequence_membership.size() != n) {
            result.error = "sequence_membership size (" + 
                std::to_string(sequence_membership.size()) + 
                ") does not match data rows (" + std::to_string(n) + ")";
            return result;
        }
        
        // Find number of sequences
        int n_seq = 0;
        for (int i = 0; i < n; i++) {
            if (sequence_membership[i] < 0) {
                result.error = "Negative sequence index at position " + std::to_string(i);
                return result;
            }
            if (sequence_membership[i] + 1 > n_seq) {
                n_seq = sequence_membership[i] + 1;
            }
        }
        
        if (n_seq < 1) {
            result.error = "No valid sequences found";
            return result;
        }
        
        // Contrast vector C: 1 in treatment effect position
        int idx = include_intercept ? 1 : 0;
        if (idx >= p) {
            result.error = "Treatment effect index out of bounds";
            return result;
        }
        
        Eigen::VectorXd C = Eigen::VectorXd::Zero(p);
        C(idx) = 1.0;
        
        // Compute L where L L' = Sigma^{-1}
        Eigen::LLT<Eigen::MatrixXd> llt_sigma(Sigma);
        if (llt_sigma.info() != Eigen::Success) {
            result.error = "Cholesky decomposition of Sigma failed";
            return result;
        }
        Eigen::MatrixXd Sigma_inv = llt_sigma.solve(Eigen::MatrixXd::Identity(n, n));
        
        Eigen::LLT<Eigen::MatrixXd> llt_sigma_inv(Sigma_inv);
        if (llt_sigma_inv.info() != Eigen::Success) {
            result.error = "Cholesky decomposition of Sigma^{-1} failed";
            return result;
        }
        Eigen::MatrixXd L = llt_sigma_inv.matrixL();
        
        // A = X' L (dimension p x n) - NOTE: L not L'
        Eigen::MatrixXd A = X.transpose() * L;
        
        // Initialize z: minimum norm solution to A z = C
        Eigen::MatrixXd AAt = A * A.transpose();
        Eigen::LLT<Eigen::MatrixXd> llt_AAt(AAt);
        if (llt_AAt.info() != Eigen::Success) {
            result.error = "Cholesky of A A' failed";
            return result;
        }
        Eigen::VectorXd z = A.transpose() * llt_AAt.solve(C);
        
        // Sequence membership as Eigen vector
        Eigen::VectorXi seq_mem(n);
        for (int i = 0; i < n; i++) {
            seq_mem(i) = sequence_membership[i];
        }
        
        // IRLS iterations
        Eigen::VectorXd z_old = z;
        
        for (int iter = 0; iter < max_iter; iter++) {
            // Compute per-sequence norms ||z_s||
            Eigen::VectorXd seq_norms = Eigen::VectorXd::Zero(n_seq);
            for (int i = 0; i < n; i++) {
                int s = seq_mem(i);
                seq_norms(s) += z(i) * z(i);
            }
            seq_norms = seq_norms.array().sqrt();
            
            // Relative epsilon for numerical stability
            double eps = 0.001 * seq_norms.mean();
            if (eps < 1e-12) eps = 1e-12;
            
            // D diagonal: d(i) = ||z_{s(i)}|| + eps
            Eigen::VectorXd d(n);
            for (int i = 0; i < n; i++) {
                int s = seq_mem(i);
                d(i) = seq_norms(s) + eps;
            }
            
            // z = D A' (A D A')^{-1} C
            Eigen::MatrixXd DAt = d.asDiagonal() * A.transpose();
            Eigen::MatrixXd ADAt = A * DAt;
            
            Eigen::LLT<Eigen::MatrixXd> llt_ADAt(ADAt);
            if (llt_ADAt.info() != Eigen::Success) {
                result.error = "Weighted matrix not positive definite at iteration " + 
                    std::to_string(iter);
                return result;
            }
            
            z = DAt * llt_ADAt.solve(C);
            
            // Check convergence
            double change = (z - z_old).norm() / (z_old.norm() + 1e-10);
            z_old = z;
            
            result.iterations = iter + 1;
            
            if (change < tol) {
                break;
            }
        }
        
        // Final weights are ||z_s||
        Eigen::VectorXd weights = Eigen::VectorXd::Zero(n_seq);
        for (int i = 0; i < n; i++) {
            int s = seq_mem(i);
            weights(s) += z(i) * z(i);
        }
        weights = weights.array().sqrt();
        
        // Normalize to sum to 1
        double total = weights.sum();
        if (total > 0) {
            weights /= total;
        } else {
            weights.setConstant(1.0 / n_seq);
        }
        
        result.weights.resize(n_seq);
        for (int i = 0; i < n_seq; i++) {
            result.weights[i] = weights(i);
        }
        
        result.valid = true;
        return result;
        
    } catch (const std::exception& e) {
        result.error = std::string("Exception: ") + e.what();
        return result;
    } catch (...) {
        result.error = "Unknown exception in calculateOptimalSequenceWeights";
        return result;
    }
}

    // Getters for design info
    int getTotalN() const {
        if (!model_valid || data.rows() == 0) return 0;
        return static_cast<int>(data.col(2).sum()); // Sum of n column
    }
    
    int getTotalClusterPeriods() const {
        return static_cast<int>(data.rows());
    }
    
    int getNClusters() const {
        if (!model_valid || data.rows() == 0) return 0;
        return static_cast<int>(data.col(0).maxCoeff()); // Max cluster number
    }
    
    int getNumParameters() const {
        if (!model || !model_valid) return 0;
        return model->model.linear_predictor.P();
    }
    
    // Status getters
    bool isValid() const { return model_valid; }
    std::string getLastError() const { return last_error; }
    std::string getFormula() const { return formula; }
    
    // Debug: get data dimensions
    int getDataRows() const { return static_cast<int>(data.rows()); }
    int getDataCols() const { return static_cast<int>(data.cols()); }
};

// Emscripten bindings
EMSCRIPTEN_BINDINGS(glmm_module) {
    // Bind the result structure
    value_object<AnalysisResult>("AnalysisResult")
        .field("power", &AnalysisResult::power)
        .field("dof", &AnalysisResult::dof)
        .field("se", &AnalysisResult::se)
        .field("mde", &AnalysisResult::mde)
        .field("ci_width", &AnalysisResult::ci_width)
        .field("valid", &AnalysisResult::valid)
        .field("error", &AnalysisResult::error);
    
    value_object<OptimalSequenceWeightsResult>("OptimalSequenceWeightsResult")
        .field("weights", &OptimalSequenceWeightsResult::weights)
        .field("valid", &OptimalSequenceWeightsResult::valid)
        .field("error", &OptimalSequenceWeightsResult::error)
        .field("iterations", &OptimalSequenceWeightsResult::iterations);

    // New: MatrixExport
    value_object<MatrixExport>("MatrixExport")
        .field("data", &MatrixExport::data)
        .field("rows", &MatrixExport::rows)
        .field("cols", &MatrixExport::cols)
        .field("label", &MatrixExport::label);
    
    // New: VerificationBundle
    value_object<VerificationBundle>("VerificationBundle")
        .field("X", &VerificationBundle::X)
        .field("Sigma", &VerificationBundle::Sigma)
        .field("M", &VerificationBundle::M)
        .field("Minv", &VerificationBundle::Minv)
        .field("bread", &VerificationBundle::bread)
        .field("meat", &VerificationBundle::meat)
        .field("V_working", &VerificationBundle::V_working)
        .field("Sigma_true", &VerificationBundle::Sigma_true)
        .field("beta", &VerificationBundle::beta)
        .field("theta", &VerificationBundle::theta)
        .field("var_delta", &VerificationBundle::var_delta)
        .field("se", &VerificationBundle::se)
        .field("dof", &VerificationBundle::dof)
        .field("power", &VerificationBundle::power)
        .field("te", &VerificationBundle::te)
        .field("alpha", &VerificationBundle::alpha)
        .field("target_power", &VerificationBundle::target_power)
        .field("idx", &VerificationBundle::idx)
        .field("estimator_name", &VerificationBundle::estimator_name)
        .field("formula", &VerificationBundle::formula)
        .field("family", &VerificationBundle::family)
        .field("link", &VerificationBundle::link)
        .field("correlation_structure", &VerificationBundle::correlation_structure)
        .field("sampling_structure", &VerificationBundle::sampling_structure)
        .field("valid", &VerificationBundle::valid)
        .field("error", &VerificationBundle::error)
        .field("target_icc", &VerificationBundle::target_icc)
        .field("target_iac", &VerificationBundle::target_iac)
        .field("target_baseline", &VerificationBundle::target_baseline)
        .field("target_baseline_trt", &VerificationBundle::target_baseline_trt)
        .field("achieved_icc", &VerificationBundle::achieved_icc)
        .field("achieved_iac", &VerificationBundle::achieved_iac)
        .field("achieved_baseline", &VerificationBundle::achieved_baseline)
        .field("achieved_baseline_trt", &VerificationBundle::achieved_baseline_trt)
        .field("raw_sigma_c", &VerificationBundle::raw_sigma_c)
        .field("raw_sigma_p", &VerificationBundle::raw_sigma_p)
        .field("solver_iterations", &VerificationBundle::solver_iterations)
        .field("solver_converged", &VerificationBundle::solver_converged)
        .field("correlation_warning", &VerificationBundle::correlation_warning);
    
    // Bind vector<double> for passing arrays
    register_vector<double>("VectorDouble");
    // Bind the wrapper class
    class_<GLMMWrapper>("GLMMWrapper")
        .constructor<>()
        .function("initialize", &GLMMWrapper::initialize)
        .function("updateParameters", &GLMMWrapper::updateParameters)
        .function("getCorrelationWarning", &GLMMWrapper::getCorrelationWarning) 
        .function("updateWeights", &GLMMWrapper::updateWeights)
        .function("setAlpha", &GLMMWrapper::setAlpha)
        .function("setTargetPower", &GLMMWrapper::setTargetPower)
        .function("setTreatmentEffect", &GLMMWrapper::setTreatmentEffect)
        .function("setIncludeIntercept", &GLMMWrapper::setIncludeIntercept)
        .function("calculatePower", &GLMMWrapper::calculatePower)
        .function("calculateOptimalWeights", &GLMMWrapper::calculateOptimalWeights)
        .function("calculateOptimalSequenceWeights", &GLMMWrapper::calculateOptimalSequenceWeights)
        .function("getTotalN", &GLMMWrapper::getTotalN)
        .function("getTotalClusterPeriods", &GLMMWrapper::getTotalClusterPeriods)
        .function("getNClusters", &GLMMWrapper::getNClusters)
        .function("getNumParameters", &GLMMWrapper::getNumParameters)
        .function("isValid", &GLMMWrapper::isValid)
        .function("getLastError", &GLMMWrapper::getLastError)
        .function("getFormula", &GLMMWrapper::getFormula)
        .function("getDataRows", &GLMMWrapper::getDataRows)
        .function("getDataCols", &GLMMWrapper::getDataCols)
        .function("getVerificationBundle", &GLMMWrapper::getVerificationBundle);

}
