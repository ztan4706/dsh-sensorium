// DSH 插件入口：注册 sense_need_tension 工具。
// v2 多做两件事：每 5 分钟自己结算一次；听用户说话（agent/inbox/claimed），
// 把"被叫了一声"记进 dialogue.jsonl——这是连接最真实的来源。
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { senseNeedTension } from './core.js'

export const name = 'sensorium-need-tension'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()
const TICK_MS = 5 * 60 * 1000

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE
  const sensoryDir = join(workspace, '.dsh', 'sensory')
  const dialoguePath = join(sensoryDir, 'dialogue.jsonl')

  // 对话是追加写，串起来免得两次写打架。
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
      // 记不上就算了，不能因为记账把对话搞挂
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
