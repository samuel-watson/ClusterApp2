#!/usr/bin/env python3
"""
Static content builder for clustertrial.app

Emits plain HTML files with no runtime dependencies. Edit the CONTENT
fragments below and re-run; nav, footer, head and structured data stay
consistent across every page.

    python3 build.py

Output goes next to this script, mirroring the deploy layout:
    /features.html  /guide.html  /designs/*.html  /methods/*.html  /sitemap.xml
"""

import os
import re

SITE = "https://clustertrial.app"
OUT = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------
# The signature element: a sequence x period allocation grid, as static SVG.
# 'C' control, 'I' intervention, 'O' not enrolled.
# --------------------------------------------------------------------------

def grid_svg(pattern, cell=38, gap=6, pad_left=52, pad_top=24, animate=False):
    rows = len(pattern)
    cols = len(pattern[0])
    w = pad_left + cols * (cell + gap)
    h = pad_top + rows * (cell + gap)
    cls = {"C": "cell-c", "I": "cell-i", "O": "cell-o"}
    out = [f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
           f'role="img" aria-label="Trial allocation grid, {rows} sequences by {cols} periods">']
    for j in range(cols):
        x = pad_left + j * (cell + gap) + cell / 2
        out.append(f'<text class="axis-label" x="{x:.0f}" y="14" text-anchor="middle">T{j + 1}</text>')
    for i, row in enumerate(pattern):
        y = pad_top + i * (cell + gap)
        out.append(f'<text class="axis-label" x="{pad_left - 12}" y="{y + cell / 2 + 4:.0f}" '
                   f'text-anchor="end">S{i + 1}</text>')
        for j, ch in enumerate(row):
            x = pad_left + j * (cell + gap)
            out.append(f'<rect class="{cls[ch]}" x="{x}" y="{y}" width="{cell}" height="{cell}"/>')
    out.append("</svg>")
    anim = " grid-fig--animate" if animate else ""
    return f'<div class="gridwrap{anim}">' + "".join(out) + "</div>"


LEGEND = ('<div class="legend">'
          '<span><i class="k-c"></i>Control</span>'
          '<span><i class="k-i"></i>Intervention</span>'
          '<span><i class="k-o"></i>Not enrolled</span>'
          '</div>')


def figure(pattern, caption, animate=False):
    return (f'<figure class="grid-fig{" grid-fig--animate" if animate else ""}">'
            + grid_svg(pattern).replace('<div class="gridwrap">', "").replace("</div>", "")
            + LEGEND
            + f"<figcaption>{caption}</figcaption></figure>")


# --------------------------------------------------------------------------
# Shell
# --------------------------------------------------------------------------

NAV_ITEMS = [
    ("/features.html", "Features"),
    ("/guide.html", "Getting started"),
    ("/designs/stepped-wedge.html", "Designs"),
    ("/methods/estimators.html", "Methods"),
]


def nav(current):
    parts = []
    for href, label in NAV_ITEMS:
        cur = " aria-current='page'" if href == current else ""
        parts.append('<a href="%s"%s>%s</a>' % (href, cur, label))
    links = "".join(parts)
    return ('<nav class="nav"><a class="nav__mark" href="/">clustertrial.app</a>'
            '<div class="nav__links">' + links + '</div>'
            '<a class="nav__cta" href="/">Open the calculator</a></nav>')


FOOTER = """<footer class="footer"><div class="wrap"><div class="footer__cols">
<div><h4>Designs</h4><ul>
<li><a href="/designs/stepped-wedge.html">Stepped wedge</a></li>
</ul></div>
<div><h4>Methods</h4><ul>
<li><a href="/methods/estimators.html">Estimators and inference</a></li>
<li><a href="/methods/correlation.html">Correlation structures</a></li>
<li><a href="/methods/verification.html">Verification bundle</a></li>
</ul></div>
<div><h4>Using the tool</h4><ul>
<li><a href="/features.html">Features</a></li>
<li><a href="/guide.html">Getting started</a></li>
</ul></div>
<div><h4>Project</h4><ul>
<li><a href="https://github.com/samuel-watson/ClusterApp2">Source code</a></li>
</ul></div>
</div>
<div class="footer__base">
A free power and sample size calculator for cluster randomised trials. Runs entirely in your
browser &mdash; no data leaves your machine. Built at the University of Birmingham.
</div></div></footer>"""

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{site}{path}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="{site}{path}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
{math}
{jsonld}
</head>
<body>
{nav}
<div class="wrap">
"""

MATHJS = """<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\\\(',right:'\\\\)',display:false}]});"></script>"""


def jsonld_article(title, desc, path):
    return f"""<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"TechArticle","headline":"{title}",
"description":"{desc}","url":"{SITE}{path}",
"isPartOf":{{"@type":"WebSite","name":"clustertrial.app","url":"{SITE}"}},
"about":{{"@type":"Thing","name":"Cluster randomised trial sample size calculation"}}}}
</script>"""


def page(path, title, desc, body, rail=None, math=True):
    r = ""
    cls = "page"
    if rail:
        items = "".join(f'<li><a href="#{i}">{t}</a></li>' for i, t in rail)
        r = f'<aside class="rail"><p class="rail__title">On this page</p><ol>{items}</ol></aside>'
        cls = "page page--railed"
    html = HEAD.format(
        title=title, desc=desc, site=SITE, path=path,
        math=MATHJS if math else "",
        jsonld=jsonld_article(title, desc, path),
        nav=nav(path),
    )
    html += f'<div class="{cls}">{r}<main class="prose">{body}</main></div></div>{FOOTER}</body></html>'
    dest = os.path.join(OUT, path.lstrip("/"))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        f.write(html)
    return path


# ==========================================================================
# CONTENT
# ==========================================================================

