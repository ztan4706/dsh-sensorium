// DSH plugin entry: registers the sense_silence_gate tool.
import { senseSilenceGate } from './core.js'

export const name = 'sensorium-silence-gate'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

  // With no workspace configured, it falls back to the process cwd - in DSH that is usually the profile directory.
  // Better to complain than to silently write state somewhere else.
  if (!config.workspace && /[\\/]\.dsh[\\/]profiles[\\/]/i.test(workspace)) {
    console.warn(`[sensorium] workspace resolved to a profile directory (${workspace}): set config.workspace or SENSORIUM_WORKSPACE.`)
  }

  ctx.tools.register({
    name: 'sense_silence_gate',
    description:
      'Decide whether to speak proactively: reads initiative, time of day and workspace activity, then returns should_speak, should_stay_silent, a reason and a confidence. This is advice, not a command; staying silent is a valid output.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute() {
      return senseSilenceGate({ workspace })
    },
  })
}
