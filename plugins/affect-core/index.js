// DSH 插件入口：注册 sense_affect_core 工具，并让它自己随时间走。
import { senseAffectCore } from './core.js'

export const name = 'sensorium-affect-core'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()
// 五分钟一次：情绪不需要更细，但也不能只在被问起时才存在。
const TICK_MS = 5 * 60 * 1000

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

  const tick = () => {
    senseAffectCore({ workspace }).catch(() => {})
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()
  ctx.on('dispose', () => clearInterval(timer))

  ctx.tools.register({
    name: 'sense_affect_core',
    description:
      'Read the current affective core: valence (-1..1), arousal (0..1), dominance (0..1). Values decay toward baseline over time and are only slightly nudged by recent workspace activity. This is an internal state, not a script for what to say.',
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
      return senseAffectCore({ workspace })
    },
  })
}