FEATURES = r"""
<p class="eyebrow">Features</p>
<h1>What this calculator does that others don&rsquo;t</h1>
<p class="lede">Most cluster trial sample size tools implement one design and one variance
formula. This one lets you draw an arbitrary allocation schedule, compare designs side by
side, choose among ten inference methods, and export a full audit of the computation.</p>

""" + figure(
    ["CIIII", "CCIII", "CCCII", "CCCCI"],
    "The allocation grid is the primary interface. Rows are randomised sequences, columns "
    "are time periods, and each cell is control, intervention, or not enrolled. Any schedule "
    "you can draw, the calculator can evaluate.",
    animate=True,
) + r"""

<div class="feature">
<p class="feature__tag">Design</p>
<h2 id="grid">Draw the trial instead of picking from a menu</h2>
<p>Click a cell to cycle it between control, intervention and not enrolled. Right-click a
row or column header to insert, delete, or set a whole sequence or period at once. Presets
give you the standard shapes &mdash; parallel, parallel with baseline, stepped wedge,
stepped wedge with an implementation period, cross-over, cross-over with washout,
staircase &mdash; but they are starting points, not constraints.</p>
<p>This matters because real trials rarely match a textbook diagram. Sites join late, a
period is lost to a service reorganisation, one arm has a transition phase where data
aren&rsquo;t analysable. A tool that only knows &ldquo;stepped wedge&rdquo; cannot cost
those designs. Here you draw the schedule that will actually happen, set the number of
clusters per sequence independently, and, if cluster-period sizes differ, set each cell
size individually.</p>
</div>

<div class="feature">
<p class="feature__tag">Inference</p>
<h2 id="estimators">Ten estimators, not one</h2>
<p>Power depends on how you will analyse the trial, and the difference is not small. A
mixed model with a normal approximation and a GEE with a robust sandwich variance can
disagree by twenty percentage points of power on the same design with fifteen clusters.
Reporting only the optimistic one is how underpowered trials get funded.</p>
<p>The calculator offers model-based inference with a <em>z</em>- or <em>t</em>-test,
Satterthwaite and Kenward&ndash;Roger small-sample corrections, GEE with independence or
exchangeable working correlation and robust variance, and a classical design-effect
calculation for comparison. Switching estimator recomputes immediately, so you can see
the spread rather than guess at it.</p>
<p><a href="/methods/estimators.html">How each estimator is computed &rarr;</a></p>
</div>

<div class="feature">
<p class="feature__tag">Comparison</p>
<h2 id="compare">Up to three designs open at once</h2>
<p>Sample size decisions are comparative. Is it cheaper to add clusters or to recruit more
people per cluster? Does a baseline period buy back enough precision to justify the extra
year? Does the staircase design lose much against the full stepped wedge?</p>
<p>You can hold three designs in the same session, each with its own allocation grid and
its own parameters, and see power, degrees of freedom, standard error, and minimum
detectable effect for all three in one table. Plots overlay the designs on the same axes.
Duplicating a design and changing one thing is a two-click operation.</p>
</div>

<div class="feature">
<p class="feature__tag">Optimal design</p>
<h2 id="optimal">Optimal weights, shown on the grid</h2>
<p>Given a design and a correlation structure, some cluster-periods carry far more
information about the treatment effect than others. The calculator solves for the optimal
allocation weights and renders them directly onto the grid: cells shrink in proportion to
how little they contribute.</p>
<p>Cell weights show where individual observations are most valuable. Row weights show how
clusters should be distributed across sequences &mdash; often strikingly non-uniform in a
stepped wedge, where the middle sequences are worth more than the first and last. You can
use this to reallocate recruitment effort, or simply as a diagnostic for whether a design
is wasting data.</p>
</div>

<div class="feature">
<p class="feature__tag">Diagnostics</p>
<h2 id="warnings">Warnings when the numbers should not be trusted</h2>
<p>Two failure modes are common enough that the calculator watches for them.</p>
<p><strong>Optimistic inference.</strong> If your selected estimator reports power more
than ten percentage points above the most conservative alternative, you get a warning
naming the gap and suggesting a small-sample correction or a robust variance. This is
almost always a signal that the cluster count is too small for the asymptotics you have
chosen.</p>
<p><strong>Incompatible correlation parameters.</strong> For binary and count outcomes,
an ICC and individual autocorrelation specified on the observed scale must be translated
into random effect variances on the link scale, and not every combination is achievable.
Some require a latent variance so extreme that individuals are effectively deterministic.
The solver reports when this happens, distinguishing &ldquo;high but usable&rdquo; from
&ldquo;implausible&rdquo; from &ldquo;no solution found&rdquo;, so you know whether the
power figure means anything.</p>
<p><a href="/methods/correlation.html">Why binary outcomes make this hard &rarr;</a></p>
</div>

<div class="feature">
<p class="feature__tag">Export</p>
<h2 id="verification">A verification bundle you can hand to a reviewer</h2>
<p>This is the feature with no equivalent anywhere else. One click exports an archive
containing the design matrix, the assumed covariance matrix, the information matrix and
its inverse, the bread and meat of the sandwich estimator, the fitted parameter vectors,
the resulting standard error and degrees of freedom &mdash; plus an R script that
recomputes the standard error from those matrices and checks it against the reported
value.</p>
<p>The point is that nobody has to take the calculator&rsquo;s word for anything. A
statistical reviewer, a CTU quality process, or a regulator can reproduce the number
independently in a few minutes. If your trials unit will not accept a sample size from a
web app, this is the answer to that objection.</p>
<p><a href="/methods/verification.html">What&rsquo;s in the bundle &rarr;</a></p>
</div>

<div class="feature">
<p class="feature__tag">Export</p>
<h2 id="figures">Publication-ready diagrams and plots</h2>
<p>Export the allocation grid as a PNG for your protocol or grant application. Export
power curves and power surfaces as PNG or SVG at publication resolution. Plot power or
minimum detectable effect against ICC, cluster-period size, treatment effect, baseline
prevalence, or total clusters, over a range you set, with a target power reference line.
Heatmap and contour views show power across cluster count and cluster size
simultaneously.</p>
</div>

<div class="feature">
<p class="feature__tag">Sessions</p>
<h2 id="save">Save the session, come back to it</h2>
<p>Export all open designs, with their parameters and results, to a JSON file, and import
it later to resume exactly where you stopped. Sample size calculations get revisited
&mdash; when a reviewer questions an assumption, when funding changes the number of sites,
when the ICC estimate is updated from pilot data. Keeping the file alongside the protocol
means the next revision takes minutes.</p>
</div>

<div class="feature">
<p class="feature__tag">Privacy</p>
<h2 id="local">Everything runs in your browser</h2>
<p>The statistical engine is compiled to WebAssembly and executes locally. No design,
parameter, or result is transmitted anywhere. There is no account, no login, and nothing
to install.</p>
</div>

<hr>
<h2 id="start">Start here</h2>
<ul class="cards">
<li class="card"><h3><a href="/guide.html">Your first calculation</a></h3>
<p>A ten-minute walkthrough from empty grid to exported bundle.</p></li>
<li class="card"><h3><a href="/designs/stepped-wedge.html">Stepped wedge sample size</a></h3>
<p>The model, the parameters, and a worked example.</p></li>
<li class="card"><h3><a href="/methods/estimators.html">Choosing an estimator</a></h3>
<p>What each method assumes and when it misleads.</p></li>
</ul>
"""

