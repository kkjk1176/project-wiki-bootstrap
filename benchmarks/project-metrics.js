#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist", "init-project-wiki.js");
const schemaVersion = 3;

const scales = {
  quick: {
    docsHeavyPages: 40,
    monorepoApps: 3,
    monorepoPackages: 6,
    docsPerWorkspace: 3,
    codePackages: 4,
    filesPerCodePackage: 20,
    readIterations: 10,
  },
  large: {
    docsHeavyPages: 500,
    monorepoApps: 8,
    monorepoPackages: 32,
    docsPerWorkspace: 8,
    codePackages: 24,
    filesPerCodePackage: 50,
    readIterations: 35,
  },
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`missing value for ${name}`);
  return value;
}

function positiveIntegerArgValue(name, defaultValue) {
  const value = argValue(name);
  if (!value) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`invalid integer for ${name}: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`invalid integer for ${name}: ${value}`);
  return parsed;
}

function optionalArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return "";
  return value;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return ((sorted[middle - 1] || 0) + (sorted[middle] || 0)) / 2;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function stats(values) {
  const average = mean(values);
  const deviation = standardDeviation(values);
  return {
    runs: values.length,
    min: round(Math.min(...values), 3),
    median: round(median(values), 3),
    max: round(Math.max(...values), 3),
    mean: round(average, 3),
    stddev: round(deviation, 3),
    coefficient_of_variation_percent: average === 0 ? 0 : round((deviation / average) * 100),
  };
}

function estimatedTokens(chars) {
  return Math.ceil(chars / 4);
}

function timed(label, fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return { elapsed_ms: round(elapsedMs, 3), label, value };
}

function runNode(args, cwd) {
  return timed(args.join(" "), () => childProcess.execFileSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function parseKeyValueOutput(output) {
  return Object.fromEntries(output
    .split(/\r?\n/)
    .map((line) => line.match(/^([a-z_]+):\s*(.+)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]));
}

function expectBenchmark(condition, message) {
  if (!condition) fail(`benchmark validation failed: ${message}`);
}

function passedValidation(name) {
  return { name, status: "passed" };
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readFiles(files, cwd, iterations) {
  const result = timed("read files", () => {
    let chars = 0;
    for (let index = 0; index < iterations; index += 1) {
      for (const file of files) chars += fs.readFileSync(path.join(cwd, file), "utf8").length;
    }
    return Math.round(chars / iterations);
  });
  return {
    avg_read_ms: round(result.elapsed_ms / iterations, 3),
    chars: result.value,
    estimated_tokens: estimatedTokens(result.value),
    file_count: files.length,
    files,
  };
}

function listWikiMarkdown(cwd) {
  const files = [];
  function walk(relativeDir) {
    const absoluteDir = path.join(cwd, relativeDir);
    if (!fs.existsSync(absoluteDir)) return;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) walk(relativePath);
      else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name) && relativePath !== path.join("wiki", "AGENTS.md")) {
        files.push(relativePath.split(path.sep).join("/"));
      }
    }
  }
  walk("wiki");
  return files.sort();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function metadata(scope, budget = "medium") {
  return `---
status: active
updated: ${today()}
scope: ${scope}
read_budget: ${budget}
decision_ref: none
review_trigger: benchmark fixture regeneration
---
`;
}

function verboseProjectDoc(title, lines, scope = "project-canonical") {
  const body = Array.from({ length: lines }, (_, index) => {
    return `- ${title} evidence ${index + 1}: ownership boundary, API contract, operational constraint, dependency relationship, release evidence, escalation rule, and verification signal.`;
  }).join("\n");
  return `${metadata(scope)}
# ${title}

## TL;DR

- Large-project benchmark document for ${title}.
- This page is intentionally detailed and should be read on demand, not at session start.

## Details

${body}
`;
}

function packageName(index) {
  return `workspace-${String(index).padStart(2, "0")}`;
}

function generatedTsFile(packageIndex, fileIndex, filesPerPackage) {
  const localName = `service${packageIndex}_${fileIndex}`;
  const next = fileIndex + 1 < filesPerPackage ? `import { service${packageIndex}_${fileIndex + 1} } from "./service-${fileIndex + 1}";\n` : "";
  const callNext = fileIndex + 1 < filesPerPackage ? `  return value + service${packageIndex}_${fileIndex + 1}(value - 1);\n` : "  return value;\n";
  return `${next}
export interface ${localName}Config {
  id: string;
  enabled: boolean;
  retryLimit: number;
}

export class ${localName}Runner {
  constructor(private readonly config: ${localName}Config) {}

  run(value: number): number {
    return ${localName}(value) + this.config.retryLimit;
  }
}

export function ${localName}(value: number): number {
${callNext}}
`;
}

function bootstrapProject(cwd) {
  fs.mkdirSync(cwd, { recursive: true });
  return runNode([cli], cwd).elapsed_ms;
}

function contextSavings(cwd, iterations) {
  const compactFiles = ["wiki/startup.md", "wiki/index.md"];
  const fullWikiFiles = listWikiMarkdown(cwd);
  const compactContext = readFiles(compactFiles, cwd, iterations);
  const fullWiki = readFiles(fullWikiFiles, cwd, iterations);
  const savedTokens = fullWiki.estimated_tokens - compactContext.estimated_tokens;
  const savedReadMs = fullWiki.avg_read_ms - compactContext.avg_read_ms;
  return {
    compact_context: compactContext,
    full_wiki: {
      ...fullWiki,
      files_sample: fullWiki.files.slice(0, 20),
      files: undefined,
    },
    savings: {
      estimated_tokens: savedTokens,
      token_savings_percent: round((savedTokens / fullWiki.estimated_tokens) * 100),
      read_ms: round(savedReadMs, 3),
      read_time_reduction_percent: round((savedReadMs / fullWiki.avg_read_ms) * 100),
    },
  };
}

function docsHeavyScenario(baseDir, scale) {
  const cwd = path.join(baseDir, "docs-heavy-large-project");
  const bootstrapMs = bootstrapProject(cwd);
  const validationIndex = Math.min(42, scale.docsHeavyPages - 1);
  let validationRelativePath = "";
  for (let index = 0; index < scale.docsHeavyPages; index += 1) {
    const bucket = index % 4 === 0 ? "decisions" : index % 5 === 0 ? "sources" : "canonical";
    const scope = bucket === "decisions" ? "project-decisions" : bucket === "sources" ? "source-summary" : "project-canonical";
    const relativePath = path.join("wiki", bucket, `large-topic-${index}.md`).split(path.sep).join("/");
    if (index === validationIndex) validationRelativePath = relativePath;
    writeFile(path.join(cwd, relativePath), verboseProjectDoc(`Docs Heavy Topic ${index}`, 34, scope));
  }
  fs.appendFileSync(path.join(cwd, validationRelativePath), "\nBenchmark validation marker: docs-heavy-needle.\n");
  const doctor = runNode([cli, "--doctor"], cwd);
  const query = runNode([cli, "--query", "docs-heavy-needle"], cwd);
  expectBenchmark(query.value.includes(validationRelativePath), "docs-heavy query did not return the expected generated wiki page");
  return {
    fixture_kind: "docs-heavy-large-project",
    confidence: "high-for-token-and-wiki-read-claims",
    assumptions: {
      generated_wiki_pages: scale.docsHeavyPages,
      curated_startup_index: true,
      refresh_index_all_pages: false,
    },
    bootstrap_create_ms: bootstrapMs,
    doctor_ms: doctor.elapsed_ms,
    query_ms: query.elapsed_ms,
    validations: [
      passedValidation("doctor command completed"),
      passedValidation(`query returned ${validationRelativePath}`),
    ],
    ...contextSavings(cwd, scale.readIterations),
  };
}

function monorepoScenario(baseDir, scale) {
  const cwd = path.join(baseDir, "monorepo-large-project");
  const bootstrapMs = bootstrapProject(cwd);
  const workspaces = [
    ...Array.from({ length: scale.monorepoApps }, (_, index) => `apps/app-${index}`),
    ...Array.from({ length: scale.monorepoPackages }, (_, index) => `packages/${packageName(index)}`),
  ];
  for (const workspace of workspaces) {
    writeFile(path.join(cwd, workspace, "package.json"), JSON.stringify({ name: workspace.replace("/", "-"), version: "0.0.0" }, null, 2));
    for (let index = 0; index < scale.docsPerWorkspace; index += 1) {
      const slug = workspace.replace(/\//g, "-");
      writeFile(path.join(cwd, "wiki", "canonical", `${slug}-topic-${index}.md`), verboseProjectDoc(`Monorepo ${workspace} Topic ${index}`, 22));
    }
  }
  const validationRelativePath = "wiki/canonical/packages-workspace-00-topic-0.md";
  fs.appendFileSync(path.join(cwd, validationRelativePath), "\nBenchmark validation marker: monorepo-package-needle.\n");
  const doctor = runNode([cli, "--doctor"], cwd);
  const query = runNode([cli, "--query", "monorepo-package-needle"], cwd);
  expectBenchmark(query.value.includes("wiki/canonical/packages-workspace-00-topic-0.md"), "monorepo query did not return the expected generated package wiki page");
  return {
    fixture_kind: "monorepo-large-project",
    confidence: "high-for-monorepo-routing-and-diagnostics-claims",
    assumptions: {
      apps: scale.monorepoApps,
      packages: scale.monorepoPackages,
      generated_wiki_pages: workspaces.length * scale.docsPerWorkspace,
      curated_startup_index: true,
    },
    bootstrap_create_ms: bootstrapMs,
    doctor_ms: doctor.elapsed_ms,
    query_ms: query.elapsed_ms,
    validations: [
      passedValidation("doctor command completed"),
      passedValidation("query returned wiki/canonical/packages-workspace-00-topic-0.md"),
    ],
    ...contextSavings(cwd, scale.readIterations),
  };
}

function codeHeavyScenario(baseDir, scale) {
  const cwd = path.join(baseDir, "code-heavy-large-project");
  const bootstrapMs = bootstrapProject(cwd);
  for (let packageIndex = 0; packageIndex < scale.codePackages; packageIndex += 1) {
    const packageDir = path.join(cwd, "packages", packageName(packageIndex));
    writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: packageName(packageIndex), version: "0.0.0" }, null, 2));
    for (let fileIndex = 0; fileIndex < scale.filesPerCodePackage; fileIndex += 1) {
      writeFile(path.join(packageDir, "src", `service-${fileIndex}.ts`), generatedTsFile(packageIndex, fileIndex, scale.filesPerCodePackage));
    }
  }
  const codeIndex = runNode([cli, "--code-index", "--code-scope", "packages"], cwd);
  const status = JSON.parse(runNode([cli, "--code-status"], cwd).value);
  const statusMap = Object.fromEntries(status.map((row) => [row.metric, row.value]));
  fs.appendFileSync(path.join(cwd, "packages", packageName(0), "src", "service-0.ts"), "\nexport const incrementalBenchmarkSignal = true;\n");
  writeFile(path.join(cwd, "packages", packageName(0), "src", "service-new.ts"), "export function incrementalBenchmarkNewFile(): boolean {\n  return true;\n}\n");
  fs.unlinkSync(path.join(cwd, "packages", packageName(0), "src", `service-${scale.filesPerCodePackage - 1}.ts`));
  const incrementalIndex = runNode([cli, "--code-index", "--code-scope", "packages"], cwd);
  const incrementalOutput = parseKeyValueOutput(incrementalIndex.value);
  const incrementalMode = incrementalOutput.mode || "unsupported";
  const reindexedFiles = Number(incrementalOutput.reindexed_files || 0);
  const deletedFiles = Number(incrementalOutput.deleted_files || 0);
  const expectedIndexedFiles = (scale.codePackages * scale.filesPerCodePackage) + scale.codePackages;
  expectBenchmark(Number(statusMap.files || 0) === expectedIndexedFiles, `code-heavy full index file count was ${statusMap.files}; expected ${expectedIndexedFiles}`);
  if (incrementalMode === "incremental") {
    expectBenchmark(reindexedFiles === 2, `code-heavy incremental reindexed ${reindexedFiles} files; expected 2`);
    expectBenchmark(deletedFiles === 1, `code-heavy incremental deleted ${deletedFiles} files; expected 1`);
  }
  const incrementalSupported = incrementalMode === "incremental";
  return {
    fixture_kind: "code-heavy-large-project",
    confidence: "high-for-typescript-code-index-throughput-claims",
    assumptions: {
      packages: scale.codePackages,
      files_per_package: scale.filesPerCodePackage,
      generated_ts_files: scale.codePackages * scale.filesPerCodePackage,
    },
    bootstrap_create_ms: bootstrapMs,
    code_index_ms: codeIndex.elapsed_ms,
    code_index_files: Number(statusMap.files || 0),
    code_index_symbols: Number(statusMap.symbols || 0),
    code_index_edges: Number(statusMap.edges || 0),
    code_index_files_per_second: round(Number(statusMap.files || 0) / (codeIndex.elapsed_ms / 1000)),
    incremental_index_ms: incrementalIndex.elapsed_ms,
    incremental_index_mode: incrementalMode,
    incremental_index_supported: incrementalSupported,
    incremental_reindexed_files: reindexedFiles,
    incremental_deleted_files: deletedFiles,
    incremental_files_per_second: round(reindexedFiles / (incrementalIndex.elapsed_ms / 1000)),
    full_to_incremental_time_reduction_percent: incrementalSupported ? round(((codeIndex.elapsed_ms - incrementalIndex.elapsed_ms) / codeIndex.elapsed_ms) * 100) : null,
    validations: [
      passedValidation(`full index contained ${expectedIndexedFiles} files`),
      passedValidation("code index rerun completed"),
      ...(incrementalSupported ? [
        passedValidation("rerun used incremental index mode"),
        passedValidation("incremental rerun reindexed 2 files"),
        passedValidation("incremental rerun deleted 1 file"),
      ] : [
        passedValidation("incremental index mode unavailable in this build"),
      ]),
    ],
  };
}

function packageVersion() {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return parsed.version || "unknown";
}

function defaultBaselinePath(report) {
  return path.join(root, "benchmarks", "baselines", `${report.package_version}-${report.scale}.json`);
}

function defaultMarkdownPath(report) {
  return path.join(root, "benchmarks", "reports", `${report.package_version}-${report.scale}.md`);
}

function compareNumber(previous, current) {
  if (typeof previous !== "number" || previous === 0 || typeof current !== "number") return null;
  return round(((current - previous) / previous) * 100);
}

const regressionThresholds = {
  docs_query_ms_delta_percent: { direction: "max", threshold: 10 },
  monorepo_doctor_ms_delta_percent: { direction: "max", threshold: 10 },
  code_index_ms_delta_percent: { direction: "max", threshold: 10 },
  code_index_throughput_delta_percent: { direction: "min", threshold: -10 },
  incremental_index_ms_delta_percent: { direction: "max", threshold: 15 },
  summary_min_token_savings_delta_percent: { direction: "min", threshold: -0.1 },
};

function assessComparison(comparison) {
  const regressions = [];
  for (const [metric, rule] of Object.entries(regressionThresholds)) {
    const value = comparison[metric];
    if (typeof value !== "number") continue;
    if (rule.direction === "max" && value > rule.threshold) regressions.push({ metric, value, threshold: rule.threshold });
    if (rule.direction === "min" && value < rule.threshold) regressions.push({ metric, value, threshold: rule.threshold });
  }
  return {
    regression_status: regressions.length === 0 ? "passed" : "failed",
    regression_thresholds: regressionThresholds,
    regressions,
  };
}

function loadBaseline(filePath) {
  if (!filePath) return null;
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) fail(`missing benchmark baseline: ${absolutePath}`);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  if (parsed.schema_version !== schemaVersion) fail(`unsupported benchmark baseline schema: ${absolutePath}`);
  return parsed;
}

function scenarioByKind(report, kind) {
  return report.scenarios.find((scenario) => scenario.fixture_kind === kind) || {};
}

function compareReport(current, baseline) {
  const docsCurrent = scenarioByKind(current, "docs-heavy-large-project");
  const docsBaseline = scenarioByKind(baseline, "docs-heavy-large-project");
  const monorepoCurrent = scenarioByKind(current, "monorepo-large-project");
  const monorepoBaseline = scenarioByKind(baseline, "monorepo-large-project");
  const codeCurrent = scenarioByKind(current, "code-heavy-large-project");
  const codeBaseline = scenarioByKind(baseline, "code-heavy-large-project");
  const comparison = {
    baseline_generated_at: baseline.generated_at,
    baseline_package_version: baseline.package_version,
    docs_token_savings_delta_percent: round((docsCurrent.savings?.token_savings_percent || 0) - (docsBaseline.savings?.token_savings_percent || 0)),
    docs_query_ms_delta_percent: compareNumber(docsBaseline.query_ms, docsCurrent.query_ms),
    monorepo_token_savings_delta_percent: round((monorepoCurrent.savings?.token_savings_percent || 0) - (monorepoBaseline.savings?.token_savings_percent || 0)),
    monorepo_doctor_ms_delta_percent: compareNumber(monorepoBaseline.doctor_ms, monorepoCurrent.doctor_ms),
    code_index_ms_delta_percent: compareNumber(codeBaseline.code_index_ms, codeCurrent.code_index_ms),
    code_index_throughput_delta_percent: compareNumber(codeBaseline.code_index_files_per_second, codeCurrent.code_index_files_per_second),
    incremental_index_ms_delta_percent: compareNumber(codeBaseline.incremental_index_ms, codeCurrent.incremental_index_ms),
    full_to_incremental_time_reduction_delta_percent: round((codeCurrent.full_to_incremental_time_reduction_percent || 0) - (codeBaseline.full_to_incremental_time_reduction_percent || 0)),
    summary_min_token_savings_delta_percent: round(current.summary.min_token_savings_percent - baseline.summary.min_token_savings_percent),
  };
  return {
    ...comparison,
    ...assessComparison(comparison),
  };
}

function writeReport(report, filePath) {
  if (!filePath) return;
  const absolutePath = path.resolve(filePath);
  writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
}

function formatDelta(value) {
  if (value === null || typeof value === "undefined") return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}

function markdownSummary(report) {
  const docs = scenarioByKind(report, "docs-heavy-large-project");
  const monorepo = scenarioByKind(report, "monorepo-large-project");
  const code = scenarioByKind(report, "code-heavy-large-project");
  const comparison = report.comparison;
  const comparisonRows = comparison ? `
## Baseline Comparison

| Metric | Delta |
| --- | ---: |
| Docs token savings | ${formatDelta(comparison.docs_token_savings_delta_percent)} |
| Docs query time | ${formatDelta(comparison.docs_query_ms_delta_percent)} |
| Monorepo token savings | ${formatDelta(comparison.monorepo_token_savings_delta_percent)} |
| Monorepo doctor time | ${formatDelta(comparison.monorepo_doctor_ms_delta_percent)} |
| Code index time | ${formatDelta(comparison.code_index_ms_delta_percent)} |
| Code index throughput | ${formatDelta(comparison.code_index_throughput_delta_percent)} |
| Incremental index time | ${formatDelta(comparison.incremental_index_ms_delta_percent)} |
| Full-to-incremental reduction | ${formatDelta(comparison.full_to_incremental_time_reduction_delta_percent)} |
| Minimum token savings | ${formatDelta(comparison.summary_min_token_savings_delta_percent)} |

Regression status: ${comparison.regression_status}
` : "";

  return `# Project Wiki Bootstrap Benchmark ${report.package_version} (${report.scale})

Generated: ${report.generated_at}

## Summary

| Metric | Value |
| --- | ---: |
| Minimum token savings | ${report.summary.min_token_savings_percent}% |
| Median token savings | ${report.summary.median_token_savings_percent}% |
| Minimum read-time reduction | ${report.summary.min_read_time_reduction_percent}% |
| Median read-time reduction | ${report.summary.median_read_time_reduction_percent}% |
| Total wiki pages measured | ${report.summary.total_wiki_pages} |
| Code-index files | ${report.summary.code_index_files} |
| Code-index throughput | ${report.summary.code_index_files_per_second} files/sec |
| Incremental reindexed files | ${report.summary.code_index_incremental_reindexed_files} |
| Incremental index time | ${report.summary.code_index_incremental_ms}ms |
| Full-to-incremental time reduction | ${report.summary.code_index_full_to_incremental_time_reduction_percent}% |
| Benchmark runs | ${report.measurement.runs} |
| Timing status | ${report.measurement.timing_status} |

## Scenario Results

| Scenario | Scale | Token Savings | Read Reduction | Key Timing |
| --- | ---: | ---: | ---: | ---: |
| Docs-heavy wiki | ${docs.assumptions?.generated_wiki_pages || 0} pages | ${docs.savings?.token_savings_percent || 0}% | ${docs.savings?.read_time_reduction_percent || 0}% | query ${docs.query_ms || 0}ms |
| Monorepo wiki | ${monorepo.assumptions?.generated_wiki_pages || 0} pages | ${monorepo.savings?.token_savings_percent || 0}% | ${monorepo.savings?.read_time_reduction_percent || 0}% | doctor ${monorepo.doctor_ms || 0}ms |
| Code-heavy TS index | ${code.assumptions?.generated_ts_files || 0} files | n/a | n/a | full ${code.code_index_ms || 0}ms, incremental ${code.incremental_index_ms || 0}ms |
${comparisonRows}
## Claim Boundaries

- Maintainer benchmark for release evidence, not a public user workflow.
- Default scale is large; quick scale validates report shape only.
- Token estimates use ceil(characters / 4) consistently across versions.
- Local filesystem timings should be compared only against baselines from comparable machines.
- TypeScript code-index throughput does not prove non-TypeScript parser performance.
`;
}

function writeMarkdownSummary(report, filePath) {
  if (!filePath) return;
  const absolutePath = path.resolve(filePath);
  writeFile(absolutePath, markdownSummary(report));
}

function requireBuiltCli() {
  if (!fs.existsSync(cli)) fail("missing dist/init-project-wiki.js; run npm run build before npm run benchmark");
}

function getPath(object, parts) {
  return parts.reduce((current, part) => current && current[part], object);
}

function setPath(object, parts, value) {
  let current = object;
  for (const part of parts.slice(0, -1)) current = current[part];
  current[parts[parts.length - 1]] = value;
}

const scenarioTimingPaths = [
  ["bootstrap_create_ms"],
  ["doctor_ms"],
  ["query_ms"],
  ["code_index_ms"],
  ["incremental_index_ms"],
  ["compact_context", "avg_read_ms"],
  ["full_wiki", "avg_read_ms"],
];

function aggregateScenario(kind, scenarioRuns) {
  const runs = scenarioRuns.map((scenarios) => scenarioByKind({ scenarios }, kind)).filter((scenario) => scenario.fixture_kind);
  const aggregate = JSON.parse(JSON.stringify(runs[0]));
  const topLevelKeys = new Set(runs.flatMap((scenario) => Object.keys(scenario).filter((key) => typeof scenario[key] === "number")));
  for (const key of topLevelKeys) {
    const values = runs.map((scenario) => scenario[key]).filter((value) => typeof value === "number");
    if (values.length === runs.length) aggregate[key] = round(median(values), key.endsWith("_ms") ? 3 : 2);
  }
  const timingStats = {};
  for (const pathParts of scenarioTimingPaths) {
    const values = runs.map((scenario) => getPath(scenario, pathParts)).filter((value) => typeof value === "number");
    if (values.length !== runs.length) continue;
    setPath(aggregate, pathParts, round(median(values), pathParts[pathParts.length - 1].endsWith("_ms") ? 3 : 2));
    timingStats[pathParts.join(".")] = stats(values);
  }
  aggregate.measurement = {
    runs: runs.length,
    timing_stats: timingStats,
  };
  return aggregate;
}

function aggregateScenarioRuns(scenarioRuns) {
  const kinds = scenarioRuns[0].map((scenario) => scenario.fixture_kind);
  return kinds.map((kind) => aggregateScenario(kind, scenarioRuns));
}

function timingReliability(scenarios, runCount) {
  const statsValues = scenarios.flatMap((scenario) => Object.values(scenario.measurement?.timing_stats || {}));
  const maxCv = statsValues.reduce((max, item) => Math.max(max, Number(item.coefficient_of_variation_percent || 0)), 0);
  return {
    runs: runCount,
    timing_status: runCount < 2 ? "single-run" : maxCv <= 10 ? "stable" : "variable",
    max_coefficient_of_variation_percent: round(maxCv),
  };
}

function suiteSummary(scenarios) {
  const wikiScenarios = scenarios.filter((scenario) => scenario.savings);
  const tokenSavings = wikiScenarios.map((scenario) => scenario.savings.token_savings_percent);
  const readSavings = wikiScenarios.map((scenario) => scenario.savings.read_time_reduction_percent);
  const codeScenario = scenarios.find((scenario) => scenario.fixture_kind === "code-heavy-large-project") || {};
  return {
    min_token_savings_percent: round(Math.min(...tokenSavings)),
    median_token_savings_percent: round(median(tokenSavings)),
    min_read_time_reduction_percent: round(Math.min(...readSavings)),
    median_read_time_reduction_percent: round(median(readSavings)),
    total_wiki_pages: wikiScenarios.reduce((sum, scenario) => sum + scenario.full_wiki.file_count, 0),
    code_index_files: codeScenario.code_index_files || 0,
    code_index_files_per_second: codeScenario.code_index_files_per_second || 0,
    code_index_incremental_reindexed_files: codeScenario.incremental_reindexed_files || 0,
    code_index_incremental_ms: codeScenario.incremental_index_ms || 0,
    code_index_full_to_incremental_time_reduction_percent: codeScenario.full_to_incremental_time_reduction_percent || 0,
  };
}

function runBenchmark() {
  requireBuiltCli();
  const scaleName = hasFlag("--quick") ? "quick" : "large";
  const scale = scales[scaleName];
  const runCount = positiveIntegerArgValue("--runs", scaleName === "quick" ? 1 : 5);
  const baselinePath = argValue("--baseline");
  const outputPath = argValue("--out");
  const markdownPath = hasFlag("--markdown") ? optionalArgValue("--markdown") : "";
  const saveBaseline = hasFlag("--save-baseline");
  const saveBaselinePath = saveBaseline ? optionalArgValue("--save-baseline") : "";
  const keepTemp = hasFlag("--keep-temp");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-wiki-benchmark-"));

  try {
    const scenarioRuns = [];
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const runRoot = path.join(tempRoot, `run-${runIndex + 1}`);
      scenarioRuns.push([
        docsHeavyScenario(runRoot, scale),
        monorepoScenario(runRoot, scale),
        codeHeavyScenario(runRoot, scale),
      ]);
    }
    const scenarios = aggregateScenarioRuns(scenarioRuns);
    const measurement = timingReliability(scenarios, runCount);
    const report = {
      schema_version: schemaVersion,
      generated_at: new Date().toISOString(),
      package_version: packageVersion(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      scale: scaleName,
      measurement,
      large_project_assumptions: {
        docs_heavy_pages: scale.docsHeavyPages,
        monorepo_workspaces: scale.monorepoApps + scale.monorepoPackages,
        code_heavy_ts_files: scale.codePackages * scale.filesPerCodePackage,
        curated_startup_index: true,
        benchmark_runs: runCount,
      },
      summary: suiteSummary(scenarios),
      scenarios,
      notes: [
        "Maintainer benchmark for release evidence, not a public CLI user workflow.",
        "Default scale is large; smoke tests use --quick only to validate report shape.",
        "Large scale uses repeated runs by default; scenario metrics are medians and include timing dispersion statistics.",
        "Large scale covers docs-heavy wiki, monorepo wiki, and code-heavy TypeScript index scenarios.",
        "estimated_tokens uses ceil(characters / 4); use the same method across versions for objective comparisons.",
        "Read timing is local filesystem wall-clock timing; compare only against baselines captured on comparable machines.",
        "Startup/index routing is intentionally curated; all-page refresh-index bloat is not used for token-savings claims.",
      ],
    };

    const baseline = loadBaseline(baselinePath);
    if (baseline) report.comparison = compareReport(report, baseline);
    writeReport(report, outputPath);
    if (saveBaseline) writeReport(report, saveBaselinePath || defaultBaselinePath(report));
    if (hasFlag("--markdown")) writeMarkdownSummary(report, markdownPath || defaultMarkdownPath(report));
    console.log(JSON.stringify(report, null, 2));
    if (hasFlag("--fail-on-regression") && report.comparison?.regression_status === "failed") {
      fail(`benchmark regression threshold failed: ${report.comparison.regressions.map((item) => item.metric).join(", ")}`);
    }
  } finally {
    if (!keepTemp) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

runBenchmark();
