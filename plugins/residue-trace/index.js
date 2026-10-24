// DSH 插件入口：注册 sense_residue_trace 工具。
import { senseResidueTrace } from './core.js'

export const name = 'sensorium-residue-trace'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

  // 装完忘了配 workspace 时，默认会落到进程的 cwd——在 DSH 里那通常是 profile 目录。
  // 与其默默把状态写进别人家里，不如吵一句。
  if (!config.workspace && /[\\/]\.dsh[\\/]profiles[\\/]/i.test(workspace)) {
    console.warn(`[sensorium] workspace 落到了 profile 目录（${workspace}）：请设 config.workspace 或 SENSORIUM_WORKSPACE。`)
  }

  ctx.tools.register({
    name: 'sense_residue_trace',
    description:
      'Read the residue trace: how much emotional aftertaste is still lingering, which direction it points, and how many past events are still active. Strong emotional events decay slower than small fluctuations. This is the carry-over, not the current mood.',
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
      return senseResidueTrace({ workspace })
    },
  })
}