GUIDE = r"""
<p class="eyebrow">Getting started</p>
<h1>Your first sample size calculation</h1>
<p class="lede">A walkthrough for a parallel cluster randomised trial with a continuous
outcome, then the same design extended to a stepped wedge. Ten minutes, no installation.</p>

<ol class="steps">
<li>
<h3 id="preset">Choose a starting shape</h3>
<p>The calculator opens on a two-arm parallel design with ten clusters per arm. Presets
across the top load the other standard schedules. Pick the one closest to your trial
&mdash; you will edit it next.</p>
</li>
<li>
<h3 id="model">Draw the schedule</h3>
<p>Click any cell to cycle it through control, intervention, and not enrolled. Right-click
a row or column header to insert or delete sequences and periods, or to set an entire
sequence or period in one action. The number beside each row label is the number of
clusters randomised to that sequence; edit it directly.</p>
<p>For a parallel trial you need one period and two sequences. For a stepped wedge with
four sequences you need five periods, with each sequence crossing over one period later
than the last.</p>
</li>
<li>
<h3 id="effect">Set the outcome and effect size</h3>
<p>Under <span class="param">Analysis Options</span>, choose continuous, binary, or count.
The treatment effect field relabels itself accordingly: a mean difference for continuous
outcomes, an absolute risk difference for binary, a rate ratio for counts. Binary and count
outcomes also need a baseline &mdash; the control-arm probability or rate.</p>
<p>A common error is entering a standardised effect size while thinking in raw units. For
continuous outcomes the calculator works on the outcome&rsquo;s own scale, with the
residual variance implied by the ICC.</p>
</li>
<li>
<h3 id="correlation">Set the correlation</h3>
<p>The intracluster correlation is the one parameter people most often guess at. Values
between 0.01 and 0.05 are typical for health service outcomes measured on patients within
practices or wards; higher values are common for outcomes measured on staff, or for
process measures under strong local control.</p>
<p>With more than one period you also choose a correlation structure. Exchangeable assumes
correlation between two observations in the same cluster does not depend on how far apart
in time they are &mdash; usually optimistic for a trial running over years.
<a href="/methods/correlation.html">The alternatives are explained here.</a></p>
</li>
<li>
<h3 id="sizes">Set cluster sizes</h3>
<p>Under <span class="param">Sample Size Options</span>, enter the mean number of
individuals per cluster-period. If cluster sizes vary substantially, enter a coefficient
of variation; the calculator inflates the variance accordingly. If you know the exact size
of each cell &mdash; which happens when clusters are known in advance &mdash; switch to
exact mode and right-click cells to set them individually.</p>
</li>
<li>
<h3 id="estimator">Choose how you will analyse the trial</h3>
<p>Set the estimator to match your analysis plan, not to maximise power. If your
statistical analysis plan says a linear mixed model with Kenward&ndash;Roger degrees of
freedom, choose that. Then change it a few times and watch what happens to power. A design
whose power is stable across estimators is robust; one that is only adequately powered
under the most optimistic method is not.</p>
</li>
<li>
<h3 id="results">Read the results, and the warnings</h3>
<p>Power, degrees of freedom, standard error, and minimum detectable effect appear in the
results table. If a warning panel appears above it, read it before anything else &mdash;
it means either that your estimator choice is flattering the design, or that the
correlation parameters you have specified are hard to realise in the model being fitted.</p>
</li>
<li>
<h3 id="explore">Explore rather than solve</h3>
<p>The plot below the results is the most useful part of the tool. Set the x-axis to total
clusters and you can read off the number needed for 80% power directly. Set it to ICC and
you can see how sensitive that answer is to a parameter you are guessing. Switch to the
contour view to see power across cluster count and cluster size at once &mdash; which is
the real trade-off when recruitment is the binding constraint.</p>
</li>
<li>
<h3 id="compare">Add a comparison</h3>
<p>Use <span class="param">Add Design</span> to duplicate what you have, then change one
thing: add a baseline period, drop a sequence, halve the cluster size. Both designs appear
side by side in the results table and overlaid on the plot. This is usually more
informative than any single number.</p>
</li>
<li>
<h3 id="export">Export</h3>
<p>Save the session as JSON so you can return to it. Export the grid as a PNG for the
protocol. If the calculation is going into a grant application or a submission, export the
verification bundle &mdash; it contains every matrix in the computation and an R script
that reproduces the standard error independently.</p>
</li>
</ol>

<div class="note">
<strong>A note on what power calculations are for</strong>
<p>A sample size calculation is a statement of what a trial can detect under assumptions
you have chosen, not a prediction. The most valuable output of this tool is usually not the
number in the power box but the shape of the curve around it &mdash; how quickly power
falls away if the ICC is twice what you assumed, or if recruitment reaches 70% of target.
Report that sensitivity, and reviewers will trust the headline number more, not less.</p>
</div>
"""


