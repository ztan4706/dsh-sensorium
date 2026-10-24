// DSH 插件入口：注册 sense_silence_gate 工具。
import { senseSilenceGate } from './core.js'

export const name = 'sensorium-silence-gate'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

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
