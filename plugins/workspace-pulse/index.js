// DSH 插件入口：注册 sense_workspace_pulse 工具，并让脉搏自己走起来。
// 只依赖 core.js 和 node 内置模块，避免从工作区解析 @deepseek-ai/*。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { senseWorkspacePulse } from './core.js'

export const name = 'sensorium-workspace-pulse'
export const inject = ['tools']

const DEFAULT_WORKSPACE = process.env.SENSORIUM_WORKSPACE || process.cwd()
// 两分钟扫一次：够细，又不吵。
const TICK_MS = 2 * 60 * 1000

export function apply(ctx, config = {}) {
  const workspace = config.workspace || DEFAULT_WORKSPACE

  // 诊断标记：插件每次被宿主加载/热重载时留一笔，方便确认挂载成功。
  const sensoryDir = join(workspace, '.dsh', 'sensory')
  mkdir(sensoryDir, { recursive: true })
    .then(() =>
      writeFile(
        join(sensoryDir, 'plugin-loaded.json'),
        `${JSON.stringify({ at: new Date().toISOString(), workspace })}\n`,
        'utf8',
      ),
    )
    .catch(() => {})

  // 自己走：进程一上来先扫一次（没有历史时顺便回填 24 小时），之后两分钟一格。
  const tick = () => {
    senseWorkspacePulse({ workspace }).catch(() => {})
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()
  ctx.on('dispose', () => clearInterval(timer))

  ctx.tools.register({
    name: 'sense_workspace_pulse',
    description:
      'Read the workspace pulse: recent file changes in the last 30 minutes (metadata only, never file contents), how many minutes the workspace has been quiet, and an activity level from 0 to 1. Use it when you want to notice what changed without being told.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 20_000,
    isConcurrencySafe: () => true,
    async execute() {
      return senseWorkspacePulse({ workspace })
    },
  })
}