STEPPED = r"""
<p class="eyebrow">Designs</p>
<h1>Stepped wedge sample size calculation</h1>
<p class="lede">In a stepped wedge cluster randomised trial every cluster eventually
receives the intervention, but the order in which they cross over is randomised. It is the
design of choice when an intervention is being rolled out anyway and withholding it
permanently is not acceptable.</p>

""" + figure(
    ["CIIII", "CCIII", "CCCII", "CCCCI"],
    "A four-sequence, five-period stepped wedge. Every cluster starts in the control "
    "condition and crosses over at a randomised time. The treatment effect is identified "
    "by comparing cluster-periods under intervention with cluster-periods under control, "
    "adjusted for time.",
) + r"""

<h2 id="model">The model</h2>
<p>The standard analysis model, following Hussey and Hughes (2007), is a linear mixed model
with fixed effects for time and a random intercept for cluster:</p>
<p>$$Y_{ijt} = \mu + \beta_t + X_{jt}\,\theta + \alpha_j + e_{ijt}$$</p>
<p>where \(Y_{ijt}\) is the outcome for individual \(i\) in cluster \(j\) at period \(t\),
\(\beta_t\) are period effects, \(X_{jt}\) is the treatment indicator, \(\theta\) is the
treatment effect, \(\alpha_j \sim N(0,\tau^2)\) is the cluster random effect and
\(e_{ijt} \sim N(0,\sigma^2)\) is residual error. The intracluster correlation is</p>
<p>$$\rho = \frac{\tau^2}{\tau^2 + \sigma^2}$$</p>
<p>The fixed period effects are essential. Because clusters cross over at different times,
treatment status is confounded with time; a model without period effects will attribute any
secular trend to the intervention. This also means the design carries no information about
the treatment effect from between-cluster comparisons alone.</p>

<h2 id="parameters">What you need to specify</h2>
<div class="tbl-scroll"><table>
<thead><tr><th>Parameter</th><th>Meaning</th><th>Typical values</th></tr></thead>
<tbody>
<tr><td>Sequences</td><td>Number of randomisation groups, each crossing over at a different period</td><td>4&ndash;12</td></tr>
<tr><td>Periods</td><td>Number of measurement periods, usually sequences + 1</td><td>5&ndash;13</td></tr>
<tr><td>Clusters per sequence</td><td>Clusters randomised to each crossover time</td><td>1&ndash;10</td></tr>
<tr><td>Cluster-period size</td><td>Individuals measured per cluster per period</td><td>10&ndash;200</td></tr>
<tr><td>ICC</td><td>Within-cluster correlation \(\rho\)</td><td>0.01&ndash;0.10</td></tr>
<tr><td>CAC</td><td>Cluster autocorrelation, if using nested exchangeable</td><td>0.6&ndash;1.0</td></tr>
</tbody></table></div>

<h2 id="intuition">Why stepped wedges are more efficient than they look</h2>
<p>A stepped wedge gets information from two sources: <em>vertical</em> comparisons between
clusters within the same period, and <em>horizontal</em> comparisons within a cluster before
and after crossover. The horizontal comparison is unavailable in a parallel trial and is
what makes the stepped wedge competitive despite the confounding with time.</p>
<p>How much the horizontal comparison is worth depends entirely on the correlation
structure. Under exchangeable correlation, within-cluster comparisons are highly precise
because the cluster effect cancels, and the stepped wedge can need far fewer clusters than
a parallel trial. Under a decaying correlation, observations separated by several periods
are much less correlated, the cluster effect no longer cancels cleanly, and the advantage
shrinks &mdash; sometimes substantially.</p>
<div class="note note--warn">
<strong>Exchangeable correlation is the optimistic assumption</strong>
<p>Assuming exchangeable correlation over a trial lasting two or three years asserts that
observations twelve periods apart are as correlated as observations in adjacent periods.
For most health service outcomes this is implausible. If you have any basis for it,
specify a cluster autocorrelation below 1 or an explicit decay, and check how much power
you lose. <a href="/methods/correlation.html">More on choosing a structure &rarr;</a></p>
</div>

<h2 id="variants">Variants the calculator supports</h2>
<h3>Implementation periods</h3>
<p>Real rollouts have transition time. Marking the crossover period as not enrolled removes
those cluster-periods from the analysis, which is usually more honest than treating a
half-implemented intervention as full strength.</p>
""" + figure(
    ["COIII", "CCOII", "CCCOI", "CCCCO"],
    "Stepped wedge with an implementation period. The transition cluster-periods are "
    "excluded from analysis rather than being assigned to either condition.",
) + r"""
<h3>Incomplete and staircase designs</h3>
<p>If measurement is expensive, you do not need every cluster measured in every period. The
staircase design measures each cluster only in the periods immediately before and after its
crossover, discarding cluster-periods that contribute little. It costs remarkably little
power relative to the full design while cutting data collection dramatically &mdash; turn
on cell weights in the calculator to see why.</p>
""" + figure(
    ["CIOOO", "OCIOO", "OOCIO", "OOOCI"],
    "A staircase design. Only cluster-periods adjacent to crossover are measured. Compare "
    "its power against the full stepped wedge by opening both designs side by side.",
) + r"""

<h2 id="pitfalls">Common pitfalls</h2>
<ul>
<li><strong>Ignoring the number of clusters.</strong> Power in a stepped wedge is driven far
more by the number of clusters than by the number of individuals per cluster. Doubling
cluster-period size when the ICC is 0.05 and there are 60 people per period buys almost
nothing; adding four clusters may buy a great deal.</li>
<li><strong>Small-cluster asymptotics.</strong> With fewer than about 20 clusters, a
model-based <em>z</em>-test overstates power appreciably. Use Kenward&ndash;Roger or
Satterthwaite degrees of freedom and report that you have done so.</li>
<li><strong>Assuming a constant treatment effect.</strong> If the intervention effect grows
over time after implementation, a model assuming an immediate constant effect is
misspecified, and the estimated effect is a weighted average that depends on the design.
Consider whether an exposure-time model is more appropriate.</li>
<li><strong>Unequal sequence sizes chosen arbitrarily.</strong> Clusters are not equally
valuable in every sequence. Turn on row weights to see the optimal distribution before
fixing your randomisation.</li>
</ul>

<h2 id="worked">Working through an example</h2>
<p>Suppose 24 general practices will adopt a new referral pathway over two years, in six
sequences of four practices, with seven two-monthly periods. The outcome is continuous,
with an assumed ICC of 0.03 and roughly 40 eligible patients per practice per period. You
expect a difference of 0.25 standard deviations.</p>
<p>To evaluate this: load the stepped wedge preset, set six sequences and seven periods,
set four clusters per sequence, mean size 40, ICC 0.03, treatment effect 0.25 with the
outcome standardised. Then set the estimator to Kenward&ndash;Roger, and plot power against
total clusters to see how much slack you have if two practices withdraw.</p>
<p><a href="/">Open the calculator and try it &rarr;</a></p>

<h2 id="refs">References</h2>
<ul>
<li>Hussey MA, Hughes JP (2007). Design and analysis of stepped wedge cluster randomized
trials. <em>Contemporary Clinical Trials</em> 28(2), 182&ndash;191.</li>
<li>Hooper R, Teerenstra S, de Hoop E, Eldridge S (2016). Sample size calculation for
stepped wedge and other longitudinal cluster randomised trials. <em>Statistics in
Medicine</em> 35(26), 4718&ndash;4728.</li>
<li>Kasza J, Hemming K, Hooper R, Matthews JNS, Forbes AB (2019). Impact of non-uniform
correlation structure on sample size and power in multiple-period cluster randomised
trials. <em>Statistical Methods in Medical Research</em> 28(3), 703&ndash;716.</li>
<li>Hemming K, Taljaard M (2020). Reflection on modern methods: when is a stepped-wedge
design a good choice? <em>International Journal of Epidemiology</em> 49(3), 1043&ndash;1052.</li>
</ul>
"""


