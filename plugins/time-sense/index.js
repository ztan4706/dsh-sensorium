// DSH 插件入口：注册 sense_time_sense 工具。
import { senseTimeSense } from './core.js'

export const name = 'sensorium-time-sense'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

  ctx.tools.register({
    name: 'sense_time_sense',
    description:
      'Read the local time sense: local hour and minute, day phase (morning / afternoon / evening / night), whether it is late night (23:00-06:00), and how many minutes the workspace has been quiet. Use it when the time of day matters, or before deciding whether it is too late to bother someone.',
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
      return senseTimeSense({ workspace })
    },
  })
}
