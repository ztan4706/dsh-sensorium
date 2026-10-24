# Sensorium

**Ten interoceptive senses for an agent that lives in a workspace.**
One npm package, one patch, ten rows — install once, all ten are there.

> Most "personality plugins" are prompts. A prompt never gets tired, never empties
> while nobody talks to it, and never settles after a busy day.
> Sensorium is computed state instead: exponential decay, integration over time,
> signals taken from file mtimes and real conversation. Deterministic, zero model
> calls. **Time passes through it even when the agent is not around.**

- Package: `dsh-sensorium`
- Version: **0.1.1**
- License: MIT
- Author: Bao · E-1021

---

## Install

```sh
dsh plugin --profile <your-profile> add dsh-sensorium
```

From a local checkout (before publishing):

```sh
git clone https://github.com/ztan4706/dsh-sensorium.git
dsh plugin --profile <profile> add link:/absolute/path/dsh-sensorium
```

Or point `plugin_manager`'s `install_bundle` at the directory. Restart DSH
afterwards — plugin modules are cached by URL. All ten rows are inserted into the
profile's patch layer in one go.

## Configure

All ten senses share one `workspace` — the project directory you want them to
observe. State lands in `<workspace>/.dsh/sensory/`. Three ways to set it, highest
priority first:

1. Override the rows by id in your own profile patch:

   ```yaml
   - id: sensorium-need-tension
     name: dsh-sensorium
     config:
       workspace: "/absolute/path/to/project"
   ```

2. Environment variable `SENSORIUM_WORKSPACE`
3. Fall back to the host process's `process.cwd()`

> ⚠️ The third option is only a fallback. Inside DSH the host's cwd is often the
> app or profile directory, and state would be written there. Since 0.0.1 the
> plugin prints a console warning when that happens — set `workspace` explicitly
> for real use.

Want only a few of them? Disable the rest by id:

```yaml
- id: sensorium-face
  disabled: true
```

## The ten

| # | Sense | Tool | What it tracks |
|---|---|---|---|
| 01 | workspace_pulse | `sense_workspace_pulse` | How busy the room is: changes in the last 30 min, quiet minutes, a 24 h sample series |
| 02 | time_sense | `sense_time_sense` | Clock, day phase, late-night flag |
| 03 | affect_core | `sense_affect_core` | Valence / arousal / dominance, decaying toward baseline |
| 04 | need_tension | `sense_need_tension` | Connection / stimulation / resolution, integrated over time, fed by real dialogue |
| 05 | expression_bias | `sense_expression_bias` | Tone / initiative / mask |
| 06 | silence_gate | `sense_silence_gate` | Whether to speak at all — silence is a valid output |
| 07 | residue_trace | `sense_residue_trace` | Emotional aftertaste; strong events linger longer |
| 08 | unresolved_weight | `sense_unresolved_weight` | Open loops that grow heavier with age (the only sense that takes input) |
| 09 | body | `sense_body` | Posture, tail, ears, hands — shown only when something changed |
| 10 | face | `sense_face` | Eyes, brows, mouth, and the one tell that escapes |

Read order: outside (01–02) → inside (03–04) → expression (05–06, 09–10) →
metabolism (07–08). Each sense writes only its own state file.

## How time works

- **It moves on its own.** The pulse samples every 2 minutes; needs and affect
  settle every 5 minutes. Nothing waits to be called.
- **Integrated in slots, not collapsed into one reading.** Leave for 15 hours and
  thirty half-hour slots are actually walked: quiet slots decay, active slots
  replenish a little.
- **It backfills.** On first start with no sample history, file mtimes reconstruct
  the last 24 hours — a power cut does not erase a day.
- **Real dialogue counts separately.** The plugin listens to
  `agent/inbox/claimed`; each message from this workspace is recorded and feeds
  connection and stimulation only. Files changing no longer pretend to be someone
  talking to you.

Formulas, parameters and two mistakes worth reading: [`docs/design.md`](docs/design.md).
Plugin-combination risks and a self-check list: [`docs/compatibility.md`](docs/compatibility.md).

## Self-test

```bash
node tests/selftest.mjs      # cross-sense regression: does time actually pass?
node tests/apply-smoke.mjs   # apply all ten like the host does; ten tools must register
```

## Versioning

`MAJOR.MINOR.PATCH`, starting at `0.0.1`.

- **MAJOR**: state file format, tool names or config keys change incompatibly.
- **MINOR**: new sense, new field, new behavior (backwards compatible).
- **PATCH**: bug fix, constant tweak, wording.

During `0.x` a MINOR may still break things — the API settles at 1.0. Every release
gets a [`CHANGELOG.md`](CHANGELOG.md) entry and a git tag (`v0.0.1`).

## Listing

1. `npm publish` (public package; `engines.dsh` declares the compatible host range).
2. Open a PR against [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
   adding one entry; the DSH plugin market picks it up automatically, usually within a day.
3. Market cards read `description`, `keywords` (including `dsh-plugin`) and the README.

## Limits (honest)

- `activity_level` is a proxy for file activity, not conversation; dialogue is
  tracked separately and only feeds connection and stimulation.
- Whether a message belongs to "this workspace" depends on the session's cwd; when
  it cannot be resolved, every message counts.
- No UI. These are states and tools, not a screen.
- The constants are chosen, not fitted. Change the numbers at the top of each
  plugin file to change the tempo.

## License

MIT · Bao · E-1021