ESTIMATORS = r"""
<p class="eyebrow">Methods</p>
<h1>Estimators and inference</h1>
<p class="lede">Power is not a property of a design alone. It is a property of a design
together with an analysis method. This page sets out what each estimator in the calculator
computes and when it will mislead you.</p>

<h2 id="core">The common core</h2>
<p>Every estimator starts from a design matrix \(X\) with one row per cluster-period and a
model-implied covariance matrix \(\Sigma\). The generalised least squares information
matrix is</p>
<p>$$M = X^{\top}\Sigma^{-1}X$$</p>
<p>and the model-based variance of the treatment effect estimate is the diagonal element of
\(M^{-1}\) corresponding to the treatment column:</p>
<p>$$\operatorname{Var}(\hat\theta) = \left[(X^{\top}\Sigma^{-1}X)^{-1}\right]_{kk}$$</p>
<p>Everything else is a variation on how \(\Sigma\) is built, whether a different working
covariance is used for estimation than for the true variance, and what reference
distribution the test statistic is compared against.</p>

<h2 id="modelbased">Model-based inference</h2>
<h3>Normal approximation</h3>
<p>The default. Treats \(\hat\theta / \operatorname{SE}(\hat\theta)\) as standard normal
under the null, giving</p>
<p>$$\text{power} = \Phi\!\left(\frac{|\theta|}{\operatorname{SE}} - z_{1-\alpha/2}\right)$$</p>
<p>Accurate when the number of clusters is large. With few clusters it is optimistic,
because it ignores the fact that the variance components are estimated rather than known.</p>

<h3>t-test</h3>
<p>Same standard error, but referred to a <em>t</em> distribution with degrees of freedom
based on the number of clusters minus the number of estimated fixed effects. A minimal
correction, but it removes the worst of the anti-conservatism at essentially no cost.</p>

<h3>Satterthwaite</h3>
<p>Approximates the degrees of freedom by matching the first two moments of the estimated
variance to a scaled chi-squared distribution. Accounts for the fact that different
contrasts in an unbalanced design carry different effective sample sizes, so the degrees of
freedom need not be an integer and can be far below the cluster count.</p>

<h3>Kenward&ndash;Roger</h3>
<p>Inflates the variance estimate to account for the downward bias induced by estimating the
variance components, <em>and</em> adjusts the degrees of freedom. The most conservative of
the model-based options and generally the best behaved with small numbers of clusters. If
your analysis plan is a linear mixed model and you have fewer than about 30 clusters, this
is usually the honest choice.</p>

<h2 id="robust">Robust and marginal methods</h2>
<p>GEE estimators use a working covariance \(V\) that need not equal the truth. The variance
is then estimated by a sandwich:</p>
<p>$$\operatorname{Var}(\hat\theta) = \underbrace{(X^{\top}V^{-1}X)^{-1}}_{\text{bread}}\;
\underbrace{X^{\top}V^{-1}\Sigma V^{-1}X}_{\text{meat}}\;
\underbrace{(X^{\top}V^{-1}X)^{-1}}_{\text{bread}}$$</p>
<p><strong>Independence working correlation</strong> takes \(V = I\): the point estimate
ignores clustering entirely, but the sandwich variance restores valid inference. Simple and
robust to covariance misspecification, at some cost in efficiency.</p>
<p><strong>Exchangeable working correlation</strong> uses a correctly shaped working
covariance, recovering most of the efficiency while keeping the robustness of the sandwich.</p>
<p>The sandwich variance is consistent as the number of clusters grows, but it is
<em>biased downward</em> when that number is small &mdash; the well known small-sample
problem with GEE. A <em>t</em>-test variant is provided for this reason. Below roughly 30
clusters, treat an uncorrected robust GEE result with the same suspicion as an uncorrected
model-based one.</p>

<h2 id="conditional">Conditional and marginal effects</h2>
<p>For continuous outcomes with an identity link, a mixed model and a GEE estimate the same
quantity. For binary and count outcomes they do not.</p>
<p>A GLMM with a logit link estimates a <em>conditional</em>, cluster-specific log odds
ratio: the effect of treatment for a given cluster. A GEE estimates a <em>marginal</em>,
population-averaged log odds ratio: the effect averaged over the cluster distribution.
Because the logit is non-linear, these differ, with the marginal effect attenuated toward
the null relative to the conditional one. The gap widens as the between-cluster variance
grows.</p>
<div class="note">
<strong>What to do about it</strong>
<p>Decide which estimand your trial question is about, then match the estimator to it, then
match the effect size you enter to the same scale. A conditional log odds ratio entered as
if it were marginal will overstate power. The calculator labels the binary and count
estimators explicitly as conditional or marginal for this reason.</p>
</div>

<h2 id="designeffect">Design effect</h2>
<p>Included for comparison with textbook and older calculations. The individually randomised
sample size is inflated by</p>
<p>$$\text{DE} = 1 + (\bar{m} - 1)\rho$$</p>
<p>for equal cluster sizes, or, allowing a coefficient of variation \(k\) in cluster size,</p>
<p>$$\text{DE} = 1 + \left\{\bar{m}(1 + k^{2}) - 1\right\}\rho$$</p>
<p>This is exact for a parallel design with a single period and no covariates. It is
<em>not</em> correct for any longitudinal design, and applying it to a stepped wedge will
overstate the required sample size substantially, because it ignores the within-cluster
comparisons entirely. It is offered so you can see the size of that discrepancy rather than
as a recommendation.</p>

<h2 id="choosing">Choosing, in practice</h2>
<div class="tbl-scroll"><table>
<thead><tr><th>Situation</th><th>Reasonable choice</th></tr></thead>
<tbody>
<tr><td>Continuous outcome, &lt; 30 clusters</td><td>Kenward&ndash;Roger</td></tr>
<tr><td>Continuous outcome, many clusters</td><td>Model-based, Satterthwaite for reassurance</td></tr>
<tr><td>Binary outcome, conditional estimand</td><td>GLMM with Satterthwaite or Kenward&ndash;Roger</td></tr>
<tr><td>Binary outcome, marginal estimand</td><td>GEE exchangeable robust, with <em>t</em>-test if few clusters</td></tr>
<tr><td>Covariance structure genuinely uncertain</td><td>GEE robust, and compare against model-based</td></tr>
</tbody></table></div>
<p>Whichever you choose, look at the spread across the alternatives before you commit. If
adequate power depends on which estimator you pick, the design is fragile, and that is worth
knowing at the protocol stage rather than at the analysis.</p>
"""


