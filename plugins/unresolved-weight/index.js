// DSH plugin entry: registers the sense_unresolved_weight tool.
import { senseUnresolvedWeight } from './core.js'

export const name = 'sensorium-unresolved-weight'
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
    name: 'sense_unresolved_weight',
    description:
      'Read the unresolved weight: things explicitly marked as unresolved, each with its age and a weight that grows with age instead of decaying. Call with no arguments to read; use add to mark a new item, resolve to close one by id or exact title.',
    parameters: {
      type: 'object',
      properties: {
        add: { type: 'string', description: 'A short title for a new unresolved item.' },
        resolve: {
          type: 'string',
          description: 'Id or exact title of an item to mark resolved.',
        },
        note: { type: 'string', description: 'Optional note when adding an item.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute(args = {}) {
      return senseUnresolvedWeight({
        workspace,
        add: args.add,
        resolve: args.resolve,
        note: args.note,
      })
    },
  })
}
