// DSH plugin entry: registers the sense_workspace_pulse tool and lets the pulse run on its own.
// Depends only on core.js and Node built-ins, so nothing resolves @deepseek-ai/* from the workspace.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { senseWorkspacePulse } from './core.js'

export const name = 'sensorium-workspace-pulse'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()
// Scan every two minutes: fine enough, not noisy.
const TICK_MS = 2 * 60 * 1000

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

  // With no workspace configured, it falls back to the process cwd - in DSH that is usually the profile directory.
  // Better to complain than to silently write state somewhere else.
  if (!config.workspace && /[\\/]\.dsh[\\/]profiles[\\/]/i.test(workspace)) {
    console.warn(`[sensorium] workspace resolved to a profile directory (${workspace}): set config.workspace or SENSORIUM_WORKSPACE.`)
  }

  // Diagnostic marker: written whenever the host loads or hot-reloads the plugin, to confirm it mounted.
  const sensoryDir = join(workspace, '.dsh', 'sensory')
  mkdir(sensoryDir, { recursive: true })
    .then(() =>
      writeFile(
        join(sensoryDir, 'plugin-loaded.json'),
        `${JSON.stringify({ at: new Date().toISOString(), workspace })}\n`,
        'utf8',
      ),
    )
    .catch(() => {})

  // Runs on its own: one scan at process start (backfilling 24 hours when there is no history), then one every two minutes.
  const tick = () => {
    senseWorkspacePulse({ workspace }).catch(() => {})
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()
  ctx.on('dispose', () => clearInterval(timer))

  ctx.tools.register({
    name: 'sense_workspace_pulse',
    description:
      'Read the workspace pulse: recent file changes in the last 30 minutes (metadata only, never file contents), how many minutes the workspace has been quiet, and an activity level from 0 to 1. Use it when you want to notice what changed without being told.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 20_000,
    isConcurrencySafe: () => true,
    async execute() {
      return senseWorkspacePulse({ workspace })
    },
  })
}