CORRELATION = r"""
<p class="eyebrow">Methods</p>
<h1>Correlation structures and sampling</h1>
<p class="lede">In a longitudinal cluster trial, the assumption you make about how
correlation decays over time can change the required sample size by a factor of two. It
deserves more thought than it usually gets.</p>

<h2 id="icc">The intracluster correlation</h2>
<p>For a continuous outcome with a cluster random effect of variance \(\tau^2\) and residual
variance \(\sigma^2\), the correlation between any two individuals in the same cluster is</p>
<p>$$\rho = \frac{\tau^2}{\tau^2 + \sigma^2}$$</p>
<p>This single number is what makes cluster trials less efficient than individually
randomised ones: observations within a cluster carry partly redundant information. In a
single-period parallel trial it is the only correlation parameter you need. As soon as there
is more than one period, it is not enough &mdash; you must also say how correlation behaves
<em>across</em> periods.</p>

<h2 id="structures">The four structures</h2>

<h3>Exchangeable</h3>
<p>$$\operatorname{Cor}(Y_{ijt}, Y_{i'jt'}) = \rho \quad \text{for all } t, t'$$</p>
<p>Correlation is the same regardless of separation in time. The cluster effect is a single
constant shift that persists undiminished for the whole trial. Simple, and the assumption
underlying the original Hussey and Hughes calculations, but strong: it implies a practice
measured in month 1 and month 36 is as similar to itself as it is between consecutive
months.</p>

<h3>Nested exchangeable</h3>
<p>$$\operatorname{Cor} = \begin{cases}\rho & t = t' \\ \rho \times \text{CAC} & t \neq t'\end{cases}$$</p>
<p>Adds a cluster autocorrelation (CAC) that discounts all between-period correlation by a
constant factor. Within-period correlation stays at \(\rho\); between-period correlation
drops to \(\rho \times \text{CAC}\) regardless of how far apart the periods are. A CAC of 1
recovers exchangeability. Values of 0.7&ndash;0.95 are commonly reported.</p>
<p>This is a good default when you believe correlation decays but have no basis for
specifying a rate. It is implemented as a second random effect nested within cluster-period.</p>

<h3>Exponential decay</h3>
<p>$$\operatorname{Cor}(Y_{ijt}, Y_{i'jt'}) = \rho\,\lambda^{|t - t'|}$$</p>
<p>Correlation decays geometrically with the number of periods separating the observations,
at a rate governed by \(\lambda \in (0,1)\). More realistic for long trials where cluster
composition, staffing, and case mix all drift. Sometimes called a discrete-time AR(1)
structure for the cluster effect.</p>

<h3>Exponential function</h3>
<p>$$\operatorname{Cor}(Y_{ijt}, Y_{i'jt'}) = \rho \exp\!\left(-\frac{|t - t'|}{\ell}\right)$$</p>
<p>The same idea parameterised by a lengthscale \(\ell\) in period units, which is easier to
elicit: a lengthscale of 4 means correlation falls to about 37% of its within-period value
after four periods. Useful when periods are irregularly spaced or when you want to reason
about decay in real time rather than period counts.</p>

<div class="note note--warn">
<strong>The choice is not neutral</strong>
<p>Structures are ordered from most to least favourable to longitudinal designs. A stepped
wedge that looks comfortably powered under exchangeable correlation can fall well below 80%
under exponential decay with a plausible rate. Because the assumption is rarely testable in
advance, the defensible approach is to compute power under more than one structure and
report the least favourable. The calculator lets you hold two designs side by side that
differ only in this assumption.</p>
</div>

<h2 id="sampling">Sampling structure</h2>
<p>Who is measured in each period changes the correlation structure independently of the
cluster effect.</p>
<div class="tbl-scroll"><table>
<thead><tr><th>Structure</th><th>Meaning</th><th>Extra parameter</th></tr></thead>
<tbody>
<tr><td>Cross-sectional</td><td>Different individuals measured each period</td><td>&mdash;</td></tr>
<tr><td>Closed cohort</td><td>The same individuals measured every period</td><td>IAC</td></tr>
<tr><td>Open cohort</td><td>A cohort with turnover between periods</td><td>IAC, replacement rate</td></tr>
</tbody></table></div>
<p>The <strong>individual autocorrelation</strong> (IAC) is the correlation between repeated
measurements on the same person, over and above the correlation induced by shared cluster
membership. Cohort designs are usually more efficient than cross-sectional ones, because
each individual acts partly as their own control &mdash; but this depends on the IAC being
substantial, and it comes at the cost of attrition risk.</p>
<p>The <strong>replacement rate</strong> in an open cohort is the proportion of individuals
replaced between consecutive periods. Zero recovers a closed cohort; one recovers a
cross-sectional design. Intermediate values interpolate, which is usually a better
description of a real service population than either extreme.</p>

<h2 id="binary">Why binary outcomes make this hard</h2>
<p>For a continuous outcome, ICC and IAC map directly onto variance components. For binary
and count outcomes they do not, and this is a genuine difficulty rather than an
implementation detail.</p>
<p>You specify correlations on the <em>observed</em> scale, because that is the scale on
which they are reported and understood. But the model is fitted on the <em>link</em> scale,
with random effects entering a logit or log linear predictor. Translating between the two
requires solving for the random effect variances that induce the requested observed-scale
correlations, given the baseline prevalence. That solution does not always exist, and when
it does it is not always sensible.</p>
<p>The reason is that a binary outcome&rsquo;s variance is bounded by its mean. To achieve a
high correlation between repeated binary measurements on the same individual, the model
needs a large individual-level random effect variance &mdash; and a large variance on the
logit scale pushes individual response probabilities toward 0 and 1. In the limit, the model
says every individual either always responds or never does, and the observed prevalence
arises entirely from the mix of types in the population rather than from any within-person
uncertainty. That is a coherent model, but it is rarely what anyone intends, and power under
it can be very different from power under a moderate-variance model.</p>

<h3>What the warnings mean</h3>
<div class="tbl-scroll"><table>
<thead><tr><th>Level</th><th>What the solver found</th><th>What to do</th></tr></thead>
<tbody>
<tr><td>Moderate</td><td>A solution exists but requires high random effect variance</td>
<td>Usable. Compare conditional and marginal estimators &mdash; they may diverge noticeably.</td></tr>
<tr><td>Severe</td><td>A solution exists but requires extreme variance, implying near-deterministic individuals</td>
<td>Reconsider the parameters. Lower the IAC or raise the ICC toward a more plausible combination.</td></tr>
<tr><td>Failure</td><td>No valid parameters found</td>
<td>The requested combination is not achievable in this model. Power output is unreliable and should not be used.</td></tr>
</tbody></table></div>
<p>These warnings appear only for non-continuous outcomes with a cohort sampling structure
and a non-zero IAC, which is where the problem arises.</p>

<h2 id="sources">Where to get correlation estimates</h2>
<ul>
<li>Published ICC databases for primary care and hospital outcomes, which give plausible
ranges by outcome type and cluster definition.</li>
<li>Routine data for the same outcome in the same setting, which is usually the best
available source and often already accessible.</li>
<li>Previous trials in the same clusters, if any &mdash; but check the cluster definition
matches, since ICCs at practice level and at ward level are not interchangeable.</li>
</ul>
<p>Whatever the source, treat the estimate as uncertain and plot power across a range. An
ICC point estimate from a study of thirty clusters has a wide confidence interval, and
propagating that uncertainty into the sample size is more honest than picking the midpoint.</p>
"""


