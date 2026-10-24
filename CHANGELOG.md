# Changelog

Versioning is `MAJOR.MINOR.PATCH`: incompatible change / new behavior / fix.

## 0.1.1 — 2026-10-24

- The repository links in `package.json` now point at the real remote
  (`github.com/ztan4706/dsh-sensorium`). 0.1.0 was published while a
  placeholder account name was still there, so its npm page linked to a 404.
  No code change.

## 0.1.0 — 2026-10-24

English-only output, and no path guessing.

- Every human-readable string these tools return is now English: the body and face
  description words (`slumped over`, `tail swaying slowly`, `ears half down`) and
  the need-tension hints (`A little empty`, `A little bored`,
  `Something is unresolved`). Tool output no longer mixes languages.
- All code comments, the bundle patch comments and the test notes are English too.
- `need_tension` no longer looks one directory up for the pulse. Each sense reads
  and writes only `<workspace>/.dsh/sensory/`; a plugin that wants the house pulse
  is configured with the house as its workspace, which is what `workspace-pulse`
  does. The old "local first, then parent" fallback was an assumption about a
  house-with-rooms layout that no other user has.
- Tests updated: the busy-window case writes the pulse into its own workspace, and
  an added assertion proves a pulse one level up is ignored.

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
