# Benchmark Evidence

Project Librarian benchmark evidence is based on actual Codex JSONL usage and local wall-clock timing.

Current local measured report: `benchmarks/reports/llm/current-local.json` and `benchmarks/reports/llm/current-local.md`, generated 2026-06-10 after explicit approval to send benchmark fixtures and prompts to Codex. It used ChatGPT/Codex auth, `gpt-5.5`, `decision_lookup`, small/medium/large, one measured run per condition, and no warmup. Claim gate passed, but this is not a release baseline: the source tree was dirty and post-run fixture fingerprint validation needs a clean isolated rerun because runtime state files touched generated fixture directories. The observed deltas were small +71.55% tokens/+64.33% wall time, medium +109.02% tokens/+9.5% wall time, and large -6.67% tokens/+7.72% wall time for Project Librarian versus control.

Create the small/medium/large with-vs-without fixture manifest without launching Codex:

```sh
npm run benchmark:llm:dry-run
```

Validate the JSONL parser and report-shape checks against checked-in sample artifacts:

```sh
npm run benchmark:llm:parse-smoke
node tests/validators/codex-llm-benchmark-smoke.js benchmarks/llm/samples/codex-measured-report.json
```

Measured Codex execution is intentionally gated behind `--allow-codex-run` and uses `codex exec --json --ephemeral --sandbox read-only --skip-git-repo-check` because scenarios run from generated fixture directories. By default it runs one with/without pair to preserve comparison validity while limiting subscription quota use; use `--full-matrix` when the selected scales/tasks should all run. Full runs use deterministic alternating pair order so the treatment condition is not always executed before the control condition. Pass `--max-scenarios`, `--runs`, and `--warmup-runs` deliberately when expanding coverage. Pass `--model <model>` when Codex JSONL does not expose a model field; the report records `model_source` as `jsonl` or `requested` rather than guessing. Pass `--markdown` to write the default Markdown summary or `--markdown <path>` for an explicit path. Use `--require-clean` for public-claim candidates so source-control provenance starts from a clean checkout. Use `--require-claimable` so partial, failed, or unclaimable scenarios are written to disk but exit non-zero. Use `--min-runs-for-claim <n>` with `--require-claimable` when a public claim requires repeated runs. Report `median` values are computed only from claimable runs: execution must complete, correctness must pass, usage/model/final-text fields must be present, token counts and wall time must be positive, and the run must resolve to exactly one model. `median_all_runs` is retained for audit when a run fails, needs review, or lacks claimable measurement fields. Raw event counts and normalized invocation counts are reported separately so start/completed JSONL pairs do not inflate tool-call claims. Reports also include prompt/command provenance, source-control metadata, fixture fingerprints, selected-matrix fingerprints, full-manifest fingerprints, timing dispersion, plan-event counts, and first-response latency when Codex JSONL exposes timestamps; otherwise first-response latency is marked unavailable. The validator reparses raw JSONL and recomputes metrics, correctness, medians, dispersion, claim gate, selected matrix fingerprints, and selected manifest fingerprints before accepting a measured report.

```sh
npm run benchmark:llm -- --allow-codex-run --scales small --tasks decision_lookup --max-scenarios 2 --runs 1 --warmup-runs 0 --model gpt-5.5
```

Run the small/medium/large decision-lookup matrix and produce a README-ready Markdown summary:

```sh
npm run benchmark:llm -- --allow-codex-run --scales small,medium,large --tasks decision_lookup --full-matrix --runs 3 --warmup-runs 1 --min-runs-for-claim 3 --require-clean --require-claimable --model gpt-5.5 --out benchmarks/reports/llm/current.json --markdown benchmarks/reports/llm/current.md
```

Run every scale and every current task family only when the expected subscription quota use is acceptable:

```sh
npm run benchmark:llm -- --allow-codex-run --full-matrix --runs 3 --warmup-runs 1 --min-runs-for-claim 3 --require-clean --require-claimable --model gpt-5.5 --out benchmarks/reports/llm/current.json --markdown benchmarks/reports/llm/current.md
```

Subscription-authenticated runs fail if `CODEX_API_KEY` or `OPENAI_API_KEY` is present. Pass `--auth-mode api-key` only when intentionally running an API-key-priced benchmark. The report records declared auth mode plus non-secret auth-environment audit flags, but public claims still need human review when local Codex config could route through a profile not visible in environment variables. Reports under `benchmarks/reports/llm/` are ignored by default; commit only deliberate release evidence.

Commit policy:

- Commit release baselines that public release claims compare against.
- Generate release baselines from a clean checkout; dirty baselines are validation artifacts only.
- Commit Markdown summaries only when they are part of release evidence; `benchmarks/reports/*.json` and `benchmarks/reports/*.md` are ignored by default for ad hoc reports.
- Do not commit ad hoc current reports from local investigation.
- Keep temporary comparison outputs outside the repository or under an ignored scratch path.
