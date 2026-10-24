// DSH plugin entry: registers the sense_face tool.
import { senseFace } from './core.js'

export const name = 'sensorium-face'
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
    name: 'sense_face',
    description:
      'Read the face: eyes (half / level / wide / narrow / away), brows (relaxed / knit / raised), mouth (relaxed / flat / corner / pressed / open), expression (neutral / warm / soft / amused / guarded / withdrawn), warmth (0..1, being seen), and `leak` - the one tell that escapes when the mask holds. Also a short `tell` clause. `changed` says the face moved; `visible` says it is noticeable.',
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
      return senseFace({ workspace })
    },
  })
}
