// DSH 插件入口：注册 sense_body 工具。
import { senseBody } from './core.js'

export const name = 'sensorium-body'
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
    name: 'sense_body',
    description:
      'Read the body: posture (slumped / perched / upright / leaning), tail (still / slow / beat / flick / thump), ears (drooped / tilted / perked / half), hands (empty / table / pockets / chin), tempo, energy, heaviness, stillness, intensity, plus a short Chinese `tell` clause. `changed` says the body moved since the last read; `visible` says it is noticeable enough to show. Nothing here is decoration: it is derived from affect, need and the hour.',
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
      return senseBody({ workspace })
    },
  })
}
