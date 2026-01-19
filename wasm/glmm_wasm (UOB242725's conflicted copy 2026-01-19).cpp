// glmm_wasm.cpp
// WASM interface for GLMM library
// Compile with Emscripten

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

// Estimator types matching JavaScript
enum class Estimator {
    MixedModel = 0,         // GLS with normal distribution
    MixedModelTTest = 1,    // BW with t-distribution  
    Satterthwaite = 2,
    KenwardRoger = 3,
    GEEIndependence = 4,
    GEEIndependenceRobust = 5
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
                   const std::string& link_str) {
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
            // Extract correlation structure from formula for later use
            correlation_structure = "exchangeable"; // default
            if (formula.find("fexp0") != std::string::npos) {
                correlation_structure = "exponential_decay";
            } else if (formula.find("sqexp0") != std::string::npos) {
                correlation_structure = "exponential_function";
            } else if (formula.find("gr(cl,t)") != std::string::npos) {
                correlation_structure = "nested_exchangeable";
            }

            // Extract sampling structure from formula
            sampling_structure = "cross_section"; // default
            if (formula.find("gr(cl)*ar0") != std::string::npos && 
                formula.find("(1|gr(cl)*ar0") != std::string::npos) {
                sampling_structure = "open_cohort";
            } else if (formula.find("|gr(cl))") != std::string::npos) {
                // Count occurrences of individual-level random effects
                // This is a simplification - you may need to adjust based on your formula patterns
                size_t count = 0;
                size_t pos = 0;
                while ((pos = formula.find("|gr(cl))", pos)) != std::string::npos) {
                    count++;
                    pos++;
                }
                if (count > 1) {
                    sampling_structure = "closed_cohort";
                }
            }
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
                      double te, double baseline, double mean_n, int num_periods) {
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
                theta.push_back(1.0 - cac_or_lengthscale);  // AR parameter
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
            // Non-Gaussian: convert ICC to variance parameters
            auto varvals = iccToVarPar(baseline, icc, family);
            double ind_level_error = varvals.first;
            double cl_level_error = varvals.second;
            
            if (sampling_structure == "closed_cohort") {
                double ind_cov = iac * varvals.first / (1.0 - iac);
                ind_level_error += ind_cov;
            }
            
            if (correlation_structure == "nested_exchangeable") {
                theta.push_back(cac_or_lengthscale * cl_level_error);
                theta.push_back((1.0 - cac_or_lengthscale) * cl_level_error);
            }
            else if (correlation_structure == "exponential_decay" || 
                     correlation_structure == "exponential_function") {
                theta.push_back(cl_level_error);
                theta.push_back(cac_or_lengthscale);
            }
            else {
                theta.push_back(cl_level_error);
            }
            
            if (sampling_structure == "closed_cohort") {
                double tau3 = iac * varvals.first / (1.0 - iac);
                tau3 = tau3 / mean_n;
                theta.push_back(tau3);
            }
            else if (sampling_structure == "open_cohort") {
                double tau3 = iac * varvals.first / (1.0 - iac);
                tau3 = tau3 / mean_n;
                theta.push_back(tau3);
                theta.push_back(1.0 - cac_or_lengthscale);
            }
            
            // Set dispersion for beta/gamma families if needed
            if (family == "binomial" || family == "poisson") {
                // These use the natural variance, no extra parameter needed
            }
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

// Update weights without rebuilding model
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
    
    // Calculate power - main analysis function
    // Returns AnalysisResult structure
    // Calculate power - main analysis function
AnalysisResult calculatePower(int estimator_type) {
    AnalysisResult result;
    result.power = 0;
    result.dof = 0;
    result.se = 0;
    result.mde = 0;
    result.ci_width = 0;
    result.valid = false;
    result.error = "";
    
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
            
            double bvar = Minv(idx, idx);
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double zval = std::abs(treatment_effect / result.se);
            
            result.power = boost::math::cdf(norm, zval - zcutoff);
            result.dof = getTotalN();
            result.ci_width = zcutoff * result.se;
            result.mde = (zcutoff + powercutoff) * result.se;
        }
        else if (est == Estimator::MixedModelTTest) {
            // BW with t-distribution
            Eigen::MatrixXd M = model->matrix.information_matrix();
            Eigen::MatrixXd Minv = M.llt().solve(Eigen::MatrixXd::Identity(M.rows(), M.cols()));
            
            double bvar = Minv(idx, idx);
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double zval = std::abs(treatment_effect / result.se);
            
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
            
            double bvar = Minv(idx, idx);
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double tval = std::abs(treatment_effect / result.se);
            
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
            double bvar;
            
            if (correlation_structure != "exchangeable" && correlation_structure != "nested_exchangeable") {
                auto res = model->matrix.template small_sample_correction<glmmr::SE::KRBoth, glmmr::IM::EIM>();
                dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
                bvar = res.vcov_beta(idx, idx);
            } else {
                auto res = model->matrix.template small_sample_correction<glmmr::SE::KR, glmmr::IM::EIM>();
                dofkr = res.dof(idx) > 1 ? res.dof(idx) : 1.0;
                bvar = res.vcov_beta(idx, idx);
            }
            
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double tval = std::abs(treatment_effect / result.se);
            
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
            
            double bvar = Minv(idx, idx);
            if (std::isnan(bvar) || bvar <= 0) {
                result.error = "Invalid variance estimate";
                return result;
            }
            
            result.se = std::sqrt(bvar);
            double zval = std::abs(treatment_effect / result.se);
            
            result.power = boost::math::cdf(norm, zval - zcutoff);
            result.dof = getTotalN();
            result.ci_width = zcutoff * result.se;
            result.mde = (zcutoff + powercutoff) * result.se;
        }
        else if (est == Estimator::GEEIndependenceRobust) {
            // GEE with robust/sandwich standard errors
            Eigen::MatrixXd X = model->model.linear_predictor.X();
            Eigen::MatrixXd Sigma = model->matrix.Sigma();
            
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
            double zval = std::abs(treatment_effect / result.se);
            
            result.power = boost::math::cdf(norm, zval - zcutoff);
            result.dof = getTotalN();
            result.ci_width = zcutoff * result.se;
            result.mde = (zcutoff + powercutoff) * result.se;
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
    
    // Bind vector<double> for passing arrays
    register_vector<double>("VectorDouble");
    
    // Bind the wrapper class
    class_<GLMMWrapper>("GLMMWrapper")
        .constructor<>()
        .function("initialize", &GLMMWrapper::initialize)
        .function("updateParameters", &GLMMWrapper::updateParameters)
        .function("setAlpha", &GLMMWrapper::setAlpha)
        .function("setTargetPower", &GLMMWrapper::setTargetPower)
        .function("setTreatmentEffect", &GLMMWrapper::setTreatmentEffect)
        .function("setIncludeIntercept", &GLMMWrapper::setIncludeIntercept)
        .function("calculatePower", &GLMMWrapper::calculatePower)
        .function("calculateOptimalWeights", &GLMMWrapper::calculateOptimalWeights)
        .function("getTotalN", &GLMMWrapper::getTotalN)
        .function("getTotalClusterPeriods", &GLMMWrapper::getTotalClusterPeriods)
        .function("getNClusters", &GLMMWrapper::getNClusters)
        .function("getNumParameters", &GLMMWrapper::getNumParameters)
        .function("isValid", &GLMMWrapper::isValid)
        .function("getLastError", &GLMMWrapper::getLastError)
        .function("getFormula", &GLMMWrapper::getFormula)
        .function("getDataRows", &GLMMWrapper::getDataRows)
        .function("getDataCols", &GLMMWrapper::getDataCols)
        .function("updateWeights", &GLMMWrapper::updateWeights);
}