VERIFICATION = r"""
<p class="eyebrow">Methods</p>
<h1>The verification bundle</h1>
<p class="lede">Every power calculation the tool produces can be exported as a complete
computational audit: every matrix in the derivation, plus an R script that reproduces the
standard error independently. Nobody has to trust the software.</p>

<h2 id="why">Why this exists</h2>
<p>Sample size calculations are among the least reproducible parts of a trial protocol.
A protocol typically states a number, an assumed effect size, an ICC, and a software name.
A reviewer cannot check the arithmetic, cannot see the assumed covariance structure, and
cannot tell whether the reported figure came from the design as finally specified or an
earlier draft.</p>
<p>Trials units are right to be cautious about a browser-based calculator for exactly this
reason. The verification bundle is the answer: it makes the computation fully inspectable,
so the tool&rsquo;s trustworthiness stops being something you have to take on faith.</p>

<h2 id="contents">What the bundle contains</h2>
<div class="tbl-scroll"><table>
<thead><tr><th>Object</th><th>Description</th></tr></thead>
<tbody>
<tr><td><code>X</code></td><td>Design matrix, one row per cluster-period, columns for intercept, treatment, and period effects</td></tr>
<tr><td><code>Sigma</code></td><td>Model-implied covariance matrix under the specified correlation and sampling structure</td></tr>
<tr><td><code>M</code></td><td>Information matrix \(X^{\top}\Sigma^{-1}X\)</td></tr>
<tr><td><code>Minv</code></td><td>Its inverse, whose treatment diagonal element is the model-based variance</td></tr>
<tr><td><code>bread</code>, <code>meat</code></td><td>Components of the sandwich variance, when a robust estimator is selected</td></tr>
<tr><td><code>V_working</code></td><td>Working covariance used for estimation, where it differs from the truth</td></tr>
<tr><td><code>Sigma_true</code></td><td>Assumed true covariance, used in the meat of the sandwich</td></tr>
<tr><td><code>beta</code>, <code>theta</code></td><td>Fixed effect and covariance parameter vectors</td></tr>
<tr><td><code>se</code>, <code>dof</code>, <code>power</code></td><td>Resulting standard error, degrees of freedom, and power</td></tr>
<tr><td>Solver diagnostics</td><td>Target versus achieved ICC, IAC and baseline; raw variance components; iteration count and convergence status</td></tr>
<tr><td>Data matrix</td><td>The cluster-period level dataset the model was built from</td></tr>
<tr><td>R script</td><td>Reads the exported matrices, recomputes the standard error, and compares it against the reported value</td></tr>
</tbody></table></div>

<h2 id="solver">The solver diagnostics</h2>
<p>For binary and count outcomes, the reported ICC and IAC are targets on the observed scale
that must be translated into random effect variances on the link scale. The bundle reports
both the targets and what was actually achieved, along with the raw variance components and
whether the solver converged.</p>
<p>This matters because a small discrepancy between target and achieved correlation is
normal and acceptable, while a large one means the requested combination was near the edge
of what the model can represent. Exposing both lets a reviewer judge for themselves rather
than relying on a warning threshold chosen by the software.
<a href="/methods/correlation.html#binary">Background on why this arises &rarr;</a></p>

<h2 id="using">Using it in a submission</h2>
<ul>
<li><strong>In a protocol appendix.</strong> Include the R script and the reported standard
error. A statistical reviewer can rerun it in under a minute.</li>
<li><strong>In a CTU quality process.</strong> The bundle documents every assumption
explicitly, including ones a protocol paragraph would omit &mdash; the exact covariance
structure, the estimator, the degrees of freedom method.</li>
<li><strong>For your own records.</strong> When someone asks in eighteen months why the
sample size is what it is, the bundle answers the question precisely, including which
version of the design it referred to.</li>
</ul>

<div class="note">
<strong>Recalculate before exporting</strong>
<p>The export button is disabled while results are marked stale, so a bundle always
corresponds to the design and parameters currently on screen rather than to an earlier
state. If the button is greyed out, press Recalculate first.</p>
</div>
"""


