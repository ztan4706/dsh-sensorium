// DSH plugin entry: registers the sense_need_tension tool.
// v2 does two more things: settles itself every 5 minutes; listens for the user speaking (agent/inbox/claimed),
// and records "being called" in dialogue.jsonl - the most honest source of connection.
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { senseNeedTension } from './core.js'

export const name = 'sensorium-need-tension'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()
const TICK_MS = 5 * 60 * 1000

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

  // With no workspace configured, it falls back to the process cwd - in DSH that is usually the profile directory.
  // Better to complain than to silently write state somewhere else.
  if (!config.workspace && /[\\/]\.dsh[\\/]profiles[\\/]/i.test(workspace)) {
    console.warn(`[sensorium] workspace resolved to a profile directory (${workspace}): set config.workspace or SENSORIUM_WORKSPACE.`)
  }
  const sensoryDir = join(workspace, '.dsh', 'sensory')
  const dialoguePath = join(sensoryDir, 'dialogue.jsonl')

  // Dialogue is append-only; queue writes so two do not collide.
  let queue = Promise.resolve()
  const record = (entry) => {
    queue = queue
      .then(() => appendFile(dialoguePath, `${JSON.stringify(entry)}\n`, 'utf8'))
      .catch(() => {})
  }

  mkdir(sensoryDir, { recursive: true })
    .then(() =>
      appendFile(dialoguePath, '', 'utf8'),
    )
    .catch(() => {})

  ctx.on('agent/inbox/claimed', (payload) => {
    try {
      const session = payload?.agent?.session
      let cwd = session?.cwd ?? session?.header?.cwd ?? null
      if (!cwd) {
        try {
          cwd = ctx.workingDirectory?.get?.(session) ?? null
        } catch {
          cwd = null
        }
      }
      const source = payload?.message?.source
      record({
        t: Date.now(),
        session: session?.id ?? null,
        mine: cwd ? String(cwd).toLowerCase().startsWith(workspace.toLowerCase()) : null,
        source: typeof source === 'string' ? source : source?.type ?? null,
        turn: payload?.turn ?? null,
      })
    } catch {
      // If the record fails, let it go; never break the conversation over bookkeeping.
    }
  })

  const tick = () => {
    senseNeedTension({ workspace }).catch(() => {})
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()
  ctx.on('dispose', () => clearInterval(timer))

  ctx.tools.register({
    name: 'sense_need_tension',
    description:
      'Read the current need tension: connection, stimulation and resolution saturations with their deficits. Low saturation reads as a kind of emptiness, boredom, or something left unfinished. This is an internal pull, not an instruction to speak.',
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
      return senseNeedTension({ workspace })
    },
  })
}
