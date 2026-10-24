// DSH plugin entry: registers the sense_affect_core tool and lets it run on its own clock.
import { senseAffectCore } from './core.js'

export const name = 'sensorium-affect-core'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()
// Every five minutes: mood needs no finer resolution, but it should not exist only when asked about.
const TICK_MS = 5 * 60 * 1000

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

  // With no workspace configured, it falls back to the process cwd - in DSH that is usually the profile directory.
  // Better to complain than to silently write state somewhere else.
  if (!config.workspace && /[\\/]\.dsh[\\/]profiles[\\/]/i.test(workspace)) {
    console.warn(`[sensorium] workspace resolved to a profile directory (${workspace}): set config.workspace or SENSORIUM_WORKSPACE.`)
  }

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