# ==========================================================================
# BUILD
# ==========================================================================

built = []

built.append(page("/features.html",
    "Features — clustertrial.app cluster randomised trial calculator",
    "Graphical trial design, ten estimators, side-by-side design comparison, optimal "
    "allocation weights, exportable verification bundles and power plots for cluster "
    "randomised trials.",
    FEATURES))

built.append(page("/guide.html",
    "Getting started: your first cluster trial sample size calculation",
    "A step-by-step walkthrough from an empty allocation grid to an exported verification "
    "bundle, for parallel and stepped wedge cluster randomised trials.",
    GUIDE,
    rail=[("preset", "Choose a shape"), ("model", "Draw the schedule"),
          ("effect", "Effect size"), ("correlation", "Correlation"),
          ("sizes", "Cluster sizes"), ("estimator", "Estimator"),
          ("results", "Results"), ("explore", "Explore"), ("compare", "Compare"), ("export", "Export")]))

built.append(page("/designs/stepped-wedge.html",
    "Stepped wedge sample size calculation — model, parameters and worked example",
    "How to calculate sample size and power for a stepped wedge cluster randomised trial: "
    "the Hussey and Hughes model, correlation assumptions, incomplete and staircase "
    "variants, and common pitfalls.",
    STEPPED,
    rail=[("model", "The model"), ("parameters", "Parameters"),
          ("intuition", "Why it works"), ("variants", "Variants"),
          ("pitfalls", "Pitfalls"), ("worked", "Worked example"), ("refs", "References")]))

built.append(page("/methods/estimators.html",
    "Estimators and inference for cluster randomised trials",
    "Model-based, Satterthwaite, Kenward-Roger, GEE with robust sandwich variance, and "
    "design effect calculations for cluster randomised trials, and when each one misleads.",
    ESTIMATORS,
    rail=[("core", "Common core"), ("modelbased", "Model-based"),
          ("robust", "Robust and GEE"), ("conditional", "Conditional vs marginal"),
          ("designeffect", "Design effect"), ("choosing", "Choosing")]))

built.append(page("/methods/correlation.html",
    "Correlation structures and sampling in cluster randomised trials",
    "Exchangeable, nested exchangeable, exponential decay and exponential function "
    "correlation structures; cross-sectional, closed and open cohort sampling; ICC, CAC "
    "and IAC; and why binary outcomes constrain achievable correlations.",
    CORRELATION,
    rail=[("icc", "The ICC"), ("structures", "Four structures"),
          ("sampling", "Sampling"), ("binary", "Binary outcomes"),
          ("sources", "Finding estimates")]))

built.append(page("/methods/verification.html",
    "The verification bundle: auditable cluster trial power calculations",
    "Export every matrix in a cluster trial power calculation plus an R script that "
    "independently reproduces the standard error, for protocol appendices and CTU review.",
    VERIFICATION,
    rail=[("why", "Why it exists"), ("contents", "Contents"),
          ("solver", "Solver diagnostics"), ("using", "In a submission")]))

# sitemap
urls = ["/"] + built
sm = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for u in urls:
    pri = "1.0" if u == "/" else "0.8"
    sm.append(f"<url><loc>{SITE}{u}</loc><priority>{pri}</priority></url>")
sm.append("</urlset>")
with open(os.path.join(OUT, "sitemap.xml"), "w") as f:
    f.write("\n".join(sm))

with open(os.path.join(OUT, "robots.txt"), "w") as f:
    f.write(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n")

print("Built:")
for u in built:
    print("  ", u)
print("   /sitemap.xml\n   /robots.txt")
