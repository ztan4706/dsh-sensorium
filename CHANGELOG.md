# Changelog

Versioning is `MAJOR.MINOR.PATCH`: incompatible change / new behavior / fix.

## 0.0.1 — 2026-10-24

First public version.

- Packaged as a single npm package, `dsh-sensorium`: one patch, ten row inserts —
  install once and all ten senses are there.
- Ten senses: workspace_pulse, time_sense, affect_core, need_tension,
  expression_bias, silence_gate, residue_trace, unresolved_weight, body, face.
- The three stateful senses carry their own clock (pulse every 2 minutes, needs and
  affect every 5), integrate in 30-minute slots, and backfill 24 hours from file
  mtimes on first start.
- `dialogue.jsonl`: listens to `agent/inbox/claimed`; real conversation feeds
  connection and stimulation instead of file activity pretending to.
- `workspace` resolves as `config.workspace` → `SENSORIUM_WORKSPACE` →
  `process.cwd()`, with a console warning when it lands in a profile directory.
- Tests: `tests/selftest.mjs` (cross-sense regression),
  `tests/apply-smoke.mjs` (applies all ten the way the host does).
- Docs: `docs/design.md` (formulas, why it works this way),
  `docs/compatibility.md` (plugin-combination risks, self-check list).
