# Compatibility notes

> "Works on my machine, errors on yours" is rarely only about Node or DSH versions.
> The **set of plugins** installed alongside it is a common cause. This page records
> what we could actually verify in our own house.

## Hypothesis: other plugins can break this one

Ordered by likelihood:

| # | Mechanism | Symptom | Our situation |
|---|---|---|---|
| 1 | **Tool name collision** | The later registration wins, or registration throws | All ten tools carry a `sense_` prefix |
| 2 | **Patch row id collision** | Rows with the same id overwrite each other | All rows use a `sensorium-` prefix |
| 3 | **Service dependency** | Depends on a service whose provider is not installed → start failure | Only `inject: ['tools']`; no own services |
| 4 | **Global side effects** | Someone else edits tool policy, the system prompt or session events | We only read `agent/inbox/claimed`, only run `setInterval` |
| 5 | **Shared state directory** | Two agents sharing one workspace overwrite each other's state | Real risk, see below |
| 6 | **Another plugin rewrites the patch** | Install/uninstall/upgrade rewrites `cordis.patch.yml` and drops hand-written rows | Real risk, see below |
| 7 | **Version gate** | Node or DSH too old, API missing | `engines.node >= 20`, `engines.dsh >= 0.2.0 < 0.4.0-0` |

## The isolation test we ran (2026-10-24)

Stripped every third-party bundle from the profile, leaving only:

```
@deepseek-ai/dsh-base
@deepseek-ai/dsh-web-app
@deepseek-ai/dsh-experimental-auto-review
dsh-ops          ← kept because it provides the shell tools used to restore
dsh-sensorium
```

Result: assembled rows **221 → 213**; all ten senses still `active`, tools returned
normally, state files kept being written. Restoring the bundles brought the row
count back to 221 with no change in behavior.

Conclusion: **in this host the senses do not depend on any third-party plugin.**
The opposite direction — another plugin depending on us, or two plugins competing
for one tool name — is not covered by this test and needs the checklist below.

## Self-check list for users

If a sense stops working after install:

1. **Is it alive?** `plugin_manager` → `list_plugins`; find the ten `sensorium-*`
   rows and check `enabled` and `fiberPhase === "active"`.
2. **Did ids collide?** Search `cordis.patch.yml` for `sensorium-`; each id should
   appear once.
3. **Did tool names collide?** Check whether another installed plugin registers a
   `sense_*` tool.
4. **Where is it writing?** Look for `<workspace>/.dsh/sensory/`. If it is missing,
   `workspace` was probably not configured and fell back to `process.cwd()` — which
   under DSH is often the profile directory.
   > Since 0.0.1 the plugin warns in the console:
   > `[sensorium] workspace fell back to a profile directory …`
5. **Is time moving?** `pulse_samples.json` should change mtime every 2 minutes;
   `need_tension.json` every 5.
6. **Was the patch rewritten?** After upgrading another plugin, check that the ten
   rows are still there. Back the file up before installing anything.

## Known real risks

- **Shared workspace**: two agents pointing at one workspace overwrite each other's
  ten state files. One agent, one workspace.
- **The patch file is the single source of truth**: any "install/uninstall/upgrade"
  flow may rewrite it. Community managers usually preserve unknown rows, but nobody
  guarantees it. A backup is cheaper than hope.
- **`process.cwd()` fallback**: a host launched from a desktop icon may have the app
  or profile directory as its cwd. Configure `workspace` explicitly in production.
