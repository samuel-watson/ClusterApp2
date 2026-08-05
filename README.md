# clustertrial.app

**A browser-based power and sample size calculator for cluster randomised trials.**

Design stepped wedge, parallel, cross-over and staircase trials by drawing the allocation
schedule on a grid; compare mixed model and GEE estimators with small-sample corrections;
and export a complete audit of the computation. Everything runs locally in the browser
through a WebAssembly build of the [glmmrBase](https://github.com/samuel-watson/glmmrBase)
C++ library. No installation, no account, no data leaves the machine.

**→ [clustertrial.app](https://clustertrial.app)**

---

## Statement of need

Sample size calculation for cluster randomised trials is poorly served by existing
software. The available tools are typically narrow Shiny applications or standalone scripts
that implement a single design family under a single set of variance assumptions. Three
limitations recur:

1. **Fixed designs.** Real trials rarely match a textbook diagram. Sites join late,
   periods are lost, interventions have implementation phases during which outcomes are not
   analysable. Tools that offer a menu of named designs cannot cost these schedules.

2. **A single estimator.** Statistical power is a property of a design *and* an analysis
   method. A model-based mixed model test and a GEE with a robust sandwich variance can
   differ by twenty percentage points of power on the same design with fifteen clusters.
   Reporting only one — usually the most optimistic — is a route to underpowered trials.

3. **Opaque computation.** A protocol typically reports a number, an assumed effect size,
   an ICC, and a software name. A reviewer cannot inspect the assumed covariance structure
   or reproduce the arithmetic. This is a substantive barrier to adoption in clinical
   trials units, which are reasonably reluctant to accept an unauditable figure from a web
   application.

clustertrial.app addresses all three. Designs are drawn cell by cell rather than selected
from a list; ten inference methods are available and switchable interactively; and every
calculation can be exported as a verification bundle containing each matrix in the
derivation together with an R script that reproduces the standard error independently.

## Features

**Design specification**

- Graphical allocation grid: rows are randomised sequences, columns are time periods, each
  cell is control, intervention, or not enrolled
- Presets for parallel, parallel with baseline, stepped wedge, stepped wedge with
  implementation period, cross-over, cross-over with washout, and staircase designs, all
  freely editable afterwards
- Independent cluster counts per sequence; uniform, coefficient-of-variation, or
  cell-by-cell specification of cluster-period sizes

**Statistical models**

- Continuous, binary and count outcomes with identity, logit and log links
- Correlation structures: exchangeable, nested exchangeable (cluster autocorrelation),
  exponential decay, and exponential function (lengthscale)
- Sampling structures: cross-sectional, closed cohort, and open cohort with a replacement
  rate, with individual autocorrelation
- Fixed or linear period effects; heterogeneous treatment effects; two-treatment factorial
  specifications

**Inference**

- Model-based inference with normal or *t* reference distributions
- Satterthwaite and Kenward–Roger small-sample corrections
- GEE with independence or exchangeable working correlation and robust sandwich variances
- Classical design-effect calculations for comparison against textbook methods
- Conditional (GLMM) and marginal (GEE) estimands distinguished explicitly for
  non-Gaussian outcomes

**Analysis and output**

- Up to three designs held concurrently, compared side by side on power, degrees of
  freedom, standard error and minimum detectable effect
- Optimal allocation weights for cells and sequences, computed by ADMM and rendered
  directly onto the design grid
- Power curves against ICC, cluster-period size, treatment effect, baseline prevalence or
  total clusters; power surfaces as heatmaps or contour plots
- Design diagrams exportable as PNG; plots exportable as PNG or SVG at publication
  resolution
- Sessions saved to and restored from JSON

**Diagnostics**

- Warnings when the selected estimator reports power materially above the most
  conservative alternative, indicating small-sample optimism
- Warnings when specified correlation parameters cannot be realised in the fitted model.
  For binary and count outcomes, an ICC and individual autocorrelation given on the
  observed scale must be solved for random effect variances on the link scale; not every
  combination admits a plausible solution, and the solver reports when it does not

**Verification**

- Exportable bundle containing the design matrix, model-implied covariance, information
  matrix and its inverse, sandwich components, working and true covariances, parameter
  vectors, resulting standard error, degrees of freedom and power, solver diagnostics
  (target versus achieved correlations, convergence status), the cluster-period dataset,
  and an R script that recomputes the standard error and checks it against the reported
  value

## Relationship to glmmrBase

The statistical engine is [glmmrBase](https://github.com/samuel-watson/glmmrBase), a
C++/Eigen library for generalised linear mixed models, also available as an R package on
CRAN. This repository contains additional solvers specific to design evaluation — in
particular the observed-scale to link-scale correlation solver and the ADMM routine for
optimal sequence weights — together with Emscripten bindings and the browser interface.

Users who prefer to work in R can perform equivalent calculations directly with glmmrBase.
The web application exists to make the same methods accessible without writing code, and
to make the results inspectable by people who will not be running R at all.

## Using it

The hosted application at [clustertrial.app](https://clustertrial.app) is the intended way
to use the tool. It requires a browser with WebAssembly support and nothing else.

Documentation lives alongside it:

- [Getting started](https://clustertrial.app/guide.html) — a walkthrough from empty grid to
  exported bundle
- [Features](https://clustertrial.app/features.html)
- [Stepped wedge sample size](https://clustertrial.app/designs/stepped-wedge.html)
- [Estimators and inference](https://clustertrial.app/methods/estimators.html)
- [Correlation structures and sampling](https://clustertrial.app/methods/correlation.html)
- [The verification bundle](https://clustertrial.app/methods/verification.html)

## Running locally

Clone the repository and serve the `deploy/` directory over HTTP. No build step is needed —
the WebAssembly binaries are committed.

```bash
git clone https://github.com/samuel-watson/clustertrial.app.git
cd clustertrial.app/deploy
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from the filesystem will not work: the WebAssembly module and
the absolute asset paths both require a web server.

## Building from source

Prebuilt WebAssembly binaries are committed to the repository, so rebuilding is only
necessary if you are modifying the C++ engine. Everything required to run the application
is already in `deploy/`.

To rebuild, you need the [Emscripten SDK](https://emscripten.org/) and CMake on the path.
The build scripts in `wasm/` handle library linkage; there is nothing else to configure.

```bash
cd wasm
./build.sh        # Linux and macOS
```

```bat
cd wasm
build.bat         :: Windows
```

The JavaScript front end is transformed with [esbuild](https://esbuild.github.io/); there
is no bundler configuration, because the application uses global UMD builds of React rather
than ES module imports.

```bash
# production build
npx esbuild App.jsx --outfile=deploy/app.js --loader:.jsx=jsx --target=es2018 --minify --drop:console

# debug build, retaining console output
npx esbuild App.jsx --outfile=deploy/app.debug.js --loader:.jsx=jsx --target=es2018
```

The static documentation pages are generated from a single source:

```bash
cd deploy
python3 build.py
```

This regenerates the content pages, `sitemap.xml` and `robots.txt`. Navigation, page
metadata and structured data are defined once in `build.py`; `index.html`, `site.css` and
`landing.css` are maintained by hand.

## Repository layout

```
wasm/                    C++ engine and Emscripten build
  CMakeLists.txt         Build configuration, including library linkage
  build.sh               Build script (Linux, macOS)
  build.bat              Build script (Windows)

deploy/                  Everything served by the web application
  index.html             Calculator entry point
  App.jsx                Application interface (React)
  glmm_wasm.js           Prebuilt WebAssembly module and loader
  glmm_wasm.wasm
  wasmLoader.global.js   Wrapper exposing the engine to the application
  reportGenerator.js     Verification bundle assembly
  build.py               Static documentation generator
  site.css               Styles for documentation pages
  landing.css            Scoped styles for the calculator page
  features.html          Generated documentation
  guide.html
  designs/               Generated: design-specific pages
  methods/               Generated: methodology pages
```

The `deploy/` directory is self-contained: copying it to any static web host is a complete
deployment.

## Testing

<!-- TODO: automated tests and instructions for running them. -->

## Validation

<!-- TODO: table reproducing published sample size results. -->

## Citing

<!-- TODO: replace with the Zenodo concept DOI once the GitHub–Zenodo integration is
     enabled, and add a CITATION.cff so GitHub renders a "Cite this repository" button. -->

If you use clustertrial.app in published work, please cite it. A machine-readable citation
is provided in `CITATION.cff`.

Methodological background for the underlying models is given in the references below.

## Contributing

Bug reports, feature requests and questions are welcome via
[GitHub issues](https://github.com/samuel-watson/clustertrial.app/issues). Please include
the design specification and parameters if you are reporting an incorrect result — the
exported session JSON is the most useful thing to attach.

Pull requests are welcome. For substantial changes, please open an issue first to discuss
the approach.

## References

- Hussey MA, Hughes JP (2007). Design and analysis of stepped wedge cluster randomized
  trials. *Contemporary Clinical Trials* 28(2), 182–191.
- Hooper R, Teerenstra S, de Hoop E, Eldridge S (2016). Sample size calculation for stepped
  wedge and other longitudinal cluster randomised trials. *Statistics in Medicine* 35(26),
  4718–4728.
- Kasza J, Hemming K, Hooper R, Matthews JNS, Forbes AB (2019). Impact of non-uniform
  correlation structure on sample size and power in multiple-period cluster randomised
  trials. *Statistical Methods in Medical Research* 28(3), 703–716.
- Kenward MG, Roger JH (1997). Small sample inference for fixed effects from restricted
  maximum likelihood. *Biometrics* 53(3), 983–997.


