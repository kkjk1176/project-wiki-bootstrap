#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildManifest, scales, taskFamilies } = require("./lib/llm-fixtures");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist", "init-project-wiki.js");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, defaultValue = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return defaultValue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`missing value for ${name}`);
  return value;
}

function listArg(name, allowed, defaultValues) {
  const raw = argValue(name, "");
  if (!raw) return defaultValues;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  for (const value of values) {
    if (!allowed.includes(value)) fail(`invalid ${name} value: ${value}`);
  }
  return values;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function defaultOutPath() {
  return path.join(root, "benchmarks", "reports", "llm", "dry-run-manifest.json");
}

function main() {
  const dryRun = hasFlag("--dry-run");
  const allowCodexRun = hasFlag("--allow-codex-run");
  const out = path.resolve(root, argValue("--out", defaultOutPath()));
  const selectedScales = listArg("--scales", Object.keys(scales), Object.keys(scales));
  const selectedTasks = listArg("--tasks", Object.keys(taskFamilies), Object.keys(taskFamilies));
  const fixtureRoot = path.resolve(os.tmpdir(), `project-librarian-codex-llm-${Date.now()}`);

  if (!dryRun && !allowCodexRun) {
    fail("measured Codex benchmark requires --allow-codex-run; use --dry-run to create a fixture manifest without consuming subscription quota");
  }

  if (!dryRun) {
    fail("measured Codex execution is not implemented yet; run --dry-run for the current fixture/manifest phase");
  }

  const manifest = buildManifest({ fixtureRoot, cliPath: cli, selectedScales, selectedTasks });
  writeJson(out, manifest);
  console.log(JSON.stringify({
    status: "ok",
    mode: "dry-run",
    out,
    fixture_root: fixtureRoot,
    scenario_count: manifest.scenarios.length,
  }, null, 2));
}

main();
